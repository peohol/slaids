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
import { IMAGE_BRIEF_RULE } from '../design'
import {
  createDeck,
  fitContextFor,
  setImageBrief,
  setPresentationTitle,
} from '../../domain/commands'
import {
  bodyOf,
  contentAssetIds,
  contentCitationIds,
  hasCardTitle,
  imagePanelOf,
} from '../../domain/content'
import {
  DEFAULT_VERTICAL_ALIGN,
  MAX_IMAGE_BRIEF_CHARS,
  type InteractiveStyleContract,
  type NotePurpose,
} from '../../domain/constants'
import { estimateFit } from '../../domain/fit'
import { availableContentKinds } from '../../domain/contentSize'
import { interactiveByteSize } from '../../domain/interactive'
import { computeSlideGeometry } from '../../domain/geometry'
import { geometryForTheme, themeMetrics } from '../../domain/metrics'
import { findSlide } from '../../domain/presentation'
import { presentationRevision } from '../../domain/revision'
import { docToPlainText } from '../../domain/richdoc'
import type { FitContext } from '../../domain/fit'
import type {
  Axis,
  CaptionPosition,
  ContentSlide,
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

/**
 * One slide in the deck's overview.
 *
 * `kind` is what tells the two apart, and it decides which of the remaining
 * fields mean anything: a content slide has a title *zone* that may be absent
 * and a tree of zones, a section has a heading it always has and the two
 * colours it hands to the slides after it.
 */
export type SlideSummary = ContentSlideSummary | SectionSlideSummary | InteractiveSlideSummary

export interface ContentSlideSummary {
  slideId: string
  index: number
  kind: 'content'
  hasTitle: boolean
  /** The title as plain text; the stored form is rich text. */
  title: string
}

export interface SectionSlideSummary {
  slideId: string
  index: number
  kind: 'section'
  /** The heading as plain text; the stored form is rich text. */
  title: string
  /** Empty when the section has no subheading — then the heading stands alone. */
  subtitle: string
  /** Pills and uncoloured headings from here to the next section. */
  accentColor: string
  /** The page colour from here to the next section. */
  backgroundColor: string
}

/**
 * An interactive slide, as a listing describes it.
 *
 * The name, the file's name and how big the file is — and never the source.
 * A listing is read by every caller that holds `presentations:read`, and a
 * megabyte of somebody's HTML in every `get_presentation` would make the
 * overview unreadable long before it became a data question; the source is
 * what `set_interactive_slide` takes in, not what a summary hands out.
 */
export interface InteractiveSlideSummary {
  slideId: string
  index: number
  kind: 'interactive'
  /** What the cover shows. */
  name: string
  fileName: string
  /** The size of the stored source, in bytes of UTF-8. */
  htmlByteSize: number
  /**
   * The design contract the file was written against.
   *
   * Here because it decides what the app inherits — which CSS variables it is
   * given and what an unstyled element looks like. See
   * `get_interactive_contract`.
   */
  styleContract: InteractiveStyleContract
}

export interface PresentationView {
  presentationId: string
  title: string
  folderId: string | null
  updatedAt: string
  /** Send this back as `expectedRevision` to write against exactly this reading. */
  revision: string
  /**
   * What the whole deck is drawn in, and what `set_theme` takes back.
   *
   * Here rather than in an operation of its own: the theme is global and small,
   * every plan for a slide depends on it, and an agent that has read the
   * presentation should not need a second call to know how much room its
   * typography leaves. See `operations/theme.ts`.
   */
  theme: ThemeView
  /**
   * The deck's shared visual premise for its pictures, or `null` when it has
   * none — see `set_image_brief`.
   *
   * Here rather than in an operation of its own, for the same reason the theme
   * is: it is one small thing that applies to the whole deck, and every image
   * prompt written for a slide depends on it. An agent that has read the
   * presentation should not need a second call to know what its pictures are
   * supposed to look like.
   */
  imageBrief: string | null
  slideCount: number
  assetCount: number
  referenceCount: number
  /** How much is parked in the sandbox. `list_sandbox_items` reads it. */
  sandboxCount: number
  slides: SlideSummary[]
}

function summarizeSlide(slide: Slide, index: number): SlideSummary {
  switch (slide.kind) {
    case 'section':
      return {
        slideId: slide.id,
        index,
        kind: 'section',
        title: docToPlainText(slide.title).trim(),
        subtitle: docToPlainText(slide.subtitle).trim(),
        accentColor: slide.accentColor,
        backgroundColor: slide.backgroundColor,
      }
    case 'interactive':
      return {
        slideId: slide.id,
        index,
        kind: 'interactive',
        name: slide.name,
        fileName: slide.fileName,
        htmlByteSize: interactiveByteSize(slide),
        styleContract: slide.styleContract,
      }
    case 'content':
      return {
        slideId: slide.id,
        index,
        kind: 'content',
        hasTitle: slide.title !== null,
        title: docToPlainText(slide.title),
      }
  }
}

export function presentationView(presentation: Presentation): PresentationView {
  return {
    presentationId: presentation.id,
    title: presentation.title,
    folderId: presentation.folderId,
    updatedAt: presentation.updatedAt,
    revision: presentationRevision(presentation),
    theme: themeView(presentation.theme),
    imageBrief: presentation.imageBrief ?? null,
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
  summary:
    'Opprett en ny presentasjon: en seksjonsslide som forside, og én tom slide etter den. Forsiden er alltid første slide, og fargene den settes i arves av slidene fram til neste seksjon.',
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
    frontTitle: z
      .string()
      .max(400)
      .optional()
      .describe('Overskriften på forsiden. Utelatt bruker presentasjonens egen tittel.'),
    frontSubtitle: z.string().max(400).optional().describe('Underoverskriften på forsiden.'),
    accentColor: z
      .string()
      .optional()
      .describe(
        'Hex-farge for piller og overskrifter uten egen farge, fra forsiden og fram til neste seksjon.',
      ),
    backgroundColor: z
      .string()
      .optional()
      .describe('Hex-farge for sidene, fra forsiden og fram til neste seksjon.'),
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
    // front section and single empty slide — and the same refusal when a name or
    // a front-page line is too long for the one line it gets.
    const created = createDeck(
      {
        title: input.title,
        folderId: input.folderId ?? null,
        firstSlideHasTitle: input.firstSlideHasTitle,
        frontTitle: input.frontTitle,
        frontSubtitle: input.frontSubtitle,
        accentColor: input.accentColor,
        backgroundColor: input.backgroundColor,
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
    'Endre navnet presentasjonen har i biblioteket. Dette er ikke forsidens overskrift – den settes med set_section på den første sliden.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    title: z.string().trim().min(1).max(200).describe('Det nye navnet.'),
  }),
  run(context, input): Promise<AgentResult<{ presentationId: string; title: string }>> {
    return mutatePresentation(context, input, (presentation) => {
      // Deliberately not the front page: the two started out the same when the deck
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
 * set_image_brief
 * ------------------------------------------------------------------ */

export const setImageBriefOperation = defineOperation({
  name: 'set_image_brief',
  summary:
    'Sett dekkets felles bildebrief: det visuelle uttrykket alle bildene i presentasjonen skal dele. Den vises aldri for publikum – den er premissen hver enkelt bildeprompt skrives mot, og det brukeren limer inn først i samtalen der bildene lages. Les den tilbake med get_presentation. ' +
    IMAGE_BRIEF_RULE,
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    brief: z
      .string()
      .max(MAX_IMAGE_BRIEF_CHARS)
      .nullable()
      .describe('Selve briefen. `null` eller bare mellomrom fjerner den.'),
  }),
  run(context, input): Promise<AgentResult<PresentationView>> {
    return mutatePresentation(context, input, (presentation) => {
      const written = setImageBrief(presentation, input.brief)
      if (!written.ok) return written
      return ok({ presentation: written.value, value: presentationView(written.value) })
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
  /** Split only: how it divides, and into what. Ratios are whole, 1–10. */
  axis?: 'x' | 'y'
  weights?: number[]
  childNodeIds?: string[]
  /**
   * Leaf only: the zone has no content object at all.
   *
   * Told apart from `contentKind: 'negative-space'` and `contentKind: 'note'`
   * deliberately. An empty zone is a hole waiting to be filled; negative space
   * is a decision that this part of the composition stays blank; a note is
   * editorial work parked in a zone that is expected to hold something else
   * later. All three draw nothing and none of them has a minimum size, but
   * they are three different states and only one of them is unfinished.
   */
  empty?: boolean
  contentKind?: ZoneContentKind
  /**
   * Leaf only: which content kinds this zone could actually be set to.
   *
   * The same rule the commands refuse by, asked of this zone's rectangle *and*
   * of what it holds today, so a caller can choose from this list instead of
   * trying kinds until one is accepted. Three things shape it: a very small
   * zone answers with the kinds that draw nothing — `negative-space` and
   * `note` — which is not a failure but the intended use of a small zone; a
   * zone that already holds something offers neither of those two, because
   * neither can take a payload with it and the content would have to be
   * cleared first (and by the same rule a zone holding a note with text in it
   * offers nothing but `note`); and the kind the zone already is is always on
   * the list, however small the zone, because that call is how a cramped
   * legacy zone gets repaired.
   */
  availableContentKinds?: ZoneContentKind[]
  /** Titled cards only: the card's own heading, and how it is aligned. */
  cardTitle?: TextSpan[]
  cardTitleAlign?: TextAlign
  /** Picture kinds only: the file, the crop and the caption over it. */
  image?: InspectedImage
  /** Notes only: the editorial text in this zone, and what it is for. */
  noteText?: string
  notePurpose?: NotePurpose
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

/**
 * One slide, read in full.
 *
 * A union rather than one shape with optional halves, for the same reason
 * `Slide` is: a section has no zones and no root node, and a shape that offered
 * them as "sometimes absent" would invite a caller to ask a section for its
 * layout and get `undefined` instead of an answer.
 */
export type SlideInspection =
  | ContentSlideInspection
  | SectionSlideInspection
  | InteractiveSlideInspection

export interface ContentSlideInspection extends ContentSlideSummary {
  presentationId: string
  revision: string
  rootNodeId: string
  /** The title as spans, so a citation in it survives being read back. */
  titleSpans: TextSpan[]
  titleAlign?: TextAlign
  zones: ZoneInspection[]
}

export interface SectionSlideInspection extends SectionSlideSummary {
  presentationId: string
  revision: string
  /** Both lines as spans, for symmetry with a content slide's title. */
  titleSpans: TextSpan[]
  subtitleSpans: TextSpan[]
}

/**
 * An interactive slide, inspected.
 *
 * Nothing beyond the summary: there are no zones to report and no text to
 * read back, and the source stays out for the reason it stays out of the
 * listing. What an agent learns here is enough to rename the slide, replace
 * its file, move it, or leave it alone.
 */
export interface InteractiveSlideInspection extends InteractiveSlideSummary {
  presentationId: string
  revision: string
}

/**
 * A zone's content, in the same agent-friendly vocabulary everywhere it is
 * read: on a slide, from `inspect_slide`, and parked in the sandbox, from
 * `list_sandbox_items`. One function, so the two can never drift into
 * describing the same `ZoneContent` two different ways.
 */
/**
 * A picture panel, as an agent reads it.
 *
 * The crop is two numbers between 0 and 1 rather than a description, because
 * that is exactly what `set_image_focus` takes back — an agent that has read a
 * zone can nudge the framing without a second lookup.
 */
export interface InspectedImage {
  assetId: string | null
  focus: { x: number; y: number }
  caption?: { position: CaptionPosition; color: string | null; spans: TextSpan[] }
}


export interface ContentInspection {
  contentKind: ZoneContentKind
  /** Titled cards only: the card's own heading, and how it is aligned. */
  cardTitle?: TextSpan[]
  cardTitleAlign?: TextAlign
  /** Picture kinds only: the file, the crop and the caption over it. */
  image?: InspectedImage
  /**
   * Notes only: the editorial text in this zone, and what it is for.
   *
   * Two flat fields rather than a nested object, the way a card's title is two
   * — `note` alone is already taken, by the sentence a sandbox item carries
   * saying what displaced it, and one word meaning two things across two
   * readings of the same vocabulary is how an agent ends up reading the wrong
   * one. The text is the same string that goes back in, so an agent can come
   * back to a deck it built, read the prompt it left in a zone and refine it.
   */
  noteText?: string
  notePurpose?: NotePurpose
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
  /** Files and references this content shows. */
  assetIds: string[]
  referenceIds: string[]
}

export function inspectContent(content: ZoneContent): ContentInspection {
  const body = bodyOf(content)
  const panel = imagePanelOf(content)
  return {
    contentKind: content.kind,
    ...(hasCardTitle(content)
      ? {
          cardTitle: docToTitleSpans(content.title),
          ...(docToTitleAlign(content.title) ? { cardTitleAlign: docToTitleAlign(content.title) } : {}),
        }
      : {}),
    ...(panel
      ? {
          image: {
            assetId: panel.assetId,
            focus: { ...panel.focus },
            ...(panel.caption
              ? {
                  caption: {
                    position: panel.caption.position,
                    color: panel.caption.color,
                    spans: docToTitleSpans(panel.caption.doc),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(content.kind === 'note'
      ? { noteText: content.text, notePurpose: content.purpose }
      : {}),
    ...(body ? { subfieldAxis: body.axis, subfieldWeights: [...body.weights] } : {}),
    subfields:
      body?.subfields.map((field) => ({
        subfieldId: field.id,
        verticalAlign: field.verticalAlign ?? DEFAULT_VERTICAL_ALIGN,
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

    const summary = summarizeSlide(slide, index)
    const revision = presentationRevision(presentation)
    if (slide.kind === 'section' && summary.kind === 'section') {
      return agentOk({
        ...summary,
        presentationId: presentation.id,
        revision,
        titleSpans: docToTitleSpans(slide.title),
        subtitleSpans: docToTitleSpans(slide.subtitle),
      })
    }
    if (summary.kind === 'interactive') {
      return agentOk({ ...summary, presentationId: presentation.id, revision })
    }
    if (slide.kind !== 'content' || summary.kind !== 'content') {
      return agentErr('SLIDE_NOT_FOUND', 'Fant ikke sliden.', {
        presentationId: presentation.id,
        slideId: input.slideId,
      })
    }
    return agentOk({
      ...summary,
      presentationId: presentation.id,
      revision,
      rootNodeId: slide.root.id,
      titleSpans: docToTitleSpans(slide.title),
      ...(docToTitleAlign(slide.title) ? { titleAlign: docToTitleAlign(slide.title) } : {}),
      zones: inspectZones(slide, presentation, context),
    })
  },
})

function inspectZones(
  slide: ContentSlide,
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

  // The same rule the command refuses by and the editor's picker greys its
  // buttons by, asked of this zone's rectangle *and* of what it holds today —
  // so an agent reading a zone learns what it may ask for rather than
  // discovering it one rejection at a time. Asked with only the rectangle it
  // would advertise air for a zone full of text, and hide a cramped zone's own
  // kind, which the command deliberately still accepts.
  const kinds = availableContentKinds(rect, node.content, themeMetrics(fitContext.theme))

  if (!node.content) {
    out.push({ nodeId: node.id, kind: 'leaf', rect, empty: true, availableContentKinds: kinds })
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
    availableContentKinds: kinds,
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
  setImageBriefOperation,
  inspectSlide,
]
