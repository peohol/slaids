/**
 * The theme new presentations start from, when the user has not chosen a
 * theme template as their default.
 *
 * A local preference, not presentation data: it says how *this* browser likes
 * to start a deck, and every presentation keeps its own theme once created.
 * It is validated on the way out, so a hand-edited or out-of-date value can
 * never produce an invalid presentation.
 *
 * Nothing writes it any more. «Bruk som standard for nye presentasjoner» is a
 * choice on a theme template now (§ 15.4), stored per user; a theme saved here
 * before that keeps working until the user picks a template.
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
 * Glem det lokale standardtemaet. Kalles når brukeren velger en temamal som
 * standard (§ 15.4): da gjelder malen, og to standarder kan aldri gjelde
 * samtidig.
 *
 * Et tema lagres ikke lenger her. Det som allerede er lagret, leses fortsatt av
 * `readDefaultTheme` – uten logoen, som er en fil i én presentasjon – til
 * brukeren velger en mal.
 */
export function clearDefaultTheme(): void {
  writePref(KEY, null)
}
