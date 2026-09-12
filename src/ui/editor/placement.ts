/**
 * Putting content somewhere without dragging it there.
 *
 * Dragging is a fine shortcut with a mouse and a poor primary interaction with
 * a finger: the targets are small, the slide is scaled down, and a gesture that
 * misses does something else instead of nothing. So every drag in the editor
 * that moves *content* has a discrete twin — pick the thing, pick the zone —
 * and both roads lead to the same domain command.
 *
 * What differs between the two sources is only where the content comes from;
 * which zones may receive it is one question with one answer, asked here.
 * `canAcceptContent` is the domain's own, so a target offered by a tap is
 * exactly a target a drop would have been allowed to land on.
 */

import { canAcceptContent } from '../../domain/commands'
import { collectLeaves } from '../../domain/layout'
import { domFitCheckers } from '../../state/measure'
import type { NodeId, Presentation, ZoneContent } from '../../domain/types'

/**
 * Content looking for a zone, and where it is coming from.
 *
 * The slide is part of it rather than assumed: a placement belongs to the page
 * its targets were measured on, so paging away simply makes it no longer the
 * current one — derived on render, with nothing to reset.
 */
export type PlacementSource =
  | { kind: 'sandbox'; itemId: string; content: ZoneContent }
  | { kind: 'zone'; nodeId: NodeId; content: ZoneContent }

export type Placement = PlacementSource & { slideId: string }

/** What the bar over the stage says while a placement is waiting for a target. */
export const PLACEMENT_PROMPT = 'Trykk på en ledig sone for å plassere innholdet.'

/**
 * The zones on `slideId` that could take this content.
 *
 * Measured, which means an offscreen render per candidate zone — so this is
 * called from an event handler, where React allows the synchronous render the
 * measurement needs, and never from a render pass. That is the same rule
 * `ZoneDropZone` states for a drag, for the same reason.
 */
export function placementTargets(
  presentation: Presentation,
  slideId: string,
  placement: Placement,
): Set<NodeId> {
  const slide = presentation.slides.find((entry) => entry.id === slideId)
  if (slide?.kind !== 'content') return new Set()
  const targets = new Set<NodeId>()
  for (const leaf of collectLeaves(slide.root)) {
    // A move to where it already is is not a move.
    if (placement.kind === 'zone' && leaf.id === placement.nodeId) continue
    if (
      canAcceptContent(presentation, {
        slideId,
        nodeId: leaf.id,
        content: placement.content,
        ...domFitCheckers,
      })
    ) {
      targets.add(leaf.id)
    }
  }
  return targets
}
