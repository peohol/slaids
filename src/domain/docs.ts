/**
 * Traversal and transformation across every rich-text document in a
 * presentation, including slide titles, card titles, subfields and the sandbox.
 *
 * The cover is deliberately not among them, and it is not an omission: the one
 * caller is `deleteReference`, which strips citations, and the cover's schema
 * has no citation node in it. A cover line has nothing for a transform to find.
 */

import { imagePanelOf, withImagePanel } from './content'
import { walkNodes } from './layout'
import type {
  CardBody,
  ImagePanel,
  LayoutNode,
  Presentation,
  RichDoc,
  RichNode,
  Slide,
  ZoneContent,
} from './types'

export type DocTransform = (doc: RichDoc) => RichDoc

export function mapContentDocs(content: ZoneContent, transform: DocTransform): ZoneContent {
  switch (content.kind) {
    case 'container':
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
    case 'image': {
      const image = mapPanelDocs(content.image, transform)
      return image === content.image ? content : { ...content, image }
    }
    case 'titled-image-card': {
      const title = transform(content.title)
      const image = mapPanelDocs(content.image, transform)
      if (title === content.title && image === content.image) return content
      return { ...content, title, image }
    }
  }
}

/** A picture's only document is its caption, when it has one. */
function mapPanelDocs(panel: ImagePanel, transform: DocTransform): ImagePanel {
  if (!panel.caption) return panel
  const doc = transform(panel.caption.doc)
  return doc === panel.caption.doc ? panel : { ...panel, caption: { ...panel.caption, doc } }
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

/**
 * Every zone content on these slides, in slide order.
 *
 * The sandbox is deliberately not part of this: it is work in progress that is
 * not on any slide, which is exactly the distinction a published snapshot has
 * to make. `allContent` adds it back for the callers that want everything.
 */
export function slideContent(slides: readonly Slide[]): ZoneContent[] {
  const out: ZoneContent[] = []
  for (const slide of slides) {
    walkNodes(slide.root, (node) => {
      if (node.kind === 'leaf' && node.content) out.push(node.content)
    })
  }
  return out
}

/** Every zone content in the presentation, slides first, then the sandbox. */
export function allContent(presentation: Presentation): ZoneContent[] {
  return [...slideContent(presentation.slides), ...presentation.sandbox.map((item) => item.content)]
}

/** Rewrite asset ids inside a single content object. */
export function remapContentAssetIds(
  content: ZoneContent,
  map: ReadonlyMap<string, string>,
): ZoneContent {
  if (map.size === 0) return content
  const mapped = mapContentDocs(content, makeAssetDocRemapper(map))
  const panel = imagePanelOf(mapped)
  const next = panel?.assetId ? map.get(panel.assetId) : undefined
  return next && panel ? withImagePanel(mapped, { ...panel, assetId: next }) : mapped
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
