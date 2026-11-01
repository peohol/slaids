/**
 * How the app's own interface looks: dark, light, or whatever the operating
 * system says.
 *
 * A preference of this browser, not of a presentation, so it lives with the
 * other UI preferences in `localStorage` and never reaches the document or the
 * slide. The stylesheet does the actual work (`light-dark()` tokens in
 * `global.css`, docs/UX_DESIGN_SYSTEM.md § 2); all this does is tell it which
 * half to use, by setting `data-appearance` on `<html>`. «Follow the system» is
 * the stylesheet's default, so it keeps following the system live, with no
 * listener here, and a first visit looks right before any script has run.
 */

import { create } from 'zustand'
import { readPref, writePref } from './prefs'

export const APPEARANCES = ['dark', 'light', 'system'] as const

export type Appearance = (typeof APPEARANCES)[number]

export const DEFAULT_APPEARANCE: Appearance = 'system'

const KEY = 'appearance'

function isAppearance(value: unknown): value is Appearance {
  return APPEARANCES.includes(value as Appearance)
}

/** The stored choice; anything unreadable or unknown is the default. */
export function readAppearance(): Appearance {
  const stored = readPref<unknown>(KEY, DEFAULT_APPEARANCE)
  return isAppearance(stored) ? stored : DEFAULT_APPEARANCE
}

/** Tell the stylesheet which appearance is in force. */
export function applyAppearance(appearance: Appearance, root: HTMLElement = document.documentElement): void {
  root.dataset.appearance = appearance
}

interface AppearanceStore {
  appearance: Appearance
  setAppearance: (appearance: Appearance) => void
}

export const useAppearance = create<AppearanceStore>((set) => ({
  appearance: readAppearance(),
  setAppearance: (appearance) => {
    writePref(KEY, appearance)
    applyAppearance(appearance)
    set({ appearance })
  },
}))
