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
  MAX_SPLIT_CHILDREN,
  MAX_ZONE_RATIO,
  MIN_SPLIT_CHILDREN,
  MIN_ZONE_RATIO,
} from './constants'
import { validateTree } from './layout'
import { quantizeStoredRatios } from './ratios'
import type { LayoutNode, Presentation, RichNode } from './types'

export const CURRENT_SCHEMA_VERSION = 12

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

export const slideSchema = z.object({
  id: z.string().min(1),
  title: richDocSchema.nullable(),
  root: layoutNodeSchema,
})

/**
 * The cover.
 *
 * Two documents and a colour — no layout, no alignment and no id: there is
 * exactly one cover per deck, it is always centred, and nothing addresses it by
 * id because nothing can move it.
 */
export const coverSchema = z.object({
  title: richDocSchema,
  subtitle: richDocSchema,
  pillColor: hexColor,
})

export const themeSchema = z.object({
  backgroundColor: hexColor,
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
})

export const presentationSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string(),
  folderId: z.string().nullable(),
  theme: themeSchema,
  cover: coverSchema,
  slides: z.array(slideSchema).min(1),
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
    for (const violation of validateTree(slide.root)) {
      issues.push({ path: `slides.${index}.root.${violation.nodeId}`, message: violation.message })
    }
  })
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: parsed.data as Presentation, issues: [] }
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
