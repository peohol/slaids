import { describe, expect, it } from 'vitest'
import { createCaption, createImage } from '../content'
import { assetOccurrences } from '../imageOptimization'
import { migratePresentation } from '../migrations'
import { createPresentation, duplicatePresentationDocument } from '../presentation'
import { computeReferenceNumbering } from '../references'
import type { Result } from '../result'
import { buildSharedSnapshot } from '../sharing'
import { contentAt } from '../testDecks'
import type { AssetRef } from '../types'
import {
  addReference,
  deleteReference,
  deleteUnusedReferences,
  moveSlideToSandbox,
  registerAsset,
  removeAsset,
  restoreSandboxSlide,
  setZoneContent,
  usedAssetIds,
} from './index'

const file: AssetRef = {
  id: 'a_bilde',
  name: 'bilde.png',
  mimeType: 'image/png',
  byteSize: 1024,
  width: 400,
  height: 300,
  isVector: false,
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

describe('parkering av en hel slide', () => {
  it('bevarer sliden og ressursene privat, også etter lagring og duplisering', () => {
    const deck = unwrap(registerAsset(createPresentation({ title: 'Forside' }), file))
    const added = unwrap(addReference(deck, { title: 'Studie', authors: '', year: '', url: '' }))
    const slide = contentAt(added.presentation, 1)
    const picture = createImage(file.id)
    const withImage = unwrap(setZoneContent(added.presentation, {
      slideId: slide.id,
      nodeId: slide.root.id,
      content: {
        ...picture,
        image: {
          ...picture.image,
          caption: createCaption('bottom', {
            type: 'doc',
            content: [{
              type: 'paragraph',
              content: [{ type: 'citation', attrs: { referenceIds: [added.reference.id] } }],
            }],
          }),
        },
      },
    })).presentation

    const parked = unwrap(moveSlideToSandbox(withImage, slide.id))
    expect(parked.slides).toEqual([withImage.slides[0]])
    expect(parked.sandboxSlides).toEqual([withImage.slides[1]])
    expect(computeReferenceNumbering(parked).size).toBe(0)
    expect(unwrap(deleteUnusedReferences(parked)).references).toEqual([added.reference])
    expect(removeAsset(parked, file.id).ok).toBe(false)
    expect(assetOccurrences(parked).get(file.id)).toEqual([{ kind: 'sandbox', itemId: slide.id }])
    expect(buildSharedSnapshot(parked)).toMatchObject({ slides: parked.slides, references: [], assets: [] })
    expect(buildSharedSnapshot(parked)).not.toHaveProperty('sandboxSlides')

    const reloaded = unwrap(migratePresentation(JSON.parse(JSON.stringify(parked))))
    const restored = unwrap(restoreSandboxSlide(reloaded, { slideId: slide.id }))
    expect(restored.slides).toEqual(withImage.slides)
    expect(restored.sandboxSlides).toEqual([])
    expect(computeReferenceNumbering(restored).get(added.reference.id)).toBe(1)

    const copied = duplicatePresentationDocument(parked)
    expect(copied.presentation.sandboxSlides?.[0]?.id).not.toBe(slide.id)
    expect(copied.presentation.sandboxSlides?.[0]?.root.id).not.toBe(slide.root.id)
    expect(usedAssetIds(copied.presentation)).toEqual(new Set([copied.assetIds.get(file.id)]))

    const cleaned = unwrap(deleteReference(parked, added.reference.id))
    expect(JSON.stringify(cleaned.sandboxSlides)).not.toContain(added.reference.id)
  })

  it('holder forsiden i dekket og gjenoppretter bare en parkert slide', () => {
    const deck = createPresentation({ title: 'Forside' })
    const slideId = deck.slides[1].id
    expect(moveSlideToSandbox(deck, deck.slides[0].id).ok).toBe(false)
    expect(restoreSandboxSlide(deck, { slideId }).ok).toBe(false)

    const parked = unwrap(moveSlideToSandbox(deck, slideId))
    expect(restoreSandboxSlide(parked, { slideId, index: 0 }).ok).toBe(false)
    expect(restoreSandboxSlide(parked, { slideId, index: 1 }).ok).toBe(true)
  })
})
