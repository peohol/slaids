/**
 * Loads web fonts on demand.
 *
 * Only families a presentation actually uses are requested, so the default
 * (system) theme makes no network request at all.
 */

import { webFontsFor } from '../domain/fonts'

const loaded = new Set<string>()

export function loadWebFonts(stacks: string[]): void {
  if (typeof document === 'undefined') return
  const families = webFontsFor(stacks).filter((family) => !loaded.has(family))
  if (families.length === 0) return
  for (const family of families) loaded.add(family)

  if (!document.querySelector('link[data-slaids-font-preconnect]')) {
    const preconnect = document.createElement('link')
    preconnect.rel = 'preconnect'
    preconnect.href = 'https://fonts.gstatic.com'
    preconnect.crossOrigin = 'anonymous'
    preconnect.setAttribute('data-slaids-font-preconnect', '')
    document.head.appendChild(preconnect)
  }

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  const query = families
    .map((family) => `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;600;700`)
    .join('&')
  link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`
  document.head.appendChild(link)
}
