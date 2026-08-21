import { afterEach, describe, expect, it } from 'vitest'
import { SlaidsDatabase } from './db'
import { DexieSlaidsRepository } from './dexieRepository'
import { createPresentation } from '../domain/presentation'
import type { AssetRef } from '../domain/types'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshRepository(): DexieSlaidsRepository {
  counter += 1
  const database = new SlaidsDatabase(`slaids-orphans-${counter}`)
  databases.push(database)
  return new DexieSlaidsRepository(database)
}

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

const ref = (id: string): AssetRef => ({
  id,
  name: `${id}.svg`,
  mimeType: 'image/svg+xml',
  byteSize: 8,
  width: 10,
  height: 10,
  isVector: true,
})

describe('orphaned assets', () => {
  it('reclaims asset rows whose presentation no longer exists', async () => {
    const repository = freshRepository()
    const presentation = createPresentation({ title: 'Eier' })
    await repository.savePresentation(presentation)
    await repository.putAsset(presentation.id, ref('kept'), new Blob(['<svg/>']))
    // An interrupted import can leave this behind: an asset with no owner.
    await repository.putAsset('borte', ref('orphan'), new Blob(['<svg/>']))

    expect(await repository.deleteOrphanAssets()).toBe(1)
    expect(await repository.getAsset('orphan')).toBeNull()
    expect(await repository.getAsset('kept')).not.toBeNull()
  })

  it('does nothing when every asset has an owner', async () => {
    const repository = freshRepository()
    const presentation = createPresentation({ title: 'Eier' })
    await repository.savePresentation(presentation)
    await repository.putAsset(presentation.id, ref('a'), new Blob(['<svg/>']))
    expect(await repository.deleteOrphanAssets()).toBe(0)
    expect(await repository.getAsset('a')).not.toBeNull()
  })

  it('reclaims everything after the owning presentation is deleted', async () => {
    const repository = freshRepository()
    const presentation = createPresentation({ title: 'Eier' })
    await repository.savePresentation(presentation)
    await repository.putAsset(presentation.id, ref('a'), new Blob(['<svg/>']))
    await repository.deletePresentation(presentation.id)
    // deletePresentation already removes them, so nothing is left to reclaim.
    expect(await repository.deleteOrphanAssets()).toBe(0)
  })
})
