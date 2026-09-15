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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bestTextColor } from './color'
import {
  BODY_LINE_HEIGHT,
  CARD_RADIUS,
  CURRENT_INTERACTIVE_STYLE_CONTRACT,
  INTERACTIVE_STYLE_CONTRACTS,
} from './constants'
import {
  INTERACTIVE_EXIT_CLEARANCE,
  INTERACTIVE_LAYOUT_RULES,
  INTERACTIVE_RESTRICTIONS,
  INTERACTIVE_STARTER_SKELETON,
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

/* ------------------------------------------------------------------ *
 * The structure an app has to have
 * ------------------------------------------------------------------ */

describe('strukturreglene', () => {
  const stated = INTERACTIVE_LAYOUT_RULES.join('\n')

  it.each([
    ['én rot', /#miniapp/],
    ['full høydekjede', /full høyde/i],
    ['box-sizing', /box-sizing: border-box/],
    ['ingen default-marg på body', /html, body/],
    ['én rulleflate', /[Nn]øyaktig én navngitt vertikal rulleflate/],
    ['min-height på rulleflaten', /min-height: 0/],
    ['overflow-y', /overflow-y: auto/],
    ['overflow-x som ikke er et bevis', /overflow-x skal aldri brukes/],
    ['ytterluft', /--slaids-gap/],
    ['panelpadding', /--slaids-padding/],
    ['blokkavstand', /--slaids-block-spacing/],
    ['én eier per avstand', /[Hh]ver avstand skal ha én eier/],
    ['panelbasert og balansert', /panel-\/beholderbasert/],
    ['ingen tilfeldig asymmetri', /asymmetriske paddings/],
  ])('sier %s direkte, ikke ved antydning', (_what, expected) => {
    expect(stated).toMatch(expected)
  })

  it('reserverer plass til avslutningsknappen med de samme tallene som skallet', () => {
    expect(stated).toContain(String(INTERACTIVE_EXIT_CLEARANCE.top))
    expect(stated).toContain(String(INTERACTIVE_EXIT_CLEARANCE.right))
  })
})

/* ------------------------------------------------------------------ *
 * The skeleton, and the examples that have to keep obeying it
 * ------------------------------------------------------------------ */

/** The selectors that carry the height chain, the scroll owner and the clearance. */
const LOAD_BEARING = [
  'html, body',
  'body',
  '#miniapp, #miniapp *',
  '#miniapp',
  '#miniapp [hidden]',
  '.app-title',
  '.app-content',
]

/** A stylesheet as `selector → declarations`, whitespace and comments removed. */
function cssRules(html: string): Map<string, string[]> {
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map(([, block]) => block)
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = new Map<string, string[]>()
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const key = selector.trim().replace(/\s+/g, ' ')
    const declarations = body
      .split(';')
      .map((declaration) => declaration.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
    rules.set(key, [...(rules.get(key) ?? []), ...declarations])
  }
  return rules
}

function example(file: string): string {
  return readFileSync(join(process.cwd(), 'examples', 'interactive-miniapps', file), 'utf8')
}

describe('startskallet', () => {
  const skeleton = cssRules(INTERACTIVE_STARTER_SKELETON)

  it('følger sine egne regler: én rot, avgrenset høyde og én rulleflate', () => {
    expect(INTERACTIVE_STARTER_SKELETON).toContain('<main id="miniapp">')
    expect(skeleton.get('html, body')).toContain('height: 100%')
    expect(skeleton.get('html, body')).toContain('margin: 0')
    expect(skeleton.get('#miniapp, #miniapp *')).toContain('box-sizing: border-box')
    expect(skeleton.get('#miniapp')).toContain('min-height: 0')
    expect(skeleton.get('.app-content')).toEqual(
      expect.arrayContaining(['min-height: 0', 'overflow-y: auto']),
    )
    // One scroll owner, not several: nothing else may own vertical overflow.
    const scrollers = [...skeleton].filter(([, declarations]) =>
      declarations.some((declaration) => /^overflow(-y)?: (auto|scroll)$/.test(declaration)),
    )
    expect(scrollers.map(([selector]) => selector)).toEqual(['.app-content'])
  })

  it('navngir Slaids-avstandene i stedet for å finne opp sine egne', () => {
    for (const variable of ['--slaids-gap', '--slaids-padding', '--slaids-block-spacing']) {
      expect(INTERACTIVE_STARTER_SKELETON).toContain(`var(${variable})`)
    }
    // A colour or a type size written out here would be a second theme.
    expect(INTERACTIVE_STARTER_SKELETON).not.toMatch(/#[0-9a-f]{3,6}\b/i)
    expect(INTERACTIVE_STARTER_SKELETON).not.toMatch(/font-size:\s*(?!var\()/)
  })

  it.each(['starter.html', 'system-test.html'])(
    '%s bærer de samme bærende reglene, så malen og kontrakten ikke gror fra hverandre',
    (file) => {
      const actual = cssRules(example(file))
      for (const selector of LOAD_BEARING) {
        const required = skeleton.get(selector)
        expect(required, `skallet mangler «${selector}»`).toBeDefined()
        expect(actual.get(selector) ?? [], `${file}: ${selector}`).toEqual(
          expect.arrayContaining(required!),
        )
      }
    },
  )
})
