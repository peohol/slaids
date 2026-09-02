/**
 * The reads an agent needs before it can place anything.
 *
 * `place_asset` addresses a zone by id, so there has to be a way to learn the
 * ids without handing out the raw document. That is what an outline is: the
 * structure, in the fixed 1600 × 900 design space, with the geometry engine's
 * own rectangles — never a JSON blob for the agent to edit and post back.
 */

import { z } from 'zod'
import { computeSlideGeometry } from '../../domain/geometry'
import { contentAssetIds } from '../../domain/content'
import { docToPlainText } from '../../domain/richdoc'
import type {
  LayoutNode,
  PresentationSummary,
  Rect,
  Slide,
  ZoneContentKind,
} from '../../domain/types'
import { defineOperation, presentationIdSchema } from '../operation'
import { loadPresentation } from '../presentation'
import { agentOk, type AgentContext, type AgentResult } from '../types'

export interface ZoneOutline {
  nodeId: string
  kind: 'split' | 'leaf'
  /** The zone's rectangle in the logical design space. */
  rect: Rect
  /** Split only: how it divides, and into what. */
  axis?: 'x' | 'y'
  weights?: number[]
  childNodeIds?: string[]
  /** Leaf only. */
  empty?: boolean
  contentKind?: ZoneContentKind
  /** Files this zone shows, so an agent can see what is already placed. */
  assetIds?: string[]
}

export interface SlideOutline {
  slideId: string
  index: number
  hasTitle: boolean
  title: string
  rootNodeId: string
  zones: ZoneOutline[]
}

export interface PresentationOutline {
  presentationId: string
  title: string
  slideCount: number
  assetCount: number
  slides: SlideOutline[]
}

const describeInput = z.object({ presentationId: presentationIdSchema })

export const describePresentation = defineOperation({
  name: 'describe_presentation',
  summary: 'Strukturen i en presentasjon: slides, soner, sone-id-er og hva som ligger i dem.',
  mutates: false,
  input: describeInput,
  async run(context, input): Promise<AgentResult<PresentationOutline>> {
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded
    const presentation = loaded.value

    return agentOk({
      presentationId: presentation.id,
      title: presentation.title,
      slideCount: presentation.slides.length,
      assetCount: presentation.assets.length,
      slides: presentation.slides.map((slide, index) =>
        outlineSlide(slide, index, context.geometry),
      ),
    })
  },
})

function outlineSlide(
  slide: Slide,
  index: number,
  geometry: AgentContext['geometry'],
): SlideOutline {
  const rects = computeSlideGeometry(slide, geometry ?? {}).rects
  const zones: ZoneOutline[] = []
  collectZones(slide.root, rects, zones)
  return {
    slideId: slide.id,
    index,
    hasTitle: slide.title !== null,
    title: docToPlainText(slide.title),
    rootNodeId: slide.root.id,
    zones,
  }
}

function collectZones(node: LayoutNode, rects: Map<string, Rect>, out: ZoneOutline[]): void {
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
    for (const child of node.children) collectZones(child, rects, out)
    return
  }

  out.push({
    nodeId: node.id,
    kind: 'leaf',
    rect,
    empty: node.content === null,
    ...(node.content
      ? { contentKind: node.content.kind, assetIds: contentAssetIds(node.content) }
      : {}),
  })
}

export const listPresentations = defineOperation({
  name: 'list_presentations',
  summary: 'Presentasjonene som finnes, med id, tittel og antall slides.',
  mutates: false,
  input: z.object({}),
  async run(context): Promise<AgentResult<{ presentations: PresentationSummary[] }>> {
    return agentOk({ presentations: await context.repository.listPresentations() })
  },
})

export const deckOperations = [listPresentations, describePresentation]
