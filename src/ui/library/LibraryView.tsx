/**
 * Presentation library: the app's home screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createDeck } from '../../domain/commands'
import { describeError } from '../../domain/result'
import { newFolderId } from '../../domain/ids'
import { domFitCheckers } from '../../state/measure'
import { repository, storageMode } from '../../persistence/activeRepository'
import { exportSlaidsArchive, importSlaidsArchive, suggestedFileName } from '../../persistence/backup'
import { estimateStorage, requestPersistentStorage, type StorageEstimateInfo } from '../../persistence/db'
import { notify } from '../../state/toast'
import { useSessionStore } from '../../state/session'
import {
  downloadBlob,
  duplicatePresentation,
  movePresentationToFolder,
  renamePresentation,
} from '../../state/libraryActions'
import type { Folder, PresentationSummary } from '../../domain/types'
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Modal } from '../components/Modal'
import { NewPresentationModal, type NewPresentationResult } from './NewPresentationModal'
import { AgentTokensModal } from './AgentTokensModal'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('nb-NO', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function LibraryView({ onOpen }: { onOpen: (id: string) => void }) {
  const [summaries, setSummaries] = useState<PresentationSummary[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<PresentationSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<PresentationSummary | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null)
  const [storage, setStorage] = useState<StorageEstimateInfo | null>(null)
  const [persisted, setPersisted] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [managingTokens, setManagingTokens] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const mode = storageMode()
  const sessionEmail = useSessionStore((state) => state.email)
  const signOut = useSessionStore((state) => state.signOut)

  const [reloadToken, setReloadToken] = useState(0)
  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])

  useEffect(() => {
    let cancelled = false
    Promise.all([repository.listPresentations(), repository.listFolders()])
      .then(([list, folderList]) => {
        if (cancelled) return
        setSummaries(list)
        setFolders(folderList)
        setLoadError(null)
        setLoading(false)
      })
      .catch((error: unknown) => {
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

  const create = async (result: NewPresentationResult): Promise<void> => {
    // The deck's name is also the first line of its cover, so it is measured
    // like any other line on a page. A refusal leaves the dialog open with the
    // name still in it, which is where the author fixes it.
    const created = createDeck(
      { title: result.title, theme: result.theme, folderId: activeFolder },
      domFitCheckers,
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
    setCreating(false)
    onOpen(presentation.id)
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
      await repository.deletePresentation(deleting.id)
      notify.info('Presentasjonen ble slettet.')
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Kunne ikke slette presentasjonen.')
    }
    setDeleting(null)
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
    if (!name?.trim()) return
    try {
      await repository.saveFolder({
        id: newFolderId(),
        name: name.trim(),
        createdAt: new Date().toISOString(),
      })
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Kunne ikke lage mappen.')
      return
    }
    refresh()
  }

  const visible = summaries.filter((summary) =>
    activeFolder === null ? true : summary.folderId === activeFolder,
  )

  return (
    <div className="library">
      <header className="library__header">
        <div>
          <h1 className="library__title">Slaids</h1>
          <p className="library__subtitle">Presentasjoner med matematisk stram soneinndeling.</p>
        </div>
        <div className="library__actions">
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
            className={activeFolder === null ? 'folder-item folder-item--active' : 'folder-item'}
            onClick={() => setActiveFolder(null)}
          >
            <Icon name="folder" size={15} /> Alle ({summaries.length})
          </button>
          {folders.map((folder) => (
            <div key={folder.id} className="folder-row">
              <button
                type="button"
                className={activeFolder === folder.id ? 'folder-item folder-item--active' : 'folder-item'}
                onClick={() => setActiveFolder(folder.id)}
                data-testid="folder-item"
                data-folder-name={folder.name}
              >
                <Icon name="folder" size={15} /> {folder.name} (
                {summaries.filter((summary) => summary.folderId === folder.id).length})
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                aria-label={`Slett mappen ${folder.name}`}
                onClick={() => setDeletingFolder(folder)}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
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
          {!loading && !loadError && visible.length === 0 && (
            <div className="library__empty">
              <p>Ingen presentasjoner her ennå.</p>
              <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
                <Icon name="plus" /> Lag den første
              </button>
            </div>
          )}
          {visible.map((summary) => (
            <article key={summary.id} className="presentation-card" data-testid="presentation-card">
              <button
                type="button"
                className="presentation-card__open"
                onClick={() => onOpen(summary.id)}
                data-testid="open-presentation"
              >
                <span className="presentation-card__name">{summary.title}</span>
                <span className="presentation-card__meta">
                  {summary.slideCount} slide{summary.slideCount === 1 ? '' : 's'} ·{' '}
                  {formatDate(summary.updatedAt)}
                </span>
              </button>
              <div className="presentation-card__tools">
                <Tooltip label="Gi nytt navn">
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    onClick={() => {
                      setRenaming(summary)
                      setRenameValue(summary.title)
                    }}
                    aria-label={`Gi ${summary.title} nytt navn`}
                    data-testid="rename-presentation"
                  >
                    <Icon name="edit" size={15} />
                  </button>
                </Tooltip>
                <Tooltip label="Dupliser">
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    aria-label={`Dupliser ${summary.title}`}
                    data-testid="duplicate-presentation"
                    onClick={() => void handleDuplicate(summary.id)}
                  >
                    <Icon name="copy" size={15} />
                  </button>
                </Tooltip>
                <Tooltip label="Last ned sikkerhetskopi">
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    onClick={() => void handleExport(summary)}
                    aria-label={`Last ned sikkerhetskopi av ${summary.title}`}
                    data-testid="export-presentation"
                  >
                    <Icon name="download" size={15} />
                  </button>
                </Tooltip>
                <Tooltip label="Slett">
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    onClick={() => setDeleting(summary)}
                    aria-label={`Slett ${summary.title}`}
                    data-testid="delete-presentation"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </Tooltip>
                {folders.length > 0 && (
                  <select
                    className="select select--inline"
                    value={summary.folderId ?? ''}
                    aria-label={`Mappe for ${summary.title}`}
                    data-testid="folder-select"
                    onChange={(event) => {
                      void movePresentationToFolder(summary.id, event.target.value || null)
                        .catch((error: unknown) => {
                          notify.error(
                            error instanceof Error ? error.message : 'Kunne ikke flytte presentasjonen.',
                          )
                        })
                        .finally(() => refresh())
                    }}
                  >
                    <option value="">Ingen mappe</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                )}
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

      {/* Mounted only while open: closing is what drops a freshly created
          token out of memory, rather than an effect that clears it. */}
      {managingTokens && <AgentTokensModal open onOpenChange={setManagingTokens} />}

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
        title="Gi nytt navn"
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
              onClick={() => {
                if (!renaming) return
                void renamePresentation(renaming.id, renameValue)
                  .catch((error: unknown) => {
                    notify.error(
                      error instanceof Error ? error.message : 'Kunne ikke gi nytt navn.',
                    )
                  })
                  .finally(() => {
                    setRenaming(null)
                    refresh()
                  })
              }}
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
        />
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Slette presentasjonen?"
        message={`«${deleting?.title ?? ''}» og alle tilhørende filer slettes permanent. Dette kan ikke angres.`}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={deletingFolder !== null}
        title="Slette mappen?"
        message={`Mappen «${deletingFolder?.name ?? ''}» slettes. Presentasjonene i den blir liggende, men uten mappe.`}
        onConfirm={() => {
          if (!deletingFolder) return
          void repository
            .deleteFolder(deletingFolder.id)
            .catch((error: unknown) => {
              notify.error(error instanceof Error ? error.message : 'Kunne ikke slette mappen.')
            })
            .finally(() => {
              setDeletingFolder(null)
              setActiveFolder(null)
              refresh()
            })
        }}
        onCancel={() => setDeletingFolder(null)}
      />
    </div>
  )
}
