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
}

export const FONT_OPTIONS: FontOption[] = [
  { id: 'system', label: 'System', stack: "system-ui, 'Segoe UI', Roboto, Arial, sans-serif" },
  { id: 'segoe', label: 'Segoe UI', stack: "'Segoe UI', system-ui, sans-serif" },
  { id: 'inter', label: 'Inter', stack: "'Inter', 'Segoe UI', system-ui, sans-serif", webFont: 'Inter' },
  { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { id: 'calibri', label: 'Calibri', stack: 'Calibri, Candara, Segoe, sans-serif' },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { id: 'tahoma', label: 'Tahoma', stack: 'Tahoma, Verdana, sans-serif' },
  { id: 'georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'times', label: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
  { id: 'cambria', label: 'Cambria', stack: "Cambria, Georgia, serif" },
  { id: 'consolas', label: 'Consolas', stack: "Consolas, 'Courier New', monospace" },
  {
    id: 'source-sans',
    label: 'Source Sans 3',
    stack: "'Source Sans 3', 'Segoe UI', sans-serif",
    webFont: 'Source Sans 3',
  },
  {
    id: 'merriweather',
    label: 'Merriweather',
    stack: "'Merriweather', Georgia, serif",
    webFont: 'Merriweather',
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    stack: "'Space Grotesk', 'Segoe UI', sans-serif",
    webFont: 'Space Grotesk',
  },
]

export const DEFAULT_HEADING_FONT = FONT_OPTIONS[0].stack
export const DEFAULT_BODY_FONT = FONT_OPTIONS[0].stack

export function findFontByStack(stack: string): FontOption | undefined {
  return FONT_OPTIONS.find((font) => font.stack === stack)
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
