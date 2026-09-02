/**
 * The reads an agent needs before it can place anything.
 *
 * `set_zone_asset` addresses a zone by id, so there has to be a way to learn
 * the ids without handing out the raw document. That is what these two are:
 * `get_presentation` says which slides exist, and `inspect_slide` describes one
 * of them — the structure, the geometry engine's own rectangles, and whether
 * what sits in each zone fits. Never a JSON blob for the agent to edit and post
 * back. See `IMPLEMENTATION_PLAN.md` §44, "Identifikatorer og inspeksjon".
 */

import { z } from 'zod'
import { fitContextFor } from '../../domain/commands'
import { bodyOf, contentAssetIds, contentCitationIds } from '../../domain/content'
import { estimateFit } from '../../domain/fit'
import { computeSlideGeometry } from '../../domain/geometry'
import { docToPlainText } from '../../domain/richdoc'
import { findSlide } from '../../domain/presentation'
import type { FitContext } from '../../domain/fit'
import type {
  LayoutNode,
  Presentation,
  PresentationSummary,
  Rect,
  Slide,
  ZoneContentKind,
} from '../../domain/types'
import { defineOperation, presentationIdSchema, slideIdSchema } from '../operation'
import { loadPresentation } from '../presentation'
import { agentErr, agentOk, type AgentContext, type AgentResult } from '../types'

/* ------------------------------------------------------------------ *
 * list_presentations
 * ------------------------------------------------------------------ */

export const listPresentations = defineOperation({
  name: 'list_presentations',
  summary: 'Presentasjonene som finnes, med id, tittel og antall slides.',
  mutates: false,
  input: z.object({}),
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
  slideCount: number
  assetCount: number
  referenceCount: number
  slides: SlideSummary[]
}

export const getPresentation = defineOperation({
  name: 'get_presentation',
  summary: 'En presentasjon i agenttermer: tittel, slides og hvor mange filer og referanser den har.',
  mutates: false,
  input: z.object({ presentationId: presentationIdSchema }),
  async run(context, input): Promise<AgentResult<PresentationView>> {
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded
    const presentation = loaded.value

    return agentOk({
      presentationId: presentation.id,
      title: presentation.title,
      folderId: presentation.folderId,
      updatedAt: presentation.updatedAt,
      slideCount: presentation.slides.length,
      assetCount: presentation.assets.length,
      referenceCount: presentation.references.length,
      slides: presentation.slides.map(summarizeSlide),
    })
  },
})

function summarizeSlide(slide: Slide, index: number): SlideSummary {
  return {
    slideId: slide.id,
    index,
    hasTitle: slide.title !== null,
    title: docToPlainText(slide.title),
  }
}

/* ------------------------------------------------------------------ *
 * inspect_slide
 * ------------------------------------------------------------------ */

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
  /** The text fields inside the content, addressable in a later call. */
  subfieldIds?: string[]
  /** Files and references this zone shows. */
  assetIds?: string[]
  referenceIds?: string[]
  /** Whether what sits here fits, measured with the headless estimator. */
  fits?: boolean
  overflow?: number
}

export interface SlideInspection extends SlideSummary {
  presentationId: string
  rootNodeId: string
  zones: ZoneInspection[]
}

export const inspectSlide = defineOperation({
  name: 'inspect_slide',
  summary: 'Strukturen i én slide: soner, sone-id-er, geometri og hva som ligger i dem.',
  mutates: false,
  input: z.object({ presentationId: presentationIdSchema, slideId: slideIdSchema }),
  async run(context, input): Promise<AgentResult<SlideInspection>> {
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded

    const presentation = loaded.value
    const index = presentation.slides.findIndex((slide) => slide.id === input.slideId)
    const slide = findSlide(presentation, input.slideId)
    if (!slide) {
      return agentErr('SLIDE_NOT_FOUND', 'Fant ikke sliden.', { slideId: input.slideId })
    }

    return agentOk({
      ...summarizeSlide(slide, index),
      presentationId: presentation.id,
      rootNodeId: slide.root.id,
      zones: inspectZones(slide, presentation, context),
    })
  },
})

function inspectZones(
  slide: Slide,
  presentation: Presentation,
  context: AgentContext,
): ZoneInspection[] {
  const rects = computeSlideGeometry(slide, context.geometry ?? {}).rects
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

  // The same checker the commands run under, so "does it fit" has one answer.
  const fit = (context.fits ?? estimateFit)(node.content, rect, fitContext)
  out.push({
    nodeId: node.id,
    kind: 'leaf',
    rect,
    empty: false,
    contentKind: node.content.kind,
    subfieldIds: bodyOf(node.content)?.subfields.map((field) => field.id) ?? [],
    assetIds: contentAssetIds(node.content),
    referenceIds: contentCitationIds(node.content),
    fits: fit.fits,
    overflow: fit.overflow,
  })
}

export const deckOperations = [listPresentations, getPresentation, inspectSlide]
