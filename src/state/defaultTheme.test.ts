/**
 * Temaet en ny presentasjon starter med, slik denne nettleseren husker det.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { defaultTheme } from '../domain/presentation'
import { readDefaultTheme, writeDefaultTheme } from './defaultTheme'
import { writePref } from './prefs'

afterEach(() => localStorage.clear())

describe('standardtemaet', () => {
  it('gir tilbake det som ble lagret', () => {
    const theme = { ...defaultTheme(), boxShadows: false, titledCardStyle: 'floating' as const }
    writeDefaultTheme(theme)
    expect(readDefaultTheme()).toEqual(theme)
  })

  it('beholder fonter og skalaer fra før en innstilling fantes, og gir den nye standardverdien', () => {
    const { boxShadows: _shadows, titledCardStyle: _style, ...older } = {
      ...defaultTheme(),
      headingFontFamily: 'Georgia, serif',
    }
    writePref('defaultTheme', older)
    expect(readDefaultTheme()).toEqual({ ...defaultTheme(), headingFontFamily: 'Georgia, serif' })
  })

  it('faller tilbake til standarden når det lagrede ikke er et tema', () => {
    writePref('defaultTheme', 'tull')
    expect(readDefaultTheme()).toEqual(defaultTheme())
  })
})
