/**
 * Factories and pure helpers for zone content.
 */

import { WHITE } from './color'
import { newContentId, newSubfieldId } from './ids'
import {
  collectCitationIds,
  collectDocAssetIds,
  emptyDoc,
  isDocEmpty,
  titleDoc,
  withoutAccentColors,
} from './richdoc'
import type {
  Axis,
  CaptionPosition,
  CardBody,
  ContainerContent,
  NegativeSpaceContent,
  ImageCaption,
  ImageContent,
  ImagePanel,
  ImageZoneContent,
  RichDoc,
  Subfield,
  TitledCardContent,
  TitledImageCardContent,
  UntitledCardContent,
  ZoneContent,
  ZoneContentKind,
} from './types'

export const DEFAULT_CARD_BACKGROUND = WHITE

/** A picture with no crop offset: the frame sits over the middle of the file. */
export const CENTRED_FOCUS = { x: 0.5, y: 0.5 } as const

/**
 * Deliberate air.
 *
 * An id and a kind, and nothing else — there is no payload to create, and that
 * is the definition rather than an omission. See `NegativeSpaceContent`.
 */
export function createNegativeSpace(): NegativeSpaceContent {
  return { id: newContentId(), kind: 'negative-space' }
}

export function createSubfield(doc: RichDoc = emptyDoc()): Subfield {
  return { id: newSubfieldId(), doc }
}

export function createCardBody(subfieldCount = 1, axis: Axis = 'y'): CardBody {
  const count = Math.max(1, Math.min(6, Math.round(subfieldCount)))
  return {
    axis,
    weights: Array.from({ length: count }, () => 1),
    subfields: Array.from({ length: count }, () => createSubfield()),
  }
}

export function createContainer(body: CardBody = createCardBody(1)): ContainerContent {
  return { id: newContentId(), kind: 'container', body }
}

/** A container holding one field with this document. */
export function containerWithDoc(doc: RichDoc): ContainerContent {
  const body = createCardBody(1)
  return createContainer({ ...body, subfields: [{ ...body.subfields[0], doc }] })
}

export function createUntitledCard(backgroundColor = DEFAULT_CARD_BACKGROUND): UntitledCardContent {
  return {
    id: newContentId(),
    kind: 'untitled-card',
    backgroundColor,
    body: createCardBody(1),
  }
}

/**
 * A titled card with no colour of its own inherits the deck's heading pill
 * colour (see `TitledCardContent.headerColor`), so `null` is the default
 * rather than a literal shade that would then need migrating every time the
 * cover's colour changes.
 */
export function createTitledCard(
  title = '',
  headerColor: string | null = null,
  subfieldCount = 1,
): TitledCardContent {
  return {
    id: newContentId(),
    kind: 'titled-card',
    headerColor,
    title: titleDoc(title),
    body: createCardBody(subfieldCount),
  }
}

/* ------------------------------------------------------------------ *
 * Pictures
 * ------------------------------------------------------------------ */

/**
 * An empty picture panel.
 *
 * `assetId: null` is a real state, not a hole: a picture zone can be created
 * before there is a file for it, exactly as a text field starts empty. What it
 * draws until then is a placeholder that asks for one.
 */
export function createImagePanel(assetId: string | null = null): ImagePanel {
  return { assetId, focus: { ...CENTRED_FOCUS }, caption: null }
}

export function createImage(assetId: string | null = null): ImageContent {
  return { id: newContentId(), kind: 'image', image: createImagePanel(assetId) }
}

export function createTitledImageCard(
  assetId: string | null = null,
  title = '',
  headerColor: string | null = null,
): TitledImageCardContent {
  return {
    id: newContentId(),
    kind: 'titled-image-card',
    headerColor,
    title: titleDoc(title),
    image: createImagePanel(assetId),
  }
}

export function createCaption(
  position: CaptionPosition = 'bottom',
  doc: RichDoc = emptyDoc(),
): ImageCaption {
  return { doc, position, color: null }
}

/** Content whose face is a picture, rather than text in fields. */
export function hasImagePanel(content: ZoneContent): content is ImageZoneContent {
  return content.kind === 'image' || content.kind === 'titled-image-card'
}

/** The picture panel of any content that has one. */
export function imagePanelOf(content: ZoneContent): ImagePanel | null {
  return hasImagePanel(content) ? content.image : null
}

/** The same content with a new picture panel, whichever kind it is. */
export function withImagePanel<T extends ZoneContent>(content: T, image: ImagePanel): T {
  return hasImagePanel(content) ? { ...content, image } : content
}

/**
 * The same panel with a deposit number, or without one.
 *
 * Absent rather than `null` or `0`, so a panel that is not part of an image
 * deposit is byte-identical to one written before deposits existed — the same
 * reason `imageContext` is optional on the document. What the number *means* is
 * `domain/imageDeposit.ts`; this is only how it is written and taken away, and
 * it lives here because `cloneContentWithNewIds` has to take it away too.
 */
export function withDepositIndex(panel: ImagePanel, index: number | null): ImagePanel {
  if (index === null) {
    if (panel.depositIndex === undefined) return panel
    const { depositIndex: _dropped, ...rest } = panel
    return rest
  }
  return panel.depositIndex === index ? panel : { ...panel, depositIndex: index }
}

/**
 * Where a caption may hang, per content kind.
 *
 * A titled image card has its header along the top edge already, so a caption
 * hanging from the ceiling would sit under a panel of the same shape and read
 * as a second, paler header.
 */
export const CAPTION_POSITIONS: readonly CaptionPosition[] = ['top', 'middle', 'bottom']

export function captionPositionsFor(kind: ZoneContentKind): readonly CaptionPosition[] {
  return kind === 'titled-image-card'
    ? CAPTION_POSITIONS.filter((position) => position !== 'top')
    : CAPTION_POSITIONS
}

export const CAPTION_POSITION_LABELS: Record<CaptionPosition, string> = {
  top: 'Øverst',
  middle: 'Midten',
  bottom: 'Nederst',
}

/* ------------------------------------------------------------------ *
 * Content kinds
 * ------------------------------------------------------------------ */

export function createContentOfKind(kind: ZoneContentKind): ZoneContent {
  switch (kind) {
    case 'negative-space':
      return createNegativeSpace()
    case 'container':
      return createContainer()
    case 'untitled-card':
      return createUntitledCard()
    case 'titled-card':
      return createTitledCard()
    case 'image':
      return createImage()
    case 'titled-image-card':
      return createTitledImageCard()
  }
}

/**
 * What each kind is called, in the order they are offered.
 *
 * The order is a statement, not an accident: `titled-card` is first because it
 * is what primary text content normally is, and `container` sits after the two
 * framed cards because it is the secondary format — a transparent field for
 * small supporting or footnote-like text, not the default a zone falls into.
 * Air is last: it is the considered choice, and the only one left in a zone too
 * small for the rest.
 */
export const CONTENT_KIND_LABELS: Record<ZoneContentKind, string> = {
  'titled-card': 'Kort med tittel',
  'untitled-card': 'Kort uten tittel',
  container: 'Beholder',
  image: 'Bilde',
  'titled-image-card': 'Kort med tittel og bilde',
  'negative-space': 'Negativt rom',
}

/**
 * Every content kind there is.
 *
 * Derived from the labels rather than written out again, so a kind added to the
 * union is offered by the editor, described to an agent and answered for by
 * `contentSize.ts` without a second list to remember.
 */
export const ZONE_CONTENT_KINDS = Object.keys(CONTENT_KIND_LABELS) as ZoneContentKind[]

/**
 * The same two questions as `hasImagePanel` and `hasCardTitle`, asked of a
 * *kind* rather than of content.
 *
 * A caller that is choosing what a zone should become has no content to ask
 * yet, and the two lists it would otherwise write out by hand are the ones
 * that go stale on the day a kind is added. So they are filtered from
 * `ZONE_CONTENT_KINDS` through the predicates that already answer, and there
 * is still exactly one place that knows which kinds carry a picture and which
 * carry a title of their own.
 */
export const IMAGE_CONTENT_KINDS: readonly ZoneContentKind[] = ZONE_CONTENT_KINDS.filter((kind) =>
  hasImagePanel(createContentOfKind(kind)),
)

export const TITLED_CONTENT_KINDS: readonly ZoneContentKind[] = ZONE_CONTENT_KINDS.filter((kind) =>
  hasCardTitle(createContentOfKind(kind)),
)

export function contentLabel(content: ZoneContent): string {
  return CONTENT_KIND_LABELS[content.kind]
}

export function hasCardBody(
  content: ZoneContent,
): content is UntitledCardContent | TitledCardContent {
  return content.kind === 'untitled-card' || content.kind === 'titled-card'
}

/** Content that carries a title panel of its own, with or without a picture. */
export function hasCardTitle(
  content: ZoneContent,
): content is TitledCardContent | TitledImageCardContent {
  return content.kind === 'titled-card' || content.kind === 'titled-image-card'
}

/**
 * The subfield body of any content that has one — the text kinds.
 *
 * A picture has no fields and negative space has nothing at all, so a caller
 * that wants to write text into either has to convert it first. Written as the
 * positive question ("which kinds have a body") rather than as "not a picture",
 * because the second reading turns every future kind without a body into a
 * crash at the first property access.
 */
export function bodyOf(content: ZoneContent): CardBody | null {
  return hasCardBody(content) || content.kind === 'container' ? content.body : null
}

/** The same content with a new body, whichever kind it is. */
export function withBody<T extends ZoneContent>(content: T, body: CardBody): T {
  return bodyOf(content) ? { ...content, body } : content
}

/**
 * The content with every colour somebody picked for it put back.
 *
 * Back to what it would have had without the choice: a title panel, a caption
 * and an accent follow their section again, and a card without a title — which
 * has nothing to inherit from — goes back to the colour a new one gets. The very
 * same object comes back when nothing was picked, so «is there anything to
 * reset?» is the question `withDefaultColors(content) !== content`.
 */
export function withDefaultColors(content: ZoneContent): ZoneContent {
  let next = content
  if (next.kind === 'untitled-card' && next.backgroundColor !== DEFAULT_CARD_BACKGROUND) {
    next = { ...next, backgroundColor: DEFAULT_CARD_BACKGROUND }
  }
  if (hasCardTitle(next) && next.headerColor !== null) next = { ...next, headerColor: null }
  const body = bodyOf(next)
  if (body) {
    const subfields = body.subfields.map((field) => {
      const doc = withoutAccentColors(field.doc)
      return doc === field.doc ? field : { ...field, doc }
    })
    if (subfields.some((field, index) => field !== body.subfields[index])) {
      next = withBody(next, { ...body, subfields })
    }
  }
  const panel = imagePanelOf(next)
  if (panel?.caption && panel.caption.color !== null) {
    next = withImagePanel(next, { ...panel, caption: { ...panel.caption, color: null } })
  }
  return next
}

/* ------------------------------------------------------------------ *
 * Subfield editing (pure)
 * ------------------------------------------------------------------ */

/** The most subfields one body is divided into. */
export const MAX_SUBFIELDS = 6

export function withSubfieldCount(body: CardBody, count: number): CardBody {
  const target = Math.max(1, Math.min(MAX_SUBFIELDS, Math.round(count)))
  if (target === body.subfields.length) return body
  if (target < body.subfields.length) {
    return {
      ...body,
      subfields: body.subfields.slice(0, target),
      weights: body.weights.slice(0, target),
    }
  }
  const added = target - body.subfields.length
  return {
    ...body,
    subfields: [...body.subfields, ...Array.from({ length: added }, () => createSubfield())],
    weights: [...body.weights, ...Array.from({ length: added }, () => 1)],
  }
}

export function withSubfieldDoc(body: CardBody, subfieldId: string, doc: RichDoc): CardBody {
  let changed = false
  const subfields = body.subfields.map((field) => {
    if (field.id !== subfieldId) return field
    changed = true
    return { ...field, doc }
  })
  return changed ? { ...body, subfields } : body
}

export function withBodyAxis(body: CardBody, axis: Axis): CardBody {
  return body.axis === axis ? body : { ...body, axis }
}

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

export function contentDocs(content: ZoneContent): RichDoc[] {
  const docs: RichDoc[] = []
  if (hasCardTitle(content)) docs.push(content.title)
  const body = bodyOf(content)
  if (body) docs.push(...body.subfields.map((field) => field.doc))
  const panel = imagePanelOf(content)
  if (panel?.caption) docs.push(panel.caption.doc)
  return docs
}

/**
 * Whether this content carries nothing anybody would miss.
 *
 * Every document it draws is empty and it points at no file. What it is *for*
 * is the one conversion that cannot keep what it is given: air has no payload
 * by definition, so turning content into it is only lossless when there was
 * nothing there to lose. See `convertContentKind`.
 */
export function contentIsEmpty(content: ZoneContent): boolean {
  if (imagePanelOf(content)?.assetId) return false
  return contentDocs(content).every(isDocEmpty)
}

/**
 * Why this zone cannot become that kind, or `null` when it can.
 *
 * Every other conversion carries everything across (see `convertContentKind`),
 * so this answers for exactly the one that cannot: air has no payload at all,
 * and folding a card's paragraphs into it would destroy them.
 *
 * Rather than deleting the work without saying so, the answer is «empty it
 * first» — «Tøm sone» parks it in the sandbox, and the emptied zone converts
 * freely. One sentence, asked by the command that refuses and by the picker
 * that greys the choice out, so a button that looks available is never a button
 * that fails on click.
 */
export function contentConversionRefusal(
  content: ZoneContent | null,
  kind: ZoneContentKind,
): string | null {
  if (!content || content.kind === kind || contentIsEmpty(content)) return null
  if (kind !== 'negative-space') return null
  return 'Negativt rom har ikke noe innhold. Tøm sonen først — innholdet havner i sandkassen.'
}

/** Reference ids used by this content, in document order. */
export function contentCitationIds(content: ZoneContent): string[] {
  return contentDocs(content).flatMap(collectCitationIds)
}

/** Asset ids used by this content, including inline images. */
export function contentAssetIds(content: ZoneContent): string[] {
  const ids: string[] = []
  const panel = imagePanelOf(content)
  if (panel?.assetId) ids.push(panel.assetId)
  for (const doc of contentDocs(content)) ids.push(...collectDocAssetIds(doc))
  return ids
}
