/**
 * The editor where there is only room for one thing at a time.
 *
 * The rule the whole layout follows: **the slide is the largest thing on
 * screen**, and exactly one panel may take room from it. Pressing the tab that
 * is already open closes it, which is how the stage gets the whole screen back
 * — there is no separate "focus the slide" control to go looking for, because
 * closing the panel is that control. The one exception is the slide overview,
 * which is navigation rather than a side panel: it covers the body outright,
 * because choosing among twenty pages is not helped by seeing a sliver of one.
 *
 * Landscape and portrait are the same React tree placed differently by CSS:
 * landscape floats the panel over the right of the stage, portrait stacks it
 * underneath. Rotating a phone therefore moves boxes and remounts nothing —
 * the selected slide, the selected zone, the undo history and any half-typed
 * field are all where they were, because none of them lives here.
 *
 * The slide area is also the deck's own navigation: one finger across it turns
 * the page, two fingers magnify it. Both are pointer gestures on this one
 * element (see `stageGestures.ts`), so every kind of page — a slide, a section,
 * a miniapp's cover, a generated reference page — can be swiped away from
 * without any of them knowing about it.
 *
 * The floating tool windows (Ideas, the sandbox) are the same components the
 * desktop uses; `FloatingWindow` itself becomes a sheet on a compact
 * workspace. Opening one closes the panel, and opening the panel closes them,
 * which is the whole of the one-at-a-time rule.
 */

import { Icon } from '../../components/Icon'
import { CompactContentList } from '../compact/CompactContentList'
import { CompactTabBar } from '../compact/CompactTabBar'
import { CompactTopBar } from '../compact/CompactTopBar'
import { CompactToolsPanel } from '../compact/CompactToolsPanel'
import { useStageGestures } from '../stageGestures'
import type { CompactPanel, EditorShellProps } from './editorShell'

const PANEL_TITLES: Record<CompactPanel, string> = {
  slides: 'Slides',
  content: 'Tekst på denne sliden',
  zone: 'Sone',
  tools: 'Verktøy',
}

/** The overview is navigation, so it takes the screen rather than a corner. */
const FULL_HEIGHT_PANELS: ReadonlySet<CompactPanel> = new Set<CompactPanel>(['slides'])

export function CompactEditorShell(props: EditorShellProps) {
  const { ideasOpen, sandboxOpen, setIdeasOpen, setSandboxOpen, compactPanel, setCompactPanel } =
    props.panels
  const focus = props.focus

  /*
   * One big surface at a time, derived rather than synchronised: a tool window
   * and a panel competing for a phone screen leaves neither usable, so while a
   * tool window is up the panel is simply not showing — and closing the window
   * brings back the panel the user last chose, with nothing to remember it.
   */
  const panel = ideasOpen || sandboxOpen ? null : compactPanel

  const openPanel = (next: CompactPanel | null): void => {
    if (next !== null) {
      setIdeasOpen(false)
      setSandboxOpen(false)
      // A panel takes the very room the writing surface needs, so typing stops
      // before it opens rather than carrying on somewhere too small to see.
      if (focus.editing) focus.onBack()
    }
    setCompactPanel(next)
  }

  /*
   * The deck, one finger at a time.
   *
   * Off while the view is magnified — a hand on a zoomed slide is inspecting
   * it, and the same drag has to pan — and off while a field is being typed in,
   * where a drag is a selection. Everything else the gesture refuses to touch
   * (controls, links, a running miniapp) it refuses for everyone; see
   * `OWNS_ITS_GESTURE`.
   */
  const swipe = useStageGestures({
    enabled: !focus.editing && !focus.magnified,
    onSwipe: (direction) => props.onStepPage(direction),
  })

  return (
    <>
      <div
        className="editor editor--compact"
        data-testid="editor"
        data-shell="compact"
        data-fonts={props.fontState}
        data-panel={panel ?? 'none'}
        data-focus={focus.editing ? 'text' : focus.focused ? 'zone' : 'slide'}
      >
        <CompactTopBar toolbar={props.toolbar} />

        <div className="editor__body compact-body">
          <div
            className="compact-stage"
            data-testid="compact-stage"
            // Which page the stage is showing. A derived page has no authored
            // slide behind it, so it has no id here either.
            data-slide-id={props.slide?.id ?? ''}
            onPointerDown={swipe.onPointerDown}
          >
            {props.stage}
            <StageControls focus={focus} />
          </div>

          {panel && (
            <section
              className="compact-panel"
              data-testid="compact-panel"
              data-panel={panel}
              data-full={FULL_HEIGHT_PANELS.has(panel) ? '' : undefined}
            >
              <header className="compact-panel__head">
                <h2 className="compact-panel__title">{PANEL_TITLES[panel]}</h2>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon touch-target"
                  onClick={() => openPanel(null)}
                  aria-label={`Lukk ${PANEL_TITLES[panel].toLowerCase()}`}
                  data-testid="compact-panel-close"
                >
                  <Icon name="close" />
                </button>
              </header>
              <div className="compact-panel__body">
                {panel === 'slides' && props.filmstrip}
                {panel === 'content' && (
                  <CompactContentList slide={props.slide} onEdit={props.onEditText} />
                )}
                {panel === 'zone' && props.inspector}
                {panel === 'tools' && (
                  <CompactToolsPanel
                    toolbar={props.toolbar}
                    onOpenIdeas={() => setIdeasOpen(true)}
                    onOpenSandbox={() => setSandboxOpen(true)}
                    onShowShortcuts={props.onShowShortcuts}
                  />
                )}
              </div>
            </section>
          )}
        </div>

        {props.textToolbar}

        <CompactTabBar
          panel={panel}
          onSelect={openPanel}
          sandboxCount={props.toolbar.sandboxCount}
        />
      </div>

      {props.placementBar}
      {props.ideas}
      {props.sandbox}
    </>
  )
}

/**
 * The ladder, as the one control that is ever needed next.
 *
 * Whole slide → the selected zone fills the stage → that zone is the writing
 * surface, and one button back down at every step. Only the step the editor is
 * actually on is drawn, so there is never a row of buttons to read: what is on
 * screen says where you are.
 */
function StageControls({ focus }: { focus: EditorShellProps['focus'] }) {
  if (focus.editing) {
    return (
      <div className="compact-stage-controls" data-testid="compact-stage-controls">
        <button
          type="button"
          className="btn btn--primary btn--sm touch-target"
          onClick={focus.onBack}
          data-testid="compact-stage-done"
        >
          <Icon name="check" size={16} /> Ferdig
        </button>
      </div>
    )
  }

  if (focus.focused) {
    return (
      <div className="compact-stage-controls" data-testid="compact-stage-controls">
        {focus.canEdit && (
          <button
            type="button"
            className="btn btn--primary btn--sm touch-target"
            onClick={focus.onEdit}
            data-testid="compact-stage-edit"
          >
            <Icon name="text" size={16} /> Rediger tekst
          </button>
        )}
        <button
          type="button"
          className="btn btn--sm touch-target"
          onClick={focus.onBack}
          data-testid="compact-stage-back"
        >
          <Icon name="collapse" size={16} /> Hele sliden
        </button>
      </div>
    )
  }

  if (!focus.canFocus && !focus.magnified) return null

  return (
    <div className="compact-stage-controls" data-testid="compact-stage-controls">
      {focus.magnified && (
        <button
          type="button"
          className="btn btn--sm touch-target"
          onClick={focus.onBack}
          data-testid="compact-stage-reset-zoom"
        >
          <Icon name="collapse" size={16} /> Nullstill zoom
        </button>
      )}
      {focus.canFocus && (
        <button
          type="button"
          className="btn btn--sm touch-target"
          onClick={focus.onFocus}
          data-testid="compact-stage-focus"
        >
          <Icon name="expand" size={16} /> Fokuser sonen
        </button>
      )}
    </div>
  )
}
