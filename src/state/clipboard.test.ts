import { afterEach, describe, expect, it } from 'vitest'
import {
  SLAIDS_CLIPBOARD_FORMAT,
  hasStructuralClipboard,
  instantiateClipboardContent,
  readStructuralClipboard,
  readStructuralClipboardSync,
  writeStructuralClipboard,
} from './clipboard'
import { validateClipboardPayload } from '../domain/schema'
import { createTitledCard } from '../domain/content'

/** jsdom has no clipboard, so the system half of the API is stubbed. */
function stubSystemClipboard(readText: () => Promise<string>): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { readText, writeText: async () => undefined },
    configurable: true,
  })
}

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('structural clipboard', () => {
  it('stores a versioned payload that validates', () => {
    const card = createTitledCard('Kopier meg')
    writeStructuralClipboard(card, [])
    const payload = readStructuralClipboardSync()
    expect(payload).not.toBeNull()
    expect(payload?.format).toBe('application/x-slaids-content')
    expect(payload?.version).toBe(1)
    expect(validateClipboardPayload(payload).ok).toBe(true)
    expect(hasStructuralClipboard()).toBe(true)
  })

  it('regenerates ids when instantiating, so a paste cannot collide', () => {
    const card = createTitledCard('Kopier meg')
    writeStructuralClipboard(card, [])
    const payload = readStructuralClipboardSync()
    expect(payload).not.toBeNull()
    if (!payload) return

    const first = instantiateClipboardContent(payload)
    const second = instantiateClipboardContent(payload)
    expect(first.id).not.toBe(card.id)
    expect(second.id).not.toBe(first.id)
    if (first.kind === 'titled-card' && second.kind === 'titled-card') {
      expect(first.body.subfields[0].id).not.toBe(card.body.subfields[0].id)
      expect(first.body.subfields[0].id).not.toBe(second.body.subfields[0].id)
      expect(JSON.stringify(first.title)).toBe(JSON.stringify(card.title))
    }
  })

  it('preserves asset references across a copy', () => {
    const content = {
      id: 'c1',
      kind: 'container' as const,
      payload: { type: 'asset' as const, assetId: 'asset-9', fit: 'contain' as const },
    }
    writeStructuralClipboard(content, [
      { id: 'asset-9', name: 'f.svg', mimeType: 'image/svg+xml', byteSize: 1, width: 1, height: 1, isVector: true },
    ])
    const payload = readStructuralClipboardSync()
    expect(payload).not.toBeNull()
    if (!payload) return
    const copy = instantiateClipboardContent(payload)
    expect(copy.kind).toBe('container')
    if (copy.kind === 'container' && copy.payload.type === 'asset') {
      expect(copy.payload.assetId).toBe('asset-9')
    }
    expect(payload.assets[0].id).toBe('asset-9')
  })

  it('prefers a valid payload from the system clipboard, so a copy survives a reload', async () => {
    writeStructuralClipboard(createTitledCard('I minnet'), [])
    const fromSystem = {
      format: SLAIDS_CLIPBOARD_FORMAT,
      version: 1,
      content: createTitledCard('Fra systemet'),
      assets: [],
    }
    stubSystemClipboard(async () => JSON.stringify(fromSystem))

    const payload = await readStructuralClipboard()
    expect(payload?.content.id).toBe(fromSystem.content.id)
  })

  it('falls back to the in-memory payload when the system clipboard is unusable', async () => {
    const card = createTitledCard('Bare i minnet')
    writeStructuralClipboard(card, [])

    stubSystemClipboard(async () => 'et helt vanlig avsnitt kopiert fra en nettside')
    expect((await readStructuralClipboard())?.content.id).toBe(card.id)

    stubSystemClipboard(async () => {
      throw new Error('nektet')
    })
    expect((await readStructuralClipboard())?.content.id).toBe(card.id)
  })

  it('gives up on a system clipboard that never answers, rather than hanging', async () => {
    const card = createTitledCard('Minnet redder pastingen')
    writeStructuralClipboard(card, [])
    // A permission prompt nobody answers leaves the promise pending forever.
    stubSystemClipboard(() => new Promise<string>(() => {}))
    expect((await readStructuralClipboard())?.content.id).toBe(card.id)
  })
})
