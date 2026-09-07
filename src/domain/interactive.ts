/**
 * Interactive slides: what a miniapp file is allowed to be.
 *
 * One door, for every way a file reaches an interactive slide — the upload
 * dialog, a replacement from the inspector, and the agent operations — so what
 * Slaids accepts does not depend on who is asking. Everything here is data
 * validation and nothing else: the file is decoded and measured, never parsed
 * into a document, never evaluated, never rendered. Passing says the file *can
 * be stored*; it says nothing about what the app inside it will do when the
 * audience activates it, and nothing in this module is a safety claim. The
 * isolation that keeps a miniapp away from Slaids lives in
 * `src/ui/interactive/sandboxDocument.ts`, and it is the browser's.
 *
 * Three rules, all of them about bytes and text rather than about markup:
 *
 *  - **one `.html` file**, by name, whatever case the extension is written in.
 *    The extension is a courtesy check that catches the wrong file before it
 *    is read; the content is what is validated.
 *  - **UTF-8 text**, decoded strictly. A byte order mark is skipped, a UTF-16
 *    mark is refused by name rather than decoded into nonsense, and a file that
 *    is not valid UTF-8 — a renamed binary, a Latin-1 export — is refused with
 *    an instruction rather than stored with every accented letter replaced.
 *  - **within the limits**, measured on the text that would be stored, in
 *    bytes of UTF-8. `string.length` counts UTF-16 units and would let a file
 *    of three-byte glyphs through at three times the size.
 *
 * Pure and headless: it runs in the browser, in the test runner and behind the
 * agent transport, with no DOM anywhere.
 */

import { MAX_INTERACTIVE_HTML_BYTES, MAX_INTERACTIVE_HTML_TOTAL_BYTES } from './constants'
import { err, ok, type Refusal, type Result } from './result'
import type { InteractiveSlide } from './types'

/** The one extension an interactive slide takes, compared case-insensitively. */
export const INTERACTIVE_FILE_EXTENSION = '.html'

/** What the dialog and the agent contract call the file type. */
export const INTERACTIVE_FILE_ACCEPT = 'text/html,.html'

/** The longest a name or a file name may be, as text on the cover. */
export const INTERACTIVE_NAME_MAX_LENGTH = 200

/** Bytes of UTF-8 a string encodes to. Never `length`, which counts UTF-16 units. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

/**
 * A miniapp file that passed the door: what a command stores.
 *
 * `byteSize` is the size of `html` as it will be stored, which for a file that
 * arrived with a byte order mark is three bytes less than the file.
 */
export interface InteractiveSource {
  fileName: string
  html: string
  byteSize: number
}

/** Whether a file name ends in the extension, in any case. */
export function hasInteractiveExtension(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(INTERACTIVE_FILE_EXTENSION)
}

/**
 * What the cover calls the app before anybody renames it: the file name without
 * its extension, or the whole name when there is nothing else to it.
 */
export function suggestedInteractiveName(fileName: string): string {
  const trimmed = fileName.trim()
  const stem = hasInteractiveExtension(trimmed)
    ? trimmed.slice(0, -INTERACTIVE_FILE_EXTENSION.length)
    : trimmed
  return (stem.trim() || trimmed || 'Miniapp').slice(0, INTERACTIVE_NAME_MAX_LENGTH)
}

/** A name or a file name as it may be stored: trimmed, non-empty, bounded. */
export function normalizeInteractiveName(name: string, what = 'Navnet'): Result<string> {
  const trimmed = name.trim()
  if (!trimmed) return err('INVALID_ARGUMENT', `${what} kan ikke være tomt.`)
  if (trimmed.length > INTERACTIVE_NAME_MAX_LENGTH) {
    return err(
      'INVALID_ARGUMENT',
      `${what} kan ikke være lengre enn ${INTERACTIVE_NAME_MAX_LENGTH} tegn.`,
    )
  }
  return ok(trimmed)
}

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const
const UTF16_MARKS: readonly (readonly [number, number])[] = [
  [0xff, 0xfe],
  [0xfe, 0xff],
]

function startsWithBytes(bytes: Uint8Array, mark: readonly number[]): boolean {
  return mark.every((byte, index) => bytes[index] === byte)
}

/**
 * The file's bytes as the text Slaids stores.
 *
 * Strict UTF-8, because the alternative is silent corruption: a lenient decode
 * turns every byte it cannot read into U+FFFD, and the app would be stored with
 * its strings mangled and nobody told. A UTF-16 file is recognised by its mark
 * and refused with the one instruction that fixes it.
 */
export function decodeInteractiveHtml(bytes: Uint8Array): Result<string> {
  if (UTF16_MARKS.some((mark) => startsWithBytes(bytes, mark))) {
    return err(
      'INVALID_INTERACTIVE_FILE',
      'Filen er lagret som UTF-16. Lagre den som UTF-8 og prøv igjen.',
    )
  }
  const body = startsWithBytes(bytes, UTF8_BOM) ? bytes.subarray(UTF8_BOM.length) : bytes
  try {
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(body))
  } catch {
    return err(
      'INVALID_INTERACTIVE_FILE',
      'Filen er ikke gyldig UTF-8-tekst. Lagre HTML-filen som UTF-8 og prøv igjen.',
    )
  }
}

/**
 * Accept the file, or say why not.
 *
 * The bytes are the file as it was picked; the name is what it was called. Both
 * are checked, in the cheapest order: the name first, because a `.png` need not
 * be read to be refused; the size against the raw bytes next, so an oversized
 * file is not decoded first; then the decoding; then the size again on the
 * text that would actually be stored, because a byte order mark leaves.
 */
export function acceptInteractiveFile(input: {
  fileName: string
  bytes: Uint8Array
}): Result<InteractiveSource> {
  const fileName = normalizeInteractiveName(input.fileName, 'Filnavnet')
  if (!fileName.ok) return fileName
  if (!hasInteractiveExtension(fileName.value)) {
    return err(
      'INVALID_INTERACTIVE_FILE',
      `Velg én .html-fil. «${fileName.value}» har ikke filendelsen ${INTERACTIVE_FILE_EXTENSION}.`,
      { fileName: fileName.value },
    )
  }
  if (input.bytes.byteLength === 0) {
    return err('INVALID_INTERACTIVE_FILE', 'Filen er tom.', { fileName: fileName.value })
  }
  const oversized = tooLarge(input.bytes.byteLength)
  if (oversized) return oversized

  const decoded = decodeInteractiveHtml(input.bytes)
  if (!decoded.ok) return decoded
  return acceptInteractiveHtml({ fileName: fileName.value, html: decoded.value })
}

/**
 * Accept HTML that is already text — an agent's, or a file that has been
 * decoded above. The same rules, minus the decoding.
 */
export function acceptInteractiveHtml(input: {
  fileName: string
  html: string
}): Result<InteractiveSource> {
  const fileName = normalizeInteractiveName(input.fileName, 'Filnavnet')
  if (!fileName.ok) return fileName
  if (!hasInteractiveExtension(fileName.value)) {
    return err(
      'INVALID_INTERACTIVE_FILE',
      `Filnavnet må slutte på ${INTERACTIVE_FILE_EXTENSION}.`,
      { fileName: fileName.value },
    )
  }

  const html = input.html
  if (html.trim().length === 0) {
    return err('INVALID_INTERACTIVE_FILE', 'Filen er tom.', { fileName: fileName.value })
  }
  // A NUL cannot occur in an HTML source anybody wrote; it is what a binary
  // file that happens to decode looks like.
  if (html.includes('\u0000')) {
    return err(
      'INVALID_INTERACTIVE_FILE',
      'Filen inneholder binærdata og er ikke en HTML-fil.',
      { fileName: fileName.value },
    )
  }
  // Not a parse and not a safety check: a file with no tag in it at all is not
  // HTML, and refusing it here is how a text file with the wrong name is
  // caught before it becomes a blank slide.
  if (!/<[a-zA-Z!]/.test(html)) {
    return err(
      'INVALID_INTERACTIVE_FILE',
      'Filen ser ikke ut som HTML: den inneholder ingen elementer.',
      { fileName: fileName.value },
    )
  }

  const byteSize = utf8ByteLength(html)
  const oversized = tooLarge(byteSize)
  if (oversized) return oversized
  return ok({ fileName: fileName.value, html, byteSize })
}

function tooLarge(byteSize: number): Refusal | null {
  if (byteSize <= MAX_INTERACTIVE_HTML_BYTES) return null
  return err(
    'INTERACTIVE_HTML_TOO_LARGE',
    `HTML-filen er ${formatByteSize(byteSize)}, som er mer enn grensen på ${formatByteSize(MAX_INTERACTIVE_HTML_BYTES)} per interaktiv slide.`,
    { byteSize, maxByteSize: MAX_INTERACTIVE_HTML_BYTES },
  )
}

/* ------------------------------------------------------------------ *
 * The deck-wide budget
 * ------------------------------------------------------------------ */

/** Bytes of miniapp source in a slide. */
export function interactiveByteSize(slide: InteractiveSlide): number {
  return utf8ByteLength(slide.html)
}

/**
 * Anything with a list of slides in it.
 *
 * A `Presentation` is one; so is a document Zod has just parsed but nothing has
 * yet called a presentation. The budget is the same question either way, and
 * asking it of the parsed shape is what lets the *schema* refuse an import that
 * is over — see `validatePresentation`.
 */
export interface InteractiveDeck {
  slides: readonly { kind: string }[]
}

/** The interactive slides in a deck, whatever else it holds. */
export function interactiveSlidesIn(deck: InteractiveDeck): InteractiveSlide[] {
  return deck.slides.filter((slide): slide is InteractiveSlide => slide.kind === 'interactive')
}

/**
 * Bytes of miniapp source across the deck, leaving out one slide when its
 * source is about to be replaced.
 */
export function interactiveHtmlBytesIn(
  deck: InteractiveDeck,
  options: { excludingSlideId?: string } = {},
): number {
  let total = 0
  for (const slide of interactiveSlidesIn(deck)) {
    if (slide.id === options.excludingSlideId) continue
    total += interactiveByteSize(slide)
  }
  return total
}

/**
 * What is wrong with an interactive slide as a document holds it, or `null`.
 *
 * The rule is one sentence: a stored document may not hold an interactive slide
 * that the typed commands would have refused. It is asked of every document
 * that is loaded or imported — see `validatePresentation` — because the door in
 * this module guards the *editor's* and the *agent's* way in, and a `.slaids`
 * archive is a third way in that goes straight to the repository. A file that
 * never passed a command must still meet what a command demands, or the
 * document does not open.
 *
 * Deliberately the same two calls the commands make, in the same order, rather
 * than a restatement of their rules: a rule that were restated here could come
 * to differ from the one that is enforced, which is the whole failure this
 * closes.
 */
export function storedInteractiveRefusal(slide: InteractiveSlide): Refusal | null {
  const name = normalizeInteractiveName(slide.name)
  if (!name.ok) return name
  const source = acceptInteractiveHtml({ fileName: slide.fileName, html: slide.html })
  if (!source.ok) return source
  return null
}

/**
 * Whether the deck has room for `byteSize` more bytes of miniapp source.
 *
 * Answered before a slide is added or a file replaced, so the deck is never
 * committed over its budget — a state a later save might not be able to move.
 */
export function interactiveBudgetRefusal(
  deck: InteractiveDeck,
  byteSize: number,
  options: { excludingSlideId?: string } = {},
): Refusal | null {
  const held = interactiveHtmlBytesIn(deck, options)
  if (held + byteSize <= MAX_INTERACTIVE_HTML_TOTAL_BYTES) return null
  return err(
    'INTERACTIVE_BUDGET_EXCEEDED',
    `Presentasjonen kan holde ${formatByteSize(MAX_INTERACTIVE_HTML_TOTAL_BYTES)} miniapp-kilde til sammen, og har allerede ${formatByteSize(held)}. Denne filen på ${formatByteSize(byteSize)} får ikke plass.`,
    {
      byteSize,
      heldByteSize: held,
      maxTotalByteSize: MAX_INTERACTIVE_HTML_TOTAL_BYTES,
    },
  )
}

/** `1,5 MB`-style sizes for dialogs and messages. Binary units, like the limits. */
export function formatByteSize(bytes: number): string {
  const mib = 1024 * 1024
  if (bytes >= mib) return `${trimNumber(bytes / mib)} MB`
  if (bytes >= 1024) return `${trimNumber(bytes / 1024)} kB`
  return `${bytes} byte`
}

function trimNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return String(rounded).replace('.', ',')
}
