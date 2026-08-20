/** Loads the small set of web fonts the theme picker offers. */

import { FONT_OPTIONS } from '../domain/fonts'

let loaded = false

export function loadWebFonts(): void {
  if (loaded || typeof document === 'undefined') return
  loaded = true
  const families = FONT_OPTIONS.flatMap((font) => (font.webFont ? [font.webFont] : []))
  if (families.length === 0) return

  const preconnect = document.createElement('link')
  preconnect.rel = 'preconnect'
  preconnect.href = 'https://fonts.gstatic.com'
  preconnect.crossOrigin = 'anonymous'
  document.head.appendChild(preconnect)

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  const query = families
    .map((family) => `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;600;700`)
    .join('&')
  link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`
  document.head.appendChild(link)
}
