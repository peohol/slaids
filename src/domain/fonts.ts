/**
 * A deliberately small, controlled font set.
 *
 * Fonts are a presentation-global choice; there is no way to end up with a
 * random font mix across slides.
 */

export interface FontOption {
  id: string
  label: string
  stack: string
  /** Google Fonts family name, when the font is a web font. */
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

export const FONT_OPTIONS: FontOption[] = [
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
    stack: "'Inter', 'Segoe UI', system-ui, sans-serif",
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
    stack: "'Source Sans 3', 'Segoe UI', sans-serif",
    webFont: 'Source Sans 3',
    advance: 0.48,
  },
  {
    id: 'merriweather',
    label: 'Merriweather',
    stack: "'Merriweather', Georgia, serif",
    webFont: 'Merriweather',
    advance: 0.56,
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    stack: "'Space Grotesk', 'Segoe UI', sans-serif",
    webFont: 'Space Grotesk',
    advance: 0.53,
  },
]

export const DEFAULT_HEADING_FONT = FONT_OPTIONS[0].stack
export const DEFAULT_BODY_FONT = FONT_OPTIONS[0].stack

export function findFontByStack(stack: string): FontOption | undefined {
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
 */
export function webFontsFor(stacks: string[]): string[] {
  const families = new Set<string>()
  for (const stack of stacks) {
    const font = findFontByStack(stack)
    if (font?.webFont) families.add(font.webFont)
  }
  return [...families]
}
