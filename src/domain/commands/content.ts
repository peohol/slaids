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
import { areWeightsValid } from '../geometry'
import { findLeaf, findNode, replaceNode } from '../layout'
import { emptyDoc, isDocEmpty } from '../richdoc'
import { findSlide, touch, withSlide } from '../presentation'
import { err, ok, type Result } from '../result'
import { normalizeHex } from '../color'
import type {
  Axis,
  ContainerPayload,
  Presentation,
  RichDoc,
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
 * Convert content from one kind to another, carrying text across so the user
 * does not lose what they already wrote.
 */
export function convertContentKind(content: ZoneContent, kind: ZoneContentKind): ZoneContent {
  if (content.kind === kind) return content

  const docs: RichDoc[] =
    content.kind === 'container'
      ? content.payload.type === 'richdoc'
        ? [content.payload.doc]
        : []
      : content.body.subfields.map((field) => field.doc)

  if (kind === 'container') {
    const merged = docs.length > 0 ? mergeDocs(docs) : emptyDoc()
    if (content.kind !== 'container' || content.payload.type === 'richdoc') {
      return createContainer({ type: 'richdoc', doc: merged })
    }
    return createContainer(content.payload)
  }

  const body = createCardBody(Math.max(1, docs.length))
  const subfields = body.subfields.map((field, index) => ({
    ...field,
    doc: docs[index] ?? emptyDoc(),
  }))
  const nextBody = { ...body, subfields }

  if (kind === 'untitled-card') {
    const card = createUntitledCard(
      content.kind === 'untitled-card' ? content.backgroundColor : undefined,
    )
    return { ...card, body: nextBody }
  }

  const card = createTitledCard()
  return {
    ...card,
    body: nextBody,
    ...(content.kind === 'titled-card' ? { title: content.title, headerColor: content.headerColor } : {}),
  }
}

function mergeDocs(docs: RichDoc[]): RichDoc {
  const content = docs.flatMap((doc) => doc.content ?? [])
  return content.length > 0 ? { type: 'doc', content } : emptyDoc()
}

export function setContentKind(
  presentation: Presentation,
  input: { slideId: string; nodeId: string; kind: ZoneContentKind },
): Result<Presentation> {
  return updateZoneContent(presentation, input.slideId, input.nodeId, (content) =>
    ok(convertContentKind(content, input.kind)),
  )
}
