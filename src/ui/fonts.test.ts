/**
 * Web fonts decide how much text fits, so "loaded" has to mean the browser can
 * actually draw the font — not that a request went out. These cases pin that
 * difference down, including the failure path, which must be reported rather
 * than quietly remembered as success.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FONT_OPTIONS } from '../domain/fonts'
import { ensureWebFonts, resetWebFontsForTest, webFontsReady } from './fonts'

const SYSTEM = FONT_OPTIONS.find((font) => font.id === 'system')?.stack ?? ''
const INTER = FONT_OPTIONS.find((font) => font.webFont === 'Inter')?.stack ?? ''

function stubFontFaceSet(check = true): { loaded: string[] } {
  const loaded: string[] = []
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      load: (spec: string) => {
        loaded.push(spec)
        return Promise.resolve([])
      },
      check: () => check,
    },
  })
  return { loaded }
}

/** The stylesheet element the loader just appended for this family. */
function linkFor(family: string): HTMLLinkElement {
  const link = [...document.querySelectorAll<HTMLLinkElement>('link[data-slaids-font]')].find(
    (candidate) => candidate.getAttribute('data-slaids-font') === family,
  )
  if (!link) throw new Error(`no stylesheet requested for ${family}`)
  return link
}

beforeEach(() => {
  resetWebFontsForTest()
  document.head.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ensureWebFonts', () => {
  it('makes no request at all for a system stack', async () => {
    const outcome = await ensureWebFonts([SYSTEM])
    expect(outcome).toEqual({ ready: [], failed: [] })
    expect(document.querySelectorAll('link[data-slaids-font]')).toHaveLength(0)
  })

  it('resolves only once the faces are downloaded, not when the request starts', async () => {
    const { loaded } = stubFontFaceSet()
    const promise = ensureWebFonts([INTER])
    // The request is out, but nothing is usable yet.
    expect(webFontsReady([INTER])).toBe(false)

    linkFor('Inter').dispatchEvent(new Event('load'))
    const outcome = await promise
    expect(outcome).toEqual({ ready: ['Inter'], failed: [] })
    // Every weight the renderer can ask for was waited for.
    expect(loaded).toHaveLength(3)
    expect(webFontsReady([INTER])).toBe(true)
  })

  it('reports a stylesheet that fails, and forgets it so a retry is possible', async () => {
    stubFontFaceSet()
    const failing = ensureWebFonts([INTER])
    linkFor('Inter').dispatchEvent(new Event('error'))
    expect(await failing).toEqual({ ready: [], failed: ['Inter'] })
    expect(webFontsReady([INTER])).toBe(false)

    const retry = ensureWebFonts([INTER])
    linkFor('Inter').dispatchEvent(new Event('load'))
    expect(await retry).toEqual({ ready: ['Inter'], failed: [] })
  })

  it('reports a family the browser cannot actually draw as failed', async () => {
    stubFontFaceSet(false)
    const promise = ensureWebFonts([INTER])
    linkFor('Inter').dispatchEvent(new Event('load'))
    expect(await promise).toEqual({ ready: [], failed: ['Inter'] })
  })

  it('gives up on a request that never answers', async () => {
    vi.useFakeTimers()
    stubFontFaceSet()
    const promise = ensureWebFonts([INTER])
    await vi.advanceTimersByTimeAsync(9000)
    expect(await promise).toEqual({ ready: [], failed: ['Inter'] })
  })
})
