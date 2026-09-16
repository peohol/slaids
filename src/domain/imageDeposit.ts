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
 *    here rather than guessed at: `01.png` and `bilde1.png` are refused with a
 *    reason, never silently matched to something.
 *
 * `pending` is the only state in which any of this is live. `completed` and
 * `abandoned` are both final — nothing here can put a deck back into `pending`,
 * which is why `openImageDeposit` asks before it stamps.
 */

import { imagePanelOf } from './content'
import { IMAGE_FILE_EXTENSION_LIST } from './imageBytes'
import { imageZoneKey, resolveImagePlan } from './imagePlan'
import { collectLeaves } from './layout'
import type { Presentation } from './types'

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

/**
 * The number a deposited file is for, or `null`.
 *
 * Strict on purpose. A leading zero is refused rather than trimmed, because
 * `01.png` and `1.png` in the same folder are two files for one picture, and a
 * rule that accepted both would have to guess which. Anything before or after
 * the digits is refused for the same reason: `bilde1.png` looks like a match
 * and is a file named after something else.
 */
export function depositIndexFromFileName(fileName: string): number | null {
  // Some browsers hand over a path when a folder is dropped. The name is the
  // last segment of it, and the segments before it say nothing about the order.
  const base = fileName.split(/[\\/]/).pop() ?? ''
  const match = /^([1-9][0-9]*)\.([A-Za-z0-9]+)$/.exec(base)
  if (!match) return null
  if (!IMAGE_FILE_EXTENSION_LIST.includes(match[2].toLowerCase())) return null
  return Number(match[1])
}

/** What the deposit screen shows about the files picked so far. */
export interface DepositReview {
  /** One verdict per file, in the order they were picked. */
  files: DepositFileVerdict[]
  /** Numbers that have exactly one usable file. */
  present: number[]
  /** Numbers 1‥N with nothing for them yet. */
  missing: number[]
  /** Exactly 1‥N, each once, and nothing rejected. */
  ready: boolean
}

/**
 * Judge a set of picked files against the brief that asked for them.
 *
 * Total and pure — names in, verdicts out — so the same rule is what the dialog
 * greys the button with and what the tests state. It never picks a winner
 * between two files claiming one number: the dialog says both are in conflict
 * and the person removes one, because the alternative is Slaids choosing which
 * of their pictures to use.
 */
export function reviewDepositFiles(
  fileNames: readonly string[],
  expectedCount: number,
): DepositReview {
  const claimed = new Map<number, number>()
  for (const name of fileNames) {
    const index = depositIndexFromFileName(name)
    if (index === null || index < 1 || index > expectedCount) continue
    claimed.set(index, (claimed.get(index) ?? 0) + 1)
  }

  const files: DepositFileVerdict[] = fileNames.map((name) => {
    const index = depositIndexFromFileName(name)
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
    ready:
      expectedCount > 0 &&
      missing.length === 0 &&
      files.every((file) => file.problem === null),
  }
}
