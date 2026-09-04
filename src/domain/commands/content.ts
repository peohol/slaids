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

/* ------------------------------------------------------------------ *
 * The subfield layout: how many, which way, in what proportions
 * ------------------------------------------------------------------ */

/** Everything about how a body divides the space it was given. */
export interface BodyLayoutInput extends ZoneContentTarget {
  /** `x` lays the subfields out as columns, `y` as rows. */
  axis?: Axis
  /** One per subfield the change ends with, all finite and greater than zero. */
  weights?: number[]
  /** 1–6. Subfields that disappear must be empty. */
  subfieldCount?: number
}

/**
 * Set how a card's subfields divide the space they share — count, direction and
 * proportions — in one gated step.
 *
 * One command rather than three, for the same reason `updateSplit` is one
 * command for a split's axis, weights and child count: all three are answered
 * against the same rectangle, and asking them one at a time gates each
 * intermediate state on its own. Two stacked rows can be too short for text
 * that two columns hold comfortably, so a caller that can only say "two
 * subfields" and *then* "side by side" never reaches the second state — the
 * first is refused on the way there. Here the fit gate runs once, against the
 * layout that was actually asked for.
 *
 * `setSubfieldCount`, `setBodyAxis` and `setBodyWeights` are this command with
 * one of the three filled in. The editor changes one thing at a time and keeps
 * calling them; a headless caller that knows the whole layout it wants says so
 * in one call.
 */
export function setBodyLayout(
  presentation: Presentation,
  input: BodyLayoutInput,
): Result<Presentation> {
  return updateZoneContent(
    presentation,
    input,
    (content) => {
      const body = bodyOf(content)
      if (!body) return err('INVALID_CONTENT', 'Innholdet har ingen subfelt.')

      const count = input.subfieldCount ?? body.subfields.length
      if (input.subfieldCount !== undefined && (!Number.isInteger(count) || count < 1 || count > 6)) {
        return err('INVALID_ARGUMENT', 'Antall subfelt må være mellom 1 og 6.')
      }
      // Against the count the call *ends* with, not the one it started with: a
      // call that both adds a subfield and re-proportions the body describes the
      // result, and matching against the old count would refuse exactly that.
      if (input.weights && input.weights.length !== count) {
        return err('INVALID_WEIGHTS', 'Antall forholdstall må matche antall subfelt.', {
          expected: count,
          received: input.weights.length,
        })
      }
      if (input.weights && !areWeightsValid(input.weights)) {
        return err('INVALID_WEIGHTS', 'Alle forholdstall må være tall større enn 0.')
      }
      const removed = body.subfields.slice(count)
      if (removed.some((field) => !isDocEmpty(field.doc))) {
        return err('INVALID_ARGUMENT', 'Subfeltene som fjernes har innhold. Tøm dem først.')
      }

      const resized = withSubfieldCount(body, count)
      const oriented = input.axis === undefined ? resized : withBodyAxis(resized, input.axis)
      const next =
        input.weights && !sameWeights(oriented.weights, input.weights)
          ? { ...oriented, weights: [...input.weights] }
          : oriented
      // Unchanged is answered with the very same object, so `updateZoneContent`
      // can tell a no-op apart from a change and leave `updatedAt` alone.
      return ok(next === body ? content : withBody(content, next))
    },
    bodyLayoutMessage(input),
  )
}

/** Which of the three was asked for, so a refusal says what was refused. */
function bodyLayoutMessage(input: BodyLayoutInput): string {
  const asked = [input.subfieldCount, input.axis, input.weights].filter(
    (value) => value !== undefined,
  ).length
  if (asked > 1) return 'Innholdet får ikke plass med denne subfeltinndelingen.'
  if (input.subfieldCount !== undefined) {
    return 'Innholdet får ikke plass når subfeltene deler sonen på nytt.'
  }
  if (input.weights !== undefined) return 'Innholdet får ikke plass med disse forholdstallene.'
  return 'Innholdet får ikke plass med denne orienteringen.'
}

function sameWeights(current: readonly number[], next: readonly number[]): boolean {
  return current.length === next.length && current.every((weight, i) => weight === next[i])
}

export function setSubfieldCount(
  presentation: Presentation,
  input: { count: number } & ZoneContentTarget,
): Result<Presentation> {
  const { count, ...target } = input
  return setBodyLayout(presentation, { ...target, subfieldCount: count })
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
  return setBodyLayout(presentation, input)
}

export function setBodyWeights(
  presentation: Presentation,
  input: { weights: number[] } & ZoneContentTarget,
): Result<Presentation> {
  return setBodyLayout(presentation, input)
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
