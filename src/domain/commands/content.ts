/**
 * Commands that edit the content inside a leaf zone.
 *
 * React components never reach into these objects directly; they call these
 * functions, which validate and return a fresh presentation.
 */

import {
  createCardBody,
  createContainer,
  createTitledCard,
  createUntitledCard,
  hasCardBody,
  withBodyAxis,
  withSubfieldCount,
  withSubfieldDoc,
} from '../content'
import { imageNode, shapeNode } from '../richdoc'
import { areWeightsValid } from '../geometry'
import { findLeaf, findNode, replaceNode } from '../layout'
import { emptyDoc, isDocEmpty } from '../richdoc'
import { findSlide, touch, withSlide } from '../presentation'
import { err, ok, type Result } from '../result'
import { normalizeHex } from '../color'
import type {
  Axis,
  CardBody,
  ContainerPayload,
  Presentation,
  RichDoc,
  RichNode,
  ZoneContent,
  ZoneContentKind,
} from '../types'

type ContentUpdater = (content: ZoneContent) => Result<ZoneContent>

/** Shared plumbing: find the leaf, run the updater, write the result back. */
export function updateZoneContent(
  presentation: Presentation,
  slideId: string,
  nodeId: string,
  updater: ContentUpdater,
): Result<Presentation> {
  const slide = findSlide(presentation, slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  const leaf = findLeaf(slide.root, nodeId)
  if (!leaf) {
    return findNode(slide.root, nodeId)
      ? err('NODE_NOT_LEAF', 'Delte soner har ikke innhold direkte.')
      : err('NODE_NOT_FOUND', 'Fant ikke sonen.')
  }
  if (!leaf.content) return err('TARGET_EMPTY', 'Sonen har ikke innhold.')

  const updated = updater(leaf.content)
  if (!updated.ok) return updated
  if (updated.value === leaf.content) return ok(presentation)

  const root = replaceNode(slide.root, leaf.id, { ...leaf, content: updated.value })
  return ok(touch(withSlide(presentation, { ...slide, root })))
}

export function setSubfieldDoc(
  presentation: Presentation,
  input: { slideId: string; nodeId: string; subfieldId: string; doc: RichDoc },
): Result<Presentation> {
  return updateZoneContent(presentation, input.slideId, input.nodeId, (content) => {
    if (content.kind === 'container') {
      if (content.payload.type !== 'richdoc') {
        return err('INVALID_CONTENT', 'Beholderen inneholder ikke tekst.')
      }
      return ok({ ...content, payload: { type: 'richdoc', doc: input.doc } })
    }
    if (!content.body.subfields.some((field) => field.id === input.subfieldId)) {
      return err('SUBFIELD_NOT_FOUND', 'Fant ikke subfeltet.')
    }
    return ok({ ...content, body: withSubfieldDoc(content.body, input.subfieldId, input.doc) })
  })
}

export function setContainerDoc(
  presentation: Presentation,
  input: { slideId: string; nodeId: string; doc: RichDoc },
): Result<Presentation> {
  return updateZoneContent(presentation, input.slideId, input.nodeId, (content) => {
    if (content.kind !== 'container' || content.payload.type !== 'richdoc') {
      return err('INVALID_CONTENT', 'Sonen inneholder ikke en tekstbeholder.')
    }
    return ok({ ...content, payload: { type: 'richdoc', doc: input.doc } })
  })
}

export function setContainerPayload(
  presentation: Presentation,
  input: { slideId: string; nodeId: string; payload: ContainerPayload },
): Result<Presentation> {
  return updateZoneContent(presentation, input.slideId, input.nodeId, (content) => {
    if (content.kind !== 'container') {
      return err('INVALID_CONTENT', 'Sonen inneholder ikke en beholder.')
    }
    return ok({ ...content, payload: input.payload })
  })
}

export function setCardTitle(
  presentation: Presentation,
  input: { slideId: string; nodeId: string; doc: RichDoc },
): Result<Presentation> {
  return updateZoneContent(presentation, input.slideId, input.nodeId, (content) => {
    if (content.kind !== 'titled-card') {
      return err('INVALID_CONTENT', 'Innholdet har ingen tittel.')
    }
    return ok({ ...content, title: input.doc })
  })
}

export function setSubfieldCount(
  presentation: Presentation,
  input: { slideId: string; nodeId: string; count: number },
): Result<Presentation> {
  return updateZoneContent(presentation, input.slideId, input.nodeId, (content) => {
    if (!hasCardBody(content)) return err('INVALID_CONTENT', 'Innholdet har ingen subfelt.')
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 6) {
      return err('INVALID_ARGUMENT', 'Antall subfelt må være mellom 1 og 6.')
    }
    const removed = content.body.subfields.slice(input.count)
    if (removed.some((field) => !isDocEmpty(field.doc))) {
      return err('INVALID_ARGUMENT', 'Subfeltene som fjernes har innhold. Tøm dem først.')
    }
    return ok({ ...content, body: withSubfieldCount(content.body, input.count) })
  })
}

export function setBodyAxis(
  presentation: Presentation,
  input: { slideId: string; nodeId: string; axis: Axis },
): Result<Presentation> {
  return updateZoneContent(presentation, input.slideId, input.nodeId, (content) => {
    if (!hasCardBody(content)) return err('INVALID_CONTENT', 'Innholdet har ingen subfelt.')
    return ok({ ...content, body: withBodyAxis(content.body, input.axis) })
  })
}

export function setBodyWeights(
  presentation: Presentation,
  input: { slideId: string; nodeId: string; weights: number[] },
): Result<Presentation> {
  return updateZoneContent(presentation, input.slideId, input.nodeId, (content) => {
    if (!hasCardBody(content)) return err('INVALID_CONTENT', 'Innholdet har ingen subfelt.')
    if (input.weights.length !== content.body.subfields.length) {
      return err('INVALID_WEIGHTS', 'Antall forholdstall må matche antall subfelt.')
    }
    if (!areWeightsValid(input.weights)) {
      return err('INVALID_WEIGHTS', 'Alle forholdstall må være tall større enn 0.')
    }
    return ok({ ...content, body: { ...content.body, weights: [...input.weights] } })
  })
}

export function setCardColor(
  presentation: Presentation,
  input: { slideId: string; nodeId: string; color: string },
): Result<Presentation> {
  const color = normalizeHex(input.color)
  if (!color) return err('INVALID_ARGUMENT', 'Ugyldig fargeverdi.')
  return updateZoneContent(presentation, input.slideId, input.nodeId, (content) => {
    if (content.kind === 'untitled-card') return ok({ ...content, backgroundColor: color })
    if (content.kind === 'titled-card') return ok({ ...content, headerColor: color })
    return err('INVALID_CONTENT', 'Beholdere har ingen bakgrunnsfarge.')
  })
}

/**
 * Convert content from one kind to another **without losing anything**.
 *
 * A card title becomes a heading when the target has no title of its own; a
 * container's image or figure becomes an inline node in the card body. Every
 * conversion is reversible in the sense that no user content disappears.
 */
export function convertContentKind(content: ZoneContent, kind: ZoneContentKind): ZoneContent {
  if (content.kind === kind) return content

  if (kind === 'container') {
    const blocks: RichNode[] = []
    if (content.kind === 'titled-card') {
      const heading = titleAsHeading(content.title)
      if (heading) blocks.push(heading)
    }
    if (content.kind !== 'container') {
      for (const field of content.body.subfields) blocks.push(...(field.doc.content ?? []))
    }
    return createContainer({
      type: 'richdoc',
      doc: blocks.length > 0 ? { type: 'doc', content: blocks } : emptyDoc(),
    })
  }

  let docs: RichDoc[]
  let axis: CardBody['axis'] = 'y'
  let weights: number[] | null = null
  let carriedTitle: RichDoc | null = null

  if (content.kind === 'container') {
    docs = [{ type: 'doc', content: containerBlocks(content) }]
  } else {
    docs = content.body.subfields.map((field) => field.doc)
    axis = content.body.axis
    weights = [...content.body.weights]
    if (content.kind === 'titled-card') {
      if (kind === 'titled-card') {
        carriedTitle = content.title
      } else {
        const heading = titleAsHeading(content.title)
        if (heading) {
          docs = [
            { type: 'doc', content: [heading, ...(docs[0]?.content ?? [])] },
            ...docs.slice(1),
          ]
        }
      }
    }
  }

  const base = createCardBody(Math.max(1, docs.length), axis)
  const body: CardBody = {
    axis,
    weights: weights && weights.length === base.subfields.length ? weights : base.weights,
    subfields: base.subfields.map((field, index) => ({ ...field, doc: docs[index] ?? emptyDoc() })),
  }

  if (kind === 'untitled-card') {
    const card = createUntitledCard(
      content.kind === 'untitled-card' ? content.backgroundColor : undefined,
    )
    return { ...card, body }
  }

  const card = createTitledCard()
  return {
    ...card,
    body,
    ...(carriedTitle ? { title: carriedTitle } : {}),
    ...(content.kind === 'titled-card' ? { headerColor: content.headerColor } : {}),
  }
}

/** A card title becomes a heading so its text survives the conversion. */
function titleAsHeading(title: RichDoc): RichNode | null {
  const inline = (title.content ?? []).flatMap((node) => node.content ?? [])
  if (inline.length === 0) return null
  return { type: 'heading', attrs: { level: 1 }, content: inline }
}

/** A container's payload as body blocks, so images and figures are carried over. */
function containerBlocks(content: Extract<ZoneContent, { kind: 'container' }>): RichNode[] {
  switch (content.payload.type) {
    case 'richdoc':
      return content.payload.doc.content ?? []
    case 'asset':
      return [imageNode(content.payload.assetId)]
    case 'shape':
      return [shapeNode(content.payload.shape)]
  }
}

export function setContentKind(
  presentation: Presentation,
  input: { slideId: string; nodeId: string; kind: ZoneContentKind },
): Result<Presentation> {
  return updateZoneContent(presentation, input.slideId, input.nodeId, (content) =>
    ok(convertContentKind(content, input.kind)),
  )
}
