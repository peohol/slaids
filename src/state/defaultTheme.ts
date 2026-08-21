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
import type { PresentationTheme } from '../domain/types'
import { readPref, writePref } from './prefs'

const KEY = 'defaultTheme'

export function readDefaultTheme(): PresentationTheme {
  const stored = readPref<unknown>(KEY, null)
  if (!stored) return defaultTheme()
  const parsed = themeSchema.safeParse(stored)
  return parsed.success ? parsed.data : defaultTheme()
}

export function writeDefaultTheme(theme: PresentationTheme): void {
  writePref(KEY, theme)
}
