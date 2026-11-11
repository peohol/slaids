/**
 * Temaet en ny presentasjon starter med, slik denne nettleseren husker det.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { defaultTheme } from '../domain/presentation'
import { clearDefaultTheme, readDefaultTheme } from './defaultTheme'
import { writePref } from './prefs'

afterEach(() => localStorage.clear())

describe('standardtemaet', () => {
  it('gir tilbake det som ble lagret, uten logo', () => {
    const theme = { ...defaultTheme(), boxShadows: false, titledCardStyle: 'floating' as const }
    writePref('defaultTheme', {
      ...theme,
      logo: {
        assetId: 'a_logo',
        aspect: 2,
        sections: { visibility: 'front', placement: 'above', height: 120 },
        slides: { visible: true, position: 'bottom-right', height: 60 },
      },
    })
    expect(readDefaultTheme()).toEqual(theme)
  })

  it('er glemt når brukeren velger en temamal som standard', () => {
    writePref('defaultTheme', { ...defaultTheme(), boxShadows: false })
    clearDefaultTheme()
    expect(readDefaultTheme()).toEqual(defaultTheme())
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
