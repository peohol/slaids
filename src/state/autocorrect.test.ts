import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_AUTOCORRECT_RULES } from '../domain/autocorrect'
import { setRepositoryOverride } from '../persistence/activeRepository'
import { SlaidsDatabase } from '../persistence/db'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import {
  currentAutocorrectRules,
  loadAutocorrect,
  resetAutocorrect,
  saveAutocorrect,
} from './autocorrect'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshRepository(): DexieSlaidsRepository {
  counter += 1
  const database = new SlaidsDatabase(`slaids-autocorrect-${counter}`)
  databases.push(database)
  const repository = new DexieSlaidsRepository(database)
  setRepositoryOverride(repository)
  return repository
}

afterEach(async () => {
  resetAutocorrect()
  setRepositoryOverride(null)
  while (databases.length > 0) await databases.pop()?.delete()
})

describe('autoerstatt-reglene i minnet', () => {
  it('substituerer ingenting før lista er hentet, og ingen lagring kan erstatte en liste ingen har sett', async () => {
    const repository = freshRepository()
    await repository.saveAutocorrectRules([{ from: '(c)', to: '©' }])

    expect(currentAutocorrectRules()).toEqual([])
    await expect(saveAutocorrect([{ from: 'x', to: 'y' }])).rejects.toThrow(/ikke hentet/)
    expect(await repository.loadAutocorrectRules()).toEqual([{ from: '(c)', to: '©' }])

    await loadAutocorrect()
    expect(currentAutocorrectRules()).toEqual([{ from: '(c)', to: '©' }])
  })

  it('lagrer en endret liste, og sier fra når ingenting endret seg', async () => {
    const repository = freshRepository()
    await loadAutocorrect()
    expect(currentAutocorrectRules()).toEqual(DEFAULT_AUTOCORRECT_RULES)

    expect(await saveAutocorrect(DEFAULT_AUTOCORRECT_RULES)).toBe(false)
    expect(await saveAutocorrect([{ from: '...', to: '…' }])).toBe(true)
    expect(currentAutocorrectRules()).toEqual([{ from: '...', to: '…' }])
    expect(await repository.loadAutocorrectRules()).toEqual([{ from: '...', to: '…' }])
  })

  it('glemmer lista når brukeren går', async () => {
    freshRepository()
    await loadAutocorrect()
    resetAutocorrect()
    expect(currentAutocorrectRules()).toEqual([])
  })
})
