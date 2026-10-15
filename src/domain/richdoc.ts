/**
 * Helpers for the stored rich-text format (ProseMirror / Tiptap JSON).
 *
 * Rich text is never stored as raw HTML. These helpers are pure and run
 * anywhere, so they can be used by tests, measurement and the reference
 * numbering pass alike.
 */

import {
  DEFAULT_TEXT_ALIGN,
  INLINE_IMAGE_MAX_WIDTH_PERCENT,
  INLINE_IMAGE_MIN_WIDTH_PERCENT,
  type AlignableBlock,
} from './constants'
import type { RichDoc, RichNode, TextAlign, TitleDoc } from './types'

export const CITATION_NODE = 'citation'
export const IMAGE_NODE = 'slaidsImage'

/**
 * The stored node behind what the agent contract calls an accent.
 *
 * It is a ProseMirror heading and stays one — renaming the node would be a
 * migration that changes nothing anybody reads. The name that mattered was the
 * one in the contract (see `agent/text.ts`), and this constant is what keeps
 * the two ends of that seam — the translation in and out, and the check that
 * finds an accent standing in for a card title — naming the same node.
 */
export const ACCENT_NODE = 'heading'

export function emptyDoc(): RichDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

export function paragraphDoc(text: string): RichDoc {
  if (!text) return emptyDoc()
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

export function titleDoc(text: string): TitleDoc {
  return paragraphDoc(text)
}

/**
 * A picture standing in the flow of a field, as the document stores it.
 *
 * The bytes are never here: the node carries the id of a file in the
 * presentation's own asset list, and everything else is how that file is drawn.
 * `aspect` is the file's intrinsic width over its height — the box has a shape
 * before the file has loaded, and the headless fit estimator has something to
 * measure — and it is derived from the stored file rather than declared,
 * because a claimed ratio is a claim and the bitstream is a measurement.
 *
 * The editor extension declares the node; everything that reads one goes
 * through here — the static renderer, the headless fit estimator and the
 * agent's text format — so what a picture *means* is answered once, and a
 * missing id or a width outside the range gets the same answer everywhere.
 */
export interface InlineImage {
  assetId: string
  alt: string
  /** Share of the column, `INLINE_IMAGE_MIN_WIDTH_PERCENT`–100. */
  widthPercent: number
  /** Intrinsic width / height, or `null` in a document written before it. */
  aspect: number | null
  /** Where the picture sits in its column, or `null` when it stores no choice. */
  align: TextAlign | null
}

/** Which kind of document a block sits in: a body field, or a one-line title. */
export type DocField = 'body' | 'title'

/** Which default an unaligned block of this node type, in this kind of document, is drawn with. */
export function alignableBlockOf(nodeType: string | undefined, field: DocField): AlignableBlock {
  if (field === 'title') return 'title'
  if (nodeType === ACCENT_NODE) return 'accent'
  if (nodeType === IMAGE_NODE) return 'image'
  return 'text'
}

/**
 * The alignment a block is *drawn* with: its own, or its kind's default when it
 * stores none.
 *
 * Separate from what a block stores, and deliberately the only place the two
 * meet. Every renderer resolves absent through here — the static one, the
 * editor's markup and picture node view, and the fit measurement that reads the
 * same markup — so a block nobody aligned cannot end up drawn one way while it
 * is edited and another way on the slide. What is *stored* stays untouched:
 * that is what the agent's text format reports, and what lets the default move
 * later without rewriting a single document.
 */
export function drawnAlign(align: unknown, block: AlignableBlock): TextAlign {
  return align === 'left' || align === 'center' || align === 'right' ? align : DEFAULT_TEXT_ALIGN[block]
}

export function imageNode(
  assetId: string,
  options: {
    alt?: string
    widthPercent?: number
    aspect?: number | null
    align?: TextAlign | null
  } = {},
): RichNode {
  const { alt = '', widthPercent = INLINE_IMAGE_MAX_WIDTH_PERCENT, aspect, align } = options
  return {
    type: IMAGE_NODE,
    attrs: {
      assetId,
      alt,
      widthPercent: clampImageWidth(widthPercent),
      ...(typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0 ? { aspect } : {}),
      ...(align ? { textAlign: align } : {}),
    },
  }
}

/** What a stored node says, or `null` when it is not a usable picture. */
export function inlineImageOf(node: RichNode): InlineImage | null {
  if (node.type !== IMAGE_NODE) return null
  const assetId = node.attrs?.assetId
  // A picture pointing at nothing is not a picture. It cannot be drawn and it
  // cannot be written back, so the callers that ask "is this a picture?" are
  // better served by "no" than by an id they would have to check again.
  if (typeof assetId !== 'string' || assetId.length === 0) return null
  const alt = node.attrs?.alt
  const aspect = Number(node.attrs?.aspect)
  const align = node.attrs?.textAlign
  return {
    assetId,
    alt: typeof alt === 'string' ? alt : '',
    widthPercent: clampImageWidth(Number(node.attrs?.widthPercent)),
    aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : null,
    align: align === 'left' || align === 'center' || align === 'right' ? align : null,
  }
}

/**
 * Whatever arrives, brought inside the range a picture may be drawn at.
 *
 * A node that states no width at all means the whole column — that is what the
 * renderer has always drawn for one — which is a different question from how
 * wide a *new* picture starts out (`INLINE_IMAGE_DEFAULT_WIDTH_PERCENT`, half
 * the column, so there is room for words beside it).
 */
function clampImageWidth(percent: number): number {
  if (!Number.isFinite(percent)) return INLINE_IMAGE_MAX_WIDTH_PERCENT
  return Math.max(
    INLINE_IMAGE_MIN_WIDTH_PERCENT,
    Math.min(INLINE_IMAGE_MAX_WIDTH_PERCENT, Math.round(percent)),
  )
}

export function walkRichNodes(doc: RichDoc, visit: (node: RichNode) => void): void {
  const go = (node: RichNode): void => {
    visit(node)
    if (node.content) for (const child of node.content) go(child)
  }
  if (doc.content) for (const child of doc.content) go(child)
}

/**
 * The document with each node passed through `change`, children first.
 *
 * The very same object comes back when `change` changed nothing, all the way
 * up — so a caller can tell «nothing to do» from an edit without comparing.
 */
export function mapRichNodes(doc: RichDoc, change: (node: RichNode) => RichNode): RichDoc {
  const mapAll = (nodes: RichNode[] | undefined): RichNode[] | undefined => {
    if (!nodes) return nodes
    let changed = false
    const next = nodes.map((node) => {
      const content = mapAll(node.content)
      const mapped = change(content === node.content ? node : { ...node, content })
      if (mapped !== node) changed = true
      return mapped
    })
    return changed ? next : nodes
  }
  const content = mapAll(doc.content)
  return content === doc.content ? doc : { ...doc, content }
}

/**
 * The document with every accent's own colour taken off, so each is painted
 * with its section's again — the «Standard» the colour picker offers.
 */
export function withoutAccentColors(doc: RichDoc): RichDoc {
  return mapRichNodes(doc, (node) => {
    if (node.type !== ACCENT_NODE || node.attrs?.color == null) return node
    return { ...node, attrs: { ...node.attrs, color: null } }
  })
}

export function docToPlainText(doc: RichDoc | null | undefined): string {
  if (!doc) return ''
  const parts: string[] = []
  const go = (nodes: RichNode[] | undefined): void => {
    if (!nodes) return
    for (const node of nodes) {
      if (node.type === 'text' && node.text) parts.push(node.text)
      else if (node.type === 'hardBreak') parts.push(' ')
      if (node.content) go(node.content)
      if (isBlockNode(node.type)) parts.push('\n')
    }
  }
  go(doc.content)
  return parts.join('').replace(/\n+/g, '\n').trim()
}

const BLOCK_NODES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'bulletList',
  'orderedList',
  'tableRow',
])

export function isBlockNode(type: string): boolean {
  return BLOCK_NODES.has(type)
}

export function isDocEmpty(doc: RichDoc | null | undefined): boolean {
  if (!doc) return true
  let hasAnything = false
  walkRichNodes(doc, (node) => {
    if (node.type === 'text' && node.text && node.text.trim().length > 0) hasAnything = true
    if (node.type === CITATION_NODE || node.type === IMAGE_NODE) hasAnything = true
    if (node.type === 'table') hasAnything = true
  })
  return !hasAnything
}

/** Reference ids in document order, including repeats. */
export function collectCitationIds(doc: RichDoc | null | undefined): string[] {
  if (!doc) return []
  const ids: string[] = []
  walkRichNodes(doc, (node) => {
    if (node.type !== CITATION_NODE) return
    const raw = node.attrs?.referenceIds
    if (Array.isArray(raw)) {
      for (const id of raw) if (typeof id === 'string') ids.push(id)
    }
  })
  return ids
}

/** Asset ids referenced from inside a document. */
export function collectDocAssetIds(doc: RichDoc | null | undefined): string[] {
  if (!doc) return []
  const ids: string[] = []
  walkRichNodes(doc, (node) => {
    if (node.type !== IMAGE_NODE) return
    const assetId = node.attrs?.assetId
    if (typeof assetId === 'string') ids.push(assetId)
  })
  return ids
}

/** Remove every citation that points at a reference id in `removed`. */
export function removeCitations(doc: RichDoc, removed: ReadonlySet<string>): RichDoc {
  const filterNodes = (nodes: RichNode[] | undefined): RichNode[] | undefined => {
    if (!nodes) return undefined
    const out: RichNode[] = []
    for (const node of nodes) {
      if (node.type === CITATION_NODE) {
        const raw = Array.isArray(node.attrs?.referenceIds)
          ? (node.attrs.referenceIds as unknown[]).filter(
              (id): id is string => typeof id === 'string' && !removed.has(id),
            )
          : []
        if (raw.length === 0) continue
        out.push({ ...node, attrs: { ...node.attrs, referenceIds: raw } })
        continue
      }
      const content = filterNodes(node.content)
      out.push(content ? { ...node, content } : node)
    }
    return out
  }
  const content = filterNodes(doc.content)
  return content ? { ...doc, content } : doc
}

/** Reference ids on a citation node, in order, ignoring anything malformed. */
export function citationIdsOf(node: RichNode): string[] {
  return Array.isArray(node.attrs?.referenceIds)
    ? (node.attrs.referenceIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
}

/**
 * Collapse citations that stand next to each other into one.
 *
 * `[1][2][3]` is three separate references but one *reference* in the reader's
 * eye, and three pills in a row is noise where `1–3` is a citation. Whitespace
 * between them counts as adjacency — a space typed between two citations is a
 * typing artefact, not a sentence — and is removed along with the merge.
 *
 * Ids keep first-appearance order and are deduplicated, so merging is
 * idempotent and can be run on load, after an insertion, or on a paste.
 */
export function mergeAdjacentCitations(doc: RichDoc): RichDoc {
  let changed = false

  const isWhitespace = (node: RichNode): boolean =>
    node.type === 'text' && typeof node.text === 'string' && node.text.trim() === ''

  const mergeNodes = (nodes: RichNode[] | undefined): RichNode[] | undefined => {
    if (!nodes) return undefined
    const out: RichNode[] = []

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]
      if (node.type !== CITATION_NODE) {
        const content = mergeNodes(node.content)
        out.push(content ? { ...node, content } : node)
        continue
      }

      const ids: string[] = [...citationIdsOf(node)]
      let last = i
      for (let j = i + 1; j < nodes.length; j += 1) {
        const candidate = nodes[j]
        if (isWhitespace(candidate)) continue
        if (candidate.type !== CITATION_NODE) break
        for (const id of citationIdsOf(candidate)) if (!ids.includes(id)) ids.push(id)
        last = j
      }

      if (last > i) {
        changed = true
        out.push({ ...node, attrs: { ...node.attrs, referenceIds: ids } })
        i = last
        continue
      }
      out.push(node)
    }
    return out
  }

  const content = mergeNodes(doc.content)
  // Unchanged documents come back identical, so callers can compare by
  // reference and skip the work that follows a real change.
  return changed && content ? { ...doc, content } : doc
}

/**
 * A paragraph that draws a line of nothing: no words, no citation, no picture.
 *
 * Whitespace counts as nothing, because a line of spaces is a typing artefact
 * rather than something the author put there. A hard break is not whitespace:
 * somebody asked for that line.
 */
function isBlankParagraph(node: RichNode): boolean {
  if (node.type !== 'paragraph') return false
  if (!node.content || node.content.length === 0) return true
  return node.content.every(
    (child) => child.type === 'text' && (child.text ?? '').trim().length === 0,
  )
}

/**
 * Drop the blank lines a document ends with.
 *
 * A blank line between two paragraphs is a distance the author chose; a blank
 * line *after* the last one is not a distance to anything, and a field aligns
 * its whole flow — so a trailing blank line is what pushes centred content up
 * and leaves more air below it than above. Inserting a picture leaves exactly
 * such a line behind every time, because a block node inserted into a
 * paragraph splits it.
 *
 * The editor still keeps that line: it is where the caret goes when somebody
 * wants to write on after a picture, and it is added back by
 * `TrailingLineExtension` the moment it is needed. It simply never becomes part
 * of the document — which is what makes it disappear again when it is left
 * empty.
 *
 * A document is `block+`, so the last block survives even when it is blank.
 * Unchanged documents come back identical, so callers can compare by reference.
 */
export function trimTrailingBlankLines(doc: RichDoc): RichDoc {
  const content = doc.content
  if (!content || content.length === 0) return doc
  let end = content.length
  while (end > 1 && isBlankParagraph(content[end - 1])) end -= 1
  return end === content.length ? doc : { ...doc, content: content.slice(0, end) }
}

/** Approximate character count, used by the size estimator fallback. */
export function docCharacterCount(doc: RichDoc | null | undefined): number {
  if (!doc) return 0
  let count = 0
  walkRichNodes(doc, (node) => {
    if (node.type === 'text' && node.text) count += node.text.length
    if (node.type === CITATION_NODE) count += 4
  })
  return count
}

/** Strip everything but plain text — the safe basis for external paste. */
export function plainTextToDoc(text: string): RichDoc {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
  if (paragraphs.length === 0) return emptyDoc()
  return {
    type: 'doc',
    content: paragraphs.map((block) => {
      const lines = block.split('\n')
      const content: RichNode[] = []
      lines.forEach((line, index) => {
        if (index > 0) content.push({ type: 'hardBreak' })
        if (line) content.push({ type: 'text', text: line })
      })
      return { type: 'paragraph', content }
    }),
  }
}
