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
import {
  IMAGE_BRIEF_RULE,
  IMAGE_PLAN_RULE,
} from '../design'
import {
  createDeck,
  fitContextFor,
  setImageContext,
  setImagePlan,
  setPresentationTitle,
} from '../../domain/commands'
import type { ImageDeposit } from '../../domain/imageDeposit'
import {
  checkImagePlan,
  composeImageBrief,
  resolveImagePlan,
} from '../../domain/imagePlan'
import {
  composeImageWorkflowStatus,
  type ImageWorkflowStatus,
} from '../../domain/imageWorkflow'
import {
  bodyOf,
  contentAssetIds,
  contentCitationIds,
  hasCardTitle,
  IMAGE_CONTENT_KINDS,
  imagePanelOf,
} from '../../domain/content'
import {
  DEFAULT_VERTICAL_ALIGN,
  MAX_IMAGE_CONTEXT_CHARS,
  MAX_PLANNED_IMAGES,
  MAX_PLANNED_IMAGE_FIELD_CHARS,
  REQUIRED_PLANNED_IMAGE_FIELDS,
  plannedImageFieldIsBlank,
  type PlannedImageField,
  type InteractiveStyleContract,
} from '../../domain/constants'
import { estimateFit } from '../../domain/fit'
import { availableContentKinds, contentKindFitsRect } from '../../domain/contentSize'
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
  nodeIdSchema,
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
   * The deck's shared visual context for its pictures, or `null` when it has
   * none — see `set_image_context`.
   *
   * Here rather than in an operation of its own, for the same reason the theme
   * is: it is one small thing that applies to the whole deck, and every picture
   * planned for a slide is made against it. An agent that has read the
   * presentation should not need a second call to know what its pictures are
   * supposed to look like. The brief itself is generated rather than stored, so
   * it has its own read (`get_image_brief`) and is not duplicated here.
   */
  imageContext: string | null
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
    imageContext: presentation.imageContext ?? null,
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
 * The pictures: the shared context, the plan, and the generated brief
 * ------------------------------------------------------------------ */

export const setImageContextOperation = defineOperation({
  name: 'set_image_context',
  summary:
    'Sett dekkets felles bildekontekst: det visuelle uttrykket alle bildene i presentasjonen skal dele. Den vises aldri for publikum. Slaids setter den inn én gang, under «FELLES BILDEKONTEKST» øverst i seriebriefen, som stilen hele serien deler – du skriver aldri briefen selv. Her er det i orden å si at noe gjelder alle bildene; det som ikke hører hjemme her, er hva ett enkelt bilde skal vise. ' +
    IMAGE_BRIEF_RULE,
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    context: z
      .string()
      .max(MAX_IMAGE_CONTEXT_CHARS)
      .nullable()
      .describe('Selve konteksten. `null` eller bare mellomrom fjerner den.'),
  }),
  run(context, input): Promise<AgentResult<PresentationView>> {
    return mutatePresentation(context, input, (presentation) => {
      const written = setImageContext(presentation, input.context)
      if (!written.ok) return written
      return ok({ presentation: written.value, value: presentationView(written.value) })
    })
  },
})

/** One planned picture as an agent reads it back: what it says, and what Slaids measured. */
export interface PlannedImageView {
  /**
   * 1‥N in deck order: the number the brief's section heading, the zone's
   * placeholder caption and the deposit's own slot all say.
   *
   * Derived in one pass from the deck, never from the order the entries were
   * written in — see `resolveImagePlan`. It is the only identity a planned
   * picture has, and the only one it needs: the brief is one text ordering all
   * of them, and the deposit places file 3 in the zone stamped 3.
   */
  number: number
  slideId: string
  nodeId: string
  /** What the slide is called, so a reader can find the zone. */
  slideLabel: string
  /** Measured from the zone, never from the text. See `domain/imagePlan.ts`. */
  aspectRatio: string
  orientation: string
  /** Whether the file has arrived. A filled zone keeps its number. */
  filled: boolean
  /**
   * The entry's own texts — **on a read, and not on the write that stored them.**
   *
   * Writing the plan is the one call that has just been *handed* these texts, so
   * echoing them adds a second copy of a long string and answers no question the
   * caller does not already have the answer to. Reading the plan back is
   * different — a later session repairing an entry has to see what it says — so
   * the read carries them.
   *
   * Never the source for the text somebody generates from either way: that is
   * `brief`, composed by Slaids from the whole plan at once.
   */
  subject?: string
  composition?: string
  requirements?: string
  avoid?: string
}

/**
 * The deck's pictures in full: the plan, the checks, and the brief itself.
 *
 * One view for both the reading operation and the writing one, so an agent that
 * has just written a plan sees exactly what it would have got by reading it
 * back — including the numbering, which is derived and therefore not something
 * the write could have reported from its own input.
 */
export interface ImageBriefView {
  presentationId: string
  revision: string
  /**
   * Whether the picture work is finished, and what happens next if it is not.
   *
   * First in the answer, and deliberately: this is the field that decides
   * whether the *task* is over, and it is read by an agent that has just
   * written a plan and is deciding what to say to the user. Everything below is
   * the plan itself; this is the sentence about the plan. See
   * `ImageWorkflowStatus` for the failure it exists to make impossible.
   */
  workflow: ImageWorkflowStatus
  /** The shared visual context, or `null` when the deck has none. */
  imageContext: string | null
  imageCount: number
  images: PlannedImageView[]
  /**
   * What is wrong with the plan, in the deck's own terms.
   *
   * An empty list is the finishing line for the picture work — see
   * `IMAGE_PLAN_RULE`. Everything in it names a slide or a picture and says
   * what to change.
   */
  issues: { code: string; message: string; number?: number; slideId?: string; nodeId?: string }[]
  /**
   * **The deliverable.** The deck's whole picture order as one text, or `null`
   * when the deck plans no pictures.
   *
   * Always present rather than opt-in, because it is what the raster flow
   * produces: the agent finishes the deck, writes the plan, and hands this over
   * to the user as one copyable message. It used to be withheld — the flow it
   * was withheld from generated the pictures one at a time and had to keep the
   * whole set out of the conversation — and that flow is gone, because a host
   * client's image tool did not survive alternating between deck work and
   * picture calls. One brief, one conversation, N files.
   *
   * Composed from the plan and the zones every time it is asked for, so there
   * is no stored copy to go stale. It carries nothing of Slaids' own
   * bookkeeping — see `composeImageBrief` — and it is handed on **verbatim**: a
   * summary of it is a different order for the same pictures.
   */
  brief: string | null
  /**
   * Whether the user can hand the finished files back in one go, and how many
   * the deck is expecting.
   *
   * Opened by writing the plan — there is nothing for an agent to switch on —
   * and reported here so an agent can tell the user what will happen when they
   * open the deck: a numbered set of picture zones that takes the whole
   * delivery in one drop. See `domain/imageDeposit.ts`.
   */
  deposit: ImageDeposit | null
}

interface ImageBriefViewOptions {
  /** The entries' own texts. On the read, not on the write that stored them. */
  fields?: boolean
}

function imageBriefView(
  presentation: Presentation,
  options: ImageBriefViewOptions = {},
): ImageBriefView {
  const images = resolveImagePlan(presentation)
  return {
    presentationId: presentation.id,
    revision: presentationRevision(presentation),
    workflow: composeImageWorkflowStatus(presentation),
    imageContext: presentation.imageContext ?? null,
    imageCount: images.length,
    images: images.map((image) => ({
      number: image.number,
      slideId: image.plan.slideId,
      nodeId: image.plan.nodeId,
      slideLabel: image.slideLabel,
      aspectRatio: image.aspectRatio,
      orientation: image.orientation,
      filled: image.filled,
      ...(options.fields
        ? {
            subject: image.plan.subject,
            composition: image.plan.composition,
            requirements: image.plan.requirements,
            avoid: image.plan.avoid,
          }
        : {}),
    })),
    issues: checkImagePlan(presentation),
    brief: composeImageBrief(presentation),
    deposit: presentation.imageDeposit ? { ...presentation.imageDeposit } : null,
  }
}

/**
 * What an agent may write into one field of a plan entry.
 *
 * Whether a field is required is *derived* from `REQUIRED_PLANNED_IMAGE_FIELDS`
 * rather than decided here, and so is the word the description opens with. That
 * is the whole point: the same list is read by the domain command that writes a
 * plan and by the schema that stores one, so a field added to or removed from
 * it changes all three boundaries at once instead of two of them and a comment.
 *
 * The prose is this layer's, because it is written for an agent rather than for
 * a validator — but it is keyed by field in a `Record` over every field, so a
 * new field is a type error here until somebody describes it.
 */
const PLANNED_IMAGE_FIELD_PROSE: Record<PlannedImageField, string> = {
  subject:
    'Hva bildet viser, konkret og entydig. Det ene feltet som må skille dette bildet fra de andre.',
  composition:
    'Komposisjon og utsnitt: hvor motivet er, kameravinkel, helfigur eller nærbilde, nødvendig negativ plass. Uten den kan ikke motivet kontrolleres mot sonens format. Ikke oppgi format eller aspect ratio – Slaids måler det fra sonen.',
  requirements:
    'Faglige krav: det som må fremstilles korrekt for at bildet skal kunne brukes. Tom utelates fra briefen.',
  avoid:
    'Hva som ikke skal forekomme i akkurat dette bildet – aldri dekkets felles kontekst. Tom utelates fra briefen.',
}

function plannedImageField(name: PlannedImageField) {
  const bounded = z.string().max(MAX_PLANNED_IMAGE_FIELD_CHARS)
  const required = REQUIRED_PLANNED_IMAGE_FIELDS.includes(name)
  const field = required
    ? bounded.refine((value) => !plannedImageFieldIsBlank(value), {
        message: 'Feltet kan ikke være tomt',
      })
    : bounded
  return field.describe(`${required ? 'Påkrevd.' : 'Valgfri.'} ${PLANNED_IMAGE_FIELD_PROSE[name]}`)
}

export const planDeckImages = defineOperation({
  name: 'plan_deck_images',
  summary:
    'Skriv hele bildeplanen for presentasjonen: én oppføring per bildesone som venter på en fil. Slaids nummererer bildene i dekkets rekkefølge, måler aspect ratio fra hver sones faktiske geometri, setter plassholder-bildeteksten «Sett inn bilde N her» i hver ufylte bildesone, og setter sammen den ferdige seriebriefen for hele dekket. Hele planen sendes hver gang – en tom liste fjerner den. Svaret er `images` med det Slaids utledet – nummer, sone og aspect ratio – og `brief`: den ferdige teksten brukeren skal ha. Briefen er leveransen, og den gis videre ordrett. Dette kallet er et mellomsteg, aldri en ferdig leveranse: `workflow` sier hvor rasterflyten står, hva som skal gjøres nå, og om oppgaven kan avsluttes i det hele tatt. ' +
    IMAGE_PLAN_RULE,
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    images: z
      .array(
        z.strictObject({
          slideId: slideIdSchema,
          nodeId: nodeIdSchema.describe(
            'Sonen bildet skal ligge i. Den må allerede være `image` eller `titled-image-card`.',
          ),
          subject: plannedImageField('subject'),
          composition: plannedImageField('composition'),
          requirements: plannedImageField('requirements'),
          avoid: plannedImageField('avoid'),
        }),
      )
      .max(MAX_PLANNED_IMAGES)
      .describe('Hele bildeplanen. Rekkefølgen her betyr ingenting – nummereringen følger dekket.'),
  }),
  run(context, input): Promise<AgentResult<ImageBriefView>> {
    return mutatePresentation(context, input, (presentation) => {
      const written = setImagePlan(presentation, input.images, structuralOptions(context))
      if (!written.ok) return written
      return ok({ presentation: written.value, value: imageBriefView(written.value) })
    })
  },
})

export const getImageBrief = defineOperation({
  name: 'get_image_brief',
  summary:
    'Les dekkets bildeplan slik den står nå, og hent den ferdige seriebriefen. `brief` er hele bildebestillingen som én tekst: antallet, reglene om at hvert nummer er én separat bildefil, den felles bildekonteksten og én nummerert seksjon per bilde med aspect ratio og motiv. Den er leveransen til brukeren, og den gis videre ordrett – ikke oppsummert, ikke delt opp, ikke skrevet om. `images` er den samme planen strukturert, med nummer, sone, aspect ratio og de fire tekstfeltene, til reparasjon og kontroll. Svaret har også kontrollene mot sonene – en tom `issues`-liste betyr at bildeplanen er klar, ikke at oppgaven er ferdig; det svarer `workflow` på.',
  mutates: false,
  scopes: ['presentations:read'],
  input: z.strictObject({ presentationId: presentationIdSchema }),
  async run(context, input): Promise<AgentResult<ImageBriefView>> {
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded
    return ok(imageBriefView(loaded.value, { fields: true }))
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
  /**
   * Picture kinds only: whether the rectangle is big enough for each picture
   * kind, once its file arrives.
   *
   * `availableContentKinds` answers what this zone could be *converted* to,
   * which for a zone that is already a picture always includes the kind it is —
   * that is what keeps a cramped legacy zone repairable. This asks the other
   * question, the one a reservation exists for: is the rectangle actually big
   * enough for a picture at all? A later split or a changed ratio can shrink a
   * waiting picture zone below a picture's minimum, and nothing refuses,
   * because nothing is being written.
   *
   * A list rather than a yes or no, because the two picture kinds are not the
   * same reservation: a `titled-image-card` carries a header above the picture
   * and therefore needs a text zone's width and that header's height on top of
   * a picture's minimum. Empty means the zone has become too small for any
   * picture at all.
   */
  reservedImageKinds?: ZoneContentKind[]
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
  const tokens = themeMetrics(fitContext.theme)
  const kinds = availableContentKinds(rect, node.content, tokens)

  if (!node.content) {
    out.push({ nodeId: node.id, kind: 'leaf', rect, empty: true, availableContentKinds: kinds })
    return
  }

  const content = node.content
  const waitingPanel = imagePanelOf(content)
  // The same checker the commands run under, so "does it fit" has one answer.
  const fit = (context.fits ?? estimateFit)(content, rect, fitContext)
  out.push({
    nodeId: node.id,
    kind: 'leaf',
    rect,
    empty: false,
    availableContentKinds: kinds,
    ...inspectContent(content),
    // See `ZoneInspection.reservedImageKinds`: only a zone that is waiting for a
    // file has a question to answer here, and each picture kind's own minimum
    // answers it.
    ...(waitingPanel && !waitingPanel.assetId
      ? {
          reservedImageKinds: IMAGE_CONTENT_KINDS.filter((kind) =>
            contentKindFitsRect(kind, rect, tokens),
          ),
        }
      : {}),
    fits: fit.fits,
    overflow: fit.overflow,
  })
}

export const deckOperations = [
  listPresentations,
  getPresentation,
  createPresentationOperation,
  setPresentationTitleOperation,
  setImageContextOperation,
  planDeckImages,
  getImageBrief,
  inspectSlide,
]
