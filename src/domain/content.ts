/**
 * Factories and pure helpers for zone content.
 */

import { WHITE } from './color'
import { newContentId, newSubfieldId } from './ids'
import { collectCitationIds, collectDocAssetIds, emptyDoc, titleDoc } from './richdoc'
import type {
  Axis,
  CardBody,
  ContainerContent,
  ContainerPayload,
  RichDoc,
  Subfield,
  TitledCardContent,
  UntitledCardContent,
  ZoneContent,
  ZoneContentKind,
} from './types'

export const DEFAULT_CARD_BACKGROUND = WHITE
export const DEFAULT_HEADER_COLOR = '#33475b'

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

export function createContainer(payload?: ContainerPayload): ContainerContent {
  return {
    id: newContentId(),
    kind: 'container',
    payload: payload ?? { type: 'richdoc', doc: emptyDoc() },
  }
}

export function createUntitledCard(backgroundColor = DEFAULT_CARD_BACKGROUND): UntitledCardContent {
  return {
    id: newContentId(),
    kind: 'untitled-card',
    backgroundColor,
    body: createCardBody(1),
  }
}

export function createTitledCard(
  title = '',
  headerColor = DEFAULT_HEADER_COLOR,
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

export function createContentOfKind(kind: ZoneContentKind): ZoneContent {
  switch (kind) {
    case 'container':
      return createContainer()
    case 'untitled-card':
      return createUntitledCard()
    case 'titled-card':
      return createTitledCard()
  }
}

export const CONTENT_KIND_LABELS: Record<ZoneContentKind, string> = {
  container: 'Beholder',
  'untitled-card': 'Kort uten tittel',
  'titled-card': 'Kort med tittel',
}

export function contentLabel(content: ZoneContent): string {
  return CONTENT_KIND_LABELS[content.kind]
}

export function hasCardBody(
  content: ZoneContent,
): content is UntitledCardContent | TitledCardContent {
  return content.kind === 'untitled-card' || content.kind === 'titled-card'
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
  switch (content.kind) {
    case 'container':
      return content.payload.type === 'richdoc' ? [content.payload.doc] : []
    case 'untitled-card':
      return content.body.subfields.map((field) => field.doc)
    case 'titled-card':
      return [content.title, ...content.body.subfields.map((field) => field.doc)]
  }
}

/** Reference ids used by this content, in document order. */
export function contentCitationIds(content: ZoneContent): string[] {
  return contentDocs(content).flatMap(collectCitationIds)
}

/** Asset ids used by this content, including inline images. */
export function contentAssetIds(content: ZoneContent): string[] {
  const ids: string[] = []
  if (content.kind === 'container' && content.payload.type === 'asset') {
    ids.push(content.payload.assetId)
  }
  for (const doc of contentDocs(content)) ids.push(...collectDocAssetIds(doc))
  return ids
}

