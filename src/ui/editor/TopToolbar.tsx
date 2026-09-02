/** Primary toolbar: modes, slide-level actions, insertion and presentation. */

import { CONTENT_KIND_LABELS } from '../../domain/content'
import type { ZoneContentKind } from '../../domain/types'
import { useSharingStore, useShareUrl } from '../../state/sharing'
import { useEditorStore } from '../../state/store'
import { Icon, type IconName } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'
import { ShareToggle } from './ShareToggle'

const CONTENT_ICONS: Record<ZoneContentKind, IconName> = {
  container: 'container',
  'untitled-card': 'card',
  'titled-card': 'card-titled',
}

export interface TopToolbarProps {
  title: string
  hasTitleZone: boolean
  canToggleTitle: boolean
  selectionIsLeaf: boolean
  selectionHasContent: boolean
  onBack: () => void
  /** A save is being flushed before leaving; the button must not be pressed twice. */
  backPending?: boolean
  onRename: () => void
  onToggleTitle: () => void
  onSetContentKind: (kind: ZoneContentKind) => void
  onOpenReferences: () => void
  onOpenTemplates: () => void
  onOpenImage: () => void
  onToggleIdeas: () => void
  onToggleSandbox: () => void
  onPresent: () => void
  onOpenTheme: () => void
  /** Publish or revoke the secret link. The toggle itself owns the state. */
  onToggleShare: () => void
  sandboxCount: number
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

  return (
    <header className="toolbar" data-testid="top-toolbar">
      <Tooltip label={props.backPending ? 'Lagrer før vi går …' : 'Tilbake til biblioteket'}>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={props.onBack}
          disabled={props.backPending}
          data-testid="back-to-library"
        >
          <Icon name="chevron-left" />
        </button>
      </Tooltip>

      <button type="button" className="toolbar__title" onClick={props.onRename} data-testid="presentation-title">
        {props.title}
      </button>

      <div className="toolbar__group">
        <Tooltip label="Innholdsredigering (Ctrl+E)">
          <button
            type="button"
            className={mode === 'content' ? 'btn btn--sm btn--active' : 'btn btn--sm'}
            onClick={() => setMode('content')}
            data-testid="mode-content"
          >
            <Icon name="text" size={15} /> Innhold
          </button>
        </Tooltip>
        <Tooltip label="Soneredigering (Ctrl+E)">
          <button
            type="button"
            className={mode === 'zone' ? 'btn btn--sm btn--active' : 'btn btn--sm'}
            onClick={() => setMode('zone')}
            data-testid="mode-zone"
          >
            <Icon name="zones" size={15} /> Soner
          </button>
        </Tooltip>
      </div>

      <div className="toolbar__group">
        <Tooltip label={props.hasTitleZone ? 'Fjern overskriftssonen' : 'Legg til overskriftssone'}>
          <button
            type="button"
            className={props.hasTitleZone ? 'btn btn--sm btn--active' : 'btn btn--sm'}
            onClick={props.onToggleTitle}
            disabled={!props.canToggleTitle}
            data-testid="toggle-title"
          >
            <Icon name="heading" size={15} /> Overskrift
          </button>
        </Tooltip>
      </div>

      <div className="toolbar__group">
        {(Object.keys(CONTENT_ICONS) as ZoneContentKind[]).map((kind) => (
          <Tooltip key={kind} label={CONTENT_KIND_LABELS[kind]}>
            <button
              type="button"
              className="btn btn--sm btn--icon"
              disabled={!props.selectionIsLeaf}
              onClick={() => props.onSetContentKind(kind)}
              data-testid={`content-kind-${kind}`}
              aria-label={CONTENT_KIND_LABELS[kind]}
            >
              <Icon name={CONTENT_ICONS[kind]} size={15} />
            </button>
          </Tooltip>
        ))}
        <Tooltip label="Sett inn bilde">
          <button
            type="button"
            className="btn btn--sm btn--icon"
            onClick={props.onOpenImage}
            data-testid="open-image"
            aria-label="Sett inn bilde"
          >
            <Icon name="image" size={15} />
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

      <div className="toolbar__spacer" />

      <div className="toolbar__group">
        <Tooltip label="Referanser">
          <button type="button" className="btn btn--sm btn--icon" onClick={props.onOpenReferences} data-testid="open-references" aria-label="Referanser">
            <Icon name="reference" size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Maler">
          <button type="button" className="btn btn--sm btn--icon" onClick={props.onOpenTemplates} data-testid="open-templates" aria-label="Maler">
            <Icon name="template" size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Idéer">
          <button type="button" className="btn btn--sm btn--icon" onClick={props.onToggleIdeas} data-testid="open-ideas" aria-label="Idéer">
            <Icon name="ideas" size={15} />
          </button>
        </Tooltip>
        <Tooltip label="Sandkassen">
          <button type="button" className="btn btn--sm" onClick={props.onToggleSandbox} data-testid="open-sandbox">
            <Icon name="sandbox" size={15} /> {props.sandboxCount > 0 ? props.sandboxCount : ''}
          </button>
        </Tooltip>
        <Tooltip label="Tema: bakgrunn, fonter, luft og skriftstørrelse">
          <button type="button" className="btn btn--sm btn--icon" onClick={props.onOpenTheme} data-testid="open-theme" aria-label="Tema">
            <Icon name="palette" size={15} />
          </button>
        </Tooltip>
      </div>

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
    </header>
  )
}
