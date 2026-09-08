/**
 * Finding the file a presentation already has.
 *
 * Against a real Dexie store, because half of what is under test is *what is
 * read*: a match is only ever answered on the stored bytes, a candidate whose
 * recorded hash differs costs no read, and a file that differs in size or type
 * is never read.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashBytes } from '../domain/assetHash'
import { createPresentation } from '../domain/presentation'
import { realImages } from '../domain/testImages'
import type { AssetRef, Presentation } from '../domain/types'
import { findIdenticalAsset } from './assetDedupe'
import { bytesToBlob } from './blob'
import { SlaidsDatabase } from './db'
import { DexieSlaidsRepository } from './dexieRepository'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshRepository(): DexieSlaidsRepository {
  counter += 1
  const database = new SlaidsDatabase(`slaids-dedupe-${counter}`)
  databases.push(database)
  return new DexieSlaidsRepository(database)
}

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

function ref(id: string, bytes: Uint8Array, extra: Partial<AssetRef> = {}): AssetRef {
  return {
    id,
    name: `${id}.png`,
    mimeType: 'image/png',
    byteSize: bytes.byteLength,
    width: 3,
    height: 2,
    isVector: false,
    ...extra,
  }
}

async function deckWith(
  repository: DexieSlaidsRepository,
  files: { ref: AssetRef; bytes: Uint8Array }[],
): Promise<Presentation> {
  const presentation = { ...createPresentation({ title: 'Dedupe' }), assets: files.map((file) => file.ref) }
  await repository.savePresentation(presentation)
  for (const file of files) {
    await repository.putAsset(presentation.id, file.ref, bytesToBlob(file.bytes, file.ref.mimeType))
  }
  return presentation
}

describe('findIdenticalAsset', () => {
  it('finds the file with the same bytes, whatever it was called', async () => {
    const repository = freshRepository()
    const png = realImages.png()
    const presentation = await deckWith(repository, [{ ref: ref('a_png', png, { name: 'first.png' }), bytes: png }])

    const found = await findIdenticalAsset(repository, presentation, { bytes: png, mimeType: 'image/png' })
    expect(found?.ref.id).toBe('a_png')
    expect(found?.hash).toBe(await hashBytes(png))
  })

  it('answers nothing for different bytes of the same size, and never reads a file of another size or type', async () => {
    const repository = freshRepository()
    const png = realImages.png()
    const other = png.slice()
    other[other.length - 5] ^= 0xff
    const webp = realImages.webp()
    const presentation = await deckWith(repository, [
      { ref: ref('a_png', png), bytes: png },
      { ref: ref('a_webp', webp, { mimeType: 'image/webp' }), bytes: webp },
    ])
    const getAsset = vi.spyOn(repository, 'getAsset')

    expect(await findIdenticalAsset(repository, presentation, { bytes: other, mimeType: 'image/png' })).toBeNull()
    // Only the same-size, same-type candidate was worth reading.
    expect(getAsset.mock.calls.map(([id]) => id)).toEqual(['a_png'])

    getAsset.mockClear()
    expect(
      await findIdenticalAsset(repository, presentation, { bytes: realImages.jpeg(), mimeType: 'image/jpeg' }),
    ).toBeNull()
    expect(getAsset).not.toHaveBeenCalled()
  })

  it('reads the bytes behind a matching hash before answering, and skips a differing hash without a read', async () => {
    const repository = freshRepository()
    const png = realImages.png()
    const hash = await hashBytes(png)
    const presentation = await deckWith(repository, [{ ref: ref('a_png', png, { contentHash: hash }), bytes: png }])
    const getAsset = vi.spyOn(repository, 'getAsset')

    const found = await findIdenticalAsset(repository, presentation, { bytes: png, mimeType: 'image/png', hash })
    expect(found?.ref.id).toBe('a_png')
    // The hash agreed, and the file was read all the same: the answer rests on
    // the bytes, never on the reference's account of them.
    expect(getAsset.mock.calls.map(([id]) => id)).toEqual(['a_png'])

    // A recorded hash that differs settles it without a read — the one thing a
    // recorded hash may decide, because the mistake it can make is a stored copy.
    getAsset.mockClear()
    const differs = { ...presentation, assets: [ref('a_png', png, { contentHash: 'f'.repeat(64) })] }
    expect(await findIdenticalAsset(repository, differs, { bytes: png, mimeType: 'image/png' })).toBeNull()
    expect(getAsset).not.toHaveBeenCalled()
  })

  it('never takes a stale hash as proof: right size, right recorded hash, other stored bytes is no match', async () => {
    const repository = freshRepository()
    const png = realImages.png()
    const other = png.slice()
    other[other.length - 5] ^= 0xff
    // The reference vouches for `png` on every count the document can check;
    // the store holds `other`. Only the bytes can tell, so only the bytes decide.
    const presentation = await deckWith(repository, [
      { ref: ref('a_stale', png, { contentHash: await hashBytes(png) }), bytes: other },
    ])

    expect(await findIdenticalAsset(repository, presentation, { bytes: png, mimeType: 'image/png' })).toBeNull()
  })

  it('skips a candidate whose bytes cannot be read rather than guessing', async () => {
    const repository = freshRepository()
    const png = realImages.png()
    // Listed in the document, but not in the store.
    const presentation = { ...createPresentation({ title: 'Dedupe' }), assets: [ref('a_ghost', png)] }
    await repository.savePresentation(presentation)
    expect(await findIdenticalAsset(repository, presentation, { bytes: png, mimeType: 'image/png' })).toBeNull()
  })
})
