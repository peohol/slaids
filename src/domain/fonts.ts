/**
 * The controlled font catalogue shared by the editor, Agent API and renderer.
 * Web fonts are guaranteed because Slaids loads their bytes itself; local fonts
 * are offered only in the editor and may depend on the machine drawing them.
 */

export interface FontOption {
  id: string
  label: string
  stack: string
  webFont?: string
  /** Average glyph advance used only by the headless fit estimator. */
  advance: number
}

export const DEFAULT_ADVANCE_RATIO = 0.5

/**
 * Guaranteed fallback for characters commonly used in presentation text but
 * absent from display fonts. `Noto Sans Symbols` deliberately covers Unicode's
 * basic Arrows block (including U+2194 LEFT RIGHT ARROW). `Noto Sans Symbols 2`
 * covers many supplemental symbols but does not cover that block reliably in
 * the Google Fonts web build, which is why it must not be the only fallback.
 */
export const SYMBOL_FALLBACK_WEB_FONT = 'Noto Sans Symbols'
export const SYMBOL_FALLBACK_WEIGHTS: readonly number[] = [400]

const CATALOGUE = [
  {
    id: 'quicksand',
    label: 'Quicksand',
    stack: "'Quicksand', 'Noto Sans Symbols', 'Segoe UI', system-ui, sans-serif",
    webFont: 'Quicksand',
    advance: 0.52,
  },
  {
    id: 'atkinson',
    label: 'Atkinson Hyperlegible Next',
    stack: "'Atkinson Hyperlegible Next', 'Noto Sans Symbols', 'Segoe UI', system-ui, sans-serif",
    webFont: 'Atkinson Hyperlegible Next',
    advance: 0.52,
  },
  {
    id: 'open-sans',
    label: 'Open Sans',
    stack: "'Open Sans', 'Noto Sans Symbols', 'Segoe UI', system-ui, sans-serif",
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
    stack: "'Inter', 'Noto Sans Symbols', 'Segoe UI', system-ui, sans-serif",
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
    stack: "'Source Sans 3', 'Noto Sans Symbols', 'Segoe UI', sans-serif",
    webFont: 'Source Sans 3',
    advance: 0.48,
  },
  {
    id: 'merriweather',
    label: 'Merriweather',
    stack: "'Merriweather', 'Noto Sans Symbols', Georgia, serif",
    webFont: 'Merriweather',
    advance: 0.56,
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    stack: "'Space Grotesk', 'Noto Sans Symbols', 'Segoe UI', sans-serif",
    webFont: 'Space Grotesk',
    advance: 0.53,
  },
] as const satisfies readonly FontOption[]

export type FontId = (typeof CATALOGUE)[number]['id']
export type CatalogueFont = FontOption & { id: FontId }
export const FONT_OPTIONS: readonly CatalogueFont[] = CATALOGUE

/**
 * Font stacks are persisted presentation data. These aliases keep decks written
 * both before symbol fallback existed and during the brief Symbols-2 fallback
 * version recognizable as the same catalogue font. Rendering canonicalizes them
 * without rewriting the stored document.
 */
const LEGACY_WEB_STACKS: Partial<Record<FontId, readonly string[]>> = {
  quicksand: [
    "'Quicksand', 'Segoe UI', system-ui, sans-serif",
    "'Quicksand', 'Noto Sans Symbols 2', 'Segoe UI', system-ui, sans-serif",
  ],
  atkinson: [
    "'Atkinson Hyperlegible Next', 'Segoe UI', system-ui, sans-serif",
    "'Atkinson Hyperlegible Next', 'Noto Sans Symbols 2', 'Segoe UI', system-ui, sans-serif",
  ],
  'open-sans': [
    "'Open Sans', 'Segoe UI', system-ui, sans-serif",
    "'Open Sans', 'Noto Sans Symbols 2', 'Segoe UI', system-ui, sans-serif",
  ],
  inter: [
    "'Inter', 'Segoe UI', system-ui, sans-serif",
    "'Inter', 'Noto Sans Symbols 2', 'Segoe UI', system-ui, sans-serif",
  ],
  'source-sans': [
    "'Source Sans 3', 'Segoe UI', sans-serif",
    "'Source Sans 3', 'Noto Sans Symbols 2', 'Segoe UI', sans-serif",
  ],
  merriweather: [
    "'Merriweather', Georgia, serif",
    "'Merriweather', 'Noto Sans Symbols 2', Georgia, serif",
  ],
  'space-grotesk': [
    "'Space Grotesk', 'Segoe UI', sans-serif",
    "'Space Grotesk', 'Noto Sans Symbols 2', 'Segoe UI', sans-serif",
  ],
}

export function findFontById(id: string): CatalogueFont | undefined {
  return FONT_OPTIONS.find((font) => font.id === id)
}

export function isGuaranteedFont(font: FontOption): boolean {
  return font.webFont !== undefined
}

export const GUARANTEED_FONT_IDS: FontId[] = FONT_OPTIONS.filter(isGuaranteedFont).map(
  (font) => font.id,
)

export function fontStackFor(id: FontId): string {
  const font = findFontById(id)
  if (!font) throw new Error(`unknown font: ${id}`)
  return font.stack
}

export const DEFAULT_HEADING_FONT = fontStackFor('quicksand')
export const DEFAULT_BODY_FONT = fontStackFor('atkinson')

export function findFontByStack(stack: string): CatalogueFont | undefined {
  return (
    FONT_OPTIONS.find((font) => font.stack === stack) ??
    FONT_OPTIONS.find((font) => LEGACY_WEB_STACKS[font.id]?.includes(stack))
  )
}

export function renderFontStack(stack: string): string {
  return findFontByStack(stack)?.stack ?? stack
}

export function advanceRatioFor(stack: string | undefined): number {
  if (!stack) return DEFAULT_ADVANCE_RATIO
  return findFontByStack(stack)?.advance ?? DEFAULT_ADVANCE_RATIO
}

/** Authored Google Fonts families named by the supplied persisted stacks. */
export function webFontsFor(stacks: string[]): string[] {
  const families = new Set<string>()
  for (const stack of stacks) {
    const font = findFontByStack(stack)
    if (font?.webFont) families.add(font.webFont)
  }
  return [...families]
}

export function localFontsFor(stacks: readonly string[]): string[] {
  const names = new Set<string>()
  for (const stack of stacks) {
    const font = findFontByStack(stack)
    if (font && isGuaranteedFont(font)) continue
    names.add(font?.label ?? stack)
  }
  return [...names]
}

export const FONT_WEIGHTS: readonly number[] = [400, 600, 700]

export interface WebFontFaceRequest {
  family: string
  weights: readonly number[]
}

/** Every face that completes one authored web font. */
export function webFontFaces(family: string): WebFontFaceRequest[] {
  if (family === SYMBOL_FALLBACK_WEB_FONT) {
    return [{ family, weights: SYMBOL_FALLBACK_WEIGHTS }]
  }
  return [
    { family, weights: FONT_WEIGHTS },
    { family: SYMBOL_FALLBACK_WEB_FONT, weights: SYMBOL_FALLBACK_WEIGHTS },
  ]
}

export function webFontWeights(family: string): readonly number[] {
  return family === SYMBOL_FALLBACK_WEB_FONT ? SYMBOL_FALLBACK_WEIGHTS : FONT_WEIGHTS
}

/** One Google Fonts stylesheet containing the authored family and symbol fallback. */
export function googleFontsHref(family: string): string {
  const queries = webFontFaces(family).map(({ family: face, weights }) => {
    const encoded = encodeURIComponent(face).replace(/%20/g, '+')
    return weights.length === 1 && weights[0] === 400
      ? `family=${encoded}`
      : `family=${encoded}:wght@${weights.join(';')}`
  })
  return `https://fonts.googleapis.com/css2?${queries.join('&')}&display=swap`
}
