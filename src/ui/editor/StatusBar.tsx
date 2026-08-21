/** Status bar: save state, selection info and slide position. */

import { breadcrumbLabels } from '../../domain/layout'
import { useEditorStore } from '../../state/store'
import type { Presentation } from '../../domain/types'

const SAVE_LABELS: Record<string, string> = {
  saved: 'Lagret',
  saving: 'Lagrer …',
  dirty: 'Ulagrede endringer',
  error: 'Lagring feilet',
}

export function StatusBar({
  presentation,
  onShowShortcuts,
}: {
  presentation: Presentation
  onShowShortcuts: () => void
}) {
  const saveStatus = useEditorStore((state) => state.saveStatus)
  const mode = useEditorStore((state) => state.mode)
  const currentSlideId = useEditorStore((state) => state.currentSlideId)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const slide = presentation.slides.find((entry) => entry.id === currentSlideId)
  const index = presentation.slides.findIndex((entry) => entry.id === currentSlideId)
  const breadcrumb = slide && selectedNodeId ? breadcrumbLabels(slide.root, selectedNodeId) : []

  return (
    <footer className="statusbar" data-testid="statusbar">
      <span data-testid="save-status" data-state={saveStatus}>
        {SAVE_LABELS[saveStatus] ?? saveStatus}
      </span>
      <span className="statusbar__sep">·</span>
      <span>
        Slide {index + 1} av {presentation.slides.length}
      </span>
      {mode === 'zone' && breadcrumb.length > 0 && (
        <>
          <span className="statusbar__sep">·</span>
          <span data-testid="status-breadcrumb">{breadcrumb.join(' › ')}</span>
        </>
      )}
      <span className="statusbar__spacer" />
      <span className="hint">
        {mode === 'zone'
          ? 'Piltaster navigerer hierarkiet · Ctrl+E bytter modus'
          : 'Ctrl+E for soneredigering'}
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={onShowShortcuts}
        data-testid="show-shortcuts"
      >
        Hurtigtaster
      </button>
    </footer>
  )
}
