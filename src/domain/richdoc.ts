/**
 * Helpers for the stored rich-text format (ProseMirror / Tiptap JSON).
 *
 * Rich text is never stored as raw HTML. These helpers are pure and run
 * anywhere, so they can be used by tests, measurement and the reference
 * numbering pass alike.
 */

import type { RichDoc, RichNode, TitleDoc } from './types'

export const CITATION_NODE = 'citation'
export const IMAGE_NODE = 'slaidsImage'

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

export function imageNode(assetId: string, alt = '', widthPercent = 100): RichNode {
  return { type: IMAGE_NODE, attrs: { assetId, alt, widthPercent } }
}

export function walkRichNodes(doc: RichDoc, visit: (node: RichNode) => void): void {
  const go = (node: RichNode): void => {
    visit(node)
    if (node.content) for (const child of node.content) go(child)
  }
  if (doc.content) for (const child of doc.content) go(child)
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
