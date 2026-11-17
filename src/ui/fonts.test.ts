/**
 * Web fonts decide how much text fits, so "loaded" has to mean the browser can
 * actually draw the font — not that a request went out. These cases pin that
 * difference down, including the failure path, which must be reported rather
 * than quietly remembered as success.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FONT_OPTIONS, SYMBOL_FALLBACK_WEB_FONT } from '../domain/fonts'
import { ensureWebFonts, resetWebFontsForTest, webFontsReady } from './fonts'

const SYSTEM = FONT_OPTIONS.find((font) => font.id === 'system')?.stack ?? ''
const INTER = FONT_OPTIONS.find((font) => font.webFont === 'Inter')?.stack ?? ''

function stubFontFaceSet(check: boolean | (() => boolean) = true): { loaded: string[] } {
  const loaded: string[] = []
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      load: (spec: string) => {
        loaded.push(spec)
        return Promise.resolve([])
      },
      check: typeof check === 'function' ? check : () => check,
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

  it('resolves only once the complete guaranteed stack is downloaded', async () => {
    const { loaded } = stubFontFaceSet()
    const promise = ensureWebFonts([INTER])
    // The request is out, but nothing is usable yet.
    expect(webFontsReady([INTER])).toBe(false)

    const link = linkFor('Inter')
    // Named from the constant rather than spelled out: the fallback family has
    // been changed once already, and a literal here went stale without saying so.
    expect(link.href).toContain(`family=${SYMBOL_FALLBACK_WEB_FONT.replace(/ /g, '+')}`)
    link.dispatchEvent(new Event('load'))
    const outcome = await promise
    expect(outcome).toEqual({ ready: ['Inter'], failed: [] })
    // Three authored weights plus the regular-only symbol fallback.
    expect(loaded).toHaveLength(4)
    expect(loaded).toContain(`400 16px "${SYMBOL_FALLBACK_WEB_FONT}"`)
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

  it('waits for faces another family\'s stylesheet adds while this one loads', async () => {
    // Den delte symbolfonten står i begge familienes stilark. Kommer det andre
    // mens det første lastes, er de nye flatene ikke lastet ennå når den første
    // familien kontrollerer seg selv – det er ikke en font som mangler. Her er
    // de lastet først når det spørres etter dem igjen.
    const stub = stubFontFaceSet(() => stub.loaded.length > 4)
    const promise = ensureWebFonts([INTER])
    linkFor('Inter').dispatchEvent(new Event('load'))
    expect(await promise).toEqual({ ready: ['Inter'], failed: [] })
    // Fire flater, lastet to ganger: den andre runden er den som ventet.
    expect(stub.loaded).toHaveLength(8)
  })

  it('gives up on a request that never answers', async () => {
    vi.useFakeTimers()
    stubFontFaceSet()
    const promise = ensureWebFonts([INTER])
    await vi.advanceTimersByTimeAsync(9000)
    expect(await promise).toEqual({ ready: [], failed: ['Inter'] })
  })
})
