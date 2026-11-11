/**
 * The presentation's theme: what the whole deck is drawn in.
 *
 * A theme is a handful of values and one command. `setTheme` already owns all of
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
 *  - **Fonts are catalogue ids, not CSS stacks**, and only the guaranteed ones.
 *    `domain/fonts.ts` is the one catalogue and the published JSON Schema is an
 *    enum generated from it, so the valid choices are discoverable from
 *    `tools/list` and cannot drift. The list is the *web fonts* — the ones
 *    Slaids fetches itself — because those are the ones a headless renderer can
 *    also be given; see "Web fonts" below. The stored value is still the stack;
 *    the id is the name it goes by.
 *  - **The scales are the domain's interval, not the chooser's four buttons.**
 *    `SPACING_RANGE` and `FONT_SCALE_RANGE` are the real limits, and the fit
 *    guard decides what is usable inside them: an agent that wants 1.12 has
 *    asked for something legal, and refusing it here would be a rule the domain
 *    does not have. The four named settings are quoted in the description —
 *    from `SPACING_PRESETS` and `FONT_SCALE_PRESETS`, so the vocabulary an agent
 *    is told is the vocabulary the editor shows — as a way to say "normal",
 *    never as the only values accepted.
 *  - **A colour is any hex value**, exactly like `set_section_colors`. The
 *    editor's swatch grid is a way to click a colour, not a restriction the
 *    domain has.
 *
 * ### Web fonts, headless measurement, and what a preview can promise
 *
 * A font decides how much text fits, so "which font was this approved against?"
 * has to have one answer — and the picture an agent then looks at has to be in
 * that same font. Three mechanisms, and they only agree because the input is
 * restricted:
 *
 *  - **In the browser** the fit gate measures the real DOM, so the answer is
 *    whichever face is loaded at that moment. That is why `ThemeModal` waits for
 *    `ensureWebFonts` before it calls `setTheme`: measured mid-download, a theme
 *    would be approved against the fallback and then drawn in something else.
 *  - **Headless — which is every agent call** — nothing is measured. The
 *    estimator reads `advanceRatioFor(stack)`, a number the catalogue states for
 *    *that* font, and it is the same number whether the font's bytes ever arrive
 *    or not. So a fit answer always describes the font that was named.
 *  - **A rendered preview** is drawn by a headless Chromium, which has the faces
 *    Slaids handed it and nothing else. A local font — Calibri, Segoe UI, Times
 *    New Roman — is one Slaids cannot hand anybody: there is nothing to fetch,
 *    so the fetch trivially succeeds, the rasterizer has no family to wait for,
 *    and the container silently substitutes. The fit answer would then describe
 *    Calibri while the picture showed something else, and `fontsReady` would say
 *    the picture was fine.
 *
 * That last case is why `set_theme` publishes `GUARANTEED_FONT_IDS` rather than
 * the whole catalogue: an agent cannot choose a font whose preview would be a
 * quiet substitution. A deck can still *hold* one, because a person can pick it
 * in the editor, so both other ends stay honest about it — the reading marks it
 * `guaranteed: false`, and `render_slide_preview` reports `fontsReady: false`
 * with a warning naming it, rather than a picture that claims to be the deck's
 * own type.
 */

import { z } from 'zod'
import { removeThemeLogo, setTheme, setThemeLogo, updateThemeLogo } from '../../domain/commands'
import {
  GUARANTEED_FONT_IDS,
  findFontByStack,
  fontStackFor,
  isGuaranteedFont,
  type FontId,
} from '../../domain/fonts'
import {
  FONT_SCALE_PRESETS,
  FONT_SCALE_RANGE,
  geometryForTheme,
  SPACING_PRESETS,
  SPACING_RANGE,
  type ThemeScalePreset,
} from '../../domain/metrics'
import {
  LOGO_MIN_HEIGHT,
  LOGO_SECTION_PLACEMENTS,
  LOGO_SECTION_VISIBILITIES,
  LOGO_SLIDE_POSITIONS,
  SLIDE_HEIGHT,
  TITLED_CARD_STYLES,
  type LogoSectionPlacement,
  type LogoSectionVisibility,
  type LogoSlidePosition,
  type TitledCardStyle,
} from '../../domain/constants'
import type { LogoReservation } from '../../domain/geometry'
import { deckLogoLayout, type LogoDeck, type ThemeLogoPatch } from '../../domain/logo'
import { ok, type Result } from '../../domain/result'
import type { Presentation, PresentationTheme } from '../../domain/types'
import { assetIdSchema, defineOperation, expectedRevisionSchema, presentationIdSchema } from '../operation'
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
 *
 * `guaranteed` is the same distinction one step further out, and it is reported
 * rather than hidden because a deck an agent did not create can be set in a
 * font it cannot choose: a person picked Calibri in the editor, where it is a
 * perfectly good choice. The agent then knows two things it would otherwise
 * find out the hard way — that `set_theme` will not take this font back, and
 * that a preview of this deck is not drawn in it.
 */
export interface ThemeFontView {
  fontId: FontId | null
  label: string
  /** The CSS font stack the presentation stores, fallbacks included. */
  stack: string
  /** Whether Slaids can draw this font anywhere, so a preview really shows it. */
  guaranteed: boolean
}

export interface ThemeView {
  headingFont: ThemeFontView
  bodyFont: ThemeFontView
  /** Luft: one multiplier on every distance in the deck. */
  spacing: number
  /** Skriftstørrelse: one multiplier on every type size in the deck. */
  fontScale: number
  /** Om kort, bilder, inndelingspiller og miniapp-rammer kaster skygge. */
  boxShadows: boolean
  /** Hvordan et kort med tittel tegner tittelen. */
  titledCardStyle: TitledCardStyle
  /**
   * Logoen i temaet, eller `null` uten logo. Den settes med `set_theme_logo`,
   * eller i editorens temaeditor; her leses den, så det er tydelig hvorfor
   * sonene har mindre plass.
   */
  logo: ThemeLogoView | null
}

/**
 * Logoen slik dekket tegner den. `height` er ønsket som er lagret;
 * `drawnHeight` er det som faktisk tegnes – aldri mer enn det alle sidene i
 * gruppen har plass til, og `null` når logoen ikke står i gruppen i det hele
 * tatt (slått av, eller ikke plass til minstemålet).
 */
export interface ThemeLogoView {
  assetId: string
  /** Bredde delt på høyde, fra filen. */
  aspect: number
  sections: {
    visibility: LogoSectionVisibility
    placement: LogoSectionPlacement
    height: number
    drawnHeight: number | null
  }
  slides: {
    visible: boolean
    position: LogoSlidePosition
    height: number
    drawnHeight: number | null
    /**
     * Stripen logoen tar langs én kant av innholdsområdet på hver vanlig
     * slide, inkludert gapet til tittel og hovedsone. Rektanglene
     * `inspect_slide` gir, er allerede regnet uten den.
     */
    reservedEdge: LogoReservation['edge'] | null
    reservedSize: number | null
  }
}

function logoView(deck: LogoDeck): ThemeLogoView | null {
  const logo = deck.theme.logo
  if (!logo) return null
  const layout = deckLogoLayout(deck)
  const reservation = layout?.slides?.reservation ?? null
  return {
    assetId: logo.assetId,
    aspect: logo.aspect,
    sections: { ...logo.sections, drawnHeight: layout?.sections?.height ?? null },
    slides: {
      ...logo.slides,
      drawnHeight: layout?.slides?.height ?? null,
      reservedEdge: reservation?.edge ?? null,
      reservedSize: reservation ? reservation.size + geometryForTheme(deck.theme).gap : null,
    },
  }
}

function fontView(stack: string): ThemeFontView {
  const font = findFontByStack(stack)
  return {
    fontId: font?.id ?? null,
    label: font?.label ?? stack,
    stack,
    guaranteed: font !== undefined && isGuaranteedFont(font),
  }
}

/** Temaet til et dekk. Hele dekket, fordi logoens størrelse avhenger av slidene. */
export function themeView(deck: LogoDeck): ThemeView {
  const { theme } = deck
  return {
    headingFont: fontView(theme.headingFontFamily),
    bodyFont: fontView(theme.bodyFontFamily),
    spacing: theme.spacing,
    fontScale: theme.fontScale,
    boxShadows: theme.boxShadows,
    titledCardStyle: theme.titledCardStyle,
    logo: logoView(deck),
  }
}

/* ------------------------------------------------------------------ *
 * set_theme
 * ------------------------------------------------------------------ */

/** «tett 0.75, normal 1, …» — the chooser's own vocabulary, from its own list. */
function presetHint(presets: readonly ThemeScalePreset[]): string {
  return presets.map((preset) => `${preset.label.toLowerCase()} ${preset.value}`).join(', ')
}

/**
 * The fonts an agent may pick: the catalogue's guaranteed half, generated.
 *
 * Not the whole catalogue. The editor's local fonts are ones Slaids cannot hand
 * a renderer, so choosing one would mean a preview drawn in a substitute while
 * the fit answer described the font that was asked for.
 */
const fontIdSchema = z.enum(GUARANTEED_FONT_IDS)

/** «quicksand, atkinson, …» — the choices, in the description as well as the enum. */
const fontChoices = GUARANTEED_FONT_IDS.join(', ')

export const setThemeOperation = defineOperation({
  name: 'set_theme',
  summary:
    'Sett presentasjonens tema: font for titler, font for brødtekst, luft, skriftstørrelse, skygger og utseendet på kort med tittel. Temaet er globalt – enkeltslides kan ikke avvike. Farger er ikke her: de settes per inndeling med set_section_colors, og arves av slidene fram til neste inndeling. Alt måles på nytt mot hele dekket, og en endring som ville skjult innhold avvises med CONTENT_DOES_NOT_FIT uten at noe lagres. Utelatte felter beholder verdien de har.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    headingFont: fontIdSchema
      .optional()
      .describe(
        `Fonten titler, overskrifter og kortheadere settes i: ${fontChoices}. Dette er fontene Slaids henter selv, og dermed de eneste et rendret preview kan tegne. Editoren tilbyr i tillegg lokale fonter som Calibri og Segoe UI; et dekk kan være satt i en av dem, men den kan ikke velges herfra.`,
      ),
    bodyFont: fontIdSchema
      .optional()
      .describe(`Fonten brødteksten settes i. Samme utvalg: ${fontChoices}.`),
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
    boxShadows: z
      .boolean()
      .optional()
      .describe('Om kort, bilder, inndelingspiller og miniapp-rammer kaster skygge. Endrer ingen geometri.'),
    titledCardStyle: z
      .enum(TITLED_CARD_STYLES)
      .optional()
      .describe(
        'Hvordan kort med tittel tegnes: joined = tittel og innhold i ett kort med tittelfeltet over hele bredden; tab = innholdet er et eget kort og tittelen en farget fane bak det, like bred som tittelteksten og høyst kortbredden minus én hjørneradius; floating = tittelen er et eget kort, like bredt som teksten og høyst like bredt som innholdet, ett gap over innholdskortet. tab gir tittelen litt mindre bredde, floating gir innholdet ett gap mindre høyde, så en endring som ville skjult tekst avvises med CONTENT_DOES_NOT_FIT.',
      ),
  }),
  run(context, input): Promise<AgentResult<{ presentationId: string; theme: ThemeView }>> {
    return mutatePresentation(context, input, (presentation) => {
      // One command for all four fields, which is what makes the change atomic
      // in the only sense that matters here: a bigger type size that hides text
      // is refused *together with* the font that came with it, so a deck never
      // ends up half-way into a theme nobody asked for.
      const themed = setTheme(presentation, patchFrom(input), structuralOptions(context))
      if (!themed.ok) return themed
      return ok({
        presentation: themed.value,
        value: { presentationId: presentation.id, theme: themeView(themed.value) },
      })
    })
  },
})

/** The domain's own field names, for the fields the caller actually sent. */
function patchFrom(input: {
  headingFont?: FontId
  bodyFont?: FontId
  spacing?: number
  fontScale?: number
  boxShadows?: boolean
  titledCardStyle?: TitledCardStyle
}): Partial<PresentationTheme> {
  return {
    ...(input.headingFont === undefined
      ? {}
      : { headingFontFamily: fontStackFor(input.headingFont) }),
    ...(input.bodyFont === undefined ? {} : { bodyFontFamily: fontStackFor(input.bodyFont) }),
    ...(input.spacing === undefined ? {} : { spacing: input.spacing }),
    ...(input.fontScale === undefined ? {} : { fontScale: input.fontScale }),
    ...(input.boxShadows === undefined ? {} : { boxShadows: input.boxShadows }),
    ...(input.titledCardStyle === undefined ? {} : { titledCardStyle: input.titledCardStyle }),
  }
}

/* ------------------------------------------------------------------ *
 * set_theme_logo
 * ------------------------------------------------------------------ */

const logoHeightSchema = z.number().min(LOGO_MIN_HEIGHT).max(SLIDE_HEIGHT)

/**
 * Logoen i temaet, med de samme tre kommandoene temaeditoren bruker. Ingen
 * egne grenser og ingen egen geometri: en høyde er et ønske, og det som tegnes
 * er aldri mer enn alle sidene i gruppen har plass til (`drawnHeight` i svaret).
 * Agenten måles strengt, som for alle andre temavalg: en logo som ville skjult
 * innhold, avvises med `CONTENT_DOES_NOT_FIT`.
 */
export const setThemeLogoOperation = defineOperation({
  name: 'set_theme_logo',
  summary:
    'Sett, flytt eller fjern logoen i temaet. Logoen gjelder hele presentasjonen: én innstilling for inndelingene (ingen, bare forsiden eller alle; over eller under overskriften) og én for vanlige slides (av/på, en av åtte plasseringer). Filen lastes opp først med upload_asset eller create_svg_asset, og assetId gis her; assetId null fjerner logoen. Høyden er et ønske i logiske piksler (sliden er 1600 × 900): logoen tegnes aldri større enn alle slidene i gruppen har plass til, og svaret sier hvor stor den faktisk tegnes (drawnHeight). Formen kommer fra filen og endres aldri. På vanlige slides tar logoen en stripe langs én kant, så hovedsonen blir mindre; en endring som ville skjult innhold avvises med CONTENT_DOES_NOT_FIT. Utelatte felter beholder verdien de har.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    assetId: assetIdSchema
      .nullable()
      .optional()
      .describe(
        'Filen som skal være logo, eller null for å fjerne logoen. Utelatt: logoen som står, beholdes, og bare plasseringen endres.',
      ),
    sections: z
      .strictObject({
        visibility: z
          .enum(LOGO_SECTION_VISIBILITIES)
          .optional()
          .describe('none = ingen inndeling, front = bare forsiden, all = alle inndelinger.'),
        placement: z
          .enum(LOGO_SECTION_PLACEMENTS)
          .optional()
          .describe(
            'above = midt mellom slidens øvre kant og overskriften, below = midt mellom underoverskriften (eller overskriften) og nedre kant. Alltid midtstilt vannrett.',
          ),
        height: logoHeightSchema.optional().describe('Ønsket høyde på inndelingene.'),
      })
      .optional()
      .describe('Logoen på inndelingene.'),
    slides: z
      .strictObject({
        visible: z.boolean().optional().describe('Om logoen står på vanlige slides.'),
        position: z
          .enum(LOGO_SLIDE_POSITIONS)
          .optional()
          .describe(
            'Hvor på vanlige slides. Øverst: tittel og hovedsone flyttes ned. Venstre/høyre: bare hovedsonen blir smalere. Nederst: en stripe over fremdriftsindikatoren.',
          ),
        height: logoHeightSchema.optional().describe('Ønsket høyde på vanlige slides.'),
      })
      .optional()
      .describe('Logoen på vanlige slides.'),
  }),
  run(context, input): Promise<AgentResult<{ presentationId: string; theme: ThemeView }>> {
    return mutatePresentation(context, input, (presentation) => {
      const changed = withLogo(presentation, input, structuralOptions(context))
      if (!changed.ok) return changed
      return ok({
        presentation: changed.value,
        value: { presentationId: presentation.id, theme: themeView(changed.value) },
      })
    })
  },
})

/** Kommandoen som svarer til det som ble bedt om – én, så endringen er ett steg. */
function withLogo(
  presentation: Presentation,
  input: { assetId?: string | null; sections?: ThemeLogoPatch['sections']; slides?: ThemeLogoPatch['slides'] },
  options: ReturnType<typeof structuralOptions>,
): Result<Presentation> {
  const patch: ThemeLogoPatch = {
    ...(input.sections ? { sections: input.sections } : {}),
    ...(input.slides ? { slides: input.slides } : {}),
  }
  if (input.assetId === null) return removeThemeLogo(presentation)
  if (input.assetId !== undefined) return setThemeLogo(presentation, input.assetId, options, patch)
  return updateThemeLogo(presentation, patch, options)
}

export const themeOperations = [setThemeOperation, setThemeLogoOperation]
