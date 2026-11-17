// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { appearanceEntries } from '../ui/components/appearanceMenu'
import { APPEARANCES, DEFAULT_APPEARANCE, applyAppearance, readAppearance, useAppearance } from './appearance'

const STORAGE_KEY = 'slaids.ui.appearance'

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.appearance
  useAppearance.setState({ appearance: DEFAULT_APPEARANCE })
})

describe('utseendet', () => {
  it('følger systemet når ingenting er valgt', () => {
    expect(DEFAULT_APPEARANCE).toBe('system')
    expect(readAppearance()).toBe('system')
  })

  it.each(['"sepia"', '42', 'ikke json', 'null'])(
    'faller tilbake til standarden for en lagret verdi som ikke er et utseende (%s)',
    (raw) => {
      localStorage.setItem(STORAGE_KEY, raw)
      expect(readAppearance()).toBe(DEFAULT_APPEARANCE)
    },
  )

  it.each(APPEARANCES)('valget «%s» settes på <html>, lagres og leses tilbake', (appearance) => {
    useAppearance.getState().setAppearance(appearance)
    expect(useAppearance.getState().appearance).toBe(appearance)
    expect(document.documentElement.dataset.appearance).toBe(appearance)
    expect(readAppearance()).toBe(appearance)
  })

  it('applyAppearance skriver bare attributtet stilarket velger på', () => {
    const root = document.createElement('div')
    applyAppearance('light', root)
    expect(root.dataset.appearance).toBe('light')
  })
})

describe('utseendemenyen', () => {
  it.each(APPEARANCES)('har én oppføring per utseende, og bare «%s» er avhaket', (current) => {
    const entries = appearanceEntries(current, () => {})
    expect(entries.map((entry) => entry.id)).toEqual(APPEARANCES.map((a) => `appearance-${a}`))
    expect(entries.filter((entry) => entry.checked).map((entry) => entry.id)).toEqual([
      `appearance-${current}`,
    ])
  })

  it('en oppføring velger sitt eget utseende', () => {
    const chosen: string[] = []
    for (const entry of appearanceEntries('system', (appearance) => chosen.push(appearance))) {
      entry.onSelect()
    }
    expect(chosen).toEqual([...APPEARANCES])
  })
})
