/**
 * The editor where there is only room for one thing at a time.
 *
 * The rule the whole layout follows: **the slide is the largest thing on
 * screen**, and exactly one panel may take room from it. Pressing the tab that
 * is already open closes it, which is how the stage gets the whole screen back
 * — there is no separate "focus the slide" control to go looking for, because
 * closing the panel is that control.
 *
 * Landscape and portrait are the same React tree placed differently by CSS:
 * landscape floats the panel over the right of the stage, portrait stacks it
 * underneath. Rotating a phone therefore moves boxes and remounts nothing —
 * the selected slide, the selected zone, the undo history and any half-typed
 * field are all where they were, because none of them lives here.
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
import type { CompactPanel, EditorShellProps } from './editorShell'

const PANEL_TITLES: Record<CompactPanel, string> = {
  slides: 'Slides',
  content: 'Tekst på denne sliden',
  zone: 'Sone',
  tools: 'Verktøy',
}

export function CompactEditorShell(props: EditorShellProps) {
  const { ideasOpen, sandboxOpen, setIdeasOpen, setSandboxOpen, compactPanel, setCompactPanel } =
    props.panels

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
    }
    setCompactPanel(next)
  }

  return (
    <>
      <div
        className="editor editor--compact"
        data-testid="editor"
        data-shell="compact"
        data-fonts={props.fontState}
        data-panel={panel ?? 'none'}
      >
        <CompactTopBar toolbar={props.toolbar} />

        <div className="editor__body compact-body">
          <div className="compact-stage" data-testid="compact-stage">
            {props.stage}
            {props.canZoom && (
              <button
                type="button"
                className="btn btn--sm compact-zoom touch-target"
                onClick={props.onToggleZoom}
                data-testid="compact-zoom"
                aria-pressed={props.zoomed}
              >
                <Icon name={props.zoomed ? 'collapse' : 'expand'} size={16} />
                {props.zoomed ? 'Hele sliden' : 'Fokuser sonen'}
              </button>
            )}
          </div>

          {panel && (
            <section className="compact-panel" data-testid="compact-panel" data-panel={panel}>
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
