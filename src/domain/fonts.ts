/**
 * A deliberately small, controlled font set.
 *
 * Fonts are a presentation-global choice; there is no way to end up with a
 * random font mix across slides.
 *
 * The catalogue holds two kinds, and the difference is not cosmetic:
 *
 *  - **Web fonts** name a Google Fonts family, so Slaids fetches the faces
 *    itself — the browser through `ui/fonts.ts`, the headless renderer through
 *    `render/fonts.ts`. Whoever draws the deck can therefore have the real
 *    type, and a fetch that fails is *reported* rather than quietly swapped.
 *  - **Local fonts** are the ones a machine either has or has not: Calibri,
 *    Segoe UI, Times New Roman. They are here because a person writing on a
 *    Windows machine may want the deck set in the type their audience reads,
 *    and the editor measures the real DOM, so choosing one there is honest.
 *    Nothing can install one, and a serverless Linux container has none of
 *    them.
 *
 * Everything that has to promise something about a font — which ones an agent
 * may choose, and whether a rendered picture is really in the deck's type —
 * asks that one question, and asks it here. See `isGuaranteedFont`.
 */

export interface FontOption {
  id: string
  label: string
  stack: string
  /**
   * Google Fonts family name, when Slaids can fetch the faces itself.
   *
   * Present is what makes a font *guaranteed*: it is the difference between a
   * font Slaids can put in front of any renderer and one that depends on the
   * machine. Absent is a local font — see the note above.
   */
  webFont?: string
  /**
   * Average glyph advance as a fraction of the font size.
   *
   * Only the headless fit estimator uses this: it is what makes a font change
   * observable to `canFit()` without a DOM. In the browser the offscreen
   * measurer renders the real font and this number is not consulted, so the
   * values only need to rank the fonts correctly, not be metrically exact.
   */
  advance: number
}

/** Fallback advance for a stack that is not one of ours (e.g. an old document). */
export const DEFAULT_ADVANCE_RATIO = 0.5

/**
 * Symbols are a separate guaranteed face, not something left to the machine.
 *
 * Google Fonts' Latin subsets are deliberately small and many display fonts do
 * not contain arrows and other presentation symbols at all. A desktop browser
 * often hides that through an installed system fallback; the serverless
 * Chromium used for previews cannot make the same promise. Noto Sans Symbols 2
 * is therefore the final authored fallback for every guaranteed web font. It
 * is only used for glyphs the chosen font does not have, so ordinary text keeps
 * the selected typeface and its metrics.
 */
export const SYMBOL_FALLBACK_WEB_FONT = 'Noto Sans Symbols 2'

/** The symbol face is regular-only; the browser synthesizes styling if needed. */
export const SYMBOL_FALLBACK_WEIGHTS: readonly number[] = [400]

/**
 * The catalogue, and the only place a font is named.
 *
 * `as const` is load-bearing rather than decorative: it is what turns the ids
 * into a union type, so an agent operation can publish them as an enum and a
 * caller that names a font is checked against the same list the editor's
 * chooser is built from. One catalogue, three consumers — the chooser, the
 * agent contract and the headless estimator.
 */
const CATALOGUE = [
  {
    id: 'quicksand',
    label: 'Quicksand',
    stack: "'Quicksand', 'Noto Sans Symbols 2', 'Segoe UI', system-ui, sans-serif",
    webFont: 'Quicksand',
    advance: 0.52,
  },
  {
    id: 'atkinson',
    label: 'Atkinson Hyperlegible Next',
    stack:
      "'Atkinson Hyperlegible Next', 'Noto Sans Symbols 2', 'Segoe UI', system-ui, sans-serif",
    webFont: 'Atkinson Hyperlegible Next',
    advance: 0.52,
  },
  {
    id: 'open-sans',
    label: 'Open Sans',
    stack: "'Open Sans', 'Noto Sans Symbols 2', 'Segoe UI', system-ui, sans-serif",
    webFont: 'Open Sans',
    advance: 0.51,
  },
  {
    id: 'system',
    label: 'System',
    stack: "system-ui, 'Segoe UI', Roboto, Arial, sans-serif",
    advance: 0.5,
  },
  { id: 'segoe', label: 'Segoe UI', stack: "'Segoe UI', system-ui, sans-serif", advance: 0.5 },
  {
    id: 'inter',
    label: 'Inter',
    stack: "'Inter', 'Noto Sans Symbols 2', 'Segoe UI', system-ui, sans-serif",
    webFont: 'Inter',
    advance: 0.52,
  },
  { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif', advance: 0.5 },
  { id: 'calibri', label: 'Calibri', stack: 'Calibri, Candara, Segoe, sans-serif', advance: 0.46 },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif', advance: 0.58 },
  { id: 'tahoma', label: 'Tahoma', stack: 'Tahoma, Verdana, sans-serif', advance: 0.52 },
  { id: 'georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif", advance: 0.51 },
  { id: 'times', label: 'Times New Roman', stack: "'Times New Roman', Times, serif", advance: 0.45 },
  { id: 'cambria', label: 'Cambria', stack: 'Cambria, Georgia, serif', advance: 0.49 },
  { id: 'consolas', label: 'Consolas', stack: "Consolas, 'Courier New', monospace", advance: 0.55 },
  {
    id: 'source-sans',
    label: 'Source Sans 3',
    stack: "'Source Sans 3', 'Noto Sans Symbols 2', 'Segoe UI', sans-serif",
    webFont: 'Source Sans 3',
    advance: 0.48,
  },
  {
    id: 'merriweather',
    label: 'Merriweather',
    stack: "'Merriweather', 'Noto Sans Symbols 2', Georgia, serif",
    webFont: 'Merriweather',
    advance: 0.56,
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    stack: "'Space Grotesk', 'Noto Sans Symbols 2', 'Segoe UI', sans-serif",
    webFont: 'Space Grotesk',
    advance: 0.53,
  },
] as const satisfies readonly FontOption[]

/** A font, named the short way: what a chooser stores and an agent sends. */
export type FontId = (typeof CATALOGUE)[number]['id']

/** A catalogue entry: an option whose id is known to be one of ours. */
export type CatalogueFont = FontOption & { id: FontId }

export const FONT_OPTIONS: readonly CatalogueFont[] = CATALOGUE

export function findFontById(id: string): CatalogueFont | undefined {
  return FONT_OPTIONS.find((font) => font.id === id)
}

/**
 * Whether Slaids can draw this font anywhere, or only where it is installed.
 *
 * Derived from `webFont` rather than declared beside it: a second field would
 * be a second truth, and the way it would break is that a font added with a
 * Google family but no flag becomes invisible to the agent for no reason
 * anybody could see. "Guaranteed" means Slaids fetches the faces itself — a
 * network that refuses them is a reported `fontsReady: false`, never a silent
 * substitution.
 */
export function isGuaranteedFont(font: FontOption): boolean {
  return font.webFont !== undefined
}

/**
 * The fonts an agent may choose, in catalogue order.
 *
 * The editor offers all of them, because a person picking a font sees the
 * result on their own machine and Slaids measures that machine's DOM. A
 * headless caller sees neither: it measures with the catalogue's own metrics
 * and looks at a picture drawn in a container that has no Calibri. Offering it
 * one would be offering a font the preview silently replaces — so the agent
 * contract is built from this list, generated here rather than written out
 * again wherever it is published.
 */
export const GUARANTEED_FONT_IDS: FontId[] = FONT_OPTIONS.filter(isGuaranteedFont).map(
  (font) => font.id,
)

/**
 * The CSS stack a font id names.
 *
 * Throws rather than falling back, and the throw is unreachable by design: the
 * argument is a `FontId`, so a caller either passed one of ours or went through
 * a schema that only accepts one. A silent fallback here would be a deck set in
 * a font nobody chose.
 */
export function fontStackFor(id: FontId): string {
  const font = findFontById(id)
  if (!font) throw new Error(`unknown font: ${id}`)
  return font.stack
}

/** Titles and headings default to Quicksand, body text to Atkinson Hyperlegible Next. */
export const DEFAULT_HEADING_FONT = fontStackFor('quicksand')
export const DEFAULT_BODY_FONT = fontStackFor('atkinson')

export function findFontByStack(stack: string): CatalogueFont | undefined {
  return FONT_OPTIONS.find((font) => font.stack === stack)
}

/** Average glyph advance for a font stack, for the headless fit estimator. */
export function advanceRatioFor(stack: string | undefined): number {
  if (!stack) return DEFAULT_ADVANCE_RATIO
  return findFontByStack(stack)?.advance ?? DEFAULT_ADVANCE_RATIO
}

/**
 * Google Fonts families that must be loaded for the given stacks.
 * Nothing is fetched unless the presentation actually uses a web font.
 *
 * A guaranteed stack also depends on the symbol fallback above. It is added
 * once after the authored families so both the editor and the headless preview
 * wait for the same complete stack, while a local/system stack still causes no
 * network request at all.
 */
export function webFontsFor(stacks: string[]): string[] {
  const families = new Set<string>()
  let needsSymbolFallback = false
  for (const stack of stacks) {
    const font = findFontByStack(stack)
    if (font?.webFont) {
      families.add(font.webFont)
      needsSymbolFallback = true
    }
  }
  if (needsSymbolFallback) families.add(SYMBOL_FALLBACK_WEB_FONT)
  return [...families]
}

/**
 * The other half of `webFontsFor`: what a renderer cannot be given.
 *
 * Every stack here is one whose type depends on the machine drawing it — a
 * local font from the catalogue, or a stack from outside it entirely (an older
 * document, or one imported from a Slaids with a different catalogue). Named by
 * label, because the answer is shown to a person or an agent rather than used
 * to fetch anything.
 *
 * A preview that has any of these in its theme is drawn in whatever the
 * rendering machine happened to substitute, which is precisely what
 * `fontsReady` exists to deny.
 */
export function localFontsFor(stacks: readonly string[]): string[] {
  const names = new Set<string>()
  for (const stack of stacks) {
    const font = findFontByStack(stack)
    if (font && isGuaranteedFont(font)) continue
    names.add(font?.label ?? stack)
  }
  return [...names]
}

/**
 * The weights the slide renderer asks for.
 *
 * Body text is 400, a card header is 600 and a heading pill is 700, so all
 * three have to be downloaded before a measurement or a rendering describes
 * the font somebody will actually look at. Declared here rather than in the
 * loader because the headless preview requests the same faces from the same
 * families — one list, two consumers.
 */
export const FONT_WEIGHTS: readonly number[] = [400, 600, 700]

/** Weights that actually exist for a web family. */
export function webFontWeights(family: string): readonly number[] {
  return family === SYMBOL_FALLBACK_WEB_FONT ? SYMBOL_FALLBACK_WEIGHTS : FONT_WEIGHTS
}

/**
 * Where a web font's faces come from.
 *
 * The `webFont` field above is already documented as a Google Fonts family
 * name, so the URL that fetches it belongs beside it: the browser's loader and
 * the headless preview both need the same stylesheet, and two spellings of the
 * same query would mean the preview could render faces the editor never
 * measured.
 */
export function googleFontsHref(family: string): string {
  const weights = webFontWeights(family)
  const query = `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${weights.join(';')}`
  return `https://fonts.googleapis.com/css2?${query}&display=swap`
}
