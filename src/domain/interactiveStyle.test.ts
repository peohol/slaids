/**
 * The design a miniapp inherits.
 *
 * Two claims, and they are the two halves of «the app follows the deck»:
 * the values are the deck's own numbers rather than a second set that happens
 * to look similar, and they are the *governing section's* colours rather than
 * the deck's first. The third claim — that changing the theme changes the app
 * without touching the stored file — is a property of where these are called
 * from, and lives in `src/ui/slide/interactive.test.tsx`.
 */

import { describe, expect, it } from 'vitest'
import { bestTextColor } from './color'
import {
  BODY_LINE_HEIGHT,
  CARD_RADIUS,
  CURRENT_INTERACTIVE_STYLE_CONTRACT,
  INTERACTIVE_STYLE_CONTRACTS,
} from './constants'
import {
  INTERACTIVE_RESTRICTIONS,
  interactiveBaseStylesheet,
  interactiveThemeCss,
  interactiveThemeTokens,
} from './interactiveStyle'
import { FONT_SCALE_RANGE, SPACING_RANGE, themeMetrics } from './metrics'
import { defaultTheme } from './presentation'

const COLORS = { accent: '#bfccd9', background: '#101828' }

function tokens(overrides: Partial<ReturnType<typeof defaultTheme>> = {}) {
  return interactiveThemeTokens({ theme: { ...defaultTheme(), ...overrides }, colors: COLORS })
}

describe('temaet en miniapp arver', () => {
  it('navngir fargene fra seksjonen sliden ligger i, med tekstfarger kontrasten dikterer', () => {
    const map = tokens()
    expect(map['--slaids-background']).toBe(COLORS.background)
    expect(map['--slaids-accent']).toBe(COLORS.accent)
    // Never picked by hand — derived, like every other text colour in Slaids.
    expect(map['--slaids-text']).toBe(bestTextColor(COLORS.background))
    expect(map['--slaids-accent-text']).toBe(bestTextColor(COLORS.accent))
  })

  it('bruker dekkets egne mål, ikke et parallelt sett', () => {
    const theme = defaultTheme()
    const metrics = themeMetrics(theme)
    const map = tokens()
    expect(map['--slaids-font-size']).toBe(`${metrics.bodyFontSize}px`)
    expect(map['--slaids-font-size-title']).toBe(`${metrics.titleFontSize}px`)
    expect(map['--slaids-gap']).toBe(`${metrics.gap}px`)
    expect(map['--slaids-padding']).toBe(`${metrics.cardPadding}px`)
    expect(map['--slaids-radius']).toBe(`${CARD_RADIUS}px`)
    expect(map['--slaids-line-height']).toBe(String(BODY_LINE_HEIGHT))
  })

  it('følger temaets skalaer, så en større font i dekket er en større font i appen', () => {
    const small = tokens({ fontScale: FONT_SCALE_RANGE.min })
    const large = tokens({ fontScale: FONT_SCALE_RANGE.max })
    expect(parseFloat(large['--slaids-font-size'])).toBeGreaterThan(
      parseFloat(small['--slaids-font-size']),
    )
    const tight = tokens({ spacing: SPACING_RANGE.min })
    const loose = tokens({ spacing: SPACING_RANGE.max })
    expect(parseFloat(loose['--slaids-gap'])).toBeGreaterThan(parseFloat(tight['--slaids-gap']))
  })

  it('gir de to fontrollene som stakker, ikke som fontnavn', () => {
    const theme = defaultTheme()
    const map = tokens()
    expect(map['--slaids-heading-font']).toBe(theme.headingFontFamily)
    expect(map['--slaids-body-font']).toBe(theme.bodyFontFamily)
    // A stack, so the app degrades exactly as the deck does when a face is
    // missing — rather than to whatever the browser's default happens to be.
    expect(map['--slaids-body-font']).toContain(',')
  })

  it('skrives som en :root-regel med hver variabel i', () => {
    const css = interactiveThemeCss({ theme: defaultTheme(), colors: COLORS })
    expect(css.startsWith(':root {')).toBe(true)
    for (const [name, value] of Object.entries(tokens())) {
      expect(css).toContain(`${name}: ${value};`)
    }
  })
})

describe('basisstilarket', () => {
  const sheet = interactiveBaseStylesheet(CURRENT_INTERACTIVE_STYLE_CONTRACT)

  it('stiler de vanlige semantiske elementene', () => {
    for (const selector of [
      'html, body',
      'h1, h2, h3, h4, h5, h6',
      'button',
      'input, textarea, select',
      'fieldset',
      'table',
      'progress, meter',
    ]) {
      expect(sheet, selector).toContain(selector)
    }
  })

  it('henter hver verdi fra variablene, og navngir aldri en farge eller en font selv', () => {
    // The one exception is the monospace stack for `code`: there is no deck
    // token for it, because the deck has no code in it.
    const withoutMono = sheet.replace(/font-family: ui-monospace[^;]*;/g, '')
    expect(withoutMono).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(withoutMono).not.toMatch(/\brgb/)
    expect(withoutMono).not.toMatch(/font-family:(?!\s*var\()/)
  })

  it('bruker bare elementselektorer, så én klasse i appens egen CSS slår den', () => {
    // `.slaids-card` is the one class, and it is offered rather than imposed.
    const classes = [...sheet.matchAll(/\.[a-z-]+/g)].map((match) => match[0])
    expect(new Set(classes)).toEqual(new Set(['.slaids-card']))
    expect(sheet).not.toContain('!important')
    expect(sheet).not.toContain('#')
  })

  it('har et ark for hver versjon kontrakten kjenner', () => {
    for (const version of INTERACTIVE_STYLE_CONTRACTS) {
      expect(interactiveBaseStylesheet(version).length).toBeGreaterThan(0)
    }
  })
})

describe('begrensningene', () => {
  it('sier hva sandkassen nekter, i den rekkefølgen en forfatter møter det', () => {
    expect(INTERACTIVE_RESTRICTIONS.length).toBeGreaterThan(0)
    const all = INTERACTIVE_RESTRICTIONS.join(' ')
    for (const refused of ['fetch', 'localStorage', 'eval', 'popup', 'kamera', 'postMessage']) {
      expect(all, refused).toContain(refused)
    }
  })
})
