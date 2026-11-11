/**
 * Presentation library: the app's home screen.
 *
 * Three views of the same store, chosen in the sidebar: everything, one folder,
 * or the trash. The first two are the library — what `listPresentations`
 * returns, filtered by folder — and the third is what was deleted from it and
 * can still come back. A deletion here is a move to the trash; what empties the
 * trash is the sweep that runs when the library opens, or the button that
 * empties it by hand, and both go through the one permanent delete the
 * repository has.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createDeck } from '../../domain/commands'
import { describeError } from '../../domain/result'
import { HUMAN_EDIT } from '../../domain/commands/manualLayout'
import { repository, storageMode } from '../../persistence/activeRepository'
import { exportSlaidsArchive, importSlaidsArchive, suggestedFileName } from '../../persistence/backup'
import { estimateStorage, requestPersistentStorage, type StorageEstimateInfo } from '../../persistence/db'
import {
  TRASH_RETENTION_DAYS,
  emptyTrash,
  purgeExpiredTrash,
  trashExpiry,
} from '../../persistence/library'
import { useFolderSharing } from '../../state/folderSharing'
import { notify } from '../../state/toast'
import { useSessionStore } from '../../state/session'
import {
  createFolder,
  downloadBlob,
  duplicatePresentation,
  movePresentationToFolder,
  renameFolder,
  renamePresentation,
} from '../../state/libraryActions'
import { useAppearance } from '../../state/appearance'
import { readDefaultTheme } from '../../state/defaultTheme'
import { defaultThemeTemplate, startInThemeTemplate } from '../editor/themeTemplates'
import type { Folder, Presentation, PresentationSummary } from '../../domain/types'
import { copyToClipboard } from '../components/clipboard'
import { Icon } from '../components/Icon'
import { formatBytes, formatSlideCount } from '../format'
import { Tooltip } from '../components/Tooltip'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ContextMenuHost } from '../components/ContextMenuHost'
import { MenuButton } from '../components/MenuButton'
import { APPEARANCE_TITLE, appearanceEntries } from '../components/appearanceMenu'
import { Modal } from '../components/Modal'
import { NewPresentationModal, type NewPresentationResult } from './NewPresentationModal'
import { AdminUsersModal } from './AdminUsersModal'
import { AgentTokensModal } from './AgentTokensModal'
import { UserSettingsModal } from './UserSettingsModal'
import { FolderSelect } from './FolderSelect'
import { FolderShareButton } from './FolderShareButton'
import { folderEntries, presentationEntries } from './libraryMenus'

/**
 * Gi en nettopp lagret presentasjon standardmalen brukeren har valgt (§ 15.4).
 * Går det ikke, beholdes presentasjonen slik den ble opprettet, og personen får
 * vite hvorfor: den finnes allerede, og temaet kan velges i temaeditoren.
 */
async function startInDefaultTemplate(presentation: Presentation): Promise<void> {
  try {
    const template = await defaultThemeTemplate()
    if (!template) return
    const started = await startInThemeTemplate(presentation, template)
    if (!started.ok) notify.warning(`Standardmalen kunne ikke brukes: ${describeError(started.error)}`)
  } catch {
    notify.warning('Standardmalen kunne ikke hentes, så presentasjonen starter i standardtemaet.')
  }
}

/** Which of the store's listings the grid is showing. */
type LibraryScope = { kind: 'all' } | { kind: 'folder'; id: string } | { kind: 'trash' }

/** What the rename dialog is open for: one presentation, or one folder. */
type RenameTarget =
  | { kind: 'presentation'; summary: PresentationSummary }
  | { kind: 'folder'; folder: Folder }

function formatDate(value: string | Date, style: 'minute' | 'day' = 'minute'): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('nb-NO', {
    dateStyle: 'medium',
    ...(style === 'minute' ? { timeStyle: 'short' } : {}),
  }).format(date)
}

/** Hvordan et dekk åpnes fra biblioteket. */
export interface OpenOptions {
  /** Åpne temaeditoren straks dekket er lastet – det et nytt dekk gjør (§ 15.1). */
  openTheme?: boolean
}

export function LibraryView({ onOpen }: { onOpen: (id: string, options?: OpenOptions) => void }) {
  const [summaries, setSummaries] = useState<PresentationSummary[]>([])
  const [trashed, setTrashed] = useState<PresentationSummary[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [scope, setScope] = useState<LibraryScope>({ kind: 'all' })
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<RenameTarget | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<PresentationSummary | null>(null)
  /** A trashed presentation about to be deleted for good. */
  const [purging, setPurging] = useState<PresentationSummary | null>(null)
  const [emptyingTrash, setEmptyingTrash] = useState(false)
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  const [storage, setStorage] = useState<StorageEstimateInfo | null>(null)
  const [persisted, setPersisted] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [managingTokens, setManagingTokens] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [managingUsers, setManagingUsers] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const mode = storageMode()
  const sessionEmail = useSessionStore((state) => state.email)
  const signOut = useSessionStore((state) => state.signOut)
  const sessionUserId = useSessionStore((state) => state.userId)
  const refreshAccess = useSessionStore((state) => state.refreshAccess)
  // Only a convenience: the server checks the role again on every call.
  const isAdmin = useSessionStore((state) => state.role === 'admin') && mode === 'supabase'

  const [reloadToken, setReloadToken] = useState(0)
  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])

  const activeFolder = scope.kind === 'folder' ? scope.id : null
  const folderShares = useFolderSharing(reloadToken)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      // The automatic emptying, before the listing, so what is shown is what
      // remains. Best effort, like the orphan sweep below: a purge the store
      // refused leaves the entry in the trash for the next visit, or for the
      // button, and must not stand between the user and their library.
      try {
        await purgeExpiredTrash(repository)
      } catch {
        // Still in the trash, still on the clock.
      }
      const [list, folderList, trashList] = await Promise.all([
        repository.listPresentations(),
        repository.listFolders(),
        repository.listTrashedPresentations(),
      ])
      if (cancelled) return
      setSummaries(list)
      setFolders(folderList)
      setTrashed(trashList)
      setLoadError(null)
      setLoading(false)
    }
    load().catch((error: unknown) => {
      if (cancelled) return
      // In Supabase mode there is nowhere else to read from: say so rather
      // than showing an empty library that looks like lost work.
      setLoadError(error instanceof Error ? error.message : 'Kunne ikke hente biblioteket.')
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  useEffect(() => {
    let cancelled = false
    // Browser storage quota only means something when the browser *is* the
    // storage.
    if (mode === 'local') {
      requestPersistentStorage().then((granted) => {
        if (!cancelled) setPersisted(granted)
      })
      estimateStorage().then((info) => {
        if (!cancelled) setStorage(info)
      })
    }
    // Reclaim any asset left behind by an interrupted import or duplicate.
    void repository.deleteOrphanAssets()
    return () => {
      cancelled = true
    }
  }, [reloadToken, mode])

  /**
   * Et nytt dekk: bare tittelen er spurt om. Resten er gjeldende standardtema
   * og standardfargene, og temaeditoren åpnes over dekket så snart det er
   * lastet (§ 15.1). Dekket er lagret før editoren åpnes, så å lukke
   * temaeditoren beholder det.
   */
  const create = async (result: NewPresentationResult): Promise<void> => {
    // Navnet er også forsidens første linje. Et navn for langt for linjen tas
    // imot og settes i mindre skrift der.
    const created = createDeck(
      { title: result.title, theme: readDefaultTheme(), folderId: activeFolder },
      HUMAN_EDIT,
    )
    if (!created.ok) {
      notify.error(describeError(created.error))
      return
    }
    const presentation = created.value
    try {
      await repository.savePresentation(presentation)
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Kunne ikke opprette presentasjonen.')
      return
    }
    await startInDefaultTemplate(presentation)
    setCreating(false)
    onOpen(presentation.id, { openTheme: true })
  }

  const handleDuplicate = async (id: string): Promise<void> => {
    try {
      await duplicatePresentation(id)
      refresh()
      notify.success('Presentasjonen ble kopiert.')
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Kunne ikke kopiere presentasjonen.')
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!deleting) return
    try {
      await repository.trashPresentation(deleting.id)
      notify.info(`«${deleting.title}» ble flyttet til søppelkassen.`)
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Kunne ikke slette presentasjonen.')
    }
    setDeleting(null)
    refresh()
  }

  const handleRestore = async (summary: PresentationSummary): Promise<void> => {
    try {
      await repository.restorePresentation(summary.id)
      notify.success(`«${summary.title}» ble gjenopprettet.`)
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Kunne ikke gjenopprette presentasjonen.')
    }
    refresh()
  }

  const handlePurge = async (): Promise<void> => {
    if (!purging) return
    try {
      // Conditioned on the card still being the trash entry it was when the
      // dialog opened. A deck restored from another tab in the meantime is
      // live again, and a delete that did not look would take it down.
      const purged =
        purging.deletedAt !== null &&
        (await repository.purgePresentation(purging.id, purging.deletedAt))
      if (purged) notify.info(`«${purging.title}» ble slettet for godt.`)
      else {
        notify.warning(
          `«${purging.title}» ligger ikke lenger i søppelkassen – den er gjenopprettet eller slettet et annet sted, og ble ikke rørt.`,
        )
      }
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Kunne ikke slette presentasjonen.')
    }
    setPurging(null)
    refresh()
  }

  const handleEmptyTrash = async (): Promise<void> => {
    try {
      const purged = await emptyTrash(repository)
      notify.info(
        purged === 1
          ? 'Søppelkassen ble tømt: én presentasjon ble slettet for godt.'
          : `Søppelkassen ble tømt: ${purged} presentasjoner ble slettet for godt.`,
      )
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Kunne ikke tømme søppelkassen.')
    }
    setEmptyingTrash(false)
    refresh()
  }

  const handleExport = async (summary: PresentationSummary): Promise<void> => {
    try {
      const archive = await exportSlaidsArchive(repository, { presentationIds: [summary.id] })
      downloadBlob(archive, suggestedFileName(summary.title))
      notify.success('Sikkerhetskopi lastet ned.')
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Eksport feilet.')
    }
  }

  const handleCopyId = async (summary: PresentationSummary): Promise<void> => {
    if (await copyToClipboard(summary.id)) notify.success('Presentasjons-ID kopiert')
    else notify.error('Kunne ikke kopiere presentasjons-ID.')
  }

  const handleImport = async (file: File): Promise<void> => {
    try {
      const report = await importSlaidsArchive(repository, file)
      refresh()
      for (const error of report.errors.slice(0, 3)) notify.error(error)
      if (report.importedPresentations.length > 0) {
        notify.success(
          `Importerte ${report.importedPresentations.length} presentasjon(er) og ${report.importedAssets} fil(er).`,
        )
      }
    } catch (error) {
      refresh()
      notify.error(
        `Importen feilet: ${error instanceof Error ? error.message : 'ukjent feil'}.`,
      )
    }
  }

  const addFolder = async (): Promise<void> => {
    const name = window.prompt('Navn på mappen')
    // Cancelled, or nothing typed. Not an error and not worth a message: the
    // same reading `renamePresentation` gives an emptied field.
    if (!name?.trim()) return
    try {
      // What a new folder is — the trimmed name, its length, the minted id, the
      // timestamp — is decided one layer down, so the agent's `create_folder`
      // makes exactly this row and refuses exactly the same names. A refusal
      // that reaches here is one the typist has to see; a dialog that closes and
      // quietly does nothing is worse than either outcome.
      const created = await createFolder(name)
      if (!created.ok) {
        notify.error(describeError(created.error))
        return
      }
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Kunne ikke lage mappen.')
      return
    }
    refresh()
  }

  const startRenaming = (target: RenameTarget): void => {
    setRenaming(target)
    setRenameValue(target.kind === 'folder' ? target.folder.name : target.summary.title)
  }

  const handleRename = async (): Promise<void> => {
    if (!renaming) return
    try {
      if (renaming.kind === 'presentation') {
        await renamePresentation(renaming.summary.id, renameValue)
      } else {
        const renamed = await renameFolder(renaming.folder.id, renameValue)
        // An emptied field keeps the old name, as for a presentation. A folder
        // deleted elsewhere is said and the library reloaded without it. Any
        // other refusal — a name that is too long — is one the typist has to
        // fix, so the dialog stays open with the name still in it.
        if (!renamed.ok && renamed.error.code === 'FOLDER_NOT_FOUND') {
          notify.error(describeError(renamed.error))
        } else if (!renamed.ok && renameValue.trim()) {
          notify.error(describeError(renamed.error))
          return
        }
      }
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Kunne ikke gi nytt navn.')
    }
    setRenaming(null)
    refresh()
  }

  const inTrash = scope.kind === 'trash'
  const visible = inTrash
    ? trashed
    : summaries.filter((summary) => activeFolder === null || summary.folderId === activeFolder)

  const folderClass = (active: boolean): string =>
    active ? 'folder-item folder-item--active' : 'folder-item'

  return (
    <div className="library">
      <header className="library__header">
        <div>
          <h1 className="library__title">Slaids</h1>
          <p className="library__subtitle">Presentasjoner med matematisk stram soneinndeling.</p>
        </div>
        <div className="library__actions">
          <MenuButton
            id="library-appearance"
            label={APPEARANCE_TITLE}
            title={APPEARANCE_TITLE}
            tooltip="Mørk, lys eller som systemet"
            icon="appearance"
            className="btn--ghost"
            testId="library-appearance"
            entries={() => {
              const { appearance, setAppearance } = useAppearance.getState()
              return appearanceEntries(appearance, setAppearance)
            }}
          />
          {mode === 'supabase' && (
            <Tooltip label="Nøkler en KI-agent bruker mot Slaids' REST-API">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setManagingTokens(true)}
                data-testid="manage-agent-tokens"
              >
                <Icon name="code" size={15} /> Agenttokens
              </button>
            </Tooltip>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="tools" size={15} /> Brukerinnstillinger
          </button>
          {isAdmin && (
            <MenuButton
              id="library-administration"
              label="Administrasjon"
              title="Administrasjon"
              tooltip="Brukere og tilgang til Slaids"
              icon="users"
              className="btn--ghost"
              testId="library-administration"
              entries={() => [
                {
                  kind: 'action',
                  id: 'admin-users',
                  label: 'Brukere',
                  icon: 'users',
                  testId: 'open-admin-users',
                  onSelect: () => setManagingUsers(true),
                },
              ]}
            />
          )}
          {mode === 'supabase' && (
            <Tooltip label={sessionEmail ? `Logget inn som ${sessionEmail}` : 'Logg ut'}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void signOut()}
                data-testid="sign-out"
              >
                <Icon name="sign-out" size={15} /> Logg ut
              </button>
            </Tooltip>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".slaids,application/x-slaids+zip,application/zip"
            style={{ display: 'none' }}
            data-testid="import-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void handleImport(file)
            }}
          />
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" /> Importer
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setCreating(true)}
            data-testid="new-presentation"
          >
            <Icon name="plus" /> Ny presentasjon
          </button>
        </div>
      </header>

      <div className="library__body">
        <aside className="library__folders">
          <div className="library__folders-head">
            <span>Mapper</span>
            <Tooltip label="Ny mappe">
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                onClick={() => void addFolder()}
                aria-label="Ny mappe"
                data-testid="new-folder"
              >
                <Icon name="plus" size={15} />
              </button>
            </Tooltip>
          </div>
          <button
            type="button"
            className={folderClass(scope.kind === 'all')}
            onClick={() => setScope({ kind: 'all' })}
          >
            <Icon name="folder" size={15} /> Alle ({summaries.length})
          </button>
          {folders.map((folder) => (
            <div key={folder.id} className="folder-row">
              <button
                type="button"
                className={folderClass(activeFolder === folder.id)}
                onClick={() => setScope({ kind: 'folder', id: folder.id })}
                data-testid="folder-item"
                data-folder-name={folder.name}
              >
                <Icon name="folder" size={15} /> {folder.name} (
                {summaries.filter((summary) => summary.folderId === folder.id).length})
              </button>
              {/* Whether the folder is shared is a state, so it stays in sight;
                  renaming and deleting are rare, so they wait in the menu. */}
              <div className="folder-row__tools">
                <FolderShareButton
                  folderName={folder.name}
                  status={folderShares.status}
                  state={folderShares.stateOf(folder.id)}
                  busy={folderShares.busyFolderId === folder.id}
                  onSetShared={(shared) => void folderShares.setShared(folder.id, shared)}
                />
                <MenuButton
                  id={`folder-menu-${folder.id}`}
                  label={`Flere handlinger for mappen ${folder.name}`}
                  title={folder.name}
                  tooltip="Flere handlinger"
                  icon="more"
                  className="btn--icon menu-button--icon"
                  testId="folder-more"
                  entries={() =>
                    folderEntries({
                      rename: () => startRenaming({ kind: 'folder', folder }),
                      remove: () => setDeletingFolder(folder),
                    })
                  }
                />
              </div>
            </div>
          ))}
          <div className="library__folders-divider" role="presentation" />
          <button
            type="button"
            className={folderClass(inTrash)}
            onClick={() => setScope({ kind: 'trash' })}
            data-testid="trash-view"
          >
            <Icon name="trash" size={15} /> Søppelkasse ({trashed.length})
          </button>
        </aside>

        <main className="library__grid" data-testid="presentation-grid">
          {loading && <p className="hint">Laster …</p>}
          {!loading && loadError && (
            <div className="library__empty" data-testid="library-error">
              <p className="error-text">{loadError}</p>
              <p className="hint">
                {mode === 'supabase'
                  ? 'Biblioteket ligger i Supabase. Ingenting lagres lokalt i mellomtiden.'
                  : 'Nettleserlagringen svarte ikke.'}
              </p>
              <button type="button" className="btn" onClick={refresh}>
                Prøv igjen
              </button>
            </div>
          )}
          {!loading && !loadError && inTrash && (
            <div className="library__trash-head" data-testid="trash-head">
              <p className="hint">
                Presentasjoner i søppelkassen slettes for godt etter {TRASH_RETENTION_DAYS} dager.
                Fram til da kan de gjenopprettes.
              </p>
              <button
                type="button"
                className="btn btn--sm"
                disabled={trashed.length === 0}
                onClick={() => setEmptyingTrash(true)}
                data-testid="empty-trash"
              >
                <Icon name="trash" size={15} /> Tøm søppelkassen
              </button>
            </div>
          )}
          {!loading && !loadError && visible.length === 0 && (
            <div className="library__empty">
              {inTrash ? (
                <p>Søppelkassen er tom.</p>
              ) : (
                <>
                  <p>Ingen presentasjoner her ennå.</p>
                  <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
                    <Icon name="plus" /> Lag den første
                  </button>
                </>
              )}
            </div>
          )}
          {inTrash
            ? visible.map((summary) => (
                <article
                  key={summary.id}
                  className="presentation-card presentation-card--trashed"
                  data-testid="trashed-card"
                >
                  {/* Not a button: a trashed deck is not opened, it is brought
                      back first. What it costs stays on the card, because the
                      trash is where one goes looking for what to let go of. */}
                  <div className="presentation-card__body">
                    <span className="presentation-card__name">{summary.title}</span>
                    <span className="presentation-card__meta">
                      {formatSlideCount(summary.slideCount)} ·{' '}
                      <span data-testid="presentation-size">{formatBytes(summary.byteSize)}</span>
                    </span>
                    {summary.deletedAt && (
                      <span className="presentation-card__meta" data-testid="trash-dates">
                        Slettet {formatDate(summary.deletedAt)} · slettes for godt{' '}
                        {formatDate(trashExpiry(summary.deletedAt), 'day')}
                      </span>
                    )}
                  </div>
                  <div className="presentation-card__tools">
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => void handleRestore(summary)}
                      data-testid="restore-presentation"
                    >
                      <Icon name="undo" size={15} /> Gjenopprett
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm presentation-card__purge"
                      onClick={() => setPurging(summary)}
                      aria-label={`Slett ${summary.title} for godt`}
                      data-testid="purge-presentation"
                    >
                      <Icon name="trash" size={15} /> Slett for godt …
                    </button>
                  </div>
                </article>
              ))
            : visible.map((summary) => (
                <article key={summary.id} className="presentation-card" data-testid="presentation-card">
                  {/* The card's face is the one thing it is for: opening the
                      presentation. Its name, what it holds, and the word. */}
                  <button
                    type="button"
                    className="presentation-card__open"
                    onClick={() => onOpen(summary.id)}
                    data-testid="open-presentation"
                  >
                    <span className="presentation-card__name">{summary.title}</span>
                    <span className="presentation-card__meta">
                      {formatSlideCount(summary.slideCount)} ·{' '}
                      {formatDate(summary.updatedAt)} ·{' '}
                      <span data-testid="presentation-size">{formatBytes(summary.byteSize)}</span>
                    </span>
                    <span className="presentation-card__cue" aria-hidden="true">
                      Åpne
                    </span>
                  </button>
                  <div className="presentation-card__tools">
                    {folders.length > 0 && (
                      <FolderSelect
                        value={summary.folderId}
                        folders={folders}
                        ariaLabel={`Mappe for ${summary.title}`}
                        onChange={(folderId) => {
                          void movePresentationToFolder(summary.id, folderId)
                            .catch((error: unknown) => {
                              notify.error(
                                error instanceof Error ? error.message : 'Kunne ikke flytte presentasjonen.',
                              )
                            })
                            .finally(() => refresh())
                        }}
                      />
                    )}
                    <MenuButton
                      id={`presentation-menu-${summary.id}`}
                      label={`Flere handlinger for ${summary.title}`}
                      title={summary.title}
                      tooltip="Gi nytt navn, dupliser, kopier ID, last ned eller slett"
                      icon="more"
                      className="presentation-card__more"
                      testId="presentation-more"
                      entries={() =>
                        presentationEntries({
                          rename: () => startRenaming({ kind: 'presentation', summary }),
                          duplicate: () => void handleDuplicate(summary.id),
                          copyId: () => void handleCopyId(summary),
                          exportBackup: () => void handleExport(summary),
                          trash: () => setDeleting(summary),
                        })
                      }
                    >
                      <span className="menu-button__label">Flere handlinger</span>
                    </MenuButton>
                  </div>
                </article>
              ))}
        </main>
      </div>

      <footer className="library__footer" data-testid="library-footer">
        {mode === 'supabase' ? (
          <>
            <span>
              Lagres i Supabase{sessionEmail ? ` · ${sessionEmail}` : ''}
            </span>
            <span className="hint">
              Presentasjonene følger kontoen din. Last gjerne ned en sikkerhetskopi før
              store omskrivinger.
            </span>
          </>
        ) : (
          <>
            <span>
              {storage
                ? `Bruker ${formatBytes(storage.usage)}${
                    storage.quota > 0 ? ` av ${formatBytes(storage.quota)}` : ''
                  } lokalt`
                : 'Lagres lokalt i nettleseren'}
              {persisted ? ' · varig lagring innvilget' : ''}
            </span>
            <span className="hint">
              Nettleserlagring kan bli tømt. Last ned en sikkerhetskopi av det du ikke vil miste.
            </span>
          </>
        )}
      </footer>

      {/* The library's menus are the app's one menu, as in the editor. */}
      <ContextMenuHost />

      {/* Mounted only while open: closing is what drops a freshly created
          token out of memory, rather than an effect that clears it. */}
      {managingTokens && <AgentTokensModal open onOpenChange={setManagingTokens} />}
      {settingsOpen && <UserSettingsModal open onOpenChange={setSettingsOpen} />}
      {isAdmin && managingUsers && (
        <AdminUsersModal
          open
          onOpenChange={setManagingUsers}
          currentUserId={sessionUserId}
          onOwnAccessChanged={() => void refreshAccess()}
        />
      )}

      <NewPresentationModal
        open={creating}
        onOpenChange={setCreating}
        onCreate={(result) => void create(result)}
      />

      <Modal
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null)
        }}
        title={renaming?.kind === 'folder' ? 'Gi mappen nytt navn' : 'Gi nytt navn'}
        width={460}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setRenaming(null)}>
              Avbryt
            </button>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="rename-confirm"
              onClick={() => void handleRename()}
            >
              Lagre
            </button>
          </>
        }
      >
        <input
          className="input"
          value={renameValue}
          autoFocus
          data-testid="rename-input"
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleRename()
          }}
        />
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Flytte presentasjonen til søppelkassen?"
        message={`«${deleting?.title ?? ''}» flyttes til søppelkassen. Der kan den gjenopprettes i ${TRASH_RETENTION_DAYS} dager, før den og alle tilhørende filer slettes for godt.`}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={purging !== null}
        title="Slette presentasjonen for godt?"
        message={`«${purging?.title ?? ''}» og alle tilhørende filer slettes permanent. Dette kan ikke angres.`}
        confirmLabel="Slett for godt"
        onConfirm={() => void handlePurge()}
        onCancel={() => setPurging(null)}
      />

      <ConfirmDialog
        open={emptyingTrash}
        title="Tømme søppelkassen?"
        message={
          trashed.length === 1
            ? 'Presentasjonen i søppelkassen og alle tilhørende filer slettes permanent. Dette kan ikke angres.'
            : `Alle ${trashed.length} presentasjonene i søppelkassen og alle tilhørende filer slettes permanent. Dette kan ikke angres.`
        }
        confirmLabel="Tøm søppelkassen"
        onConfirm={() => void handleEmptyTrash()}
        onCancel={() => setEmptyingTrash(false)}
      />

      <ConfirmDialog
        open={deletingFolder !== null}
        title="Slette mappen?"
        message={`Mappen «${deletingFolder?.name ?? ''}» slettes. Presentasjonene i den blir liggende, men uten mappe.${
          deletingFolder && folderShares.stateOf(deletingFolder.id).shared
            ? ' Delingslenken til mappen slutter å virke.'
            : ''
        }`}
        onConfirm={() => {
          if (!deletingFolder) return
          void repository
            .deleteFolder(deletingFolder.id)
            .catch((error: unknown) => {
              notify.error(error instanceof Error ? error.message : 'Kunne ikke slette mappen.')
            })
            .finally(() => {
              setDeletingFolder(null)
              setScope({ kind: 'all' })
              refresh()
            })
        }}
        onCancel={() => setDeletingFolder(null)}
      />
    </div>
  )
}
