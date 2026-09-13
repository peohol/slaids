/**
 * Resizing a zone without dragging its edge.
 *
 * The ratio drag on the stage is precise and fast with a mouse and close to
 * unusable with a finger on a slide scaled to a quarter of its size. These are
 * the same change stated discretely: bigger, smaller, or a ratio typed in.
 *
 * They are not a second implementation of anything. Every button ends in
 * `setSplitWeights`, which is where the ratios are quantised, where the minimum
 * zone size is checked and where the fit guard refuses a change that would hide
 * content — so a zone grown by a button lands on exactly the layout a drag to
 * the same place would have committed, and is refused in exactly the cases a
 * drag is.
 */

import { setSplitWeights } from '../../domain/commands'
import { findParent, findSplit } from '../../domain/layout'
import { domFitCheckers } from '../../state/measure'
import { useEditorStore } from '../../state/store'
import type { ContentSlide, NodeId, SplitNode } from '../../domain/types'
import { Icon } from '../components/Icon'

/** The ratios a deck may be written in — see `quantizeRatios`. */
const MIN_WEIGHT = 1
const MAX_WEIGHT = 10

/**
 * The split these controls act on, and which of its children is selected.
 *
 * A selected split is resized from the inside — its own children's ratios are
 * what it has — while a selected child is resized within the split it belongs
 * to. Both are "make this zone bigger", said about a different node.
 */
export function splitContextFor(
  slide: ContentSlide,
  nodeId: NodeId | null,
): { split: SplitNode; childIndex: number | null } | null {
  if (!nodeId) return null
  const own = findSplit(slide.root, nodeId)
  if (own) return { split: own, childIndex: null }
  const parent = findParent(slide.root, nodeId)
  if (!parent) return null
  const childIndex = parent.children.findIndex((child) => child.id === nodeId)
  return childIndex < 0 ? null : { split: parent, childIndex }
}

export function ZoneSizeControls({
  slide,
  split,
  childIndex,
}: {
  slide: ContentSlide
  split: SplitNode
  /** `null` when the split itself is selected: then no single zone is "this one". */
  childIndex: number | null
}) {
  const runStructural = useEditorStore((state) => state.runStructural)

  const apply = (weights: number[]): void => {
    runStructural('zone-weights', (presentation) =>
      setSplitWeights(presentation, {
        slideId: slide.id,
        nodeId: split.id,
        weights,
        ...domFitCheckers,
      }),
    )
  }

  const step = (index: number, delta: number): void => {
    const next = [...split.weights]
    const wanted = Math.round(next[index]) + delta
    if (wanted < MIN_WEIGHT || wanted > MAX_WEIGHT) return
    next[index] = wanted
    apply(next)
  }

  const along = split.axis === 'x' ? 'bredere' : 'høyere'
  const against = split.axis === 'x' ? 'smalere' : 'lavere'

  return (
    <div className="zone-size" data-testid="zone-size-controls">
      {childIndex !== null && (
        <div className="inspector__actions">
          <button
            type="button"
            className="btn btn--sm"
            data-testid="zone-size-grow"
            disabled={Math.round(split.weights[childIndex]) >= MAX_WEIGHT}
            onClick={() => step(childIndex, 1)}
          >
            <Icon name={split.axis === 'x' ? 'split-x' : 'split-y'} size={14} /> Gjør {along}
          </button>
          <button
            type="button"
            className="btn btn--sm"
            data-testid="zone-size-shrink"
            disabled={Math.round(split.weights[childIndex]) <= MIN_WEIGHT}
            onClick={() => step(childIndex, -1)}
          >
            <Icon name={split.axis === 'x' ? 'split-x' : 'split-y'} size={14} /> Gjør {against}
          </button>
        </div>
      )}

      <div className="zone-size__rows">
        {split.weights.map((weight, index) => (
          <div className="zone-size__row" key={split.children[index]?.id ?? index}>
            <span className={index === childIndex ? 'zone-size__label is-current' : 'zone-size__label'}>
              Subsone {index + 1}
            </span>
            <button
              type="button"
              className="btn btn--sm btn--icon"
              aria-label={`Mindre subsone ${index + 1}`}
              data-testid={`zone-weight-down-${index}`}
              disabled={Math.round(weight) <= MIN_WEIGHT}
              onClick={() => step(index, -1)}
            >
              <Icon name="minus" size={14} />
            </button>
            <input
              className="input zone-size__value"
              type="number"
              min={MIN_WEIGHT}
              max={MAX_WEIGHT}
              step={1}
              value={Math.round(weight)}
              aria-label={`Forholdstall for subsone ${index + 1}`}
              data-testid={`zone-weight-${index}`}
              onChange={(event) => {
                const parsed = Number(event.target.value)
                if (!Number.isFinite(parsed) || parsed < MIN_WEIGHT || parsed > MAX_WEIGHT) return
                const next = [...split.weights]
                next[index] = Math.round(parsed)
                apply(next)
              }}
            />
            <button
              type="button"
              className="btn btn--sm btn--icon"
              aria-label={`Større subsone ${index + 1}`}
              data-testid={`zone-weight-up-${index}`}
              disabled={Math.round(weight) >= MAX_WEIGHT}
              onClick={() => step(index, 1)}
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
