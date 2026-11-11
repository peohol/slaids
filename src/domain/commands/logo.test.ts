/**
 * Logoen som fil i dekket: kommandoene som setter, endrer og fjerner den, og
 * at hver vei som spør «hvilke filer viser dette dekket?» også ser logoen.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_LOGO_SLIDE_HEIGHT, LOGO_MIN_HEIGHT, SLIDE_HEIGHT } from '../constants'
import { dropAssetIds, remapAssetIds } from '../docs'
import { createPresentation, duplicatePresentationDocument } from '../presentation'
import { buildSharedSnapshot } from '../sharing'
import type { AssetRef, Presentation } from '../types'
import { findPresentationIssues } from '../validation'
import {
  deckAssetIds,
  mergeDuplicateAssets,
  pruneAssets,
  registerAsset,
  removeAsset,
  summarizeAssetUsage,
  usedAssetIds,
} from './assets'
import { HUMAN_EDIT } from './manualLayout'
import { removeThemeLogo, setThemeLogo, updateThemeLogo } from './logo'

const LOGO: AssetRef = {
  id: 'a_logo',
  name: 'logo.svg',
  mimeType: 'image/svg+xml',
  byteSize: 512,
  width: 300,
  height: 100,
  isVector: true,
}

const COPY: AssetRef = { ...LOGO, id: 'a_copy' }

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`Forventet ok, fikk ${JSON.stringify(result.error)}`)
  }
  return result.value
}

function deckWithLogo(): Presentation {
  const presentation = unwrap(registerAsset(createPresentation({ title: 'Logo' }), LOGO))
  return unwrap(setThemeLogo(presentation, LOGO.id))
}

describe('setThemeLogo', () => {
  it('tar formen fra filen og starter med standardinnstillingene', () => {
    const logo = deckWithLogo().theme.logo!
    expect(logo.assetId).toBe(LOGO.id)
    expect(logo.aspect).toBe(3)
    expect(logo.slides.height).toBe(DEFAULT_LOGO_SLIDE_HEIGHT)
    expect(logo.sections.visibility).toBe('front')
  })

  it('beholder plassering og størrelse når filen byttes', () => {
    let presentation = deckWithLogo()
    presentation = unwrap(updateThemeLogo(presentation, { slides: { position: 'top-left', height: 50 } }))
    const square = { ...LOGO, id: 'a_square', width: 200, height: 200 }
    presentation = unwrap(registerAsset(presentation, square))
    const logo = unwrap(setThemeLogo(presentation, square.id)).theme.logo!
    expect(logo).toMatchObject({ assetId: square.id, aspect: 1 })
    expect(logo.slides).toMatchObject({ position: 'top-left', height: 50 })
  })

  it('nekter en fil dekket ikke har, og en fil som ikke er et bilde', () => {
    const presentation = createPresentation({ title: 'Logo' })
    expect(setThemeLogo(presentation, 'a_none')).toMatchObject({ ok: false, error: { code: 'ASSET_NOT_FOUND' } })
    const pdf = { ...LOGO, id: 'a_pdf', mimeType: 'application/pdf' }
    const withPdf = unwrap(registerAsset(presentation, pdf))
    expect(setThemeLogo(withPdf, pdf.id)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
  })
})

describe('updateThemeLogo', () => {
  it('endrer bare det som nevnes', () => {
    const presentation = unwrap(
      updateThemeLogo(deckWithLogo(), { sections: { placement: 'below' }, slides: { visible: false } }),
    )
    const logo = presentation.theme.logo!
    expect(logo.sections).toMatchObject({ visibility: 'front', placement: 'below' })
    expect(logo.slides).toMatchObject({ visible: false, position: 'bottom-right' })
  })

  it('nekter verdier utenfor grensene, og et dekk uten logo', () => {
    for (const height of [LOGO_MIN_HEIGHT - 1, SLIDE_HEIGHT + 1, Number.NaN]) {
      expect(updateThemeLogo(deckWithLogo(), { slides: { height } }).ok).toBe(false)
    }
    expect(
      updateThemeLogo(deckWithLogo(), { slides: { position: 'middle' as never } }).ok,
    ).toBe(false)
    expect(updateThemeLogo(createPresentation({ title: 'x' }), { slides: { height: 50 } }).ok).toBe(false)
  })

  it('lar en person be om en stor logo – den tegnes så stor som det er plass til', () => {
    const presentation = unwrap(
      updateThemeLogo(deckWithLogo(), { slides: { height: SLIDE_HEIGHT } }, HUMAN_EDIT),
    )
    expect(presentation.theme.logo!.slides.height).toBe(SLIDE_HEIGHT)
  })
})

describe('removeThemeLogo', () => {
  it('fjerner logoen, og filen blir ubrukt', () => {
    const presentation = unwrap(removeThemeLogo(deckWithLogo()))
    expect(presentation.theme.logo).toBeUndefined()
    expect('logo' in presentation.theme).toBe(false)
    expect(pruneAssets(presentation).removed.map((asset) => asset.id)).toEqual([LOGO.id])
  })
})

describe('logoen i filveiene', () => {
  it('regnes som brukt, og kan ikke slettes mens den er logo', () => {
    const presentation = deckWithLogo()
    expect(usedAssetIds(presentation).has(LOGO.id)).toBe(true)
    expect(pruneAssets(presentation).removed).toEqual([])
    expect(summarizeAssetUsage(presentation, LOGO.id)).toMatchObject({ total: 1, theme: 1 })
    const refused = removeAsset(presentation, LOGO.id)
    expect(refused).toMatchObject({ ok: false, error: { code: 'ASSET_IN_USE' } })
    if (!refused.ok) expect(refused.error.message).toContain('logoen')
  })

  it('følger med i det delte øyeblikksbildet', () => {
    const presentation = deckWithLogo()
    expect(deckAssetIds(presentation).has(LOGO.id)).toBe(true)
    const snapshot = buildSharedSnapshot(presentation, '2026-11-11T00:00:00.000Z')
    expect(snapshot.theme.logo?.assetId).toBe(LOGO.id)
    expect(snapshot.assets.map((asset) => asset.id)).toEqual([LOGO.id])
  })

  it('pekes om ved import og kopiering, og kopien har sin egen fil', () => {
    const remapped = remapAssetIds(deckWithLogo(), new Map([[LOGO.id, 'a_new']]))
    expect(remapped.theme.logo!.assetId).toBe('a_new')
    expect(remapped.assets.map((asset) => asset.id)).toEqual(['a_new'])

    const { presentation: copy, assetIds } = duplicatePresentationDocument(deckWithLogo(), { title: 'Kopi' })
    const copied = assetIds.get(LOGO.id)
    expect(copied).toBeDefined()
    expect(copy.theme.logo!.assetId).toBe(copied)
  })

  it('forsvinner når filen ikke kan tas med', () => {
    const dropped = dropAssetIds(deckWithLogo(), new Set([LOGO.id]))
    expect(dropped.theme.logo).toBeUndefined()
    expect(findPresentationIssues(dropped)).toEqual([])
  })

  it('følger med når like filer slås sammen', () => {
    let presentation = unwrap(registerAsset(deckWithLogo(), COPY))
    presentation = unwrap(setThemeLogo(presentation, COPY.id))
    const merged = unwrap(mergeDuplicateAssets(presentation, new Map([[COPY.id, LOGO.id]])))
    expect(merged.theme.logo!.assetId).toBe(LOGO.id)
    expect(findPresentationIssues(merged)).toEqual([])
  })

  it('meldes som feil når filen mangler', () => {
    const broken = { ...deckWithLogo(), assets: [] }
    expect(findPresentationIssues(broken)).toEqual([
      expect.objectContaining({ code: 'ASSET_NOT_FOUND', details: { assetId: LOGO.id, theme: 'logo' } }),
    ])
  })
})
