/**
 * Deterministic colour palette and contrast handling.
 *
 * The palette is intentionally small: 12 hues x 4 lightness steps at a fixed
 * saturation, plus black and white. Text colour is never chosen by hand — it is
 * derived from the background's lightness, so every swatch in a palette row
 * gets the same text colour.
 */

export const PALETTE_HUES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]
export const PALETTE_LIGHTNESS = [20, 40, 60, 80]
export const PALETTE_SATURATION = 25

export const WHITE = '#ffffff'
export const BLACK = '#000000'

function componentToHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
}

export function hslToHex(h: number, s: number, l: number): string {
  const saturation = s / 100
  const lightness = l / 100
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r: number
  let g: number
  let b: number
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = lightness - c / 2
  return `#${componentToHex((r + m) * 255)}${componentToHex((g + m) * 255)}${componentToHex((b + m) * 255)}`
}

/** The full swatch grid: 4 rows of 12 hues, then a final row with black and white. */
export function buildPalette(): string[][] {
  const rows = PALETTE_LIGHTNESS.map((l) =>
    PALETTE_HUES.map((h) => hslToHex(h, PALETTE_SATURATION, l)),
  )
  rows.push([BLACK, WHITE])
  return rows
}

export const PALETTE = buildPalette()

export function normalizeHex(input: string): string | null {
  const value = input.trim().toLowerCase()
  const short = /^#([0-9a-f]{3})$/.exec(value)
  if (short) {
    const [r, g, b] = short[1].split('')
    return `#${r}${r}${g}${g}${b}${b}`
  }
  const long = /^#([0-9a-f]{6})$/.exec(value)
  return long ? `#${long[1]}` : null
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHex(hex)
  if (!normalized) return null
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  }
}

function channelLuminance(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  )
}

/** WCAG contrast ratio between two colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/** HSL lightness (0..100) — the same scale the palette rows are built on. */
export function hslLightness(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  return ((Math.max(rgb.r, rgb.g, rgb.b) + Math.min(rgb.r, rgb.g, rgb.b)) / 2 / 255) * 100
}

/** Backgrounds darker than this get white text; the rest get black. */
export const TEXT_LIGHTNESS_THRESHOLD = 50

/** WCAG AA for large text. Every palette colour clears it by lightness alone. */
export const MIN_TEXT_CONTRAST = 3

/**
 * White on dark backgrounds, black on light ones, judged by lightness — so a
 * palette row shares one text colour. Saturated colours outside the palette can
 * mislead lightness (pure blue sits at 50 %); when the pick falls below
 * {@link MIN_TEXT_CONTRAST}, the other colour is used, which then clears 7:1.
 */
export function bestTextColor(background: string): string {
  const byLightness = hslLightness(background) < TEXT_LIGHTNESS_THRESHOLD ? WHITE : BLACK
  if (contrastRatio(background, byLightness) >= MIN_TEXT_CONTRAST) return byLightness
  return byLightness === WHITE ? BLACK : WHITE
}

/** Decorative only — legibility never depends on the shadow. */
export function textShadowFor(background: string): string | undefined {
  return bestTextColor(background) === WHITE ? '0 1px 2px rgba(0,0,0,0.45)' : undefined
}

export function isDarkColor(background: string): boolean {
  return bestTextColor(background) === WHITE
}

/** A subtle divider colour that stays visible on the given surface. */
export function dividerColorFor(background: string): string {
  return isDarkColor(background) ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.16)'
}

export function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}
