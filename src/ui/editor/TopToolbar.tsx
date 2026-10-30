/** Primary toolbar: modes, slide-level actions, insertion and presentation. */

import type { ZoneContentKind } from '../../domain/types'
import { useSharingStore, useShareUrl } from '../../state/sharing'
import { useEditorStore } from '../../state/store'
import { Icon } from '../components/Icon'
import { pressedButton } from '../components/pressed'
import { Tooltip } from '../components/Tooltip'
import type { ContentKindOption } from './contentKinds'
import { ShareToggle } from './ShareToggle'

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
    <header className="toolbar" data-testid="top-toolbar" data-mode={mode}>
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
            >
              <Icon name="text" size={15} tone="content" /> Innhold
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
            >
              <Icon name="zones" size={15} tone="zone" /> Soner
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="toolbar__group">
        <Tooltip label={props.hasTitleZone ? 'Fjern overskriftssonen' : 'Legg til overskriftssone'}>
          <button
            type="button"
            /* A disabled button never reads as "on": on a page with no title
               zone to toggle, the state of some other page's is not news. */
            {...pressedButton('btn btn--sm', props.hasTitleZone && props.canToggleTitle)}
            onClick={props.onToggleTitle}
            disabled={!props.canToggleTitle}
            data-testid="toggle-title"
          >
            <Icon name="heading" size={15} tone="content" /> Overskrift
          </button>
        </Tooltip>
      </div>

      <div className="toolbar__group">
        {props.contentKinds.map((option) => {
          const disabled = !props.selectionIsLeaf || option.disabled
          return (
            <Tooltip
              key={option.kind}
              label={option.reason ?? option.label}
              wrap={disabled}
            >
              <button
                type="button"
                {...pressedButton(
                  'btn btn--sm btn--icon',
                  !disabled && option.kind === props.selectedKind,
                )}
                disabled={disabled}
                onClick={() => props.onSetContentKind(option.kind)}
                data-testid={`content-kind-${option.kind}`}
                aria-label={option.label}
              >
                <Icon name={option.icon} size={15} tone={option.tone} />
              </button>
            </Tooltip>
          )
        })}
        {/* Choosing a file, not a content kind: its own icon (the frame with a
            plus), so it is not a seventh copy of «Bilde» beside the kinds. */}
        <Tooltip label="Sett inn bilde fra fil">
          <button
            type="button"
            className="btn btn--sm btn--icon"
            onClick={props.onOpenImage}
            disabled={!props.canEditZones}
            data-testid="open-image"
            aria-label="Sett inn bilde"
          >
            <Icon name="image-add" size={15} tone="media" />
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
          <button
            type="button"
            className="btn btn--sm btn--icon"
            onClick={props.onOpenTemplates}
            disabled={!props.canEditZones}
            data-testid="open-templates"
            aria-label="Maler"
          >
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
        <Tooltip label="Bildebrief: én samlet bestilling for alle bildene i dekket">
          <button
            type="button"
            className="btn btn--sm btn--icon"
            onClick={props.onOpenImageBrief}
            data-testid="open-image-brief"
            aria-label="Bildebrief"
          >
            <Icon name="note" size={15} tone="media" />
          </button>
        </Tooltip>
        <Tooltip label="Optimaliser bilder: mindre filer uten synlig kvalitetstap">
          <button
            type="button"
            className="btn btn--sm btn--icon"
            onClick={props.onOptimizeImages}
            data-testid="optimize-images"
            aria-label="Optimaliser bilder"
          >
            <Icon name="optimize" size={15} tone="media" />
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
