// @vitest-environment node
/**
 * The chrome's colour tokens, held to the contrast the design system promises.
 *
 * `docs/UX_DESIGN_SYSTEM.md` states ratios for every token; this reads the
 * tokens from the one place they are defined (`global.css`) and checks the
 * rules those ratios come from, so a token edited later cannot quietly fall
 * below them. Contrast is computed with the same function the app uses for
 * slide text (`domain/color.ts`).
 *
 * The rules, from WCAG 2.2:
 *  - text, and the words that carry a status, at least 4.5:1 (1.4.3) on every
 *    surface it is drawn on — including the selected surface, which is the
 *    accent at 18 % over a raised one;
 *  - the function inks, the selection/focus accent and the status edges at
 *    least 3:1 (1.4.11), because they are what tells one control from another;
 *  - white words on the filled buttons at least 4.5:1.
 *
 * Every rule holds in both appearances: a token written as
 * `light-dark(<light>, <dark>)` is checked once per half, against the surfaces
 * of the same half.
 *
 * Disabled text (`--chrome-text-faint`) is exempt by the same criterion, and
 * the pressed surface only lasts while a press does, so text is not held to it.
 *
 * The inks are also promised to stay apart with colour blindness, from each
 * other and from the selection accent: zone mode is drawn violet right beside
 * things drawn blue because they are selected, and the two must not read as
 * one signal. That is checked by simulating the three dichromacies (Machado,
 * Oliveira & Fernandes 2009, full severity, in linear RGB) and requiring a
 * clear CIELAB distance between every pair. Shape (icons) and form (segment,
 * edge, `aria-pressed`) are the first cue and colour the second, so «clear»
 * means well past a just-noticeable difference, not merely different.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrastRatio, hexToRgb } from '../domain/color'

const css = readFileSync(fileURLToPath(new URL('./global.css', import.meta.url)), 'utf8')
const rootStart = css.indexOf(':root {')
const root = css.slice(rootStart, css.indexOf('}', rootStart))

type Scheme = 'lys' | 'mørk'
const SCHEMES: readonly Scheme[] = ['lys', 'mørk']

/** The arguments of a CSS function call, split at its top-level commas. */
function args(call: string): string[] {
  const inner = call.slice(call.indexOf('(') + 1, call.lastIndexOf(')'))
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of inner) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else current += char
  }
  return [...parts, current.trim()]
}

/** A token's value in one appearance: one half of `light-dark()`, or the value itself. */
function token(name: string, scheme: Scheme): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(root)
  if (!match) throw new Error(`global.css har ikke --${name}.`)
  const value = match[1].trim()
  if (!value.startsWith('light-dark(')) return value
  const [light, dark] = args(value)
  return scheme === 'lys' ? light : dark
}

function hex(name: string, scheme: Scheme): string {
  const value = token(name, scheme)
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`--${name} er ikke en hex-farge: ${value}`)
  return value
}

/** An `rgba()` token painted over an opaque surface, as the browser composites it. */
function over(name: string, surface: string, scheme: Scheme): string {
  const match = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(token(name, scheme))
  const base = hexToRgb(surface)
  if (!match || !base) throw new Error(`--${name} er ikke en rgba-farge over en hex-flate.`)
  const alpha = Number(match[4])
  const channel = (top: string, bottom: number) =>
    Math.round(alpha * Number(top) + (1 - alpha) * bottom)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(match[1], base.r)}${channel(match[2], base.g)}${channel(match[3], base.b)}`
}

const SURFACES = ['chrome-bg', 'chrome-bg-raised', 'chrome-bg-inset', 'chrome-bg-hover'] as const

/** Every surface text sits on, by name, with the selected one composited. */
function textSurfaces(scheme: Scheme): Array<[string, string]> {
  return [
    ...SURFACES.map((name): [string, string] => [name, hex(name, scheme)]),
    ['valgt flate', over('chrome-accent-soft', hex('chrome-bg-raised', scheme), scheme)],
  ]
}

describe('fargene skrives én gang per utseende', () => {
  it('roten følger systemet, og «Utseende» kan låse den til lys eller mørk', () => {
    expect(token('chrome-bg', 'mørk')).not.toBe(token('chrome-bg', 'lys'))
    expect(root).toMatch(/color-scheme:\s*light dark;/)
    expect(css).toMatch(/:root\[data-appearance='light'\]\s*\{\s*color-scheme:\s*light;/)
    expect(css).toMatch(/:root\[data-appearance='dark'\]\s*\{\s*color-scheme:\s*dark;/)
  })
})

describe.each(SCHEMES)('app-chromens fargetokener, %s', (scheme) => {
  it.each([
    'chrome-text',
    'chrome-text-dim',
    'chrome-accent-text',
    'chrome-danger-text',
    'chrome-success',
  ])('--%s er lesbar tekst på hver flate (minst 4,5:1)', (name) => {
    for (const [surface, value] of textSurfaces(scheme)) {
      expect(contrastRatio(hex(name, scheme), value), `${name} på ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    'ink-content',
    'ink-zone',
    'ink-media',
    'chrome-accent',
    'chrome-warning',
    'chrome-danger',
  ])('--%s skiller seg fra flatene den tegnes på (minst 3:1)', (name) => {
    for (const surface of ['chrome-bg', 'chrome-bg-raised', 'chrome-bg-inset']) {
      expect(
        contrastRatio(hex(name, scheme), hex(surface, scheme)),
        `${name} på ${surface}`,
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it.each(['chrome-primary', 'chrome-primary-hover', 'chrome-danger-strong'])(
    'hvit tekst på --%s er lesbar (minst 4,5:1)',
    (name) => {
      expect(contrastRatio('#ffffff', hex(name, scheme))).toBeGreaterThanOrEqual(4.5)
    },
  )
})

/** Machado et al. (2009), severity 1.0, applied to linear RGB. */
const DICHROMACIES: Record<string, number[][]> = {
  protanopi: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopi: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopi: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
}

const linear = (channel: number) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function lab([r, g, b]: number[]): [number, number, number] {
  const [x, y, z] = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
  ]
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

function simulated(name: string, scheme: Scheme, matrix: number[][]): [number, number, number] {
  const rgb = hexToRgb(hex(name, scheme))
  if (!rgb) throw new Error(`--${name} er ikke en hex-farge.`)
  const channels = [rgb.r, rgb.g, rgb.b].map(linear)
  return lab(
    matrix.map((row) =>
      Math.min(
        1,
        Math.max(
          0,
          row.reduce((sum, weight, index) => sum + weight * channels[index], 0),
        ),
      ),
    ),
  )
}

const IDENTITY = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

/** CIELAB ΔE*76; around 2.3 is just noticeable, and 20 is a different colour. */
const CLEARLY_APART = 20

describe.each(SCHEMES)('blekkfargene og valgfargen ved fargesynsvariasjoner, %s', (scheme) => {
  const signals = ['ink-content', 'ink-zone', 'ink-media', 'chrome-accent'] as const
  it.each([...Object.keys(DICHROMACIES), 'normalt fargesyn'])(
    'holder familiene og valgt-blått adskilt ved %s',
    (kind) => {
      const matrix = DICHROMACIES[kind] ?? IDENTITY
      for (const [index, a] of signals.entries()) {
        for (const b of signals.slice(index + 1)) {
          const distance = Math.hypot(
            ...simulated(a, scheme, matrix).map(
              (value, axis) => value - simulated(b, scheme, matrix)[axis],
            ),
          )
          expect(distance, `${a} mot ${b}`).toBeGreaterThanOrEqual(CLEARLY_APART)
        }
      }
    },
  )
})
