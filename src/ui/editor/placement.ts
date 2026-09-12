/**
 * Putting content somewhere without dragging it there.
 *
 * Dragging is a fine shortcut with a mouse and a poor primary interaction with
 * a finger: the targets are small, the slide is scaled down, and a gesture that
 * misses does something else instead of nothing. So every drag in the editor
 * that moves *content* has a discrete twin — pick the thing, pick the zone —
 * and both roads lead to the same domain command.
 *
 * Which zones may receive it is one question with one answer, asked here, and
 * asked of **the command that would do the placing**. That is not ceremony: a
 * move and a copy are different transitions, and only the command knows which
 * one it is performing. Content carrying a citation that moves past another
 * citation-bearing zone renumbers the deck, and a check that added a second
 * copy while leaving the original in place would be measuring a document the
 * move never produces — offering a target the commit then refuses. A dry run
 * cannot disagree with the commit, because it *is* the commit, with its result
 * thrown away.
 *
 * Everything in the domain is a pure function from a presentation to a
 * `Result`, so running one and discarding the answer changes nothing.
 */

import { moveZoneContent, placeSandboxItem } from '../../domain/commands'
import { collectLeaves } from '../../domain/layout'
import { domFitCheckers } from '../../state/measure'
import type { NodeId, Presentation } from '../../domain/types'

/** Where the content looking for a zone is coming from. */
export type PlacementSource =
  | { kind: 'sandbox'; itemId: string }
  | { kind: 'zone'; nodeId: NodeId }

/**
 * Content looking for a zone, on the page its targets were measured on.
 *
 * The slide is part of it rather than assumed: a placement belongs to the page
 * it was started on, so paging away simply makes it no longer the current one —
 * derived on render, with nothing to reset.
 */
export type Placement = PlacementSource & { slideId: string }

/** What the bar over the stage says while a placement is waiting for a target. */
export const PLACEMENT_PROMPT = 'Trykk på en ledig sone for å plassere innholdet.'

/**
 * Would this placement be accepted? Asked by making it and reading the answer.
 *
 * The result is deliberately thrown away: what is wanted is the verdict, and
 * the verdict is the whole command — the target's own fit, the minimum zone
 * size, and the deck-wide guard that catches a zone on another slide losing
 * room to a renumbering. Re-deriving any of that here would be a second set of
 * rules that agreed with the first until it did not.
 */
function wouldBeAccepted(
  presentation: Presentation,
  slideId: string,
  placement: PlacementSource,
  nodeId: NodeId,
): boolean {
  const outcome =
    placement.kind === 'sandbox'
      ? placeSandboxItem(presentation, {
          itemId: placement.itemId,
          slideId,
          nodeId,
          ...domFitCheckers,
        })
      : moveZoneContent(presentation, {
          slideId,
          fromNodeId: placement.nodeId,
          toNodeId: nodeId,
          ...domFitCheckers,
        })
  return outcome.ok
}

/**
 * The zones on `slideId` that could take this content.
 *
 * Measured, which means offscreen renders — so this is called from an event
 * handler, where React allows the synchronous render the measurement needs, and
 * never from a render pass. That is the same rule `ZoneDropZone` states for a
 * drag, for the same reason.
 */
export function placementTargets(
  presentation: Presentation,
  slideId: string,
  placement: PlacementSource,
): Set<NodeId> {
  const slide = presentation.slides.find((entry) => entry.id === slideId)
  if (slide?.kind !== 'content') return new Set()
  const targets = new Set<NodeId>()
  for (const leaf of collectLeaves(slide.root)) {
    // Moving content onto the zone it already sits in is a state the document
    // is already in, so `moveZoneContent` answers "done" rather than refusing.
    // True, and not a target: the prompt is asking where to put it *instead*.
    if (placement.kind === 'zone' && leaf.id === placement.nodeId) continue
    // An occupied zone is refused by every command that places content, and
    // saying so here costs nothing where asking costs a measurement.
    if (leaf.content) continue
    if (wouldBeAccepted(presentation, slideId, placement, leaf.id)) targets.add(leaf.id)
  }
  return targets
}
