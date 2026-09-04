/**
 * Factories and pure helpers for zone content.
 */

import { WHITE } from './color'
import { newContentId, newSubfieldId } from './ids'
import { collectCitationIds, collectDocAssetIds, emptyDoc, titleDoc } from './richdoc'
import type {
  Axis,
  CaptionPosition,
  CardBody,
  ContainerContent,
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

export const CONTENT_KIND_LABELS: Record<ZoneContentKind, string> = {
  container: 'Beholder',
  'untitled-card': 'Kort uten tittel',
  'titled-card': 'Kort med tittel',
  image: 'Bilde',
  'titled-image-card': 'Kort med tittel og bilde',
}

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
 * The subfield body of any content that has one — the text kinds. A picture
 * has no fields, so a caller that wants to write text into one has to convert
 * it first.
 */
export function bodyOf(content: ZoneContent): CardBody | null {
  return hasImagePanel(content) ? null : content.body
}

/** The same content with a new body, whichever kind it is. */
export function withBody<T extends ZoneContent>(content: T, body: CardBody): T {
  return hasImagePanel(content) ? content : { ...content, body }
}

/* ------------------------------------------------------------------ *
 * Subfield editing (pure)
 * ------------------------------------------------------------------ */

export function withSubfieldCount(body: CardBody, count: number): CardBody {
  const target = Math.max(1, Math.min(6, Math.round(count)))
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
