/**
 * The deck's design, as the one string a sandboxed document can carry.
 *
 * The claim that matters here is about the *network*: a miniapp's frame is not
 * allowed to fetch anything, so the theme's faces have to arrive as part of the
 * document or not at all. What is checked is that they really do — every file
 * a `data:` URL, nothing left pointing at a host — and that the failure mode is
 * the fallback stack rather than an app that will not start.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultTheme } from '../../domain/presentation'
import { interactiveBaseStylesheet, interactiveThemeCss } from '../../domain/interactiveStyle'
import { resetInlinedFontCache } from '../../fonts/inlineFaces'
import { interactiveDocumentStyle, interactiveFontCss } from './documentStyle'

beforeEach(resetInlinedFontCache)

const COLORS = { accent: '#bfccd9', background: '#101828' }
const SYSTEM_STACK = 'Arial, Helvetica, sans-serif'

/** A fetch that answers Google's stylesheet and then the face file. */
function fakeFetch(options: { faceStatus?: number } = {}) {
  const calls: string[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.startsWith('https://fonts.googleapis.com/')) {
      return new Response(
        "@font-face { font-family: 'Quicksand'; src: url(https://fonts.gstatic.com/s/q/a.woff2) format('woff2'); }",
        { status: 200 },
      )
    }
    if (options.faceStatus && options.faceStatus !== 200) {
      return new Response('nope', { status: options.faceStatus })
    }
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
  })
  return { calls, fetchImpl: fetchImpl as unknown as typeof globalThis.fetch }
}

describe('fontene en miniapp får', () => {
  it('kommer som data-URL-er, så dokumentet ikke trenger nettverk for å tegnes riktig', async () => {
    const { fetchImpl } = fakeFetch()
    const css = await interactiveFontCss([defaultTheme().headingFontFamily], { fetch: fetchImpl })

    expect(css).toContain('@font-face')
    expect(css).toContain('url(data:font/woff2;base64,')
    // Nothing left for the frame to go and get — which it could not anyway.
    expect(css).not.toContain('https://')
  })

  it('henter ingenting for en systemstakk: den fonten er maskinens eller ingen', async () => {
    const { fetchImpl, calls } = fakeFetch()
    expect(await interactiveFontCss([SYSTEM_STACK, SYSTEM_STACK], { fetch: fetchImpl })).toBe('')
    expect(calls).toEqual([])
  })

  it('gir tom CSS når en font ikke kan hentes, i stedet for å la appen vente', async () => {
    const { fetchImpl } = fakeFetch({ faceStatus: 503 })
    expect(await interactiveFontCss([defaultTheme().headingFontFamily], { fetch: fetchImpl })).toBe('')
  })
})

describe('stilarket for én kjøring', () => {
  it('legger fontene først, så variablene, så basisarket', () => {
    const style = interactiveDocumentStyle({
      theme: defaultTheme(),
      colors: COLORS,
      contract: 1,
      fontCss: '@font-face { font-family: X; }',
    })
    const faces = style.indexOf('@font-face')
    const tokens = style.indexOf(':root {')
    const base = style.indexOf('box-sizing')
    // The order is the contract: a variable must exist before the sheet that
    // reads it, and a face before the rule that names the family.
    expect(faces).toBeGreaterThanOrEqual(0)
    expect(tokens).toBeGreaterThan(faces)
    expect(base).toBeGreaterThan(tokens)
  })

  it('er variablene og basisarket, uendret, når det ikke er noen fonter å legge ved', () => {
    const input = { theme: defaultTheme(), colors: COLORS, contract: 1 as const }
    expect(interactiveDocumentStyle({ ...input, fontCss: '' })).toBe(
      [interactiveThemeCss(input), interactiveBaseStylesheet(1)].join('\n\n'),
    )
  })
})
