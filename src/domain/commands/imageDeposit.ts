/**
 * Opening, closing and giving up on the deck's image deposit.
 *
 * The three writes a deposit ever needs, and the rule they all share: `pending`
 * is a state a deck can be put into exactly once. `completed` and `abandoned`
 * are final, so every function here asks `depositIsFinal` before it writes, and
 * a deck that has been through the workflow behaves like any other deck
 * afterwards — no numbers on its panels, no dialog on opening it, nothing to
 * reset.
 *
 * Where the numbering comes from is not decided here. It is `resolveImagePlan`'s
 * deck-order numbering, the same one that stamps the placeholder captions and
 * heads each section of the brief, which is why `openImageDeposit` is called
 * from inside `syncImagePlaceholders`: one pass, one numbering, three things
 * that say it.
 */

import { hasImagePanel, imagePanelOf, withDepositIndex, withImagePanel } from '../content'
import { depositIsFinal, depositIsOpen, depositSlots, type ImageDeposit } from '../imageDeposit'
import { resolveImagePlan, imageZoneKey } from '../imagePlan'
import { collectLeaves, updateNode } from '../layout'
import { mapDeckSlides, touch } from '../presentation'
import { err, ok, type Result } from '../result'
import type { ContentSlide, LayoutNode, Presentation } from '../types'
import { setImageAsset } from './content'
import type { StructuralOptions } from './types'

/**
 * Stamp the deck's planned picture zones with the numbers the brief uses.
 *
 * Pure and idempotent: a deck already stamped comes back identical, so the
 * caller decides whether anything happened. Called from
 * `syncImagePlaceholders`, which is the one pass that reconciles a moved deck
 * with the plan written for it — so a re-plan, a dragged slide or simply
 * opening the brief brings the numbers, the placeholders and the brief back
 * into line together.
 *
 * Three outcomes, and the first is the one that matters most:
 *
 *  - a deck whose deposit is **final** is left exactly as it is. Nothing can
 *    put it back into `pending`, which is the promise the whole workflow rests
 *    on;
 *  - a deck that **plans no pictures** loses its deposit and every number on
 *    its panels — there is nothing to deposit;
 *  - anything else is stamped 1‥N in deck order and marked `pending`.
 */
export function openImageDeposit(presentation: Presentation): Presentation {
  if (depositIsFinal(presentation.imageDeposit)) return presentation

  const numbers = new Map(
    resolveImagePlan(presentation).map((image) => [
      imageZoneKey(image.plan.slideId, image.plan.nodeId),
      image.number,
    ]),
  )
  const stamped = restampPanels(presentation, (slideId, nodeId) => numbers.get(imageZoneKey(slideId, nodeId)) ?? null)

  const deposit: ImageDeposit | undefined =
    numbers.size === 0 ? undefined : { status: 'pending', expectedCount: numbers.size }
  return withDeposit(stamped, deposit)
}

/**
 * Give up on the automatic deposit, for good.
 *
 * What the numbered zones become is nothing at all: they are already ordinary
 * picture zones, and the only thing removed is the internal number that made
 * them part of a set. So the deck keeps every zone, every caption and every
 * file it had, and simply stops offering to fill them in one go.
 *
 * Refused on a deck that has no deposit to abandon, and on one already closed:
 * both would be a caller asking for something that has already happened, and a
 * silent success there would hide a bug rather than a no-op.
 */
export function abandonImageDeposit(presentation: Presentation): Result<Presentation> {
  const deposit = presentation.imageDeposit
  if (!deposit || deposit.status !== 'pending') {
    return err('INVALID_ARGUMENT', 'Presentasjonen venter ikke på bilder.')
  }
  const stripped = restampPanels(presentation, () => null)
  return ok(
    touch(withDeposit(stripped, { status: 'abandoned', expectedCount: deposit.expectedCount })),
  )
}

/** One file, and the number it was made for. */
export interface DepositPlacement {
  index: number
  assetId: string
}

/**
 * Put the deposited files in their zones and close the deposit.
 *
 * One call for the whole set, deliberately: a deposit that landed halfway is
 * the state this workflow exists to prevent, and the way to not have it is to
 * refuse before the first write rather than to unwind after the third. So the
 * placements are checked against the deck's own numbered zones first — exactly
 * 1‥N, each once — and only then does anything move.
 *
 * Each file lands through `setImageAsset`, the same command the upload dialog
 * uses, so a placeholder caption is taken back and the fit guard is asked in
 * exactly the way it is for a picture chosen by hand.
 */
export function completeImageDeposit(
  presentation: Presentation,
  placements: readonly DepositPlacement[],
  options: StructuralOptions = {},
): Result<Presentation> {
  if (!depositIsOpen(presentation)) {
    return err(
      'INVALID_ARGUMENT',
      'Presentasjonen venter ikke lenger på bilder, så de kan ikke settes inn samlet.',
    )
  }
  const slots = depositSlots(presentation)
  const byIndex = new Map(placements.map((placement) => [placement.index, placement.assetId]))
  if (byIndex.size !== placements.length) {
    return err('INVALID_ARGUMENT', 'To filer er levert for det samme bildenummeret.')
  }
  if (byIndex.size !== slots.length || slots.some((slot) => !byIndex.has(slot.index))) {
    return err(
      'INVALID_ARGUMENT',
      `Deponeringen må inneholde nøyaktig ett bilde for hvert nummer fra 1 til ${slots.length}.`,
    )
  }

  let current = presentation
  for (const slot of slots) {
    const written = setImageAsset(current, {
      slideId: slot.slideId,
      nodeId: slot.nodeId,
      assetId: byIndex.get(slot.index) as string,
      ...options,
    })
    if (!written.ok) return written
    current = written.value
  }

  const stripped = restampPanels(current, () => null)
  return ok(
    touch(withDeposit(stripped, { status: 'completed', expectedCount: slots.length })),
  )
}

/* ------------------------------------------------------------------ *
 * Writing the numbers
 * ------------------------------------------------------------------ */

/**
 * Every picture panel in the deck given the number the callback says, or none.
 *
 * One traversal for all three writers, so «which panels carry numbers» has one
 * implementation: a panel the callback has no number for loses the one it had,
 * which is what makes stamping idempotent and stripping total.
 */
function restampPanels(
  presentation: Presentation,
  numberFor: (slideId: string, nodeId: string) => number | null,
): Presentation {
  let changed = false
  const slides = mapDeckSlides(presentation.slides, {
    section: (slide) => slide,
    interactive: (slide) => slide,
    content: (slide): ContentSlide => {
      let root = slide.root
      for (const leaf of collectLeaves(slide.root)) {
        const content = leaf.content
        if (!content || !hasImagePanel(content)) continue
        const panel = imagePanelOf(content)
        if (!panel) continue
        const next = withDepositIndex(panel, numberFor(slide.id, leaf.id))
        if (next === panel) continue
        changed = true
        root = updateNode(root, leaf.id, (node): LayoutNode => ({
          ...(node as typeof leaf),
          content: withImagePanel(content, next),
        }))
      }
      return root === slide.root ? slide : { ...slide, root }
    },
  })
  return changed ? { ...presentation, slides } : presentation
}

/** The document with a deposit, or with none. Absent means «never had one». */
function withDeposit(presentation: Presentation, deposit: ImageDeposit | undefined): Presentation {
  const current = presentation.imageDeposit
  if (!deposit) {
    if (!current) return presentation
    const { imageDeposit: _dropped, ...rest } = presentation
    return rest as Presentation
  }
  if (current && current.status === deposit.status && current.expectedCount === deposit.expectedCount) {
    return presentation
  }
  return { ...presentation, imageDeposit: deposit }
}
