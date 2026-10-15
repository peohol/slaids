/** Status bar: save state, selection info and slide position. */

import { breadcrumbLabels } from '../../domain/layout'
import { useEditorStore } from '../../state/store'
import { pageKindName } from './pageKinds'
import type { Presentation } from '../../domain/types'

const SAVE_LABELS: Record<string, string> = {
  saved: 'Lagret',
  saving: 'Lagrer …',
  dirty: 'Ulagrede endringer',
  error: 'Lagring feilet',
}

/**
 * Whether the work is safe, in one element.
 *
 * Lifted out of the status bar because a compact workspace has no status bar
 * and still has to say this — and because it is the one thing the tests wait
 * for before they reload. Two of them would be two answers.
 */
export function SaveIndicator({ short = false }: { short?: boolean }) {
  const saveStatus = useEditorStore((state) => state.saveStatus)
  const label = SAVE_LABELS[saveStatus] ?? saveStatus
  return (
    <span data-testid="save-status" data-state={saveStatus} title={label}>
      {short ? SHORT_SAVE_LABELS[saveStatus] ?? label : label}
    </span>
  )
}

/** The same four states where there is only room for a word. */
const SHORT_SAVE_LABELS: Record<string, string> = {
  saved: 'Lagret',
  saving: 'Lagrer …',
  dirty: 'Ulagret',
  error: 'Feil',
}

export function StatusBar({
  presentation,
  onShowShortcuts,
}: {
  presentation: Presentation
  onShowShortcuts: () => void
}) {
  const mode = useEditorStore((state) => state.mode)
  const currentSlideId = useEditorStore((state) => state.currentSlideId)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const slide = presentation.slides.find((entry) => entry.id === currentSlideId)
  const index = presentation.slides.findIndex((entry) => entry.id === currentSlideId)
  const breadcrumb =
    slide?.kind === 'content' && selectedNodeId
      ? breadcrumbLabels(slide.root, selectedNodeId)
      : []

  return (
    <footer className="statusbar" data-testid="statusbar">
      <SaveIndicator />
      <span className="statusbar__sep">·</span>
      <span>
        {`${pageKindName(slide?.kind ?? 'content', index)} ${index + 1} av ${presentation.slides.length}`}
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
