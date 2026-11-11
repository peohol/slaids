/**
 * The theme new presentations start from.
 *
 * A local preference, not presentation data: it says how *this* browser likes
 * to start a deck, and every presentation keeps its own theme once created.
 * That is why it lives in `localStorage` alongside window positions rather than
 * in IndexedDB. It is validated on the way out, so a hand-edited or
 * out-of-date value can never produce an invalid presentation.
 */

import { defaultTheme } from '../domain/presentation'
import { themeSchema } from '../domain/schema'
import { themeWithoutLogo } from '../domain/logo'
import type { PresentationTheme } from '../domain/types'
import { readPref, writePref } from './prefs'

const KEY = 'defaultTheme'

export function readDefaultTheme(): PresentationTheme {
  const stored = readPref<unknown>(KEY, null)
  if (!stored) return defaultTheme()
  // Lagt over dagens standardverdier, så et tema lagret før en innstilling
  // fantes, beholder fonter og skalaer og får den nye innstillingens standard.
  const parsed = themeSchema.safeParse(
    typeof stored === 'object' ? { ...defaultTheme(), ...stored } : stored,
  )
  return parsed.success ? themeWithoutLogo(parsed.data) : defaultTheme()
}

/**
 * Logoen er en fil i én presentasjon, og en ny presentasjon har ingen filer.
 * Standardtemaet bærer derfor aldri logoen; temamalene (§ 15.4) gjør det, med
 * en egen kopi av filen.
 */
export function writeDefaultTheme(theme: PresentationTheme): void {
  writePref(KEY, themeWithoutLogo(theme))
}
