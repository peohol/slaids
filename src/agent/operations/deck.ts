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
import { createDeck, fitContextFor, setPresentationTitle } from '../../domain/commands'
import { bodyOf, contentAssetIds, contentCitationIds } from '../../domain/content'
import { estimateFit } from '../../domain/fit'
import { computeSlideGeometry } from '../../domain/geometry'
import { geometryForTheme } from '../../domain/metrics'
import { findSlide } from '../../domain/presentation'
import { presentationRevision } from '../../domain/revision'
import { docToPlainText } from '../../domain/richdoc'
import type { FitContext } from '../../domain/fit'
import type {
  Axis,
  LayoutNode,
  Presentation,
  PresentationSummary,
  Rect,
  Slide,
  VerticalAlign,
  ZoneContent,
  ZoneContentKind,
} from '../../domain/types'
import { ok } from '../../domain/result'
import {
  defineOperation,
  expectedRevisionSchema,
  presentationIdSchema,
  slideIdSchema,
} from '../operation'
import {
  loadPresentation,
  missingFolder,
  mutatePresentation,
  savePresentation,
  structuralOptions,
} from '../presentation'
import {
  docToBlocks,
  docToTitleAlign,
  docToTitleSpans,
  type InspectedBlock,
  type TextAlign,
  type TextSpan,
} from '../text'
import { agentErr, agentOk, type AgentContext, type AgentResult } from '../types'
import { themeView, type ThemeView } from './theme'

/* ------------------------------------------------------------------ *
 * list_presentations
 * ------------------------------------------------------------------ */

export const listPresentations = defineOperation({
  name: 'list_presentations',
  summary: 'Presentasjonene som finnes, med id, tittel og antall slides.',
  mutates: false,
  scopes: ['presentations:read'],
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
  /** The mandatory first page. Not a slide, and not counted as one. */
  cover: { title: string; subtitle: string; pillColor: string }
  /**
   * What the whole deck is drawn in, and what `set_theme` takes back.
   *
   * Here rather than in an operation of its own: the theme is global and small,
   * every plan for a slide depends on it, and an agent that has read the
   * presentation should not need a second call to know how much room its
   * typography leaves. See `operations/theme.ts`.
   */
  theme: ThemeView
  slideCount: number
  assetCount: number
  referenceCount: number
  /** How much is parked in the sandbox. `list_sandbox_items` reads it. */
  sandboxCount: number
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
    cover: {
      title: docToPlainText(presentation.cover.title).trim(),
      subtitle: docToPlainText(presentation.cover.subtitle).trim(),
      pillColor: presentation.cover.pillColor,
    },
    theme: themeView(presentation.theme),
    slideCount: presentation.slides.length,
    assetCount: presentation.assets.length,
    referenceCount: presentation.references.length,
    sandboxCount: presentation.sandbox.length,
    slides: presentation.slides.map(summarizeSlide),
  }
}

export const getPresentation = defineOperation({
  name: 'get_presentation',
  summary:
    'En presentasjon i agenttermer: tittel, revisjon, tema, slides og hvor mange filer og referanser den har.',
  mutates: false,
  scopes: ['presentations:read'],
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
  summary: 'Opprett en ny presentasjon med en forside og én tom slide.',
  mutates: true,
  scopes: ['presentations:write'],
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
    coverTitle: z
      .string()
      .max(400)
      .optional()
      .describe('Tittelen på forsiden. Utelatt bruker presentasjonens egen tittel.'),
    coverSubtitle: z.string().max(400).optional().describe('Undertittelen på forsiden.'),
  }),
  async run(context, input): Promise<AgentResult<PresentationView>> {
    // A named folder has to be one the library actually has, for the same reason
    // `move_presentation` checks: a deck whose `folderId` points at nothing is
    // shown neither at the root nor in any folder. Same check, same code, so the
    // two doors into a folder cannot disagree.
    const missing = await missingFolder(context, input.folderId ?? null)
    if (missing) return missing

    // The same command the library uses, so an agent's presentation is not a
    // second kind of presentation: same schema version, same default theme, same
    // single empty slide — and the same refusal when a name or a cover line is
    // too long for the one line the cover gives it.
    const created = createDeck(
      {
        title: input.title,
        folderId: input.folderId ?? null,
        firstSlideHasTitle: input.firstSlideHasTitle,
        coverTitle: input.coverTitle,
        coverSubtitle: input.coverSubtitle,
      },
      structuralOptions(context),
    )
    if (!created.ok) {
      return agentErr(created.error.code, created.error.message, created.error.details)
    }
    const saved = await savePresentation(context, created.value)
    if (!saved.ok) return saved
    return agentOk(presentationView(saved.value))
  },
})

/* ------------------------------------------------------------------ *
 * set_presentation_title
 * ------------------------------------------------------------------ */

export const setPresentationTitleOperation = defineOperation({
  name: 'set_presentation_title',
  summary:
    'Endre navnet presentasjonen har i biblioteket. Dette er ikke forsidens tittel – den settes med set_cover.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    title: z.string().trim().min(1).max(200).describe('Det nye navnet.'),
  }),
  run(context, input): Promise<AgentResult<{ presentationId: string; title: string }>> {
    return mutatePresentation(context, input, (presentation) => {
      // Deliberately not the cover: the two started out the same when the deck
      // was created and are two decisions from then on, so renaming a deck in
      // the library must not silently rewrite the page an audience reads.
      const renamed = setPresentationTitle(presentation, input.title)
      if (!renamed.ok) return renamed
      return ok({
        presentation: renamed.value,
        value: { presentationId: presentation.id, title: renamed.value.title },
      })
    })
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
  /** Titled cards only: the card's own heading, and how it is aligned. */
  cardTitle?: TextSpan[]
  cardTitleAlign?: TextAlign
  /**
   * How the text fields inside the content divide it, and in what proportions —
   * the card's own layout, one level below the `axis`/`weights` a split reports.
   * `adjust_subfields` takes exactly these two back.
   */
  subfieldAxis?: Axis
  subfieldWeights?: number[]
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
  titleAlign?: TextAlign
  zones: ZoneInspection[]
}

/**
 * A zone's content, in the same agent-friendly vocabulary everywhere it is
 * read: on a slide, from `inspect_slide`, and parked in the sandbox, from
 * `list_sandbox_items`. One function, so the two can never drift into
 * describing the same `ZoneContent` two different ways.
 */
export interface ContentInspection {
  contentKind: ZoneContentKind
  /** Containers only: whether the zone holds text fields or a file. */
  payload?: 'fields' | 'asset'
  /** Titled cards only: the card's own heading, and how it is aligned. */
  cardTitle?: TextSpan[]
  cardTitleAlign?: TextAlign
  /**
   * The subfield layout: which way the fields run and how they share the room.
   *
   * Reported even for a single field, because that is the layout a later
   * `adjust_subfields` is written against — an agent that has to guess whether
   * a card is stacked or side by side is an agent that flips it by accident.
   * Absent only when there is no body at all, which is a zone showing a file.
   */
  subfieldAxis?: Axis
  subfieldWeights?: number[]
  /** The text fields inside the content, addressable in a later call. */
  subfields: SubfieldInspection[]
  /**
   * A zone showing a file: how the picture is drawn.
   *
   * Reported here rather than left to be guessed from `assetIds`, because both
   * are what a later `set_zone_asset` has to restate — a call that means to
   * round the corners and says nothing about the fit would otherwise put the
   * picture back to `contain`.
   */
  assetFit?: 'contain' | 'cover'
  assetRounded?: boolean
  /** Files and references this content shows. */
  assetIds: string[]
  referenceIds: string[]
}

export function inspectContent(content: ZoneContent): ContentInspection {
  const body = bodyOf(content)
  return {
    contentKind: content.kind,
    ...(content.kind === 'container' ? { payload: content.payload.type } : {}),
    ...(content.kind === 'titled-card'
      ? {
          cardTitle: docToTitleSpans(content.title),
          ...(docToTitleAlign(content.title) ? { cardTitleAlign: docToTitleAlign(content.title) } : {}),
        }
      : {}),
    ...(content.kind === 'container' && content.payload.type === 'asset'
      ? { assetFit: content.payload.fit, assetRounded: Boolean(content.payload.rounded) }
      : {}),
    ...(body ? { subfieldAxis: body.axis, subfieldWeights: [...body.weights] } : {}),
    subfields:
      body?.subfields.map((field) => ({
        subfieldId: field.id,
        verticalAlign: field.verticalAlign ?? 'top',
        blocks: docToBlocks(field.doc),
      })) ?? [],
    assetIds: contentAssetIds(content),
    referenceIds: contentCitationIds(content),
  }
}

export const inspectSlide = defineOperation({
  name: 'inspect_slide',
  summary: 'Strukturen i én slide: soner, sone-id-er, geometri, tekst og hva som ligger i dem.',
  mutates: false,
  scopes: ['presentations:read'],
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
      ...(docToTitleAlign(slide.title) ? { titleAlign: docToTitleAlign(slide.title) } : {}),
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
  // The same checker the commands run under, so "does it fit" has one answer.
  const fit = (context.fits ?? estimateFit)(content, rect, fitContext)
  out.push({
    nodeId: node.id,
    kind: 'leaf',
    rect,
    empty: false,
    ...inspectContent(content),
    fits: fit.fits,
    overflow: fit.overflow,
  })
}

export const deckOperations = [
  listPresentations,
  getPresentation,
  createPresentationOperation,
  setPresentationTitleOperation,
  inspectSlide,
]
