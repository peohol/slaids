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
import { InspectorButton, InspectorFold } from './InspectorParts'

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
  const icon = split.axis === 'x' ? 'split-x' : 'split-y'

  /* Every zone's own ratio, typed or stepped. The main control when the split
     itself is selected; one step further away when a single zone is, where
     «bredere/smalere» already says what is usually meant. */
  const rows = (
    <div className="zone-size__rows">
      {split.weights.map((weight, index) => (
        <div className="zone-size__row" key={split.children[index]?.id ?? index}>
          <span className={index === childIndex ? 'zone-size__label is-current' : 'zone-size__label'}>
            Sone {index + 1}
          </span>
          <button
            type="button"
            className="btn btn--sm btn--icon"
            aria-label={`Mindre sone ${index + 1}`}
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
            aria-label={`Forholdstall for sone ${index + 1}`}
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
            aria-label={`Større sone ${index + 1}`}
            data-testid={`zone-weight-up-${index}`}
            disabled={Math.round(weight) >= MAX_WEIGHT}
            onClick={() => step(index, 1)}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
      ))}
    </div>
  )

  return (
    <div className="zone-size" data-testid="zone-size-controls">
      <p className="zone-size__summary">
        <span>Forholdstall</span>
        {/* Printed as they are stored, because they are whole numbers: a
            zone ratio that needed rounding to be read would be a ratio the
            author could not type back in. */}
        <strong className="zone-size__ratios" data-testid="zone-ratios">
          {split.weights.join(' : ')}
        </strong>
      </p>

      {childIndex === null ? (
        rows
      ) : (
        <>
          <div className="inspector__actions">
            <InspectorButton
              icon={icon}
              label={`Gjør ${along}`}
              testId="zone-size-grow"
              disabled={Math.round(split.weights[childIndex]) >= MAX_WEIGHT}
              reason={`Forholdstallet er allerede ${MAX_WEIGHT}, det høyeste.`}
              onClick={() => step(childIndex, 1)}
            />
            <InspectorButton
              icon={icon}
              label={`Gjør ${against}`}
              testId="zone-size-shrink"
              disabled={Math.round(split.weights[childIndex]) <= MIN_WEIGHT}
              reason={`Forholdstallet er allerede ${MIN_WEIGHT}. Gjør en annen sone større i stedet.`}
              onClick={() => step(childIndex, -1)}
            />
          </div>
          <InspectorFold id="zone-ratios" summary="Juster hver sone">
            {rows}
          </InspectorFold>
        </>
      )}

      <InspectorFold id="zone-size-help" summary="Hvordan virker dette?" icon="info">
        <p className="hint">
          Knappene endrer forholdstallene direkte. Med mus kan du også dra i mellomrommet mellom
          sonene for å flytte grensen, eller dra inni en sone på tvers av retningen for å endre
          størrelsen symmetrisk og langs retningen for å forskyve den. Layouten låses til
          nærmeste heltallsforhold uansett vei.
        </p>
      </InspectorFold>
    </div>
  )
}
