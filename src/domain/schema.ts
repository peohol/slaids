/**
 * Runtime schema for everything that is persisted or imported.
 *
 * Zod validates the *shape*; the layout tree's structural invariants
 * (`children.length === weights.length`, 2..10 children, ...) are validated by
 * `validateTree` so the two concerns stay separate and both stay readable.
 */

import { z } from 'zod'
import { FONT_SCALE_RANGE, SPACING_RANGE } from './metrics'
import {
  INTERACTIVE_STYLE_CONTRACTS,
  MAX_IMAGE_CONTEXT_CHARS,
  MAX_PLANNED_IMAGES,
  MAX_PLANNED_IMAGE_FIELD_CHARS,
  PLANNED_IMAGE_FIELDS,
  REQUIRED_PLANNED_IMAGE_FIELDS,
  plannedImageFieldIsBlank,
  MAX_SPLIT_CHILDREN,
  MAX_ZONE_RATIO,
  MIN_SPLIT_CHILDREN,
  MIN_ZONE_RATIO,
} from './constants'
import { validateTree } from './layout'
import { quantizeStoredRatios } from './ratios'
import { interactiveBudgetRefusal, storedInteractiveRefusal } from './interactive'
import type { LayoutNode, Presentation, RichNode } from './types'

export const CURRENT_SCHEMA_VERSION = 16

const hexColor = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, 'Ugyldig fargeverdi')
const axisSchema = z.union([z.literal('x'), z.literal('y')])

const richMarkSchema = z.object({
  type: z.string(),
  attrs: z.record(z.string(), z.unknown()).optional(),
})

export const richNodeSchema: z.ZodType<RichNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(richNodeSchema).optional(),
    marks: z.array(richMarkSchema).optional(),
    text: z.string().optional(),
  }),
)

export const richDocSchema = z.object({
  type: z.literal('doc'),
  content: z.array(richNodeSchema).optional(),
})

export const verticalAlignSchema = z.enum(['top', 'middle', 'bottom'])

export const subfieldSchema = z.object({
  id: z.string().min(1),
  doc: richDocSchema,
  verticalAlign: verticalAlignSchema.optional(),
})

export const cardBodySchema = z
  .object({
    axis: axisSchema,
    weights: z.array(z.number().finite().positive()).min(1),
    subfields: z.array(subfieldSchema).min(1),
  })
  .refine((body) => body.weights.length === body.subfields.length, {
    message: 'Antall vekter må matche antall subfelt',
  })

export const captionPositionSchema = z.enum(['top', 'middle', 'bottom'])

export const imageCaptionSchema = z.object({
  doc: richDocSchema,
  position: captionPositionSchema,
  color: hexColor.nullable(),
})

/**
 * The crop is a *view* onto the file, so both coordinates are bounded: a focus
 * outside 0..1 would frame a part of the picture that does not exist.
 */
export const imagePanelSchema = z.object({
  assetId: z.string().min(1).nullable(),
  focus: z.object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  }),
  caption: imageCaptionSchema.nullable(),
})

export const zoneContentSchema = z.discriminatedUnion('kind', [
  /* Deliberate air. An id and a kind and nothing else — «no payload» is what
     this content *is*, so the shape says so rather than leaving room for one.
     Adding a member to this union needs no migration: no document that exists
     changes shape, and a stored empty leaf is still `content: null`, which is
     the other, older thing and stays it. */
  z.object({
    id: z.string().min(1),
    kind: z.literal('negative-space'),
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('container'),
    body: cardBodySchema,
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('untitled-card'),
    backgroundColor: hexColor,
    body: cardBodySchema,
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('titled-card'),
    headerColor: hexColor.nullable(),
    title: richDocSchema,
    body: cardBodySchema,
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('image'),
    image: imagePanelSchema,
  }),
  z.object({
    id: z.string().min(1),
    kind: z.literal('titled-image-card'),
    headerColor: hexColor.nullable(),
    title: richDocSchema,
    image: imagePanelSchema,
  }),
])

export const layoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([
    z.object({
      id: z.string().min(1),
      kind: z.literal('leaf'),
      content: zoneContentSchema.nullable(),
    }),
    z.object({
      id: z.string().min(1),
      kind: z.literal('split'),
      axis: axisSchema,
      /* Whole ratios, not any positive number: what a finished layout is
         stored with is the ladder an author can read back and type in again.
         Decimals from before the rule are quantised by the migration chain, so
         nothing that was readable becomes unopenable — see `migrate11to12`. */
      weights: z
        .array(z.number().int().min(MIN_ZONE_RATIO).max(MAX_ZONE_RATIO))
        .min(MIN_SPLIT_CHILDREN)
        .max(MAX_SPLIT_CHILDREN),
      children: z.array(layoutNodeSchema).min(MIN_SPLIT_CHILDREN).max(MAX_SPLIT_CHILDREN),
    }),
  ]),
)

export const contentSlideSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('content'),
  title: richDocSchema.nullable(),
  root: layoutNodeSchema,
})

/**
 * A section slide.
 *
 * Two documents and two colours — no layout and no alignment: a section is
 * always centred, and the colours are the defaults it hands to every page from
 * itself up to the next section.
 */
export const sectionSlideSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('section'),
  title: richDocSchema,
  subtitle: richDocSchema,
  accentColor: hexColor,
  backgroundColor: hexColor,
})

/**
 * An interactive slide.
 *
 * Strings and nothing else: no layout tree, no title zone, no colours of its
 * own — it is drawn in the governing section's. `html` is a bounded field for
 * exactly this kind, never an extension of the rich-text model.
 *
 * The shape is here; what the strings may *contain* is
 * `storedInteractiveRefusal` in `domain/interactive.ts`, asked by
 * `validatePresentation` below in the same breath as the layout-tree
 * invariants. Both halves are checked on every load, and neither is restated:
 * a stored slide meets exactly what a command demands because it is asked the
 * command's own question.
 */
export const interactiveSlideSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('interactive'),
  name: z.string(),
  fileName: z.string(),
  html: z.string(),
  /* Read from the list rather than written out, so adding a version is one
     edit in `constants.ts` and not two that can disagree. */
  styleContract: z.literal([...INTERACTIVE_STYLE_CONTRACTS]),
})

export const slideSchema = z.discriminatedUnion('kind', [
  contentSlideSchema,
  sectionSlideSchema,
  interactiveSlideSchema,
])

export const themeSchema = z.object({
  headingFontFamily: z.string().min(1),
  bodyFontFamily: z.string().min(1),
  spacing: z.number().finite().min(SPACING_RANGE.min).max(SPACING_RANGE.max),
  fontScale: z.number().finite().min(FONT_SCALE_RANGE.min).max(FONT_SCALE_RANGE.max),
})

export const referenceSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  authors: z.string(),
  url: z.string(),
  year: z.string(),
})

export const sandboxItemSchema = z.object({
  id: z.string().min(1),
  content: zoneContentSchema,
  createdAt: z.string(),
  note: z.string(),
})

/**
 * One ordered list, one level deep: a category is a row beside the loose ideas
 * and holds ideas only. The nesting rule is in the shape rather than in a
 * separate check, so a category holding a category cannot validate.
 */
export const ideaSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('idea'),
  text: z.string(),
})

export const ideaCategorySchema = z.object({
  id: z.string().min(1),
  kind: z.literal('category'),
  text: z.string(),
  color: hexColor,
  ideas: z.array(ideaSchema),
})

export const ideaRowSchema = z.union([ideaSchema, ideaCategorySchema])

export const assetRefSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int().nonnegative(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
  isVector: z.boolean(),
  /* Optional, and no schema version bump: a reference without it is a file
     nobody has hashed yet, not an older kind of document. See `assetHash.ts`. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
})

/**
 * One planned picture: the zone it is for, and the four things the brief says
 * about it. See `domain/imagePlan.ts`.
 *
 * The motif and the composition are required *here* as well as on the command
 * that writes them, and that is not defensive duplication between internal
 * layers: this is the other system boundary. A `.slaids` archive is a file a
 * person can edit, so without it a document could arrive carrying a plan the
 * normal write path would have refused — and generate a brief with a picture
 * that shows nothing. Which fields those are is `REQUIRED_PLANNED_IMAGE_FIELDS`,
 * asked rather than restated, so the two cannot come to disagree.
 */
const requiredPlanField = z
  .string()
  .max(MAX_PLANNED_IMAGE_FIELD_CHARS)
  .refine((value) => !plannedImageFieldIsBlank(value), { message: 'Feltet kan ikke være tomt' })

const optionalPlanField = z.string().max(MAX_PLANNED_IMAGE_FIELD_CHARS)

function planField(name: (typeof PLANNED_IMAGE_FIELDS)[number]) {
  return REQUIRED_PLANNED_IMAGE_FIELDS.includes(name) ? requiredPlanField : optionalPlanField
}

export const plannedImageSchema = z.object({
  slideId: z.string().min(1),
  nodeId: z.string().min(1),
  subject: planField('subject'),
  composition: planField('composition'),
  requirements: planField('requirements'),
  avoid: planField('avoid'),
})

export const presentationSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string(),
  folderId: z.string().nullable(),
  /* Optional: a document without it is a deck nobody has written a shared
     image context for, not an older kind of document — the same reason
     `AssetRef.contentHash` is optional. See `Presentation.imageContext`. */
  imageContext: z.string().max(MAX_IMAGE_CONTEXT_CHARS).optional(),
  /* Optional for the same reason, and bounded for the reason every editorial
     field on the document is: it rides inside the presentation on every save.
     Whether an entry still points at a picture zone is *not* asked here —
     that is a question about the slides, and `checkImagePlan` answers it, so a
     deck whose tree was re-split stays openable and reports the mismatch
     instead of failing validation. */
  imagePlan: z.array(plannedImageSchema).max(MAX_PLANNED_IMAGES).optional(),
  theme: themeSchema,
  /* At least one slide, and the first one is a section. The refinement is the
     runtime half of `DeckSlides`: it is the only place a stored document is
     asked the question, and everything downstream is typed as though it can
     only have been answered yes. */
  slides: z
    .array(slideSchema)
    .min(1)
    .refine((slides) => slides[0]?.kind === 'section', {
      message: 'Første slide må være en seksjon',
    }),
  references: z.array(referenceSchema),
  sandbox: z.array(sandboxItemSchema),
  ideas: z.array(ideaRowSchema),
  assets: z.array(assetRefSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const folderSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.string(),
})

export const layoutTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  hasTitle: z.boolean(),
  root: layoutNodeSchema,
  createdAt: z.string(),
})

export const clipboardPayloadSchema = z.object({
  format: z.literal('application/x-slaids-content'),
  version: z.literal(1),
  content: zoneContentSchema,
  assets: z.array(assetRefSchema),
})

export const slaidsFileManifestSchema = z.object({
  format: z.literal('slaids-backup'),
  version: z.literal(1),
  exportedAt: z.string(),
  presentationCount: z.number().int().nonnegative(),
})

export type ValidationIssue = { path: string; message: string }

export interface SchemaResult<T> {
  ok: boolean
  value?: T
  issues: ValidationIssue[]
}

function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }))
}

/** Validate a presentation, including layout-tree invariants. */
export function validatePresentation(input: unknown): SchemaResult<Presentation> {
  const parsed = presentationSchema.safeParse(input)
  if (!parsed.success) return { ok: false, issues: toIssues(parsed.error) }

  const issues: ValidationIssue[] = []
  parsed.data.slides.forEach((slide, index) => {
    if (slide.kind === 'interactive') {
      const refusal = storedInteractiveRefusal(slide)
      if (refusal) issues.push({ path: `slides.${index}`, message: refusal.error.message })
      return
    }
    if (slide.kind !== 'content') return
    for (const violation of validateTree(slide.root)) {
      issues.push({ path: `slides.${index}.root.${violation.nodeId}`, message: violation.message })
    }
  })
  /*
   * The deck-wide budget, which no single slide can be measured against: every
   * miniapp can be inside the per-file limit while the document as a whole is
   * larger than the transports that have to carry it. A `.slaids` archive is
   * the door this closes — it is written by hand as easily as by Slaids, and it
   * reaches the repository without passing a command.
   */
  const overBudget = interactiveBudgetRefusal({ slides: parsed.data.slides }, 0)
  if (overBudget) issues.push({ path: 'slides', message: overBudget.error.message })
  if (issues.length > 0) return { ok: false, issues }
  // The refinement above is what makes this cast a statement of fact rather
  // than a hope: a `slides` array that reached here opens with a section.
  return { ok: true, value: parsed.data as unknown as Presentation, issues: [] }
}

/**
 * Validate a stored template, repairing the one thing about it that changed.
 *
 * A template is layout and nothing else, and it carries no `schemaVersion` to
 * migrate on — so this, the single gate every reader and writer of a template
 * passes through, is where a template saved before whole ratios were the rule
 * gets rewritten in them. Callers must therefore keep `value`, not the object
 * they passed in: dropping a template from the list because its ratios were
 * written the old way would delete work over a number nobody typed.
 */
export function validateLayoutTemplate(input: unknown): SchemaResult<z.infer<typeof layoutTemplateSchema>> {
  const parsed = layoutTemplateSchema.safeParse(quantizeStoredRatios(input))
  if (!parsed.success) return { ok: false, issues: toIssues(parsed.error) }
  const issues = validateTree(parsed.data.root).map((violation) => ({
    path: violation.nodeId,
    message: violation.message,
  }))
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: parsed.data, issues: [] }
}

export function validateClipboardPayload(
  input: unknown,
): SchemaResult<z.infer<typeof clipboardPayloadSchema>> {
  const parsed = clipboardPayloadSchema.safeParse(input)
  if (!parsed.success) return { ok: false, issues: toIssues(parsed.error) }
  return { ok: true, value: parsed.data, issues: [] }
}
