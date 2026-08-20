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

export function headingParagraphDoc(heading: string, body: string): RichDoc {
  const content: RichNode[] = []
  content.push({
    type: 'heading',
    attrs: { level: 1 },
    ...(heading ? { content: [{ type: 'text', text: heading }] } : {}),
  })
  content.push({
    type: 'paragraph',
    ...(body ? { content: [{ type: 'text', text: body }] } : {}),
  })
  return { type: 'doc', content }
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

export function docBlockCount(doc: RichDoc | null | undefined): number {
  if (!doc) return 0
  let count = 0
  walkRichNodes(doc, (node) => {
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem') count += 1
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
