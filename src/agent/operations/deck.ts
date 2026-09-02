/**
 * Creating a deck, and reading one.
 *
 * These are the operations an agent starts and orients itself with. Everything
 * else addresses a slide or a zone by id, so there has to be a way to learn the
 * ids without handing out the raw document: `get_presentation` says which slides
 * exist, and `inspect_slide` describes one of them — the structure, the geometry
 * engine's own rectangles, the text as agent blocks, and whether what sits in
 * each zone fits. Never a JSON blob for the agent to edit and post back. See
 * `IMPLEMENTATION_PLAN.md` §44, "Identifikatorer og inspeksjon".
 *
 * Both reads answer with the presentation's `revision`, which is the same value
 * a later mutation may send back as `expectedRevision` — that is how an agent
 * that read before somebody else wrote is told so instead of overwriting them.
 */

import { z } from 'zod'
import { fitContextFor } from '../../domain/commands'
import { bodyOf, contentAssetIds, contentCitationIds } from '../../domain/content'
import { estimateFit } from '../../domain/fit'
import { computeSlideGeometry } from '../../domain/geometry'
import { geometryForTheme } from '../../domain/metrics'
import { createPresentation, findSlide } from '../../domain/presentation'
import { presentationRevision } from '../../domain/revision'
import { docToPlainText } from '../../domain/richdoc'
import type { FitContext } from '../../domain/fit'
import type {
  LayoutNode,
  Presentation,
  PresentationSummary,
  Rect,
  Slide,
  VerticalAlign,
  ZoneContentKind,
} from '../../domain/types'
import { defineOperation, presentationIdSchema, slideIdSchema } from '../operation'
import { loadPresentation, savePresentation } from '../presentation'
import { docToBlocks, docToTitleSpans, type InspectedBlock, type TextSpan } from '../text'
import { agentErr, agentOk, type AgentContext, type AgentResult } from '../types'

/* ------------------------------------------------------------------ *
 * list_presentations
 * ------------------------------------------------------------------ */

export const listPresentations = defineOperation({
  name: 'list_presentations',
  summary: 'Presentasjonene som finnes, med id, tittel og antall slides.',
  mutates: false,
  input: z.strictObject({}),
  async run(context): Promise<AgentResult<{ presentations: PresentationSummary[] }>> {
    return agentOk({ presentations: await context.repository.listPresentations() })
  },
})

/* ------------------------------------------------------------------ *
 * get_presentation
 * ------------------------------------------------------------------ */

export interface SlideSummary {
  slideId: string
  index: number
  hasTitle: boolean
  /** The title as plain text; the stored form is rich text. */
  title: string
}

export interface PresentationView {
  presentationId: string
  title: string
  folderId: string | null
  updatedAt: string
  /** Send this back as `expectedRevision` to write against exactly this reading. */
  revision: string
  slideCount: number
  assetCount: number
  referenceCount: number
  slides: SlideSummary[]
}

function summarizeSlide(slide: Slide, index: number): SlideSummary {
  return {
    slideId: slide.id,
    index,
    hasTitle: slide.title !== null,
    title: docToPlainText(slide.title),
  }
}

export function presentationView(presentation: Presentation): PresentationView {
  return {
    presentationId: presentation.id,
    title: presentation.title,
    folderId: presentation.folderId,
    updatedAt: presentation.updatedAt,
    revision: presentationRevision(presentation),
    slideCount: presentation.slides.length,
    assetCount: presentation.assets.length,
    referenceCount: presentation.references.length,
    slides: presentation.slides.map(summarizeSlide),
  }
}

export const getPresentation = defineOperation({
  name: 'get_presentation',
  summary:
    'En presentasjon i agenttermer: tittel, revisjon, slides og hvor mange filer og referanser den har.',
  mutates: false,
  input: z.strictObject({ presentationId: presentationIdSchema }),
  async run(context, input): Promise<AgentResult<PresentationView>> {
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded
    return agentOk(presentationView(loaded.value))
  },
})

/* ------------------------------------------------------------------ *
 * create_presentation
 * ------------------------------------------------------------------ */

export const createPresentationOperation = defineOperation({
  name: 'create_presentation',
  summary: 'Opprett en ny presentasjon med én tom slide.',
  mutates: true,
  input: z.strictObject({
    title: z.string().trim().min(1).max(200).describe('Tittelen på presentasjonen.'),
    folderId: z
      .string()
      .min(1)
      .nullish()
      .describe('Mappen den skal ligge i. Utelatt legger den på rotnivå.'),
    firstSlideHasTitle: z
      .boolean()
      .default(true)
      .describe('Om den første sliden får en overskriftssone.'),
  }),
  async run(context, input): Promise<AgentResult<PresentationView>> {
    // The same factory the library uses, so an agent's presentation is not a
    // second kind of presentation: same schema version, same default theme, same
    // single empty slide to start from.
    const presentation = createPresentation({
      title: input.title,
      folderId: input.folderId ?? null,
      firstSlideHasTitle: input.firstSlideHasTitle,
    })
    const saved = await savePresentation(context, presentation)
    if (!saved.ok) return saved
    return agentOk(presentationView(saved.value))
  },
})

/* ------------------------------------------------------------------ *
 * inspect_slide
 * ------------------------------------------------------------------ */

export interface SubfieldInspection {
  subfieldId: string
  verticalAlign: VerticalAlign
  /** The text, in the same block format `set_zone_text` accepts. */
  blocks: InspectedBlock[]
}

export interface ZoneInspection {
  nodeId: string
  kind: 'split' | 'leaf'
  /** The zone's rectangle in the logical 1600 × 900 design space. */
  rect: Rect
  /** Split only: how it divides, and into what. */
  axis?: 'x' | 'y'
  weights?: number[]
  childNodeIds?: string[]
  /** Leaf only. */
  empty?: boolean
  contentKind?: ZoneContentKind
  /** Containers only: whether the zone holds text fields or a file. */
  payload?: 'fields' | 'asset'
  /** Titled cards only: the card's own heading. */
  cardTitle?: TextSpan[]
  /** The text fields inside the content, addressable in a later call. */
  subfields?: SubfieldInspection[]
  /** Files and references this zone shows. */
  assetIds?: string[]
  referenceIds?: string[]
  /** Whether what sits here fits, measured with the headless estimator. */
  fits?: boolean
  overflow?: number
}

export interface SlideInspection extends SlideSummary {
  presentationId: string
  revision: string
  rootNodeId: string
  /** The title as spans, so a citation in it survives being read back. */
  titleSpans: TextSpan[]
  zones: ZoneInspection[]
}

export const inspectSlide = defineOperation({
  name: 'inspect_slide',
  summary: 'Strukturen i én slide: soner, sone-id-er, geometri, tekst og hva som ligger i dem.',
  mutates: false,
  input: z.strictObject({ presentationId: presentationIdSchema, slideId: slideIdSchema }),
  async run(context, input): Promise<AgentResult<SlideInspection>> {
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded

    const presentation = loaded.value
    const index = presentation.slides.findIndex((slide) => slide.id === input.slideId)
    const slide = findSlide(presentation, input.slideId)
    if (!slide) {
      return agentErr('SLIDE_NOT_FOUND', 'Fant ikke sliden.', {
        presentationId: presentation.id,
        slideId: input.slideId,
      })
    }

    return agentOk({
      ...summarizeSlide(slide, index),
      presentationId: presentation.id,
      revision: presentationRevision(presentation),
      rootNodeId: slide.root.id,
      titleSpans: docToTitleSpans(slide.title),
      zones: inspectZones(slide, presentation, context),
    })
  },
})

function inspectZones(
  slide: Slide,
  presentation: Presentation,
  context: AgentContext,
): ZoneInspection[] {
  // The theme scales the gap and the title zone, so the rects reported are the
  // ones the fit guard measures against — not a second, unthemed geometry.
  const rects = computeSlideGeometry(slide, {
    ...geometryForTheme(presentation.theme),
    ...context.geometry,
  }).rects
  const zones: ZoneInspection[] = []
  collectZones(slide.root, rects, fitContextFor(presentation), context, zones)
  return zones
}

function collectZones(
  node: LayoutNode,
  rects: Map<string, Rect>,
  fitContext: FitContext,
  context: AgentContext,
  out: ZoneInspection[],
): void {
  const rect = rects.get(node.id)
  if (!rect) return

  if (node.kind === 'split') {
    out.push({
      nodeId: node.id,
      kind: 'split',
      rect,
      axis: node.axis,
      weights: [...node.weights],
      childNodeIds: node.children.map((child) => child.id),
    })
    for (const child of node.children) collectZones(child, rects, fitContext, context, out)
    return
  }

  if (!node.content) {
    out.push({ nodeId: node.id, kind: 'leaf', rect, empty: true })
    return
  }

  const content = node.content
  const body = bodyOf(content)
  // The same checker the commands run under, so "does it fit" has one answer.
  const fit = (context.fits ?? estimateFit)(content, rect, fitContext)
  out.push({
    nodeId: node.id,
    kind: 'leaf',
    rect,
    empty: false,
    contentKind: content.kind,
    ...(content.kind === 'container' ? { payload: content.payload.type } : {}),
    ...(content.kind === 'titled-card' ? { cardTitle: docToTitleSpans(content.title) } : {}),
    subfields:
      body?.subfields.map((field) => ({
        subfieldId: field.id,
        verticalAlign: field.verticalAlign ?? 'top',
        blocks: docToBlocks(field.doc),
      })) ?? [],
    assetIds: contentAssetIds(content),
    referenceIds: contentCitationIds(content),
    fits: fit.fits,
    overflow: fit.overflow,
  })
}

export const deckOperations = [
  listPresentations,
  getPresentation,
  createPresentationOperation,
  inspectSlide,
]
