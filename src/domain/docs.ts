/**
 * Traversal and transformation across every rich-text document in a
 * presentation, including slide titles, card titles, subfields and the sandbox.
 */

import { walkNodes } from './layout'
import type { LayoutNode, Presentation, RichDoc, ZoneContent } from './types'

export type DocTransform = (doc: RichDoc) => RichDoc

export function mapContentDocs(content: ZoneContent, transform: DocTransform): ZoneContent {
  switch (content.kind) {
    case 'container': {
      if (content.payload.type !== 'richdoc') return content
      const doc = transform(content.payload.doc)
      return doc === content.payload.doc ? content : { ...content, payload: { type: 'richdoc', doc } }
    }
    case 'untitled-card': {
      const body = mapBodyDocs(content, transform)
      return body === content.body ? content : { ...content, body }
    }
    case 'titled-card': {
      const title = transform(content.title)
      const body = mapBodyDocs(content, transform)
      if (title === content.title && body === content.body) return content
      return { ...content, title, body }
    }
  }
}

function mapBodyDocs(
  content: Extract<ZoneContent, { body: unknown }>,
  transform: DocTransform,
): (typeof content)['body'] {
  let changed = false
  const subfields = content.body.subfields.map((field) => {
    const doc = transform(field.doc)
    if (doc === field.doc) return field
    changed = true
    return { ...field, doc }
  })
  return changed ? { ...content.body, subfields } : content.body
}

function mapTreeDocs(node: LayoutNode, transform: DocTransform): LayoutNode {
  if (node.kind === 'leaf') {
    if (!node.content) return node
    const content = mapContentDocs(node.content, transform)
    return content === node.content ? node : { ...node, content }
  }
  let changed = false
  const children = node.children.map((child) => {
    const next = mapTreeDocs(child, transform)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...node, children } : node
}

/** Apply a transform to every document in the presentation. Structure-preserving. */
export function mapPresentationDocs(
  presentation: Presentation,
  transform: DocTransform,
): Presentation {
  let changed = false

  const slides = presentation.slides.map((slide) => {
    const title = slide.title ? transform(slide.title) : null
    const root = mapTreeDocs(slide.root, transform)
    if (title === slide.title && root === slide.root) return slide
    changed = true
    return { ...slide, title, root }
  })

  const sandbox = presentation.sandbox.map((item) => {
    const content = mapContentDocs(item.content, transform)
    if (content === item.content) return item
    changed = true
    return { ...item, content }
  })

  return changed ? { ...presentation, slides, sandbox } : presentation
}

/** Every zone content in the presentation, slides first, then the sandbox. */
export function allContent(presentation: Presentation): ZoneContent[] {
  const out: ZoneContent[] = []
  for (const slide of presentation.slides) {
    walkNodes(slide.root, (node) => {
      if (node.kind === 'leaf' && node.content) out.push(node.content)
    })
  }
  for (const item of presentation.sandbox) out.push(item.content)
  return out
}
