/**
 * Traversal and transformation across every rich-text document in a
 * presentation, including slide titles, card titles, subfields and the sandbox.
 */

import { walkNodes } from './layout'
import type { CardBody, LayoutNode, Presentation, RichDoc, RichNode, ZoneContent } from './types'

export type DocTransform = (doc: RichDoc) => RichDoc

export function mapContentDocs(content: ZoneContent, transform: DocTransform): ZoneContent {
  switch (content.kind) {
    case 'container': {
      if (content.payload.type !== 'fields') return content
      const body = mapBodyDocs(content.payload.body, transform)
      return body === content.payload.body
        ? content
        : { ...content, payload: { type: 'fields', body } }
    }
    case 'untitled-card': {
      const body = mapBodyDocs(content.body, transform)
      return body === content.body ? content : { ...content, body }
    }
    case 'titled-card': {
      const title = transform(content.title)
      const body = mapBodyDocs(content.body, transform)
      if (title === content.title && body === content.body) return content
      return { ...content, title, body }
    }
  }
}

function mapBodyDocs(body: CardBody, transform: DocTransform): CardBody {
  let changed = false
  const subfields = body.subfields.map((field) => {
    const doc = transform(field.doc)
    if (doc === field.doc) return field
    changed = true
    return { ...field, doc }
  })
  return changed ? { ...body, subfields } : body
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

/** Rewrite asset ids inside a single content object. */
export function remapContentAssetIds(
  content: ZoneContent,
  map: ReadonlyMap<string, string>,
): ZoneContent {
  if (map.size === 0) return content
  const mapped = mapContentDocs(content, makeAssetDocRemapper(map))
  if (mapped.kind === 'container' && mapped.payload.type === 'asset') {
    const next = map.get(mapped.payload.assetId)
    if (next) return { ...mapped, payload: { ...mapped.payload, assetId: next } }
  }
  return mapped
}

function makeAssetDocRemapper(map: ReadonlyMap<string, string>): DocTransform {
  return (doc: RichDoc): RichDoc => {
    let changed = false
    const walk = (nodes: RichNode[] | undefined): RichNode[] | undefined => {
      if (!nodes) return undefined
      return nodes.map((node) => {
        const assetId = node.attrs?.assetId
        const next = typeof assetId === 'string' ? map.get(assetId) : undefined
        const content = walk(node.content)
        if (!next && content === node.content) return node
        changed = true
        return {
          ...node,
          ...(next ? { attrs: { ...node.attrs, assetId: next } } : {}),
          ...(content ? { content } : {}),
        }
      })
    }
    const content = walk(doc.content)
    return changed && content ? { ...doc, content } : doc
  }
}

/** Rewrite asset ids everywhere they are referenced. Used by import and paste. */
export function remapAssetIds(
  presentation: Presentation,
  map: ReadonlyMap<string, string>,
): Presentation {
  if (map.size === 0) return presentation
  const remapContent = (content: ZoneContent): ZoneContent => remapContentAssetIds(content, map)

  const slides = presentation.slides.map((slide) => ({
    ...slide,
    root: mapTreeContent(slide.root, remapContent),
  }))
  const sandbox = presentation.sandbox.map((item) => ({
    ...item,
    content: remapContent(item.content),
  }))
  const assets = presentation.assets.map((asset) => ({ ...asset, id: map.get(asset.id) ?? asset.id }))
  return { ...presentation, slides, sandbox, assets }
}

function mapTreeContent(
  node: LayoutNode,
  transform: (content: ZoneContent) => ZoneContent,
): LayoutNode {
  if (node.kind === 'leaf') {
    if (!node.content) return node
    const content = transform(node.content)
    return content === node.content ? node : { ...node, content }
  }
  return { ...node, children: node.children.map((child) => mapTreeContent(child, transform)) }
}
