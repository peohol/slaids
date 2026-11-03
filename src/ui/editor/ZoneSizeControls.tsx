/**
 * Resizing a zone without dragging its edge.
 *
 * The ratio drag on the stage is precise and fast with a mouse and close to
 * unusable with a finger on a slide scaled to a quarter of its size. These are
 * the same change stated discretely: bigger, smaller, or a ratio typed in.
 *
 * They are not a second implementation of anything. Every button ends in
 * `setSplitWeights` — by way of `setSplitWeightsByHand`, because a button is a
 * person's own resize just as a drag is — which is where the ratios are
 * quantised and where the hard minimum of what each zone holds is checked. Like
 * a drag, a button may take a zone below the size its text fits in at normal
 * type; the slide then draws the text smaller and marks the zone, and the next
 * press the other way gives the room back.
 */

import { setSplitWeightsByHand } from '../../domain/commands/manualLayout'
import { breadcrumbLabels, findParent, findSplit } from '../../domain/layout'
import { useEditorStore } from '../../state/store'
import type { ContentSlide, NodeId, SplitNode } from '../../domain/types'
import { Icon } from '../components/Icon'
import { InspectorButton, InspectorFold } from './InspectorParts'
import { SIZE_SCOPE_TITLES, type SizeScope } from './zoneDescription'

/** The ratios a deck may be written in — see `quantizeRatios`. */
const MIN_WEIGHT = 1
const MAX_WEIGHT = 10

/**
 * One split these controls act on, and what the selected zone is to it.
 *
 * Two different questions wear the same words. A selected split is resized
 * from the inside — its own children's ratios are what it has, the
 * «fordeling inni denne sonen». A selected zone with a parent is resized among
 * its siblings, in the split it belongs to. A split that is itself somebody's
 * child is both, and gets both, each under its own name.
 */
export interface SizeContext {
  scope: SizeScope
  split: SplitNode
  /** The selected zone among `split`'s children; `null` for `inside`, where no one child is "this one". */
  childIndex: number | null
}

/** The size questions the selected zone answers, inside first; none for a root leaf. */
export function sizeContextsFor(slide: ContentSlide, nodeId: NodeId | null): SizeContext[] {
  if (!nodeId) return []
  const contexts: SizeContext[] = []
  const own = findSplit(slide.root, nodeId)
  if (own) contexts.push({ scope: 'inside', split: own, childIndex: null })
  const parent = findParent(slide.root, nodeId)
  const childIndex = parent ? parent.children.findIndex((child) => child.id === nodeId) : -1
  if (parent && childIndex >= 0) contexts.push({ scope: 'siblings', split: parent, childIndex })
  return contexts
}

/** Where the split sits, as the breadcrumb and the split dialog name it: «Rot › 2». */
function pathOf(slide: ContentSlide, split: SplitNode): string {
  return breadcrumbLabels(slide.root, split.id).join(' › ')
}

export function ZoneSizeControls({
  slide,
  context,
  withHelp = true,
}: {
  slide: ContentSlide
  context: SizeContext
  /** The one explanation, under the last of the panel's size sections. */
  withHelp?: boolean
}) {
  const { scope, split, childIndex } = context

  const runStructural = useEditorStore((state) => state.runStructural)

  const apply = (weights: number[]): void => {
    runStructural('zone-weights', (presentation) =>
      setSplitWeightsByHand(presentation, { slideId: slide.id, nodeId: split.id, weights }),
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

  const path = pathOf(slide, split)
  const count = split.children.length
  /* One line on which zones these numbers are between, in the words and the
     path the split dialog uses, so the two never seem to talk about different
     zones. */
  const scopeLine =
    scope === 'inside'
      ? `Forholdet mellom de ${count} direkte subsonene i ${path}.`
      : `Denne sonen er sone ${(childIndex ?? 0) + 1} av ${count} i ${path}.`

  /* Every zone's own ratio, typed or stepped. The main control when the split
     itself is selected; one step further away when a single zone is, where
     «bredere/smalere» already says what is usually meant. */
  const rows = (
    <div className="zone-size__rows" role="group" aria-label={SIZE_SCOPE_TITLES[scope]}>
      {split.weights.map((weight, index) => {
        const current = index === childIndex
        return (
          <div className="zone-size__row" key={split.children[index]?.id ?? index}>
            <span
              className={current ? 'zone-size__label is-current' : 'zone-size__label'}
              aria-current={current || undefined}
            >
              Sone {index + 1}
              {/* Said, not only set in bold: which row is the selected zone. */}
              {current && <span className="zone-size__self"> (denne)</span>}
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
        )
      })}
    </div>
  )

  return (
    <div className="zone-size" data-testid="zone-size-controls" data-scope={scope}>
      <p className="hint zone-size__scope" data-testid="zone-size-scope">
        {scopeLine}
      </p>
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

      {withHelp && (
        <InspectorFold id="zone-size-help" summary="Hvordan virker dette?" icon="info">
          <p className="hint">
            «{SIZE_SCOPE_TITLES.inside}» endrer forholdet mellom en delt sones egne subsoner.
            «{SIZE_SCOPE_TITLES.siblings}» endrer hvor stor den valgte sonen er ved siden av
            søsknene sine. Begge endrer forholdstallene direkte. Med mus kan du også dra i
            mellomrommet mellom sonene for å flytte grensen, eller dra inni en sone på tvers av
            retningen for å endre størrelsen symmetrisk og langs retningen for å forskyve den.
            Layouten låses til nærmeste heltallsforhold uansett vei.
          </p>
        </InspectorFold>
      )}
    </div>
  )
}
