/**
 * References and citations.
 *
 * Citation nodes store reference ids only. The visible numbers are derived on
 * every render from first-occurrence order across the deck, so reordering
 * slides renumbers everything automatically.
 */

import {
  G,
  REFERENCE_ENTRY_GAP,
  REFERENCE_FONT_SIZE,
  REFERENCE_LINE_HEIGHT,
  REFERENCE_MAX_COLUMNS,
} from './constants'
import { contentCitationIds } from './content'
import { sandboxContent } from './docs'
import { collectContent } from './layout'
import { collectCitationIds } from './richdoc'
import type { DeckSource, Presentation, Reference } from './types'

export type ReferenceNumbering = ReadonlyMap<string, number>

/**
 * Reference ids in first-occurrence order across the deck.
 *
 * Everything about numbering is derived from the slides and the reference list,
 * so this — and everything built on it — takes a `DeckSource` rather than a
 * whole `Presentation`. A published snapshot is then numbered by exactly the
 * same code as the private document it was cut from.
 */
export function referenceOrder(deck: DeckSource): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  const known = new Set(deck.references.map((reference) => reference.id))

  const push = (id: string): void => {
    if (!known.has(id) || seen.has(id)) return
    seen.add(id)
    order.push(id)
  }

  for (const slide of deck.slides) {
    // A section cannot cite — the schema leaves the node out of its two lines —
    // so first-occurrence order is decided by the content slides alone.
    if (slide.kind !== 'content') continue
    for (const id of collectCitationIds(slide.title)) push(id)
    for (const content of collectContent(slide.root)) {
      for (const id of contentCitationIds(content)) push(id)
    }
  }
  return order
}

export function computeReferenceNumbering(deck: DeckSource): ReferenceNumbering {
  const numbering = new Map<string, number>()
  referenceOrder(deck).forEach((id, index) => numbering.set(id, index + 1))
  return numbering
}

/**
 * Reference ids cited anywhere in the document, including content parked in the
 * sandbox. Sandbox citations get no *number* (they are not on a slide), but they
 * are still real references and must survive pruning.
 */
export function citedReferenceIds(presentation: Presentation): Set<string> {
  const known = new Set(presentation.references.map((reference) => reference.id))
  const ids = new Set(referenceOrder(presentation))
  for (const id of sandboxCitedReferenceIds(presentation)) {
    if (known.has(id)) ids.add(id)
  }
  return ids
}

/** Reference ids cited only from sandbox content. */
export function sandboxCitedReferenceIds(presentation: Presentation): Set<string> {
  const ids = new Set<string>()
  for (const slide of presentation.sandboxSlides ?? []) {
    for (const id of collectCitationIds(slide.title)) ids.add(id)
  }
  for (const content of sandboxContent(presentation)) {
    for (const id of contentCitationIds(content)) ids.add(id)
  }
  return ids
}

/** Ids that currently appear on a slide, and therefore carry a number. */
export function usedReferenceIds(deck: DeckSource): Set<string> {
  return new Set(referenceOrder(deck))
}

export function splitReferences(deck: DeckSource): {
  used: Reference[]
  unused: Reference[]
} {
  const numbering = computeReferenceNumbering(deck)
  const used = deck.references
    .filter((reference) => numbering.has(reference.id))
    .sort((a, b) => (numbering.get(a.id) ?? 0) - (numbering.get(b.id) ?? 0))
  const unused = deck.references
    .filter((reference) => !numbering.has(reference.id))
    .sort((a, b) => referenceSortKey(a).localeCompare(referenceSortKey(b), 'nb'))
  return { used, unused }
}

export function referenceSortKey(reference: Reference): string {
  return (reference.title || reference.authors || reference.url || '').toLowerCase()
}

export function isReferenceValid(reference: Pick<Reference, 'title' | 'authors' | 'url'>): boolean {
  return Boolean(reference.title.trim() || reference.authors.trim() || reference.url.trim())
}

/**
 * Compress a citation group: runs of at least three become a range, runs of two
 * stay listed. `1,2,3,5,6,8,9,10` becomes `1–3, 5, 6, 8–10`.
 */
export function compressNumbers(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const parts: string[] = []
  let start = sorted[0]
  let previous = sorted[0]

  const flush = (): void => {
    const runLength = previous - start + 1
    if (runLength >= 3) parts.push(`${start}–${previous}`)
    else for (let value = start; value <= previous; value += 1) parts.push(String(value))
  }

  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === previous + 1) {
      previous = sorted[i]
      continue
    }
    flush()
    start = sorted[i]
    previous = sorted[i]
  }
  flush()
  return parts.join(', ')
}

export function citationLabel(
  referenceIds: readonly string[],
  numbering: ReferenceNumbering,
): string {
  const numbers = referenceIds
    .map((id) => numbering.get(id))
    .filter((value): value is number => typeof value === 'number')
  return compressNumbers(numbers)
}

/** `Tittel ⋅ Forfatter(e) ⋅ År ⋅ Lenke`, skipping empty parts. */
export function formatReference(reference: Reference): string {
  return formatReferenceParts(reference, true)
}

function formatReferenceParts(
  reference: Pick<Reference, 'title' | 'authors' | 'year' | 'url'>,
  includeUrl: boolean,
): string {
  const parts = [reference.title, reference.authors, reference.year]
  if (includeUrl) parts.push(reference.url)
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ⋅ ')
}

export interface ReferenceEntry {
  id: string
  number: number
  text: string
  /** `text` with the url stripped off, so a renderer can link only the url itself. */
  label: string
  url: string
}

export function referenceEntries(deck: DeckSource): ReferenceEntry[] {
  const numbering = computeReferenceNumbering(deck)
  const byId = new Map(deck.references.map((reference) => [reference.id, reference]))
  return referenceOrder(deck).flatMap((id) => {
    const reference = byId.get(id)
    if (!reference) return []
    return [
      {
        id,
        number: numbering.get(id) ?? 0,
        text: formatReference(reference),
        label: formatReferenceParts(reference, false),
        url: reference.url.trim(),
      },
    ]
  })
}

/* ------------------------------------------------------------------ *
 * Pagination of derived reference slides
 * ------------------------------------------------------------------ */

export interface ReferencePaginationOptions {
  width: number
  height: number
  gap?: number
  maxColumns?: number
  fontSize?: number
  lineHeight?: number
  /**
   * Injected estimator so this stays pure and testable.
   *
   * The entry id comes along so a caller can measure the node it is actually
   * going to render rather than a reconstruction of it.
   */
  measureEntryHeight?: (text: string, columnWidth: number, entryId: string) => number
}

export interface ReferencePlan {
  columns: number
  /** Reference entries grouped per slide, then per column. */
  slides: ReferenceEntry[][][]
}

function defaultEntryHeight(text: string, columnWidth: number, fontSize: number): number {
  const charsPerLine = Math.max(1, Math.floor(columnWidth / (fontSize * 0.5)))
  const lines = Math.max(1, Math.ceil((text.length + 4) / charsPerLine))
  return lines * fontSize * REFERENCE_LINE_HEIGHT + REFERENCE_ENTRY_GAP
}

/**
 * Use as few columns as possible, add columns before adding slides, and never
 * shrink the font below the configured minimum — add another slide instead.
 *
 * `measureEntryHeight` is what makes the plan match the page: the caller that
 * renders these entries measures the node it is going to draw, with the
 * typography it will draw it in. The built-in estimate below is a fallback for
 * callers that have neither.
 */
export function planReferenceSlides(
  entries: ReferenceEntry[],
  options: ReferencePaginationOptions,
): ReferencePlan {
  if (entries.length === 0) return { columns: 1, slides: [] }
  const gap = options.gap ?? G
  const maxColumns = options.maxColumns ?? REFERENCE_MAX_COLUMNS
  const fontSize = options.fontSize ?? REFERENCE_FONT_SIZE
  const measure =
    options.measureEntryHeight ?? ((text, width) => defaultEntryHeight(text, width, fontSize))

  for (let columns = 1; columns <= maxColumns; columns += 1) {
    const columnWidth = (options.width - gap * (columns - 1)) / columns
    if (columnWidth <= 0) continue
    const plan = fill(entries, columns, columnWidth, options.height, measure)
    if (plan.length === 1) return { columns, slides: plan }
    if (columns === maxColumns) return { columns, slides: plan }
  }
  return { columns: maxColumns, slides: [[entries]] }
}

function fill(
  entries: ReferenceEntry[],
  columns: number,
  columnWidth: number,
  columnHeight: number,
  measure: (text: string, width: number, entryId: string) => number,
): ReferenceEntry[][][] {
  const slides: ReferenceEntry[][][] = []
  let currentSlide: ReferenceEntry[][] = [[]]
  let currentColumn = 0
  let used = 0

  for (const entry of entries) {
    const height = measure(entry.text, columnWidth, entry.id)
    if (used + height > columnHeight && currentSlide[currentColumn].length > 0) {
      currentColumn += 1
      used = 0
      if (currentColumn >= columns) {
        slides.push(currentSlide)
        currentSlide = [[]]
        currentColumn = 0
      } else {
        currentSlide.push([])
      }
    }
    currentSlide[currentColumn].push(entry)
    used += height
  }
  if (currentSlide.some((column) => column.length > 0)) slides.push(currentSlide)
  return slides
}

/** Derived reference slides are never stored; they are recomputed on render. */
export const REFERENCE_SLIDE_ID_PREFIX = '__references__'

