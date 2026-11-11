/**
 * Temaets logo i lagerveiene (§ 15.5): sikkerhetskopi, import som kopi,
 * avvisning ved døren, kopiering av presentasjoner og eldre dokumenter uten
 * logo. Logoen er en vanlig fil i presentasjonen, men den står i temaet og
 * ikke i en sone, så hver vei som flytter filer, må også se den.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { registerAsset, setThemeLogo } from '../domain/commands'
import { deckAssetIds } from '../domain/commands/assets'
import { computeSlideGeometry } from '../domain/geometry'
import { geometryForDeck } from '../domain/logo'
import { geometryForTheme } from '../domain/metrics'
import { createPresentation } from '../domain/presentation'
import { contentAt } from '../domain/testDecks'
import type { AssetRef, Presentation } from '../domain/types'
import { findPresentationIssues } from '../domain/validation'
import { exportSlaidsArchive, importSlaidsArchive } from './backup'
import { SlaidsDatabase } from './db'
import { DexieSlaidsRepository } from './dexieRepository'
import { duplicatePresentation } from './library'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshRepository(): DexieSlaidsRepository {
  counter += 1
  const database = new SlaidsDatabase(`slaids-theme-logo-${counter}`)
  databases.push(database)
  return new DexieSlaidsRepository(database)
}

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

const LOGO_MARKUP =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect width="300" height="100" fill="#1f6feb"/></svg>'

const LOGO: AssetRef = {
  id: 'a_logo',
  name: 'logo.svg',
  mimeType: 'image/svg+xml',
  byteSize: LOGO_MARKUP.length,
  width: 300,
  height: 100,
  isVector: true,
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Et dekk der logoen er den eneste filen: den står ikke i noen sone. */
async function storedDeckWithLogo(
  repository: DexieSlaidsRepository,
  markup = LOGO_MARKUP,
): Promise<Presentation> {
  const base = createPresentation({ title: 'Med logo' })
  const deck = unwrap(setThemeLogo(unwrap(registerAsset(base, LOGO)), LOGO.id))
  await repository.savePresentation(deck)
  await repository.putAsset(deck.id, LOGO, new Blob([markup], { type: 'image/svg+xml' }))
  return deck
}

async function logoBytes(repository: DexieSlaidsRepository, deck: Presentation): Promise<string | null> {
  const id = deck.theme.logo?.assetId
  return id ? ((await (await repository.getAsset(id))?.blob.text()) ?? null) : null
}

describe('logoen i en .slaids-sikkerhetskopi', () => {
  it('følger med ut og inn, også når den ikke står i noen sone', async () => {
    const source = freshRepository()
    const deck = await storedDeckWithLogo(source)
    const archive = await exportSlaidsArchive(source, { presentationIds: [deck.id] })

    const target = freshRepository()
    const report = await importSlaidsArchive(target, archive)
    expect(report.errors).toEqual([])
    expect(report.importedAssets).toBe(1)
    const restored = await target.loadPresentation(deck.id)
    expect(restored.theme.logo).toEqual(deck.theme.logo)
    expect(await logoBytes(target, restored)).toContain('<rect')
    expect(findPresentationIssues(restored)).toEqual([])
  })

  it('får en egen fil når presentasjonen importeres som kopi', async () => {
    const repository = freshRepository()
    const deck = await storedDeckWithLogo(repository)
    const archive = await exportSlaidsArchive(repository, { presentationIds: [deck.id] })

    const report = await importSlaidsArchive(repository, archive)
    expect(report.errors).toEqual([])
    const [copyId] = report.importedPresentations
    expect(copyId).not.toBe(deck.id)
    const copy = await repository.loadPresentation(copyId)
    expect(copy.theme.logo?.assetId).not.toBe(LOGO.id)
    expect(copy.assets.map((asset) => asset.id)).toEqual([copy.theme.logo?.assetId])
    expect(await logoBytes(repository, copy)).toContain('<rect')
    // Originalen er urørt.
    expect((await repository.loadPresentation(deck.id)).theme.logo?.assetId).toBe(LOGO.id)
  })

  it('tas ut av temaet når døren avviser filen, og resten av dekket kommer inn', async () => {
    const source = freshRepository()
    const deck = await storedDeckWithLogo(
      source,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><script>alert(1)</script></svg>',
    )
    const archive = await exportSlaidsArchive(source, { presentationIds: [deck.id] })

    const target = freshRepository()
    const report = await importSlaidsArchive(target, archive)
    expect(report.importedPresentations).toEqual([deck.id])
    expect(report.errors.join(' ')).toContain('logo.svg')
    const restored = await target.loadPresentation(deck.id)
    expect(restored.theme.logo).toBeUndefined()
    expect(restored.assets).toEqual([])
    expect(findPresentationIssues(restored)).toEqual([])
  })
})

describe('logoen når en presentasjon kopieres', () => {
  it('får kopien sin egen fil, som lever videre når originalen slettes', async () => {
    const repository = freshRepository()
    const deck = await storedDeckWithLogo(repository)
    const copy = await duplicatePresentation(repository, deck)
    expect(copy.theme.logo?.assetId).toBeDefined()
    expect(copy.theme.logo?.assetId).not.toBe(LOGO.id)
    expect(copy.theme.logo?.aspect).toBe(deck.theme.logo?.aspect)

    await repository.deletePresentation(deck.id)
    expect(await repository.getAsset(LOGO.id)).toBeNull()
    expect(await logoBytes(repository, await repository.loadPresentation(copy.id))).toContain('<rect')
  })
})

describe('en presentasjon fra før logoen fantes', () => {
  it('leses uten logo, uten filer å vise og med nøyaktig den gamle geometrien', async () => {
    const repository = freshRepository()
    const old = createPresentation({ title: 'Gammel' })
    const { logo: _logo, ...theme } = old.theme
    await repository.savePresentation({ ...old, theme })
    const loaded = await repository.loadPresentation(old.id)
    expect(loaded.theme).not.toHaveProperty('logo')
    expect([...deckAssetIds(loaded)]).toEqual([])
    expect(geometryForDeck(loaded)).toEqual({ ...geometryForTheme(loaded.theme), logo: null })
    const slide = contentAt(loaded, 1)
    expect(computeSlideGeometry(slide, geometryForDeck(loaded)).rects).toEqual(
      computeSlideGeometry(slide, geometryForTheme(loaded.theme)).rects,
    )
  })
})
