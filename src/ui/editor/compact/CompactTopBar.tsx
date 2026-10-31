/**
 * The slim bar across the top of a compact workspace.
 *
 * Only what has to be one press away wherever you are: back out, what the deck
 * is called, whether the work is safe, undo and redo, and the way into
 * presentation mode. Everything else lives in the panels below, because a bar
 * that tries to be the desktop toolbar on a phone is a row of targets nobody
 * can hit.
 */

import { useEditorStore } from '../../../state/store'
import { Icon } from '../../components/Icon'
import { SaveIndicator } from '../StatusBar'
import type { TopToolbarProps } from '../TopToolbar'

export function CompactTopBar({ toolbar }: { toolbar: TopToolbarProps }) {
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const canUndo = useEditorStore((state) => state.past.length > 0)
  const canRedo = useEditorStore((state) => state.future.length > 0)

  return (
    <header className="compact-bar compact-bar--top" data-testid="compact-top-bar">
      <button
        type="button"
        className="btn btn--ghost btn--icon touch-target"
        onClick={toolbar.onBack}
        disabled={toolbar.backPending}
        aria-label="Tilbake til biblioteket"
        data-testid="back-to-library"
      >
        <Icon name="chevron-left" />
      </button>

      <button
        type="button"
        className="compact-bar__title"
        onClick={toolbar.onRename}
        data-testid="presentation-title"
      >
        <span className="compact-bar__name">{toolbar.title}</span>
        <SaveIndicator short />
      </button>

      <button
        type="button"
        className="btn btn--ghost btn--icon touch-target"
        onClick={undo}
        disabled={!canUndo}
        aria-label="Angre"
        data-testid="undo"
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--icon touch-target"
        onClick={redo}
        disabled={!canRedo}
        aria-label="Gjør om"
        data-testid="redo"
      >
        <Icon name="redo" />
      </button>
      <button
        type="button"
        className="btn btn--primary touch-target compact-bar__present"
        onClick={toolbar.onPresent}
        aria-label="Vis presentasjon"
        data-testid="present"
      >
        {/* Named as on the desktop, where the same button says «Vis». */}
        <Icon name="play" /> Vis
      </button>
    </header>
  )
}
