/**
 * The presentation's theme: what the whole deck is drawn in.
 *
 * A theme is five values and one command. `setTheme` already owns all of
 * them — it normalises the colour, refuses an empty font, bounds the two scales
 * and re-measures the deck against the *prospective* theme — so this file
 * translates names and does nothing else. There is no validation here, no
 * clamping, and no second idea of what a legal theme is.
 *
 * Four things about the contract are decisions rather than plumbing:
 *
 *  - **Reading is part of `get_presentation`, not a `get_theme`.** The theme is
 *    global, small, and needed by anything that plans a slide. An agent that has
 *    read the presentation has read its theme, and a second read-only operation
 *    would be one more call for something already in hand.
 *  - **Fonts are catalogue ids, not CSS stacks.** `domain/fonts.ts` is the one
 *    catalogue, the editor's chooser is built from it, and the published JSON
 *    Schema is an enum generated from it — so the valid choices are discoverable
 *    from `tools/list` and cannot drift from the ones a person can pick. The
 *    stored value is still the stack; the id is the name it goes by.
 *  - **The scales are the domain's interval, not the chooser's four buttons.**
 *    `SPACING_RANGE` and `FONT_SCALE_RANGE` are the real limits, and the fit
 *    guard decides what is usable inside them: an agent that wants 1.12 has
 *    asked for something legal, and refusing it here would be a rule the domain
 *    does not have. The four named settings are quoted in the description —
 *    from `SPACING_PRESETS` and `FONT_SCALE_PRESETS`, so the vocabulary an agent
 *    is told is the vocabulary the editor shows — as a way to say "normal",
 *    never as the only values accepted.
 *  - **The background is any hex colour**, exactly like `set_cover_color`. The
 *    editor's swatch grid is a way to click a colour, not a restriction the
 *    domain has.
 *
 * ### Web fonts and headless measurement
 *
 * A font decides how much text fits, so "which font was this approved against?"
 * has to have one answer. It does, and it is not the same mechanism in the two
 * places:
 *
 *  - **In the browser** the fit gate measures the real DOM, so the answer is
 *    whichever face is loaded at that moment. That is why `ThemeModal` waits for
 *    `ensureWebFonts` before it calls `setTheme`: measured mid-download, a theme
 *    would be approved against the fallback and then drawn in something else.
 *  - **Headless — which is every agent call** — nothing is measured. The
 *    estimator reads `advanceRatioFor(stack)`, a number the catalogue states for
 *    *that* font, and it is the same number whether the font's bytes ever arrive
 *    or not. There is therefore no fallback to be approved against and nothing
 *    to wait for: `set_theme` and a later `render_slide_preview` judge the same
 *    named font. Restricting the input to catalogue ids is what guarantees it —
 *    a stack from outside the catalogue would fall back to
 *    `DEFAULT_ADVANCE_RATIO`, which describes no particular font and would be
 *    exactly the drift this avoids.
 *
 * The renderer says the other half out loud: a preview reports `fontsReady`, so
 * an agent looking at a picture knows whether the glyphs in it are the deck's
 * own or a stand-in the network cost it.
 */

import { z } from 'zod'
import { setTheme } from '../../domain/commands'
import { FONT_IDS, findFontByStack, fontStackFor, type FontId } from '../../domain/fonts'
import {
  FONT_SCALE_PRESETS,
  FONT_SCALE_RANGE,
  SPACING_PRESETS,
  SPACING_RANGE,
  type ThemeScalePreset,
} from '../../domain/metrics'
import { ok } from '../../domain/result'
import type { PresentationTheme } from '../../domain/types'
import { defineOperation, expectedRevisionSchema, presentationIdSchema } from '../operation'
import { mutatePresentation, structuralOptions } from '../presentation'
import type { AgentResult } from '../types'

/* ------------------------------------------------------------------ *
 * The theme, as an agent reads it
 * ------------------------------------------------------------------ */

/**
 * One of the two font choices.
 *
 * `fontId` is what `set_theme` takes back; `stack` is what the document stores.
 * A deck whose stack is not in the catalogue — an older document, or one
 * imported from a Slaids that offered a font this one does not — reports
 * `fontId: null` rather than the nearest guess: the agent can then see that it
 * cannot reproduce the current font, only replace it.
 */
export interface ThemeFontView {
  fontId: FontId | null
  label: string
  /** The CSS font stack the presentation stores, fallbacks included. */
  stack: string
}

export interface ThemeView {
  backgroundColor: string
  headingFont: ThemeFontView
  bodyFont: ThemeFontView
  /** Luft: one multiplier on every distance in the deck. */
  spacing: number
  /** Skriftstørrelse: one multiplier on every type size in the deck. */
  fontScale: number
}

function fontView(stack: string): ThemeFontView {
  const font = findFontByStack(stack)
  return { fontId: font?.id ?? null, label: font?.label ?? stack, stack }
}

export function themeView(theme: PresentationTheme): ThemeView {
  return {
    backgroundColor: theme.backgroundColor,
    headingFont: fontView(theme.headingFontFamily),
    bodyFont: fontView(theme.bodyFontFamily),
    spacing: theme.spacing,
    fontScale: theme.fontScale,
  }
}

/* ------------------------------------------------------------------ *
 * set_theme
 * ------------------------------------------------------------------ */

/** «tett 0.75, normal 1, …» — the chooser's own vocabulary, from its own list. */
function presetHint(presets: readonly ThemeScalePreset[]): string {
  return presets.map((preset) => `${preset.label.toLowerCase()} ${preset.value}`).join(', ')
}

const fontIdSchema = z.enum(FONT_IDS)

export const setThemeOperation = defineOperation({
  name: 'set_theme',
  summary:
    'Sett presentasjonens tema: bakgrunnsfarge, font for titler, font for brødtekst, luft og skriftstørrelse. Temaet er globalt – enkeltslides kan ikke avvike. Alt måles på nytt mot hele dekket, og en endring som ville skjult innhold avvises med CONTENT_DOES_NOT_FIT uten at noe lagres. Utelatte felter beholder verdien de har.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    backgroundColor: z
      .string()
      .optional()
      .describe(
        'Hex-farge for hele dekket, for eksempel «#101828». Tekstfargen utledes av kontrast og settes ikke.',
      ),
    headingFont: fontIdSchema
      .optional()
      .describe('Fonten titler, overskrifter og kortheadere settes i. En id fra fontkatalogen.'),
    bodyFont: fontIdSchema.optional().describe('Fonten brødteksten settes i.'),
    spacing: z
      .number()
      .min(SPACING_RANGE.min)
      .max(SPACING_RANGE.max)
      .optional()
      .describe(
        `Luft: én multiplikator på alle avstander – gapet mellom soner, polstringen i kort, avstanden mellom subfelt og mellom tekstblokker. Editorens trinn: ${presetHint(SPACING_PRESETS)}. Alt mellom ${SPACING_RANGE.min} og ${SPACING_RANGE.max} er lov.`,
      ),
    fontScale: z
      .number()
      .min(FONT_SCALE_RANGE.min)
      .max(FONT_SCALE_RANGE.max)
      .optional()
      .describe(
        `Skriftstørrelse: én multiplikator på all typografi, inkludert tittelsonen og kortheaderen. Editorens trinn: ${presetHint(FONT_SCALE_PRESETS)}. Alt mellom ${FONT_SCALE_RANGE.min} og ${FONT_SCALE_RANGE.max} er lov.`,
      ),
  }),
  run(context, input): Promise<AgentResult<{ presentationId: string; theme: ThemeView }>> {
    return mutatePresentation(context, input, (presentation) => {
      // One command for all five fields, which is what makes the change atomic
      // in the only sense that matters here: a bigger type size that hides text
      // is refused *together with* the colour that came with it, so a deck never
      // ends up half-way into a theme nobody asked for.
      const themed = setTheme(presentation, patchFrom(input), structuralOptions(context))
      if (!themed.ok) return themed
      return ok({
        presentation: themed.value,
        value: { presentationId: presentation.id, theme: themeView(themed.value.theme) },
      })
    })
  },
})

/** The domain's own field names, for the fields the caller actually sent. */
function patchFrom(input: {
  backgroundColor?: string
  headingFont?: FontId
  bodyFont?: FontId
  spacing?: number
  fontScale?: number
}): Partial<PresentationTheme> {
  return {
    ...(input.backgroundColor === undefined ? {} : { backgroundColor: input.backgroundColor }),
    ...(input.headingFont === undefined
      ? {}
      : { headingFontFamily: fontStackFor(input.headingFont) }),
    ...(input.bodyFont === undefined ? {} : { bodyFontFamily: fontStackFor(input.bodyFont) }),
    ...(input.spacing === undefined ? {} : { spacing: input.spacing }),
    ...(input.fontScale === undefined ? {} : { fontScale: input.fontScale }),
  }
}

export const themeOperations = [setThemeOperation]
