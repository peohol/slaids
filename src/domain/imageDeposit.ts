/**
 * Handing the deck's planned pictures over, and taking them back in one go.
 *
 * `imagePlan.ts` produces the *order*: one brief, numbered 1‥N, that a person
 * pastes into whatever makes their pictures. This module is the other end of
 * that errand — the return trip. The pictures come back as a folder of files,
 * and the only thing that has to survive the round trip is which file belongs
 * in which zone.
 *
 * Three decisions make that survivable:
 *
 *  - **The number lives on the element.** A picture panel that is part of an
 *    open deposit carries `depositIndex`, so the mapping from «file 3» to «that
 *    zone» is stored, not recomputed from where the zone happens to sit when
 *    the files arrive. A zone that is deleted, emptied or turned into text
 *    takes its number with it, and that is what makes a broken deposit
 *    something this module can *see* rather than something a user discovers
 *    afterwards.
 *  - **The numbering is the brief's own.** `syncImagePlaceholders` stamps the
 *    placeholder captions, the deposit numbers and the brief from one pass over
 *    `resolveImagePlan`, so «Sett inn bilde 3 her», «BILDE 3 AV 7» and `3.png`
 *    are the same 3 by construction. There is no second numbering to keep in
 *    step.
 *  - **The file name is the whole protocol.** `1.png`, `2.jpg`, `3.webp` — a
 *    number, a dot, an extension, nothing else. It is the one instruction that
 *    survives being carried between two programs by a person, and it is checked
 *    rather than guessed at: `01.png` and `bilde1.png` are refused with a
 *    reason, never silently matched to something. The rule itself is
 *    `imageFileNumber`, beside the rule that writes the name.
 *
 * The file name is enough when a *person* made the pictures, because a person
 * saving «bilde 7» saves it as `7.png`. It is not enough when an agent did:
 * generation order is not the plan's order, and a file named by arrival is a
 * file named after the wrong picture. So an agent-driven delivery also carries
 * an explicit binding — `imageGeneration.ts` — and `reviewDeposit` refuses the
 * whole set when that binding and the plan disagree.
 *
 * `pending` is the only state in which any of this is live. `completed` and
 * `abandoned` are both final — nothing here can put a deck back into `pending`,
 * which is why `openImageDeposit` asks before it stamps.
 */

import { hasImagePanel, imagePanelOf, withDepositIndex, withImagePanel } from './content'
import { mapDeckSlides } from './deckSlides'
import {
  checkGeneratedImages,
  imageBindingCheck,
  manifestPresentationIssue,
  parseImageGenerationManifest,
  type DeliveredImageFile,
  type ImageBindingIssue,
} from './imageGeneration'
import { imageFileNumber, imageZoneKey, resolveImagePlan } from './imagePlan'
import { collectLeaves, updateNode } from './layout'
import type { ContentSlide, LayoutNode, Presentation, SandboxItem } from './types'

export type ImageDepositStatus = 'pending' | 'completed' | 'abandoned'

/**
 * Whether the deck is still expecting its picture files, and how many.
 *
 * `expectedCount` is the count the brief was written with, kept after the fact:
 * a completed deposit that says 7 is a record of what was handed over, which is
 * the only thing left to say about it once the pictures are in the zones.
 */
export interface ImageDeposit {
  status: ImageDepositStatus
  expectedCount: number
}

/** Statuses a deck can never leave. See `openImageDeposit`. */
export function depositIsFinal(deposit: ImageDeposit | undefined): boolean {
  return deposit?.status === 'completed' || deposit?.status === 'abandoned'
}

/* ------------------------------------------------------------------ *
 * The zones a deposit points at
 * ------------------------------------------------------------------ */

/** One numbered picture zone, addressed the way every command addresses a zone. */
export interface DepositSlot {
  index: number
  slideId: string
  nodeId: string
  /** Whether a file is already in it. A deposit overwrites it either way. */
  filled: boolean
}

/**
 * Every numbered picture zone in the deck, in number order.
 *
 * Read off the slides rather than out of a list on the document, because the
 * slides are where a zone can stop existing. A manifest beside them would keep
 * naming a zone that is gone; this simply stops returning it, and
 * `depositIsOpen` is the question that notices.
 */
export function depositSlots(presentation: Presentation): DepositSlot[] {
  const slots: DepositSlot[] = []
  for (const slide of presentation.slides) {
    if (slide.kind !== 'content') continue
    for (const leaf of collectLeaves(slide.root)) {
      const panel = leaf.content ? imagePanelOf(leaf.content) : null
      if (!panel || panel.depositIndex === undefined) continue
      slots.push({
        index: panel.depositIndex,
        slideId: slide.id,
        nodeId: leaf.id,
        filled: panel.assetId !== null,
      })
    }
  }
  return slots.sort((a, b) => a.index - b.index)
}

/**
 * Whether the user can still deposit files: pending, and the numbered zones
 * still spell out exactly 1‥N.
 *
 * The one question a structural edit can change the answer to, and the reason
 * the numbers are stored on the elements: a zone deleted, emptied, converted to
 * text or duplicated all show up here as a set that is no longer 1‥N, without
 * this module having to know which edit did it.
 *
 * One predicate rather than a «pending» flag and an «intact» flag beside it:
 * the two are only ever asked together, and a caller holding the first without
 * the second is a caller about to offer a deposit that cannot land.
 */
export function depositIsOpen(presentation: Presentation): boolean {
  const deposit = presentation.imageDeposit
  if (!deposit || deposit.status !== 'pending' || deposit.expectedCount < 1) return false
  const slots = depositSlots(presentation)
  if (slots.length !== deposit.expectedCount) return false
  return slots.every((slot, position) => slot.index === position + 1)
}

/**
 * Whether the deck is still actually waiting for something.
 *
 * An open deposit whose every zone has been filled by hand is finished in every
 * way but the flag, and asking that author to deposit files would be asking
 * them to redo work they have already done. So the screens that *offer* the
 * workflow ask this, while the ones that *guard* it ask `depositIsOpen`.
 */
export function depositIsWaiting(presentation: Presentation): boolean {
  return depositIsOpen(presentation) && depositSlots(presentation).some((slot) => !slot.filled)
}

/* ------------------------------------------------------------------ *
 * What the user is being asked to make
 * ------------------------------------------------------------------ */

/** One expected picture, as the deposit screens list it. */
export interface DepositImage {
  index: number
  /** Which slide it belongs on, so the number can be found in the deck. */
  slideLabel: string
  /** The short brief for exactly this picture: its motif, in one field. */
  generationBrief: string
  /** The shape the zone wants, measured off the slide. `null` when unknown. */
  desiredAspectRatio: string | null
  filled: boolean
}

/**
 * The deposit as a numbered list a person can read.
 *
 * Joined to the image plan rather than stored a second time: the motif and the
 * aspect ratio are already facts the brief is generated from, so a copy of them
 * on the panel would be a second description of the same picture, free to drift
 * from the one the brief actually says. A slot whose plan entry has gone still
 * appears — it is a number the user was asked for — with whatever is left.
 */
export function depositImages(presentation: Presentation): DepositImage[] {
  const planned = new Map(
    resolveImagePlan(presentation).map((image) => [
      imageZoneKey(image.plan.slideId, image.plan.nodeId),
      image,
    ]),
  )
  return depositSlots(presentation).map((slot) => {
    const image = planned.get(imageZoneKey(slot.slideId, slot.nodeId))
    return {
      index: slot.index,
      slideLabel: image?.slideLabel ?? '',
      generationBrief: image?.plan.subject ?? '',
      desiredAspectRatio: image?.aspectRatio ?? null,
      filled: slot.filled,
    }
  })
}

/* ------------------------------------------------------------------ *
 * The file names
 * ------------------------------------------------------------------ */

/**
 * Why a dropped file cannot be used.
 *
 *  - `NAME`   — it is not `<number>.<extension>`, or the extension is not one
 *               Slaids stores. `01.png`, `bilde1.png`, `1a.png`, `1` and
 *               `1.txt` all land here.
 *  - `RANGE`  — a number outside 1‥N. The brief asked for N pictures.
 *  - `DUPLICATE` — two files claim the same number. Both are marked, because
 *                  neither is more right than the other and the user has to say
 *                  which one they meant.
 */
export type DepositFileProblem = 'NAME' | 'RANGE' | 'DUPLICATE'

export interface DepositFileVerdict {
  name: string
  /** The number the name claims, or `null` when it claims none. */
  index: number | null
  problem: DepositFileProblem | null
}

/** What the deposit screen shows about the files picked so far. */
export interface DepositReview {
  /** One verdict per file, in the order they were picked. */
  files: DepositFileVerdict[]
  /** Numbers that have exactly one usable file. */
  present: number[]
  /** Numbers 1‥N with nothing for them yet. */
  missing: number[]
  /**
   * Where the numbering came from, and how far anything could check it.
   *
   * Three values because there are three genuinely different situations, and
   * collapsing any two would overstate one of them:
   *
   *  - `'manual'` — a person named the files. The number in the name is the
   *    only binding there is, and it is authoritative: they made it.
   *  - `'file-checked'` — a manifest came with the files, every record carried
   *    a digest of the bytes its generation response returned, and each file's
   *    own bytes matched. The strongest thing Slaids can say.
   *  - `'unchecked'` — a manifest came with the files but at least one binding
   *    carries no digest, so the metadata is all there is. It may be perfectly
   *    consistent and still describe the wrong files.
   *
   * None of the three says the picture shows the right motif. Whatever shows
   * this to somebody has to keep those apart; see the deposit dialog.
   */
  assurance: 'manual' | 'file-checked' | 'unchecked'
  /**
   * Everything wrong with an agent delivery's bindings. Always empty for a
   * manual upload, because there is nothing there to be wrong.
   */
  binding: ImageBindingIssue[]
  /**
   * Exactly 1‥N, each once, nothing rejected, and no binding in conflict.
   *
   * Deliberately true for an `'unchecked'` delivery: nothing is wrong with it
   * as far as anything here can tell, and refusing every host that cannot
   * reach its own bytes would push people back to naming files by hand. What it
   * does not do is *claim* anything — a caller that offers this set has to
   * carry the `assurance` through to whoever is about to press the button.
   */
  ready: boolean
}

/**
 * Judge a set of picked file *names* against the brief that asked for them.
 *
 * Total and pure — names in, verdicts out — so the same rule is what the tests
 * state and what `reviewDeposit` builds its verdict on. It never picks a winner
 * between two files claiming one number: the dialog says both are in conflict
 * and the person removes one, because the alternative is Slaids choosing which
 * of their pictures to use.
 *
 * The manual flow in full, and the whole of it: a name is the only binding a
 * person gives, so `source` is `'manual'` and there is nothing to cross-check.
 * `reviewDeposit` is what the dialog asks, because it is the one that knows
 * about the other flow.
 */
export function reviewDepositFiles(
  fileNames: readonly string[],
  expectedCount: number,
): DepositReview {
  const claimed = new Map<number, number>()
  for (const name of fileNames) {
    const index = imageFileNumber(name)
    if (index === null || index < 1 || index > expectedCount) continue
    claimed.set(index, (claimed.get(index) ?? 0) + 1)
  }

  const files: DepositFileVerdict[] = fileNames.map((name) => {
    const index = imageFileNumber(name)
    if (index === null) return { name, index: null, problem: 'NAME' }
    if (index < 1 || index > expectedCount) return { name, index, problem: 'RANGE' }
    if ((claimed.get(index) ?? 0) > 1) return { name, index, problem: 'DUPLICATE' }
    return { name, index, problem: null }
  })

  const present: number[] = []
  const missing: number[] = []
  for (let index = 1; index <= expectedCount; index += 1) {
    if (claimed.get(index) === 1) present.push(index)
    else missing.push(index)
  }

  return {
    files,
    present,
    missing,
    assurance: 'manual',
    binding: [],
    ready:
      expectedCount > 0 &&
      missing.length === 0 &&
      files.every((file) => file.problem === null),
  }
}

/**
 * The whole verdict on a deposit: the names, and the binding when there is one.
 *
 * One entry point, so the two flows cannot be told apart anywhere but here. The
 * dialog hands over what it has — the image files it was given, and the text of
 * the manifest file if one came with them — and gets back a single `ready`.
 * Deciding that in the dialog instead would put the rule that keeps pictures off
 * the wrong slides in a React component, where the tests are not.
 *
 * A manifest changes what the review *is*, not just what it warns about: with
 * one, the bindings are checked against the deck's own plan and a mismatch
 * refuses the whole set. Without one, this is exactly the manual upload it has
 * always been — the number in the file name is the binding, because a person who
 * saves «bilde 3» as `3.png` has made it.
 *
 * A manifest that cannot be read is *not* a deposit without a manifest. It is an
 * agent delivery whose binding is unknown, and falling back to the file names
 * there would be the original failure with an extra step in front of it.
 */
export function reviewDeposit(
  presentation: Presentation,
  delivered: readonly DeliveredImageFile[],
  manifestText: string | null,
): DepositReview {
  const names = reviewDepositFiles(
    delivered.map((file) => file.fileName),
    depositSlots(presentation).length,
  )
  if (manifestText === null) return names

  const parsed = parseImageGenerationManifest(manifestText)
  if (!parsed.ok) {
    return refused(names, { code: 'MANIFEST_UNREADABLE', message: parsed.error.message })
  }
  /* Asked before the bindings are: a manifest for another deck reports every id
     as unknown, and that list says nothing about what actually went wrong. */
  const wrongDeck = manifestPresentationIssue(presentation, parsed.value)
  if (wrongDeck) return refused(names, wrongDeck)

  const records = parsed.value.images
  const binding = checkGeneratedImages(presentation, records, delivered)
  return {
    ...names,
    /* The level is what the *records* make possible, and the issues are whether
       it held. They are reported side by side rather than folded together
       because a delivery with no digests produces no issues at all, and calling
       that «checked» is the one thing this must never do. */
    assurance: imageBindingCheck(records, delivered),
    binding,
    ready: names.ready && binding.length === 0,
  }
}

/** A manifest that could not even be read against: nothing lands, nothing is claimed. */
function refused(names: DepositReview, issue: ImageBindingIssue): DepositReview {
  return { ...names, assurance: 'unchecked', binding: [issue], ready: false }
}

/* ------------------------------------------------------------------ *
 * Writing and taking back the numbers
 * ------------------------------------------------------------------ */

/**
 * Every picture panel in the deck given the number the callback says, or none.
 *
 * One traversal for everything that writes or takes back a number — opening a
 * deposit, closing one, giving up on one, and publishing a deck — so «which
 * panels carry numbers» has one implementation. A panel the callback has no
 * number for loses the one it had, which is what makes stamping idempotent and
 * stripping total.
 *
 * **The sandbox is always stripped.** Content parked there is not on a slide,
 * so it is not part of any deposit — and a zone whose content was rescued to
 * the sandbox by the very edit that ended the deposit would otherwise carry the
 * number back onto a slide when it was placed again. `depositSlots` never looks
 * there either, so the two agree.
 *
 * Returns the very same presentation when nothing changed, so a caller can tell
 * whether there is anything to save.
 */
export function restampDepositNumbers(
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
        const next = withDepositIndex(content.image, numberFor(slide.id, leaf.id))
        if (next === content.image) continue
        changed = true
        root = updateNode(root, leaf.id, (node): LayoutNode => ({
          ...(node as typeof leaf),
          content: withImagePanel(content, next),
        }))
      }
      return root === slide.root ? slide : { ...slide, root }
    },
  })

  const sandbox = presentation.sandbox.map((item): SandboxItem => {
    const panel = imagePanelOf(item.content)
    if (!panel) return item
    const next = withDepositIndex(panel, null)
    if (next === panel) return item
    changed = true
    return { ...item, content: withImagePanel(item.content, next) }
  })

  return changed ? { ...presentation, slides, sandbox } : presentation
}

/** The deck with no deposit numbers anywhere: what publishing and closing leave. */
export function withoutDepositNumbers(presentation: Presentation): Presentation {
  return restampDepositNumbers(presentation, () => null)
}
