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
  IMAGE_HANDOFF_RULE,
  IMAGE_JOB_RULE,
  IMAGE_PLAN_RULE,
} from '../design'
import {
  createDeck,
  fitContextFor,
  recordGeneratedImages,
  setImageContext,
  setImagePlan,
  setPresentationTitle,
} from '../../domain/commands'
import type { ImageDeposit } from '../../domain/imageDeposit'
import {
  checkGeneratedImages,
  plannedGeneratedImages,
  composeImageGenerationManifest,
  expectedGeneratedImages,
  imageBindingCheck,
  IMAGE_MANIFEST_FILE_NAME,
  type GeneratedImageRecord,
  type ImageBindingCheck,
  type ImageBindingIssue,
} from '../../domain/imageGeneration'
import {
  checkImagePlan,
  composeImageBrief,
  composeImageGenerationContract,
  isImagePlanItemId,
  resolveImagePlan,
  type ImageGenerationContract,
} from '../../domain/imagePlan'
import {
  composeImageWorkflowStatus,
  nextImageJob,
  type ImageGenerationJob,
  type ImageJobStatus,
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
    'Sett dekkets felles bildekontekst: det visuelle uttrykket alle bildene i presentasjonen skal dele. Den vises aldri for publikum. Slaids bruker den som stil- og kvalitetsdelen av den ferdige prompten for hvert enkelt bilde – du skriver aldri prompten selv, og du sier aldri til en bildegenerator at den samme konteksten gjelder flere bilder. ' +
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
   * The entry's stable identity, and the only thing a generated file may be
   * bound to.
   *
   * Here because the alternative was tried and failed: with only a `number` to
   * go on, an agent that generated nine pictures and named the files in the
   * order they came back put seven of them on the wrong slide. The id is what a
   * generation call carries out and back, and `verify_image_handoff` is what
   * checks that it came back attached to the same picture.
   */
  imagePlanItemId: string
  /** 1‥N in deck order. The number the zone's placeholder caption says. */
  number: number
  /** What this picture's file is called: the entry's own number, plus the extension. */
  fileName: string
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
   * Optional for one reason, and it is the same reason the prompts moved to a
   * surface of their own: a response that restates the plan puts the set back
   * in the context the next image call is written from. Writing the plan is the
   * one call that has just been *handed* these texts, so echoing them adds a
   * second copy and answers no question the caller does not already have the
   * answer to. Reading the plan back is different — a later session repairing
   * an entry has to see what it says — so the read carries them.
   *
   * Never the source for a generation prompt either way: that is composed by
   * Slaids, one entry at a time. See `composeImageGenerationPrompt`.
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
   * The whole plan as one human-readable message — **only when it was asked
   * for**, and `null` otherwise. Documentation, debugging, manual copying.
   *
   * Generated from the plan and the zones every time it is asked for; there is
   * no stored copy, so it cannot be stale.
   *
   * Opt-in because it does not belong in the generation flow at all, and being
   * in the response *is* being in the flow: one message that counts the
   * pictures, numbers them and lists every motif is a set to compose, whether
   * it is handed to a generator directly — the collage a deck of eight planned
   * pictures came back as — or merely sitting in the context the next image
   * call is written from. Generation runs off one job at a time; the editor's
   * own brief dialog composes this same text for a person, and an agent asks
   * for it when a person wants to paste it somewhere.
   */
  brief: string | null
  /**
   * What a finished set of files has to be, when the pictures are generated
   * rather than pasted. `null` exactly when `brief` is.
   *
   * See `ImageGenerationContract`: it adds the one thing the entries cannot say
   * about themselves — how many of them make a delivery — so an agent can check
   * what it produced before the files reach the deposit.
   */
  generation: ImageGenerationContract | null
  /**
   * Whether the user can hand the finished files back in one go, and how many
   * the deck is expecting.
   *
   * Opened by writing the plan — there is nothing for an agent to switch on —
   * and reported here so an agent can tell the user what will happen when they
   * open the deck: a numbered set of picture zones that fills itself from files
   * called `1.png`, `2.jpg`, … See `domain/imageDeposit.ts`.
   */
  deposit: ImageDeposit | null
}

interface ImageBriefViewOptions {
  /** The whole-plan message, only when a person asked for it. */
  brief?: boolean
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
      imagePlanItemId: image.id,
      number: image.number,
      fileName: `${image.fileNameStem}.<filendelse>`,
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
    brief: options.brief ? composeImageBrief(presentation) : null,
    generation: composeImageGenerationContract(presentation),
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
    'Skriv hele bildeplanen for presentasjonen: én oppføring per bildesone som venter på en fil. Slaids nummererer bildene i dekkets rekkefølge, måler aspect ratio fra hver sones faktiske geometri, setter plassholder-bildeteksten «Sett inn bilde N her» i hver ufylte bildesone, og setter sammen den ferdige bildeprompten for hver enkelt oppføring. Hele planen sendes hver gang – en tom liste fjerner den. Svaret er `images`: én oppføring per bilde, med det Slaids utledet – `imagePlanItemId`, nummer, filnavn, sone og aspect ratio. Teksten du nettopp sendte gjentas ikke: den ligger i planen og leses tilbake med `get_image_brief` når den trengs. Selve prompten ligger ikke her: den hentes én jobb om gangen med `get_next_image_job`, slik at ett bildekall aldri ser de andre oppføringene. `generation` sier hvordan én jobb utføres og hva en ferdig leveranse er. Dette kallet er et mellomsteg, aldri en ferdig leveranse: `workflow` sier hvor rasterflyten står, hva som skal gjøres nå, og om oppgaven kan avsluttes i det hele tatt. ' +
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
    'Les dekkets bildeplan slik den står nå: `images` med én oppføring per bilde – `imagePlanItemId`, filnavn, sone, aspect ratio målt fra sonen, og de fire tekstfeltene. Bildene genereres ikke herfra: selve prompten kommer én jobb om gangen fra `get_next_image_job`, slik at ett bildekall aldri ser de andre oppføringene. Svaret har kontrollene mot sonene – en tom `issues`-liste betyr at planen er klar til bildegenerering, ikke at oppgaven er ferdig; det svarer `workflow` på – og `generation`, som sier hvordan én oppføring utføres og hva en ferdig leveranse er. `brief` er tom med mindre du ber om den: den samlede teksten er til dokumentasjon og manuell kopiering, aldri et steg i genereringsflyten.',
  mutates: false,
  scopes: ['presentations:read'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    includeBrief: z
      .boolean()
      .optional()
      .describe(
        'Ta med den samlede, menneskelesbare briefen i `brief`. Bare når et menneske skal lese eller lime den inn et sted – den viser alle bildene samtidig, og det er nettopp det én bildegenerering ikke skal se. Utelatt er `brief` `null`.',
      ),
  }),
  async run(context, input): Promise<AgentResult<ImageBriefView>> {
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded
    return ok(imageBriefView(loaded.value, { fields: true, brief: input.includeBrief ?? false }))
  },
})

/* ------------------------------------------------------------------ *
 * get_next_image_job
 * ------------------------------------------------------------------ */

/**
 * One picture to generate now, as an agent reads it.
 *
 * A surface of its own rather than a field on the plan, and that is the whole
 * design: a response that carries the plan carries the *set*, and an agent
 * holding nine motifs and nine prompts has the set in context when it writes
 * the first image call — whatever it was told not to say out loud. What an
 * image generator does with a task it can see is a set is compose the set: a
 * collage, a contact sheet, a storyboard, a whole slide. That is its ordinary
 * behaviour, not a lapse another warning would catch.
 *
 * So this can only say one thing, and the next job is fetched after the current
 * one is generated and bound. See `nextImageJob`.
 */
export interface ImageJobView {
  presentationId: string
  revision: string
  /** Why there is a job, or why there is none. See `ImageJobStatus`. */
  status: ImageJobStatus
  /** The one picture to generate now, or `null`. */
  job: ImageGenerationJob | null
  /** What to do with this answer, in one sentence. */
  instruction: string
  /** What to fix when the plan is what stops a job. Empty otherwise. */
  issues: { code: string; message: string; number?: number; slideId?: string; nodeId?: string }[]
}

export const getNextImageJob = defineOperation({
  name: 'get_next_image_job',
  summary:
    'Hent den ene bildejobben som skal gjøres nå. Svaret er én jobb, og den har tre felter: `prompt` er hele instruksen for dette ene bildet – dekkets felles bildekontekst og bare denne oppføringens motiv, komposisjon, krav og «unngå» – `aspectRatio` er formatet målt fra sonen, og `imagePlanItemId` er bokføringen kontrollen etterpå ber om. Nummer, filnavn og sone følger ikke med: hvert av dem sier «ett av flere», og koblingskontrollen svarer med navnet filen skal lagres under. Ingen andre oppføringer, ingen samlet brief, intet antall: kall bildegeneratoren nøyaktig én gang med `prompt` ordrett, svar for bytene – SHA-256 av det som kom tilbake, eller `bytesUnavailable: true` når verten ikke gir deg dem – kjør koblingskontrollen for denne oppføringen, og hent så neste jobb. Kommer det ingen jobb, sier `status` hvorfor: planen har funn som skal rettes, dekket planlegger ingen bilder, eller alle oppføringene har svart for bytene – det siste er slutten på løkken. ' +
    IMAGE_JOB_RULE,
  mutates: false,
  scopes: ['presentations:read'],
  input: z.strictObject({ presentationId: presentationIdSchema }),
  async run(context, input): Promise<AgentResult<ImageJobView>> {
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded
    const next = nextImageJob(loaded.value)
    return ok({
      presentationId: loaded.value.id,
      revision: presentationRevision(loaded.value),
      status: next.status,
      job: next.job,
      instruction: next.instruction,
      issues: next.issues.map((issue) => ({ ...issue })),
    })
  },
})

/** What the handoff check answers. See `verify_image_handoff`. */
export interface GeneratedImagesView {
  presentationId: string
  revision: string
  /** Whether the files may be handed over. False means something is named below. */
  ok: boolean
  /**
   * How far the bindings can be checked against the files themselves.
   *
   * Reported beside `ok`, never folded into it, because the two answer
   * different questions and the difference is the whole point: a delivery with
   * no digests is consistent metadata about files nobody compared, so it is
   * `ok: true` and `check: 'unchecked'`. An agent that read only `ok` would
   * call that verified, which is the failure one layer up from the one this
   * operation exists for.
   */
  check: ImageBindingCheck
  /** What `check` means, in a sentence that does not overstate it. */
  checkMeans: string
  /** What is wrong with the bindings, in the deck's own terms. Empty when `ok`. */
  issues: ImageBindingIssue[]
  /**
   * Whether every planned entry now has a stored binding.
   *
   * The completeness half, separated from `ok` because the check runs per
   * picture: a call that binds one picture correctly is `ok` while the plan is
   * still waiting for the rest, and an agent that read `ok` as «the set is
   * done» would stop one job early. False is not a finding — it is the loop
   * saying there is another job to fetch.
   */
  planCovered: boolean
  /**
   * The bindings the deck's plan expects — **only when something is wrong.**
   *
   * There to save a round trip on a repair, and withheld otherwise for the
   * reason the whole generation flow is one job at a time: this list is the
   * set, and a successful per-picture check that restated it would put the set
   * back in context before the next image call.
   */
  expected: Omit<GeneratedImageRecord, 'fileName' | 'contentHash'>[]
  /**
   * What each file in this call is to be saved as, by plan entry.
   *
   * The name is the entry's own number and the format's extension, and it is
   * answered *here* rather than handed out with the job: a number is a fact
   * about a set, and the job is the one place that must not carry one. Nothing
   * needs it to make a picture; the deposit needs it to place one.
   */
  files: { imagePlanItemId: string; fileName: string }[]
  /** What the manifest file is called when the files go through the deposit. */
  manifestFileName: string
  /**
   * The manifest to hand over with the files, or `null` until the whole plan is
   * bound and nothing is wrong.
   *
   * Withheld rather than emitted with a warning: a manifest is a statement that
   * the binding was checked, and one produced from records that did not check
   * out would be exactly the false reassurance this operation exists to remove.
   *
   * Composed from the bindings the deck *holds*, so the per-picture loop
   * produces one manifest for the whole delivery on its last round rather than
   * a partial one on every round. The deposit matches files 1‥N, and a manifest
   * naming one of them is not a delivery.
   */
  manifest: string | null
  /**
   * Where the raster flow stands once this call's bindings are part of the deck.
   *
   * A passing check is stored, so what it reports here is what every later read
   * reports too. What it reports is what was *claimed*: every field in a
   * binding is a string this call supplied, so a complete set lands on
   * `awaiting-deposit` with `complete: false` — the pictures are not in the
   * deck, and nothing said here can put them there. `complete` turns true when
   * the user's deposit inserts the files, which is also the only place the
   * digests are compared against real bytes. An agent's own stop is
   * `workflow.remainingSteps`, never `complete`.
   */
  workflow: ImageWorkflowStatus
}

/**
 * What each verification level actually covers, for an agent about to report it.
 *
 * Here rather than left to the agent to phrase, because the phrasing is the
 * deliverable: «kontrollert» said of a delivery nobody could check is how a
 * flow that cannot see its own pictures ends up claiming it can.
 */
const CHECK_MEANS: Record<ImageBindingCheck, string> = {
  'file-checked':
    'Hver kobling bærer et avtrykk, så nettleseren *kan* sammenligne hver fil med akkurat de bytene før bildene settes inn. Selve sammenligningen skjer der, ikke her: Slaids ser aldri filene dine, så på dette punktet er avtrykket en påstand du har oppgitt. Når den er sammenlignet, avgjør den hvilken fil som hører til hvilken bildeplass – aldri hva bildet viser. Se gjennom bildene selv i tillegg.',
  unchecked:
    'Minst én kobling mangler `contentHash`, så koblingen kan ikke kontrolleres mot filene selv – bare mot planen. Leveransen er uverifisert: metadataene kan stemme samtidig som filene er forvekslet. Si dette uttrykkelig til brukeren, og be om manuell gjennomgang av bildene i stedet for å omtale leveransen som kontrollert.',
}

/**
 * The final check before the files leave the agent's hands.
 *
 * A read, and the one read in the whole surface whose *argument* is the answer:
 * the agent states, per file, which plan entry it generated that file from, and
 * Slaids says whether that set of claims is the set of pictures the deck
 * planned. Nothing else in the flow can do it. Slaids never sees the files, and
 * the agent cannot check its own bookkeeping against a plan it is holding from
 * memory — which is exactly how nine pictures generated in the order 1, 3, 9,
 * 6, 5, 8, 2, 4, 7 became nine files named by arrival.
 *
 * Deliberately not a mutation and deliberately not a gate Slaids can enforce:
 * the deposit is a user action in a browser, so what this buys is that a
 * mis-binding is *discovered by the agent, before the files are handed over*,
 * with a message that names which picture to generate again. The deposit dialog
 * asks the same question of the same module when a manifest comes with the
 * files, so the two cannot disagree about what a correct delivery is.
 */
export const verifyImageHandoff = defineOperation({
  name: 'verify_image_handoff',
  summary:
    'Kontroller at hver genererte bildefil er knyttet til den bildeplanoppføringen den faktisk ble generert fra. Kjør den per bilde, rett etter at bildet er laget og før neste jobb hentes: send `imagePlanItemId` fra jobben, `fileExtension` – filendelsen filen har – og enten `contentHash`, avtrykket av bytene bildegenereringen returnerte, eller `bytesUnavailable: true` hvis vertsklienten ikke gir deg de bytene. Én av de to må være med: uten noen av dem blir oppføringen stående som ubesvart bildejobb, fordi alt annet i en kobling sto i bildeplanen fra før. Nummer, sone og filnavn henter Slaids fra bildeplanen, og `files` i svaret sier hva filen skal lagres som; har du selv holdt styr på dem, kan du sende dem, og da kontrolleres de mot planen som før. Flere oppføringer i samme kall går også an. Koblingene legges til dem dekket allerede har, så senere lesninger vet hva som er meldt: med avtrykk blir `workflow.stage` `awaiting-deposit` når hele planen er dekket, og `generation-verified` først når filene er lagt inn i sonene – det er også der avtrykkene faktisk sammenlignes med bytene. Uten avtrykk lagres koblingen, men ingenting kan noen gang sammenlignes: stadiet blir `generation-unverified`. Begge er `complete: false`, for kontrollen svarer på hva du har meldt, ikke på at bildene finnes. Å legge filene inn er brukerens steg med mindre klienten har en filbro. ' +
    IMAGE_HANDOFF_RULE,
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    images: z
      .array(
        z.strictObject({
          imagePlanItemId: z
            .string()
            .refine((value) => isImagePlanItemId(value), { message: 'Ikke en gyldig bildeplan-id' })
            .describe(
              'Id-en til bildeplanoppføringen denne filen ble generert fra, ordrett fra jobben som ga deg prompten. Aldri konstruert, aldri gjettet ut fra rekkefølgen, og ikke hentet ut av bildeplanen på nytt: mellom to genereringer leser du ikke de andre oppføringene.',
            ),
          fileExtension: z
            .string()
            .min(1)
            .describe(
              'Filendelsen filen faktisk har – `png`, `jpg`, `webp` og så videre. Slaids setter sammen navnet av oppføringens eget nummer og denne, og svarer med navnet filen skal lagres under. Du trenger ikke vite nummeret for å generere bildet, og bildejobben oppgir det derfor ikke.',
            )
            .optional(),
          number: z
            .number()
            .int()
            .min(1)
            .max(MAX_PLANNED_IMAGES)
            .describe(
              'Valgfri: oppføringens eget nummer, hvis du har holdt styr på det – ikke bildets plass i genereringsrekkefølgen. Utelatt henter Slaids det fra bildeplanen.',
            )
            .optional(),
          slideId: slideIdSchema.optional(),
          nodeId: nodeIdSchema.optional(),
          fileName: z
            .string()
            .min(1)
            .describe(
              'Valgfri: filnavnet filen fikk, hvis du alt har navngitt den. Utelatt setter Slaids det sammen av oppføringens nummer og `fileExtension`, og svaret sier hva det ble.',
            )
            .optional(),
          bytesUnavailable: z
            .literal(true)
            .optional()
            .describe(
              'Sett denne når vertsklienten ikke gir deg bytene fra sitt eget bildeverktøy, så du ikke kan regne ut et avtrykk. Oppføringen slutter da å bli tilbudt som bildejobb, leveransen står som uverifisert for godt, og brukeren bekrefter bildene manuelt i deponeringen. Den er en erklæring, ikke et bevis – bruk den bare når bildet faktisk er laget.',
            ),
          contentHash: z
            .string()
            .regex(/^[0-9a-f]{64}$/)
            .optional()
            .describe(
              'SHA-256 (lowercase hex) av bytene bildegenereringen returnerte for akkurat denne oppføringen. Regn den ut i det filen kommer tilbake, før neste bilde genereres – et avtrykk beregnet etterpå fra en mappe med ferdige filer fester bare en forveksling som allerede har skjedd. Utelat feltet hvis du ikke har tilgang til bytene; leveransen blir da rapportert som uverifisert, aldri som kontrollert.',
            ),
        })
          .refine((image) => image.fileName !== undefined || image.fileExtension !== undefined, {
            message:
              'Oppgi enten `fileExtension` – så setter Slaids sammen filnavnet – eller `fileName` hvis du alt har navngitt filen.',
          })
          /*
           * One of the two, never both and never neither. A binding that says
           * nothing about the bytes is a row that could have been written off
           * the plan, and it would leave the entry in the queue for ever; a
           * binding that says both is claiming a digest it has just said it
           * could not compute.
           */
          .refine(
            (image) =>
              (image.contentHash === undefined) !== (image.bytesUnavailable === undefined),
            {
              message:
                'Oppgi `contentHash` – SHA-256 av bytene bildegenereringen returnerte – eller `bytesUnavailable: true` hvis vertsklienten ikke gir deg bytene. Én av dem, ikke begge: uten noen av dem har Slaids ingenting som skiller en generert fil fra en rad skrevet av bildeplanen, og oppføringen blir stående som ubesvart bildejobb.',
            },
          ),
      )
      .max(MAX_PLANNED_IMAGES)
      .describe('Én oppføring per ferdig bildefil. Rekkefølgen her betyr ingenting.'),
  }),
  run(context, input): Promise<AgentResult<GeneratedImagesView>> {
    return mutatePresentation(context, input, (presentation) => {
      /*
       * Everything but the id and the digest is filled in from the plan when
       * the caller leaves it out, and that is what lets a generation job be an
       * opaque id, a format and a prompt.
       *
       * The number, the zone and the file name are facts about a *set* — «the
       * third one», «the one on that slide» — so a host whose image tool reads
       * the conversation rather than an explicit prompt would have them in
       * context at the moment it generates. They are not needed to make a
       * picture, only to file one, so they are asked for afterwards or derived
       * here. A caller that tracked them may still send them: then they are
       * checked against the plan exactly as before, which is the cross-check
       * that catches a delivery named by arrival order.
       */
      const plan = new Map(resolveImagePlan(presentation).map((image) => [image.id, image]))
      const completed = input.images.map((image) => {
        const entry = plan.get(image.imagePlanItemId)
        const extension = image.fileExtension?.replace(/^\./, '').toLowerCase()
        return {
          imagePlanItemId: image.imagePlanItemId,
          number: image.number ?? entry?.number ?? 0,
          slideId: image.slideId ?? entry?.plan.slideId ?? '',
          nodeId: image.nodeId ?? entry?.plan.nodeId ?? '',
          fileName:
            image.fileName ??
            (entry && extension ? `${entry.fileNameStem}.${extension}` : (image.fileName ?? '')),
          ...(image.contentHash ? { contentHash: image.contentHash } : {}),
          ...(image.bytesUnavailable ? { bytesUnavailable: true as const } : {}),
        }
      })
      /*
       * `MISSING_ITEM` is set apart from everything else this check reports,
       * and that is what makes the flow sequential. The others are things
       * wrong with the bindings in *this* call — an unknown id, a duplicate, a
       * zone that is not the entry's — and they refuse it. A missing entry is
       * the plan waiting for a job that has not been generated yet, which is
       * the normal state of every call but the last one.
       */
      const outstanding = checkGeneratedImages(presentation, completed)
      const issues = outstanding.filter((issue) => issue.code !== 'MISSING_ITEM')
      const check = imageBindingCheck(completed)
      /*
       * A check that passes is written down, and that is what makes this a
       * mutation at all. Slaids never sees a generated file, so the deck cannot
       * observe generation on its own: an answer that lived only in this
       * response would be gone by the next read, and the very next
       * `get_image_brief` on an unchanged deck would ask for every picture
       * again — the duplicate generation the flow's own rules forbid.
       *
       * Only on success. Storing a set that did not check out would be the
       * false reassurance this operation exists to remove, and the command
       * refuses it independently for that reason.
       */
      const recorded = issues.length === 0 ? recordGeneratedImages(presentation, completed) : null
      if (recorded && !recorded.ok) return recorded
      const written = recorded?.value ?? presentation
      /*
       * The manifest is the *stored* set, not this call's argument. It is what
       * travels to the deposit beside the files, and the deposit accepts
       * 1‥N — so it can only be written once the last job is bound, and it has
       * to carry every binding rather than the one that happened to be checked
       * last.
       */
      const stored = plannedGeneratedImages(written)
      const planCovered =
        stored.length > 0 && checkGeneratedImages(written, stored).length === 0
      return ok({
        presentation: written,
        value: {
          presentationId: written.id,
          revision: presentationRevision(written),
          ok: issues.length === 0,
          check,
          checkMeans: CHECK_MEANS[check],
          issues,
          planCovered,
          expected: issues.length === 0 ? [] : expectedGeneratedImages(written),
          files: completed.map((record) => ({
            imagePlanItemId: record.imagePlanItemId,
            fileName: record.fileName,
          })),
          manifestFileName: IMAGE_MANIFEST_FILE_NAME,
          manifest:
            issues.length === 0 && planCovered
              ? composeImageGenerationManifest({
                  presentationId: written.id,
                  images: stored,
                })
              : null,
          workflow: composeImageWorkflowStatus(written),
        },
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
  getNextImageJob,
  verifyImageHandoff,
  inspectSlide,
]
