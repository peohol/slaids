/**
 * The desktop's main toolbar, arranged by what each control acts on
 * (docs/UX_BASELINE.md § 4.1):
 *
 *   presentation  – back, title and save state;          (left, always)
 *   the slide     – editing mode and its title zone;
 *   history       – undo and redo;
 *   the selection – its content kind, and a picture file;
 *   tools         – the «Presentasjon» and «Verktøy» menus;
 *   showing       – share and present.                    (right, always)
 *
 * Nothing is allowed to leave the window. As it narrows, labels give way to
 * their icons, least needed first (see `.toolbar` in editor.css); the controls
 * and their accessible names stay.
 */

import { useRef } from 'react'
import type { ZoneContentKind } from '../../domain/types'
import { useSharingStore, useShareUrl } from '../../state/sharing'
import { useEditorStore } from '../../state/store'
import { anchorBelow, useContextMenu, type MenuEntry } from '../components/contextMenu'
import { Icon, type IconName, type IconTone } from '../components/Icon'
import { pressedButton } from '../components/pressed'
import { Tooltip } from '../components/Tooltip'
import { contentKindEntries, type ContentKindOption } from './contentKinds'
import { ShareToggle } from './ShareToggle'
import { SaveIndicator } from './StatusBar'
import { helperToolEntries, presentationToolEntries } from './toolbarMenus'

export interface TopToolbarProps {
  title: string
  hasTitleZone: boolean
  canToggleTitle: boolean
  /**
   * False on a page with no zone tree — a derived page or the cover.
   *
   * Zone mode, the content types and an inserted picture all address a zone, so
   * on such a page there is nothing for them to act on.
   */
  canEditZones: boolean
  selectionIsLeaf: boolean
  selectionHasContent: boolean
  /** The selected zone's content kind, marked as the choice in force. */
  selectedKind: ZoneContentKind | null
  onBack: () => void
  /** A save is being flushed before leaving; the button must not be pressed twice. */
  backPending?: boolean
  onRename: () => void
  onToggleTitle: () => void
  onSetContentKind: (kind: ZoneContentKind) => void
  /**
   * The content kinds, already told apart by what fits the selected zone.
   *
   * Built once in `EditorView` from the domain rule and handed to every surface
   * that offers them, so the toolbar, the inspector, the picker in the zone and
   * the compact panel cannot disagree about what is available.
   */
  contentKinds: ContentKindOption[]
  onOpenReferences: () => void
  onOpenTemplates: () => void
  onOpenImage: () => void
  onToggleIdeas: () => void
  onToggleSandbox: () => void
  /** Whether the floating windows are open, so their menu entries can say so. */
  ideasOpen: boolean
  sandboxOpen: boolean
  onShowShortcuts: () => void
  onPresent: () => void
  onOpenTheme: () => void
  /** The deck's shared visual premise for its pictures; see `ImageBriefModal`. */
  onOpenImageBrief: () => void
  /** Analyse and shrink every picture in the deck; see `ImageOptimizeModal`. */
  onOptimizeImages: () => void
  /** Publish or revoke the secret link. The toggle itself owns the state. */
  onToggleShare: () => void
  sandboxCount: number
}

/**
 * A toolbar button that opens a menu of entries below itself.
 *
 * The menu is the app's one context menu, opened against the button: the same
 * keyboard handling, focus return, placement and look as every other menu, and
 * a press from the keyboard puts the focus on the first entry.
 */
function MenuButton({
  id,
  label,
  title,
  tooltip,
  icon,
  tone,
  disabled = false,
  className = '',
  entries,
  children,
}: {
  id: string
  label: string
  /** Said at the top of the open menu. */
  title: string
  tooltip: string
  icon: IconName
  tone?: IconTone
  disabled?: boolean
  className?: string
  entries: () => MenuEntry[]
  /** What the button shows besides its icon; the label by default. */
  children?: React.ReactNode
}) {
  const open = useContextMenu((state) => state.open)
  const expanded = useContextMenu((state) => state.menu?.owner === id)
  /*
   * A second press on the button closes its menu, as it would a native one.
   * The press outside the menu has already closed it by the time the click
   * lands, so whether it was open is noted as the press begins.
   */
  const wasOpen = useRef(false)
  return (
    <Tooltip label={tooltip} wrap={disabled}>
      <button
        type="button"
        className={`btn btn--sm toolbar__menu-button ${className}`.trim()}
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-label={label}
        disabled={disabled}
        data-testid={`toolbar-menu-${id}`}
        onPointerDown={() => {
          wasOpen.current = expanded
        }}
        onClick={(event) => {
          if (wasOpen.current) {
            wasOpen.current = false
            return
          }
          open({
            anchor: anchorBelow(event.currentTarget),
            title,
            entries: entries(),
            // A click from Enter or Space has no pointer position.
            keyboard: event.detail === 0,
            owner: id,
          })
        }}
      >
        <Icon name={icon} size={15} tone={tone} />
        {children ?? <span className="toolbar__label">{label}</span>}
        <Icon name="chevron-down" size={13} className="toolbar__chevron" />
      </button>
    </Tooltip>
  )
}

export function TopToolbar(props: TopToolbarProps) {
  const mode = useEditorStore((state) => state.mode)
  const setMode = useEditorStore((state) => state.setMode)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const canUndo = useEditorStore((state) => state.past.length > 0)
  const canRedo = useEditorStore((state) => state.future.length > 0)
  const shareStatus = useSharingStore((state) => state.status)
  const shared = useSharingStore((state) => state.shared)
  const shareBusy = useSharingStore((state) => state.busy)
  const shareError = useSharingStore((state) => state.error)
  const shareLink = useShareUrl()

  const current = props.selectionIsLeaf
    ? (props.contentKinds.find((option) => option.kind === props.selectedKind) ?? null)
    : null
  const kindLabel = current?.label ?? (props.selectionIsLeaf ? 'Velg innholdstype' : 'Innholdstype')

  return (
    <header className="toolbar" data-testid="top-toolbar" data-mode={mode}>
      <div className="toolbar__start">
        <Tooltip label={props.backPending ? 'Lagrer før vi går …' : 'Tilbake til biblioteket'}>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={props.onBack}
            disabled={props.backPending}
            data-testid="back-to-library"
            aria-label="Tilbake til biblioteket"
          >
            <Icon name="chevron-left" />
          </button>
        </Tooltip>

        {/* The name, and whether the work is safe, read as one thing. */}
        <div className="toolbar__identity">
          <Tooltip label="Gi presentasjonen nytt navn">
            <button
              type="button"
              className="toolbar__title"
              onClick={props.onRename}
              data-testid="presentation-title"
            >
              {props.title}
            </button>
          </Tooltip>
          <span className="toolbar__save">
            <SaveIndicator />
          </span>
        </div>
      </div>

      <div className="toolbar__group">
        {/* One control with two positions, not two buttons that might both be
            on: the mode is a «which», and it is inked with its family. */}
        <div className="segmented" role="group" aria-label="Redigeringsmodus">
          <Tooltip label="Innholdsredigering (Ctrl+E)">
            <button
              type="button"
              {...pressedButton('btn btn--sm', mode === 'content')}
              data-tone="content"
              onClick={() => setMode('content')}
              data-testid="mode-content"
              aria-label="Innhold"
            >
              <Icon name="text" size={15} tone="content" />
              <span className="toolbar__label toolbar__label--mode">Innhold</span>
            </button>
          </Tooltip>
          <Tooltip label="Soneredigering (Ctrl+E)">
            <button
              type="button"
              {...pressedButton('btn btn--sm', mode === 'zone')}
              data-tone="zone"
              onClick={() => setMode('zone')}
              disabled={!props.canEditZones}
              data-testid="mode-zone"
              aria-label="Soner"
            >
              <Icon name="zones" size={15} tone="zone" />
              <span className="toolbar__label toolbar__label--mode">Soner</span>
            </button>
          </Tooltip>
        </div>
        <Tooltip label={props.hasTitleZone ? 'Fjern overskriftssonen' : 'Legg til overskriftssone'}>
          <button
            type="button"
            /* A disabled button never reads as "on": on a page with no title
               zone to toggle, the state of some other page's is not news. */
            {...pressedButton('btn btn--sm', props.hasTitleZone && props.canToggleTitle)}
            onClick={props.onToggleTitle}
            disabled={!props.canToggleTitle}
            data-testid="toggle-title"
            aria-label="Overskrift"
          >
            <Icon name="heading" size={15} tone="content" />
            <span className="toolbar__label toolbar__label--secondary">Overskrift</span>
          </button>
        </Tooltip>
      </div>

      <div className="toolbar__group">
        <Tooltip label="Angre (Ctrl+Z)">
          <button
            type="button"
            className="btn btn--sm btn--icon"
            onClick={undo}
            disabled={!canUndo}
            data-testid="undo"
            aria-label="Angre"
          >
            <Icon name="undo" size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Gjør om (Ctrl+Shift+Z)">
          <button
            type="button"
            className="btn btn--sm btn--icon"
            onClick={redo}
            disabled={!canRedo}
            data-testid="redo"
            aria-label="Gjør om"
          >
            <Icon name="redo" size={15} />
          </button>
        </Tooltip>
      </div>

      {/*
        The selected zone: what it holds, and the way to change that — one
        control that shows the kind in force rather than six look-alike icons.
        Beside it, and deliberately unlike it, the picture *file*: choosing a
        file is not choosing a kind.
      */}
      <div className="toolbar__group toolbar__group--selection">
        <MenuButton
          id="content-kind"
          label={`Innholdstype: ${kindLabel}`}
          title="Innholdstype for valgt sone"
          tooltip={props.selectionIsLeaf ? 'Endre innholdstype' : 'Velg én sone for å velge innholdstype'}
          icon={current?.icon ?? 'card'}
          tone={current?.tone}
          disabled={!props.selectionIsLeaf}
          className="toolbar__kind"
          entries={() =>
            contentKindEntries(props.contentKinds, props.selectedKind, props.onSetContentKind)
          }
        >
          <span className="toolbar__kind-label" data-kind={current?.kind ?? ''}>
            {kindLabel}
          </span>
        </MenuButton>
        <Tooltip label="Sett inn bilde fra fil">
          <button
            type="button"
            className="btn btn--sm"
            onClick={props.onOpenImage}
            disabled={!props.canEditZones}
            data-testid="open-image"
            aria-label="Sett inn bilde fra fil"
          >
            <Icon name="image-add" size={15} tone="media" />
            <span className="toolbar__label toolbar__label--secondary">Bilde fra fil</span>
          </button>
        </Tooltip>
      </div>

      <div className="toolbar__spacer" />

      <div className="toolbar__group">
        <MenuButton
          id="presentation"
          label="Presentasjon"
          title="Presentasjon"
          tooltip="Navn, tema, maler, referanser og bilder for hele presentasjonen"
          icon="deck"
          entries={() => presentationToolEntries(props)}
        />
        <MenuButton
          id="tools"
          label={props.sandboxCount > 0 ? `Verktøy, ${props.sandboxCount} i sandkassen` : 'Verktøy'}
          title="Verktøy"
          tooltip="Idéer, sandkassen og hurtigtaster"
          icon="tools"
          entries={() =>
            helperToolEntries({
              sandboxCount: props.sandboxCount,
              ideasOpen: props.ideasOpen,
              sandboxOpen: props.sandboxOpen,
              onIdeas: props.onToggleIdeas,
              onSandbox: props.onToggleSandbox,
              onShowShortcuts: props.onShowShortcuts,
            })
          }
        >
          <span className="toolbar__label">Verktøy</span>
          {props.sandboxCount > 0 && (
            <span className="toolbar__badge" data-testid="sandbox-count">
              {props.sandboxCount}
            </span>
          )}
        </MenuButton>
      </div>

      <div className="toolbar__end">
        <ShareToggle
          status={shareStatus}
          shared={shared}
          busy={shareBusy}
          error={shareError}
          link={shareLink}
          onToggle={props.onToggleShare}
        />

        <Tooltip label="Vis presentasjon (F5)">
          <button type="button" className="btn btn--primary btn--sm" onClick={props.onPresent} data-testid="present">
            <Icon name="play" size={15} /> Vis
          </button>
        </Tooltip>
      </div>
    </header>
  )
}
