// @vitest-environment node
/**
 * Fetching the theme's faces here instead of in the browser.
 *
 * The reason this file exists is a measurement: letting the headless Chromium
 * fetch Google's stylesheet cost twelve seconds per picture, every picture,
 * because a page's HTTP cache is not something the next serverless invocation
 * can rely on. Moving the fetch into this process took it to a tenth of a
 * second — and, more importantly, made a render independent of whether a font
 * service is reachable at that moment.
 *
 * So what is checked here is the part that makes that safe: the files really are
 * embedded, they are fetched once, only Google's own host is ever contacted, and
 * a family that fails is *reported* rather than silently swapped for a fallback.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FONT_WEIGHTS } from '../domain/fonts'
import { defaultTheme } from '../domain/presentation'
import {
  NO_PREVIEW_FONTS,
  googleFontLoader,
  previewFontFamilies,
  resetPreviewFontCache,
} from './fonts'

beforeEach(resetPreviewFontCache)

const FACE_URL = 'https://fonts.gstatic.com/s/quicksand/v37/abcdef.woff2'

function stylesheetFor(url = FACE_URL): string {
  return `@font-face {\n  font-family: 'Quicksand';\n  font-weight: 400;\n  src: url(${url}) format('woff2');\n}`
}

/** A fetch that answers the stylesheet and the file, and counts the calls. */
function fakeFetch(options: { stylesheet?: string; faceStatus?: number } = {}) {
  const calls: string[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    if (url.startsWith('https://fonts.googleapis.com/')) {
      return new Response(options.stylesheet ?? stylesheetFor(), { status: 200 })
    }
    if (options.faceStatus && options.faceStatus !== 200) {
      return new Response('nope', { status: options.faceStatus })
    }
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
  })
  return { calls, fetchImpl: fetchImpl as unknown as typeof globalThis.fetch }
}

describe('hvilke familier som hentes', () => {
  it('er de webfontene temaet navngir, og ingenting for en systemstakk', () => {
    expect(previewFontFamilies(defaultTheme())).toEqual([
      'Quicksand',
      'Atkinson Hyperlegible Next',
    ])
    expect(
      previewFontFamilies({
        ...defaultTheme(),
        headingFontFamily: 'Arial, Helvetica, sans-serif',
        bodyFontFamily: 'Arial, Helvetica, sans-serif',
      }),
    ).toEqual([])
  })

  it('henter ingenting når det ikke er noe å hente', async () => {
    const { fetchImpl, calls } = fakeFetch()
    expect(await googleFontLoader({ fetch: fetchImpl })([])).toEqual(NO_PREVIEW_FONTS)
    expect(calls).toEqual([])
  })
})

describe('innbaking', () => {
  it('erstatter hver fontfil med en data-URL, og ber om alle vektene', async () => {
    const { fetchImpl, calls } = fakeFetch()
    const fonts = await googleFontLoader({ fetch: fetchImpl })(['Quicksand'])

    expect(fonts.linkFamilies).toEqual([])
    expect(fonts.families).toEqual(['Quicksand'])
    expect(fonts.css).toContain("font-family: 'Quicksand'")
    expect(fonts.css).toContain('url(data:font/woff2;base64,AQIDBA==)')
    // Not a URL the browser would have to fetch.
    expect(fonts.css).not.toContain('https://fonts.gstatic.com')

    const stylesheet = calls.find((url) => url.startsWith('https://fonts.googleapis.com/'))
    // The weights the slide renderer can ask for, all of them: a heading pill's
    // 700 has to be there even on a slide with no bold text.
    for (const weight of FONT_WEIGHTS) expect(stylesheet).toContain(String(weight))
  })

  it('henter hver familie én gang per instans', async () => {
    const { fetchImpl, calls } = fakeFetch()
    const load = googleFontLoader({ fetch: fetchImpl })

    const first = await load(['Quicksand'])
    const second = await load(['Quicksand'])

    expect(second.css).toBe(first.css)
    expect(calls.filter((url) => url.startsWith('https://fonts.googleapis.com/'))).toHaveLength(1)
  })
})

describe('når det ikke går', () => {
  it('lenker familien i stedet, så nettleseren fortsatt kan prøve', async () => {
    const { fetchImpl } = fakeFetch({ faceStatus: 404 })
    const fonts = await googleFontLoader({ fetch: fetchImpl })(['Quicksand'])

    expect(fonts.css).toBe('')
    expect(fonts.linkFamilies).toEqual(['Quicksand'])
    // Still part of what the rasterizer waits for and reports on.
    expect(fonts.families).toEqual(['Quicksand'])
  })

  it('glemmer en mislykket familie, så et senere kall kan prøve igjen', async () => {
    let failing = true
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('https://fonts.googleapis.com/')) {
        return new Response(stylesheetFor(), { status: 200 })
      }
      if (failing) return new Response('nope', { status: 500 })
      return new Response(new Uint8Array([9]), { status: 200 })
    }) as unknown as typeof globalThis.fetch

    const load = googleFontLoader({ fetch: fetchImpl })
    expect((await load(['Quicksand'])).linkFamilies).toEqual(['Quicksand'])

    failing = false
    const retried = await load(['Quicksand'])
    expect(retried.linkFamilies).toEqual([])
    expect(retried.css).toContain('url(data:font/woff2;base64,CQ==)')
  })

  it('nekter å hente en fontfil fra en annen vert enn Googles egen', async () => {
    // The stylesheet is a response from outside that names URLs to fetch, which
    // is the shape of a request forgery. The allowlist does not depend on the
    // response being well-behaved.
    const { fetchImpl, calls } = fakeFetch({
      stylesheet: stylesheetFor('https://evil.example/font.woff2'),
    })
    const fonts = await googleFontLoader({ fetch: fetchImpl })(['Quicksand'])

    expect(fonts.linkFamilies).toEqual(['Quicksand'])
    expect(calls).not.toContain('https://evil.example/font.woff2')
  })

  it('avviser et stilark uten fontfiler i det', async () => {
    const { fetchImpl } = fakeFetch({ stylesheet: '/* ingenting */' })
    expect((await googleFontLoader({ fetch: fetchImpl })(['Quicksand'])).linkFamilies).toEqual([
      'Quicksand',
    ])
  })
})
