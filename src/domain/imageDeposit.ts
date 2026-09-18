/**
 * Handing the deck's planned pictures over, and taking them back in one go.
 *
 * `imagePlan.ts` produces the *order*: one brief, numbered 1‥N, that a person
 * pastes into one conversation whose whole job from that point is making N
 * pictures. This module is the other end of that errand — the return trip. The
 * pictures come back as a folder of files, and the only thing that has to
 * survive the round trip is which file belongs in which zone.
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
 *    `resolveImagePlan`, so «Sett inn bilde 3 her», «BILDE 3 AV 7» and picture
 *    3 are the same 3 by construction. There is no second numbering to keep in
 *    step.
 *  - **There are exactly two ways to say the order, and neither is a guess.**
 *    Either the files are called `1`, `2`, `3` … — a complete, unambiguous
 *    1‥N — and the names *are* the order; or they are called whatever the
 *    generator called them, and then nothing in the names can be read as an
 *    order, so the person puts them in order themselves. See
 *    `reviewDepositFiles`.
 *
 * The second way is what this module gained when the pictures stopped being
 * generated one at a time. A conversation that produces the whole series hands
 * back `IMG_4821.png` and `padmasambhava.webp` as readily as `1.png`, and
 * refusing those was refusing the ordinary delivery: the order is a thing a
 * person can supply in two seconds by dragging, and it is the one thing they
 * are certain of.
 *
 * `pending` is the only state in which any of this is live. `completed` and
 * `abandoned` are both final for the round they close, and only a deck that is
 * genuinely waiting for pictures again reopens — see `openImageDeposit`.
 */

import { hasImagePanel, imagePanelOf, withDepositIndex, withImagePanel } from './content'
import { mapDeckSlides } from './deckSlides'
import { IMAGE_FILE_EXTENSION_LIST } from './imageBytes'
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
  /** What this picture shows: the plan entry's motif, in one field. */
  subject: string
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
      subject: image?.plan.subject ?? '',
      desiredAspectRatio: image?.aspectRatio ?? null,
      filled: slot.filled,
    }
  })
}

/* ------------------------------------------------------------------ *
 * The files, and the order they are in
 * ------------------------------------------------------------------ */

/**
 * How the order of the deposited files was decided.
 *
 *  - `'numbered'` — the files are called `1`‥`N`, so the names say it.
 *  - `'manual'` — they are not, so the person says it by arranging them.
 *
 * Two modes rather than one, because the two deliveries are genuinely
 * different. A person who saves «bilde 7» as `7.png` has made the binding
 * themselves and it is the strongest one available. A conversation that made
 * the whole series at once hands back whatever it calls its files, and the
 * order it returned them in is not a fact about the plan — so it is asked for
 * rather than inferred.
 */
export type DepositOrderMode = 'numbered' | 'manual'

/**
 * Why a picked file cannot be used.
 *
 *  - `TYPE`   — not a picture Slaids stores. A `.txt`, a `.json`, a `.zip`.
 *  - `EXCESS` — more pictures than the deck has places for. The deck expects
 *               exactly N, and which of the extras to drop is the person's
 *               choice, not Slaids'.
 *
 * What is deliberately *not* here any more is a verdict on the *name*. `01.png`,
 * `bilde1.png` and `1-final.png` used to be refused, because a name that was
 * not exactly `<number>.<ext>` could not be placed. They are ordinary file
 * names now: they simply do not say an order, so the person is asked for one.
 * The rule that has not moved an inch is that Slaids never *guesses* — a name
 * is either a complete 1‥N set or it is not read as a number at all.
 */
export type DepositFileProblem = 'TYPE' | 'EXCESS'

export interface DepositFileVerdict {
  name: string
  /** The picture number this file will become, or `null` when it cannot be used. */
  index: number | null
  problem: DepositFileProblem | null
}

/** What the deposit screen shows about the files picked so far. */
export interface DepositReview {
  /** Where the order came from. See `DepositOrderMode`. */
  mode: DepositOrderMode
  /**
   * One verdict per picked file, **positionally aligned with the names given**.
   *
   * By position rather than by name, because arbitrary names are not unique: two
   * folders can both hold an `IMG_4821.png`, and a lookup by name would place
   * one of them twice. The position is also what the person is arranging in
   * manual mode, so it is the only thing that can carry their answer.
   */
  files: DepositFileVerdict[]
  /** Numbers that have a file. */
  present: number[]
  /** Numbers 1‥N with nothing for them yet. */
  missing: number[]
  /**
   * Exactly N usable files, each with a number of its own, nothing rejected.
   *
   * The same predicate «Fullfør» is greyed out on and the command refuses on, so
   * the button cannot be enabled for a set the write would turn down.
   */
  ready: boolean
}

/** The extension a name claims, lowercase and without the dot, or `null`. */
function extensionOf(fileName: string): string | null {
  const base = fileName.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return null
  return base.slice(dot + 1).toLowerCase()
}

/** Whether a file is a picture at all, judged by the one thing a name can say. */
function isPictureFileName(fileName: string): boolean {
  const extension = extensionOf(fileName)
  return extension !== null && IMAGE_FILE_EXTENSION_LIST.includes(extension)
}

/**
 * The numbers the file names spell out, or `null` when they do not spell any.
 *
 * All or nothing, deliberately. A set is read as numbered only when it is
 * exactly N files whose names are `1`‥`N`, each once — so `1.png, 2.jpg,
 * 3.webp` is a numbering and `1.png, bilde2.png, 3.webp` is not a numbering
 * with a defect in it. Anything less than complete is a set of ordinary names,
 * and the person is asked for the order instead of being told two of their
 * three files are wrong.
 *
 * The order the names arrive in says nothing: `3.webp, 1.png, 2.jpg` is the
 * same numbering as `1.png, 2.jpg, 3.webp`, because a file picker and an
 * operating system sort a folder however they like.
 */
function numberedOrder(fileNames: readonly string[], expectedCount: number): number[] | null {
  if (expectedCount < 1 || fileNames.length !== expectedCount) return null
  const numbers: number[] = []
  const seen = new Set<number>()
  for (const name of fileNames) {
    const number = imageFileNumber(name)
    if (number === null || number < 1 || number > expectedCount || seen.has(number)) return null
    seen.add(number)
    numbers.push(number)
  }
  return numbers
}

/**
 * Judge a set of picked file names, in the order they are standing, against the
 * brief that asked for them.
 *
 * Total and pure — names in, verdicts out — so the same rule is what the tests
 * state and what the dialog shows. It decides three things and nothing else:
 * which files are pictures at all, whether the names say the order, and which
 * number each file will become.
 *
 * In `'manual'` mode the answer is the position: the first usable file is
 * picture 1, the second picture 2, and so on. That is the person's own
 * arrangement, because the caller keeps the list in the order they dragged it
 * into — there is nothing here to sort, and sorting would be Slaids overruling
 * the one thing it asked them for.
 */
export function reviewDepositFiles(
  fileNames: readonly string[],
  expectedCount: number,
): DepositReview {
  const pictures = fileNames.filter(isPictureFileName)
  const numbers = numberedOrder(pictures, expectedCount)
  const mode: DepositOrderMode = numbers ? 'numbered' : 'manual'

  let position = 0
  const files: DepositFileVerdict[] = fileNames.map((name) => {
    if (!isPictureFileName(name)) return { name, index: null, problem: 'TYPE' }
    const place = position
    position += 1
    if (numbers) return { name, index: numbers[place], problem: null }
    if (place >= expectedCount) return { name, index: null, problem: 'EXCESS' }
    return { name, index: place + 1, problem: null }
  })

  const claimed = new Set(
    files.flatMap((file) => (file.problem === null && file.index !== null ? [file.index] : [])),
  )
  const present: number[] = []
  const missing: number[] = []
  for (let index = 1; index <= expectedCount; index += 1) {
    if (claimed.has(index)) present.push(index)
    else missing.push(index)
  }

  return {
    mode,
    files,
    present,
    missing,
    ready:
      expectedCount > 0 &&
      missing.length === 0 &&
      files.every((file) => file.problem === null),
  }
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
