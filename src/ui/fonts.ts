/**
 * Web font loading, with readiness as a promise.
 *
 * A font is not a cosmetic choice here: it decides how much text fits, and the
 * fit gate answers that by measuring the real DOM. So the order matters. If a
 * theme change is measured while the browser is still drawing the fallback,
 * the answer describes a font nobody will end up looking at — the web font
 * arrives a moment later, the metrics change, and content that was measured as
 * fitting is quietly clipped.
 *
 * Everything here therefore reports when a family is *usable*, not when it was
 * *requested*: the stylesheet has loaded, the faces are downloaded, and
 * `document.fonts.check()` agrees. A family that fails or hangs is reported as
 * unavailable and forgotten, so a later attempt can try again rather than
 * inheriting a false "loaded" flag.
 *
 * Only families a presentation actually uses are requested: a deck set in the
 * system stack asks for nothing. A guaranteed web-font stylesheet carries both
 * the authored family and the controlled symbol fallback declared in
 * `domain/fonts.ts`.
 */

import { googleFontsHref, webFontFaces, webFontsFor } from '../domain/fonts'

/**
 * How long to wait for a family before calling it unavailable.
 *
 * A hung request must not leave the editor waiting forever: without a deadline
 * a font chooser that never answers is indistinguishable from a broken app.
 */
const FONT_TIMEOUT_MS = 8000

export interface FontLoadOutcome {
  /** Families that are downloaded and usable for measurement. */
  ready: string[]
  /** Families that could not be loaded — network, blocking, or timeout. */
  failed: string[]
}

/** Families whose complete face set is confirmed usable, keyed by authored family. */
const usable = new Set<string>()
/** In-flight (or settled-successful) loads, so concurrent callers share one request. */
const pending = new Map<string, Promise<boolean>>()

function injectStylesheet(family: string): HTMLLinkElement {
  if (!document.querySelector('link[data-slaids-font-preconnect]')) {
    const preconnect = document.createElement('link')
    preconnect.rel = 'preconnect'
    preconnect.href = 'https://fonts.gstatic.com'
    preconnect.crossOrigin = 'anonymous'
    preconnect.setAttribute('data-slaids-font-preconnect', '')
    document.head.appendChild(preconnect)
  }

  const existing = [...document.querySelectorAll<HTMLLinkElement>('link[data-slaids-font]')].find(
    (link) => link.getAttribute('data-slaids-font') === family,
  )
  if (existing) return existing

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.setAttribute('data-slaids-font', family)
  link.href = googleFontsHref(family)
  document.head.appendChild(link)
  return link
}

/** Resolves once the stylesheet for this family has loaded, or rejects. */
function stylesheetReady(link: HTMLLinkElement): Promise<void> {
  // `sheet` is populated only for a stylesheet that has actually loaded, which
  // is how a link element reused across calls reports "already there".
  if (link.sheet) return Promise.resolve()
  return new Promise((resolve, reject) => {
    link.addEventListener('load', () => resolve(), { once: true })
    link.addEventListener('error', () => reject(new Error('stylesheet')), { once: true })
  })
}

async function loadFamily(family: string): Promise<boolean> {
  if (typeof document === 'undefined') return false
  const link = injectStylesheet(family)
  await stylesheetReady(link)

  const fonts = document.fonts
  // Without the CSS Font Loading API there is nothing to wait for and nothing
  // to verify; the stylesheet is as far as this environment goes.
  if (!fonts) return true

  const specs = webFontFaces(family).flatMap(({ family: face, weights }) =>
    weights.map((weight) => `${weight} 16px "${face}"`),
  )
  await Promise.all(specs.map((spec) => fonts.load(spec)))
  return specs.every((spec) => fonts.check(spec))
}

function withTimeout(work: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    work
      .then((value) => resolve(value))
      .catch(() => resolve(false))
      .finally(() => clearTimeout(timer))
  })
}

/**
 * Make sure every web font these stacks name is downloaded and usable.
 *
 * Resolves when there is nothing left to wait for, listing what worked and what
 * did not. System stacks resolve immediately and touch the network not at all.
 */
export function ensureWebFonts(stacks: string[]): Promise<FontLoadOutcome> {
  const families = webFontsFor(stacks)
  if (families.length === 0 || typeof document === 'undefined') {
    return Promise.resolve({ ready: [], failed: [] })
  }

  const loads = families.map((family) => {
    if (usable.has(family)) return Promise.resolve(true)
    let load = pending.get(family)
    if (!load) {
      load = withTimeout(loadFamily(family), FONT_TIMEOUT_MS).then((ok) => {
        pending.delete(family)
        if (ok) usable.add(family)
        return ok
      })
      pending.set(family, load)
    }
    return load
  })

  return Promise.all(loads).then((results) => {
    const outcome: FontLoadOutcome = { ready: [], failed: [] }
    results.forEach((ok, index) => {
      ;(ok ? outcome.ready : outcome.failed).push(families[index])
    })
    return outcome
  })
}

/** Whether every web font in these stacks is already usable, with no waiting. */
export function webFontsReady(stacks: string[]): boolean {
  return webFontsFor(stacks).every((family) => usable.has(family))
}

/** Test seam: forget what has been loaded so a case can start from nothing. */
export function resetWebFontsForTest(): void {
  usable.clear()
  pending.clear()
}
