/**
 * Commands that edit the content inside a leaf zone.
 *
 * React components never reach into these objects directly; they call these
 * functions, which validate and return a fresh presentation.
 */

import {
  bodyOf,
  createCardBody,
  createContainer,
  createTitledCard,
  createUntitledCard,
  withBody,
  withBodyAxis,
  withSubfieldCount,
  withSubfieldDoc,
} from '../content'
import { imageNode } from '../richdoc'
import { areWeightsValid } from '../geometry'
import { findLeaf, findNode, replaceNode } from '../layout'
import { emptyDoc, isDocEmpty } from '../richdoc'
import { findSlide, touch, withSlide } from '../presentation'
import { err, ok, type Result } from '../result'
import { normalizeHex } from '../color'
import { guardFit } from './fitGuard'
import type { StructuralOptions } from './types'
import type {
  Axis,
  CardBody,
  ContainerContent,
  ContainerPayload,
  Presentation,
  RichDoc,
  RichNode,
  VerticalAlign,
  ZoneContent,
  ZoneContentKind,
} from '../types'

type ContentUpdater = (content: ZoneContent) => Result<ZoneContent>

/** Everything a content command needs to address one zone. */
export interface ZoneContentTarget extends StructuralOptions {
  slideId: string
  nodeId: string
}

/**
 * Shared plumbing: find the leaf, run the updater, write the result back — and
 * refuse to commit a result that hides content the zone was showing.
 *
 * The fit gate lives here rather than in each command so that no content
 * command can be added later that quietly skips it. Whether it runs at all is
 * still the caller's choice (see `StructuralOptions`): the editor deliberately
 * omits the checkers while typing, because rolling a keystroke back has to
 * happen against the live DOM and must never interrupt an IME composition —
 * `RichTextEditor` owns that. Every non-typing caller, and any headless caller,
 * passes the checkers and gets validated here.
 */
export function updateZoneContent(
  presentation: Presentation,
  target: ZoneContentTarget,
  updater: ContentUpdater,
  fitMessage = 'Innholdet får ikke plass i sonen etter endringen.',
): Result<Presentation> {
  const slide = findSlide(presentation, target.slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  const leaf = findLeaf(slide.root, target.nodeId)
  if (!leaf) {
    return findNode(slide.root, target.nodeId)
      ? err('NODE_NOT_LEAF', 'Delte soner har ikke innhold direkte.')
      : err('NODE_NOT_FOUND', 'Fant ikke sonen.')
  }
  if (!leaf.content) return err('TARGET_EMPTY', 'Sonen har ikke innhold.')

  const updated = updater(leaf.content)
  if (!updated.ok) return updated
  if (updated.value === leaf.content) return ok(presentation)

  const root = replaceNode(slide.root, leaf.id, { ...leaf, content: updated.value })
  const next = touch(withSlide(presentation, { ...slide, root }))
  return guardFit(presentation, next, target, fitMessage)
}

export function setSubfieldDoc(
  presentation: Presentation,
  input: { subfieldId: string; doc: RichDoc } & ZoneContentTarget,
): Result<Presentation> {
  return updateZoneContent(presentation, input, (content) => {
    const body = bodyOf(content)
    if (!body) return err('INVALID_CONTENT', 'Innholdet har ingen tekstfelt.')
    if (!body.subfields.some((field) => field.id === input.subfieldId)) {
      return err('SUBFIELD_NOT_FOUND', 'Fant ikke subfeltet.')
    }
    return ok(withBody(content, withSubfieldDoc(body, input.subfieldId, input.doc)))
  })
}

export function setContainerPayload(
  presentation: Presentation,
  input: { payload: ContainerPayload } & ZoneContentTarget,
): Result<Presentation> {
  return updateZoneContent(
    presentation,
    input,
    (content) => {
      if (content.kind !== 'container') {
        return err('INVALID_CONTENT', 'Sonen inneholder ikke en beholder.')
      }
      return ok({ ...content, payload: input.payload })
    },
    'Det nye innholdet får ikke plass i sonen.',
  )
}

export function setCardTitle(
  presentation: Presentation,
  input: { doc: RichDoc } & ZoneContentTarget,
): Result<Presentation> {
  return updateZoneContent(
    presentation,
    input,
    (content) => {
      if (content.kind !== 'titled-card') {
        return err('INVALID_CONTENT', 'Innholdet har ingen tittel.')
      }
      return ok({ ...content, title: input.doc })
    },
    'Korttittelen får ikke plass i kortet.',
  )
}

export function setSubfieldCount(
  presentation: Presentation,
  input: { count: number } & ZoneContentTarget,
): Result<Presentation> {
  return updateZoneContent(
    presentation,
    input,
    (content) => {
      const body = bodyOf(content)
      if (!body) return err('INVALID_CONTENT', 'Innholdet har ingen subfelt.')
      if (!Number.isInteger(input.count) || input.count < 1 || input.count > 6) {
        return err('INVALID_ARGUMENT', 'Antall subfelt må være mellom 1 og 6.')
      }
      const removed = body.subfields.slice(input.count)
      if (removed.some((field) => !isDocEmpty(field.doc))) {
        return err('INVALID_ARGUMENT', 'Subfeltene som fjernes har innhold. Tøm dem først.')
      }
      return ok(withBody(content, withSubfieldCount(body, input.count)))
    },
    'Innholdet får ikke plass når subfeltene deler sonen på nytt.',
  )
}

/**
 * Where content sits inside the height it is given.
 *
 * Purely presentational — moving text within a box it already fits in cannot
 * make it stop fitting — but it goes through a command like everything else so
 * a headless caller has the same vocabulary as the toolbar.
 *
 * `subfieldId: null` targets a container's own field.
 */
export function setVerticalAlign(
  presentation: Presentation,
  input: { subfieldId: string | null; align: VerticalAlign } & ZoneContentTarget,
): Result<Presentation> {
  return updateZoneContent(
    presentation,
    input,
    (content) => {
      if (input.subfieldId === null) {
        if (content.kind !== 'container') {
          return err('INVALID_CONTENT', 'Sonen har ingen beholder å justere.')
        }
        return ok({ ...content, verticalAlign: input.align })
      }
      const body = bodyOf(content)
      if (!body) return err('INVALID_CONTENT', 'Innholdet har ingen subfelt.')
      const index = body.subfields.findIndex((field) => field.id === input.subfieldId)
      if (index < 0) return err('SUBFIELD_NOT_FOUND', 'Fant ikke subfeltet.')
      const subfields = [...body.subfields]
      subfields[index] = { ...subfields[index], verticalAlign: input.align }
      return ok(withBody(content, { ...body, subfields }))
    },
    'Justeringen får ikke plass.',
  )
}

export function setBodyAxis(
  presentation: Presentation,
  input: { axis: Axis } & ZoneContentTarget,
): Result<Presentation> {
  return updateZoneContent(
    presentation,
    input,
    (content) => {
      const body = bodyOf(content)
      if (!body) return err('INVALID_CONTENT', 'Innholdet har ingen subfelt.')
      return ok(withBody(content, withBodyAxis(body, input.axis)))
    },
    'Innholdet får ikke plass med denne orienteringen.',
  )
}

export function setBodyWeights(
  presentation: Presentation,
  input: { weights: number[] } & ZoneContentTarget,
): Result<Presentation> {
  return updateZoneContent(
    presentation,
    input,
    (content) => {
      const body = bodyOf(content)
      if (!body) return err('INVALID_CONTENT', 'Innholdet har ingen subfelt.')
      if (input.weights.length !== body.subfields.length) {
        return err('INVALID_WEIGHTS', 'Antall forholdstall må matche antall subfelt.')
      }
      if (!areWeightsValid(input.weights)) {
        return err('INVALID_WEIGHTS', 'Alle forholdstall må være tall større enn 0.')
      }
      return ok(withBody(content, { ...body, weights: [...input.weights] }))
    },
    'Innholdet får ikke plass med disse forholdstallene.',
  )
}

/** Colour is the one content property that cannot change how much space content needs. */
export function setCardColor(
  presentation: Presentation,
  input: { color: string } & ZoneContentTarget,
): Result<Presentation> {
  const color = normalizeHex(input.color)
  if (!color) return err('INVALID_ARGUMENT', 'Ugyldig fargeverdi.')
  return updateZoneContent(presentation, input, (content) => {
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

  // Every kind now divides into the same subfields, so a conversion carries the
  // whole body across instead of flattening it into a single document.
  let docs: RichDoc[]
  let axis: CardBody['axis'] = 'y'
  let weights: number[] | null = null
  let carriedTitle: RichDoc | null = null

  const source = bodyOf(content)
  if (source) {
    docs = source.subfields.map((field) => field.doc)
    axis = source.axis
    weights = [...source.weights]
  } else {
    // A picture-filled container: the picture becomes an inline image.
    docs = [{ type: 'doc', content: containerBlocks(content as ContainerContent) }]
  }

  if (content.kind === 'titled-card') {
    if (kind === 'titled-card') {
      carriedTitle = content.title
    } else {
      const heading = titleAsHeading(content.title)
      if (heading) {
        docs = [{ type: 'doc', content: [heading, ...(docs[0]?.content ?? [])] }, ...docs.slice(1)]
      }
    }
  }

  const base = createCardBody(Math.max(1, docs.length), axis)
  const body: CardBody = {
    axis,
    weights: weights && weights.length === base.subfields.length ? weights : base.weights,
    subfields: base.subfields.map((field, index) => ({
      ...field,
      doc: docs[index] ?? emptyDoc(),
      ...(source?.subfields[index]?.verticalAlign
        ? { verticalAlign: source.subfields[index].verticalAlign }
        : {}),
    })),
  }

  if (kind === 'container') return createContainer({ type: 'fields', body })

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

/** A picture-filled container as body blocks, so the picture is carried over. */
function containerBlocks(content: ContainerContent): RichNode[] {
  return content.payload.type === 'asset' ? [imageNode(content.payload.assetId)] : []
}

/**
 * Converting between content kinds changes the chrome around the text: a titled
 * card spends `CARD_HEADER_HEIGHT + CARD_PADDING * 2` of the zone that a
 * container gives entirely to content. The gate in `updateZoneContent` is what
 * stops a conversion from pushing text out of sight.
 */
export function setContentKind(
  presentation: Presentation,
  input: { kind: ZoneContentKind } & ZoneContentTarget,
): Result<Presentation> {
  return updateZoneContent(
    presentation,
    input,
    (content) => ok(convertContentKind(content, input.kind)),
    'Innholdet får ikke plass i denne innholdstypen.',
  )
}
