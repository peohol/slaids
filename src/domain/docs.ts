/**
 * Traversal and transformation across every rich-text document in a
 * presentation, including slide titles, card titles, subfields and the sandbox.
 *
 * Section slides are included, and their two lines go through the transform
 * like any other document — even though the one caller today,
 * `deleteReference`, will never find anything there: a section's schema has no
 * citation node in it. Reaching every document is the contract; which of them
 * happen to hold what a given transform looks for is not this module's
 * business.
 */

import { imagePanelOf, withImagePanel } from './content'
import { walkNodes } from './layout'
import { mapDeckSlides } from './deckSlides'
import { emptyDoc } from './richdoc'
import type {
  CardBody,
  ContentSlide,
  DeckSlides,
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
    // Air draws no text at all, so there is nothing to map.
    case 'negative-space':
      return content
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

/** A rewrite of one zone's content, whatever kind it is. */
export type ContentTransform = (content: ZoneContent) => ZoneContent

/**
 * Rebuild every leaf's content in a zone tree.
 *
 * The one traversal of the tree, so a caller that wants to reach every zone —
 * to rewrite documents, or to strip something out on the way to being
 * published — says what it wants done rather than walking the tree again. An
 * unchanged transform returns the very same nodes, so callers can tell a no-op
 * apart from a change by identity.
 */
export function mapTreeContent(node: LayoutNode, transform: ContentTransform): LayoutNode {
  if (node.kind === 'leaf') {
    if (!node.content) return node
    const content = transform(node.content)
    return content === node.content ? node : { ...node, content }
  }
  let changed = false
  const children = node.children.map((child) => {
    const next = mapTreeContent(child, transform)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...node, children } : node
}

/** Every zone of every content slide, rebuilt. Sections and miniapps have none. */
export function mapDeckContents(slides: DeckSlides, transform: ContentTransform): DeckSlides {
  return mapDeckSlides(slides, {
    section: (slide) => slide,
    interactive: (slide) => slide,
    content: (slide) => {
      const root = mapTreeContent(slide.root, transform)
      return root === slide.root ? slide : { ...slide, root }
    },
  })
}

function mapTreeDocs(node: LayoutNode, transform: DocTransform): LayoutNode {
  return mapTreeContent(node, (content) => mapContentDocs(content, transform))
}

/** Apply a transform to every document in the presentation. Structure-preserving. */
export function mapPresentationDocs(
  presentation: Presentation,
  transform: DocTransform,
): Presentation {
  let changed = false

  const mapSlide = (slide: ContentSlide): ContentSlide => {
    const title = slide.title ? transform(slide.title) : null
    const root = mapTreeDocs(slide.root, transform)
    if (title === slide.title && root === slide.root) return slide
    changed = true
    return { ...slide, title, root }
  }

  const slides = mapDeckSlides(presentation.slides, {
    section: (slide) => {
      const title = transform(slide.title)
      const subtitle = transform(slide.subtitle)
      if (title === slide.title && subtitle === slide.subtitle) return slide
      changed = true
      return { ...slide, title, subtitle }
    },
    content: mapSlide,
    // A miniapp's source is a file, not a document: no transform reaches it.
    interactive: (slide) => slide,
  })

  const sandbox = presentation.sandbox.map((item) => {
    const content = mapContentDocs(item.content, transform)
    if (content === item.content) return item
    changed = true
    return { ...item, content }
  })

  const sandboxSlides = presentation.sandboxSlides?.map(mapSlide)
  return changed ? { ...presentation, slides, sandbox, sandboxSlides } : presentation
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
    // A section has no zones, so there is nothing of it to collect.
    if (slide.kind !== 'content') continue
    walkNodes(slide.root, (node) => {
      if (node.kind === 'leaf' && node.content) out.push(node.content)
    })
  }
  return out
}

/** Every zone content in the presentation, slides first, then the sandbox. */
export function allContent(presentation: Presentation): ZoneContent[] {
  return [...slideContent(presentation.slides), ...sandboxContent(presentation)]
}

export function sandboxContent(presentation: Presentation): ZoneContent[] {
  return [
    ...presentation.sandbox.map((item) => item.content),
    ...slideContent(presentation.sandboxSlides ?? []),
  ]
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
  return makeAssetNodeRewriter((node, assetId) => {
    const next = map.get(assetId)
    return next ? { ...node, attrs: { ...node.attrs, assetId: next } } : node
  })
}

/**
 * A transform that hands every node naming a file to `rewrite`, with the id it
 * names, and keeps whatever comes back. Returning the node itself means «leave
 * it», and a document nothing in it changed is returned as the same object —
 * the structure-preserving contract every transform in this module keeps.
 *
 * The one walk over a document's file references, shared by the remap import
 * and paste do and by the optimiser's replacement, which also has to update the
 * proportions a picture node stores about the file it points at.
 */
export function makeAssetNodeRewriter(
  rewrite: (node: RichNode, assetId: string) => RichNode,
): DocTransform {
  return (doc: RichDoc): RichDoc => {
    let changed = false
    const walk = (nodes: RichNode[] | undefined): RichNode[] | undefined => {
      if (!nodes) return undefined
      return nodes.map((node) => {
        const assetId = node.attrs?.assetId
        const rewritten = typeof assetId === 'string' ? rewrite(node, assetId) : node
        const content = walk(node.content)
        if (rewritten === node && content === node.content) return node
        changed = true
        return { ...rewritten, ...(content ? { content } : {}) }
      })
    }
    const content = walk(doc.content)
    return changed && content ? { ...doc, content } : doc
  }
}

/**
 * Every zone content in the presentation — on the slides and in the sandbox —
 * put through `transform`. Structure-preserving: content the transform hands
 * back unchanged stays the same object, and so does a presentation in which
 * nothing changed.
 */
export function mapPresentationContent(
  presentation: Presentation,
  transform: (content: ZoneContent) => ZoneContent,
): Presentation {
  let changed = false
  const mapSlide = (slide: ContentSlide): ContentSlide => {
    const root = mapTreeContent(slide.root, transform)
    if (root === slide.root) return slide
    changed = true
    return { ...slide, root }
  }
  const slides = mapDeckSlides(presentation.slides, {
    section: (slide) => slide,
    content: mapSlide,
    interactive: (slide) => slide,
  })
  const sandbox = presentation.sandbox.map((item) => {
    const content = transform(item.content)
    if (content === item.content) return item
    changed = true
    return { ...item, content }
  })
  const sandboxSlides = presentation.sandboxSlides?.map(mapSlide)
  return changed ? { ...presentation, slides, sandbox, sandboxSlides } : presentation
}

/** Rewrite asset ids everywhere they are referenced. Used by import and paste. */
export function remapAssetIds(
  presentation: Presentation,
  map: ReadonlyMap<string, string>,
): Presentation {
  if (map.size === 0) return presentation
  const remapped = mapPresentationContent(presentation, (content) => remapContentAssetIds(content, map))
  const assets = presentation.assets.map((asset) => ({ ...asset, id: map.get(asset.id) ?? asset.id }))
  return { ...remapped, assets }
}

/**
 * Remove every trace of these files from the presentation.
 *
 * The mirror of `remapAssetIds`, for the one case where a file a document names
 * will not exist: a `.slaids` archive whose figure the ingress door refuses, or
 * whose bytes are simply not in the zip. Keeping the `AssetRef` would import a
 * deck pointing at bytes nobody is ever going to write — precisely the state
 * `unknownAssetIds` calls broken — so the reference goes at the same moment the
 * file does.
 *
 * What "removed" means depends on where the reference sits, and both answers
 * are states the model already has rather than new ones:
 *
 *  - a picture zone keeps its crop, its caption and its title and simply has no
 *    file (`assetId: null`), which is exactly a zone waiting for one;
 *  - an inline picture is a block in the text, and a block pointing at nothing
 *    cannot be drawn, so it is taken out. Whatever held it — the field itself, a
 *    quote, a list item, a table cell — is left with an empty paragraph if the
 *    picture was all it had. Every one of those requires at least one block, so
 *    an emptied container is not a document any more; and the removal happens
 *    *after* `migratePresentation` validated it, so nothing would catch it.
 */
export function dropAssetIds(
  presentation: Presentation,
  ids: ReadonlySet<string>,
): Presentation {
  if (ids.size === 0) return presentation
  return {
    ...mapPresentationContent(presentation, (content) => dropContentAssetIds(content, ids)),
    assets: presentation.assets.filter((asset) => !ids.has(asset.id)),
  }
}

/** Remove every trace of these files from a single content object. */
export function dropContentAssetIds(
  content: ZoneContent,
  ids: ReadonlySet<string>,
): ZoneContent {
  if (ids.size === 0) return content
  const cleaned = mapContentDocs(content, makeAssetDocRemover(ids))
  const panel = imagePanelOf(cleaned)
  if (!panel?.assetId || !ids.has(panel.assetId)) return cleaned
  return withImagePanel(cleaned, { ...panel, assetId: null })
}

function makeAssetDocRemover(ids: ReadonlySet<string>): DocTransform {
  const walk = (nodes: RichNode[] | undefined): RichNode[] | undefined => {
    if (!nodes) return nodes
    let changed = false
    const kept: RichNode[] = []
    for (const node of nodes) {
      const assetId = node.attrs?.assetId
      if (typeof assetId === 'string' && ids.has(assetId)) {
        changed = true
        continue
      }
      const content = walk(node.content)
      if (content === node.content) {
        kept.push(node)
        continue
      }
      changed = true
      /*
       * A container emptied by the removal is repaired the same way the
       * document is, and for the same reason. A picture is a *block*, so the
       * only nodes that can hold one directly are the document, a quote, a list
       * item and a table cell — and every one of them requires at least one
       * block. "Keep it, empty" is not a state any of them has: ProseMirror
       * refuses `blockquote: <>` outright, so a document that was valid when it
       * was migrated would be made invalid *after* validation and saved that
       * way. One rule rather than a list of node names, because the list is
       * exactly the nodes this can empty.
       */
      kept.push({ ...node, content: content && content.length > 0 ? content : [emptyBlock()] })
    }
    return changed ? kept : nodes
  }

  return (doc: RichDoc): RichDoc => {
    const content = walk(doc.content)
    if (content === doc.content) return doc
    return content && content.length > 0 ? { ...doc, content } : emptyDoc()
  }
}

/** A fresh empty paragraph — the block every emptied container is left with. */
function emptyBlock(): RichNode {
  return { type: 'paragraph' }
}

