/**
 * Putting one file where another was, and the file list staying true.
 *
 * The property under test is the one `validate_presentation` would otherwise
 * report: after any of these commands, every file the document shows is in its
 * file list, and no file in the list is shown by nothing it did not already
 * show nothing by.
 */

import { describe, expect, it } from 'vitest'
import { containerWithDoc, createImage, imagePanelOf } from '../content'
import { createLeaf, createSplit } from '../layout'
import { createPresentation } from '../presentation'
import { imageNode, inlineImageOf, walkRichNodes } from '../richdoc'
import { contentAt, sectionAt } from '../testDecks'
import type { AssetRef, LayoutNode, Presentation, ZoneContent } from '../types'
import { mergeDuplicateAssets, replaceAssetUses, usedAssetIds } from './assets'

const OLD: AssetRef = {
  id: 'a_old',
  name: 'ferie.jpg',
  mimeType: 'image/jpeg',
  byteSize: 4_000_000,
  width: 4000,
  height: 3000,
  isVector: false,
}

const NEW: AssetRef = {
  id: 'a_new',
  name: 'ferie.webp',
  mimeType: 'image/webp',
  byteSize: 200_000,
  width: 799,
  height: 600,
  isVector: false,
  contentHash: 'a'.repeat(64),
}

function unwrap<T>(result: { ok: boolean; value?: T; error?: { code: string } }): T {
  if (!result.ok) throw new Error(`uventet feil: ${result.error?.code}`)
  return result.value as T
}

function deckWith(root: LayoutNode, assets: AssetRef[], sandbox: ZoneContent[] = []): Presentation {
  const base = createPresentation({ title: 'Erstatning' })
  return {
    ...base,
    assets,
    slides: [sectionAt(base, 0), { ...contentAt(base, 1), title: null, root }],
    sandbox: sandbox.map((content, index) => ({ id: `sb${index}`, content, createdAt: base.createdAt, note: '' })),
  }
}

/** A container whose one field holds a picture of `assetId`, with or without a stored ratio. */
function textWithPicture(assetId: string, aspect: number | null): ZoneContent {
  return containerWithDoc({
    type: 'doc',
    content: [{ type: 'paragraph', content: [imageNode(assetId, { aspect })] }],
  })
}

function inlineImages(presentation: Presentation): { assetId: string; aspect: number | null }[] {
  const out: { assetId: string; aspect: number | null }[] = []
  const visit = (content: ZoneContent): void => {
    if (content.kind !== 'container') return
    for (const field of content.body.subfields) {
      walkRichNodes(field.doc, (node) => {
        const image = inlineImageOf(node)
        if (image) out.push({ assetId: image.assetId, aspect: image.aspect })
      })
    }
  }
  const walk = (node: LayoutNode): void => {
    if (node.kind === 'leaf') {
      if (node.content) visit(node.content)
      return
    }
    node.children.forEach(walk)
  }
  for (const slide of presentation.slides) if (slide.kind === 'content') walk(slide.root)
  for (const item of presentation.sandbox) visit(item.content)
  return out
}

function leftAndRight(presentation: Presentation): [LayoutNode, LayoutNode] {
  const root = contentAt(presentation, 1).root
  if (root.kind !== 'split') throw new Error('forventet en delt sone')
  return [root.children[0], root.children[1]]
}

function panelAssetOf(node: LayoutNode): string | null | undefined {
  return node.kind === 'leaf' && node.content ? imagePanelOf(node.content)?.assetId : undefined
}

describe('replacing a file everywhere it is shown', () => {
  it('repoints panels, inline pictures and the sandbox, and swaps the file list entry', () => {
    const deck = deckWith(
      createSplit('x', [1, 1], [createLeaf(createImage('a_old')), createLeaf(textWithPicture('a_old', 4 / 3))]),
      [OLD],
      [createImage('a_old')],
    )
    const next = unwrap(replaceAssetUses(deck, { fromId: 'a_old', to: NEW }))

    const [left] = leftAndRight(next)
    expect(panelAssetOf(left)).toBe('a_new')
    expect(imagePanelOf(next.sandbox[0].content)?.assetId).toBe('a_new')
    expect(inlineImages(next)).toEqual([{ assetId: 'a_new', aspect: NEW.width / NEW.height }])

    // The old file is shown nowhere and leaves the list; the new one is on it.
    expect(next.assets.map((asset) => asset.id)).toEqual(['a_new'])
    expect(next.assets[0]).toEqual(NEW)
    expect(usedAssetIds(next)).toEqual(new Set(['a_new']))
    expect(next.updatedAt >= deck.updatedAt).toBe(true)
  })

  it('leaves a picture node that never stored a ratio drawing the default', () => {
    const deck = deckWith(createLeaf(textWithPicture('a_old', null)), [OLD])
    const next = unwrap(replaceAssetUses(deck, { fromId: 'a_old', to: NEW }))
    expect(inlineImages(next)).toEqual([{ assetId: 'a_new', aspect: null }])
  })

  it('keeps the crop where it was unless told to centre it', () => {
    const cropped = createImage('a_old')
    cropped.image.focus = { x: 0.2, y: 0.9 }
    const deck = deckWith(createLeaf(cropped), [OLD])

    const kept = unwrap(replaceAssetUses(deck, { fromId: 'a_old', to: NEW }))
    const keptRoot = contentAt(kept, 1).root
    expect(keptRoot.kind === 'leaf' && keptRoot.content && imagePanelOf(keptRoot.content)?.focus).toEqual({
      x: 0.2,
      y: 0.9,
    })

    const centred = unwrap(replaceAssetUses(deck, { fromId: 'a_old', to: NEW, recentre: true }))
    const centredRoot = contentAt(centred, 1).root
    expect(
      centredRoot.kind === 'leaf' && centredRoot.content && imagePanelOf(centredRoot.content)?.focus,
    ).toEqual({ x: 0.5, y: 0.5 })
  })

  it('refuses a file the presentation does not have, and a file replaced with itself', () => {
    const deck = deckWith(createLeaf(createImage('a_old')), [OLD])
    const missing = replaceAssetUses(deck, { fromId: 'a_borte', to: NEW })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('ASSET_NOT_FOUND')

    const self = replaceAssetUses(deck, { fromId: 'a_old', to: { ...NEW, id: 'a_old' } })
    expect(self.ok).toBe(false)
    if (!self.ok) expect(self.error.code).toBe('INVALID_ARGUMENT')
  })
})

describe('forking a file for one panel', () => {
  function sharedDeck(): Presentation {
    return deckWith(
      createSplit('x', [1, 1], [createLeaf(createImage('a_old')), createLeaf(createImage('a_old'))]),
      [OLD],
      [textWithPicture('a_old', 4 / 3)],
    )
  }

  it('changes that panel only, keeps both files listed, and centres the fork\'s crop', () => {
    const deck = sharedDeck()
    const slide = contentAt(deck, 1)
    const [leftBefore] = leftAndRight(deck)

    const next = unwrap(
      replaceAssetUses(deck, {
        fromId: 'a_old',
        to: NEW,
        only: { slideId: slide.id, nodeId: leftBefore.id },
        recentre: true,
      }),
    )
    const [left, right] = leftAndRight(next)
    expect(panelAssetOf(left)).toBe('a_new')
    expect(panelAssetOf(right)).toBe('a_old')
    // Neither the inline picture nor the sandbox is touched by a fork.
    expect(inlineImages(next)).toEqual([{ assetId: 'a_old', aspect: 4 / 3 }])
    expect(next.assets.map((asset) => asset.id).sort()).toEqual(['a_new', 'a_old'])
    expect(usedAssetIds(next)).toEqual(new Set(['a_new', 'a_old']))
  })

  it('refuses a zone that does not show the file', () => {
    const deck = deckWith(
      createSplit('x', [1, 1], [createLeaf(createImage('a_old')), createLeaf(textWithPicture('a_old', 1))]),
      [OLD],
    )
    const slide = contentAt(deck, 1)
    const [, text] = leftAndRight(deck)
    const refused = replaceAssetUses(deck, {
      fromId: 'a_old',
      to: NEW,
      only: { slideId: slide.id, nodeId: text.id },
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.code).toBe('INVALID_CONTENT')

    const nowhere = replaceAssetUses(deck, {
      fromId: 'a_old',
      to: NEW,
      only: { slideId: slide.id, nodeId: 'n_borte' },
    })
    expect(nowhere.ok).toBe(false)
    if (!nowhere.ok) expect(nowhere.error.code).toBe('NODE_NOT_FOUND')
  })
})

describe('merging identical files', () => {
  const COPY: AssetRef = { ...OLD, id: 'a_copy', name: 'ferie (2).jpg' }

  it('points every use at the kept file and drops the copies from the list', () => {
    const deck = deckWith(
      createSplit('x', [1, 1], [createLeaf(createImage('a_copy')), createLeaf(textWithPicture('a_copy', 4 / 3))]),
      [OLD, COPY],
      [createImage('a_copy')],
    )
    const next = unwrap(mergeDuplicateAssets(deck, new Map([['a_copy', 'a_old']])))
    const [left] = leftAndRight(next)
    expect(panelAssetOf(left)).toBe('a_old')
    expect(imagePanelOf(next.sandbox[0].content)?.assetId).toBe('a_old')
    // Same bytes, same size: the stored ratio has nothing to change to.
    expect(inlineImages(next)).toEqual([{ assetId: 'a_old', aspect: 4 / 3 }])
    expect(next.assets).toEqual([OLD])
  })

  it('does nothing for an empty map, and refuses a map the document cannot follow', () => {
    const deck = deckWith(createLeaf(createImage('a_copy')), [OLD, COPY])
    expect(mergeDuplicateAssets(deck, new Map())).toEqual({ ok: true, value: deck })

    const self = mergeDuplicateAssets(deck, new Map([['a_old', 'a_old']]))
    expect(!self.ok && self.error.code).toBe('INVALID_ARGUMENT')

    const missing = mergeDuplicateAssets(deck, new Map([['a_copy', 'a_borte']]))
    expect(!missing.ok && missing.error.code).toBe('ASSET_NOT_FOUND')

    // A chain would leave a reference pointing at a file that goes one step later.
    const third: AssetRef = { ...OLD, id: 'a_third' }
    const chained = mergeDuplicateAssets(
      { ...deck, assets: [OLD, COPY, third] },
      new Map([
        ['a_copy', 'a_old'],
        ['a_old', 'a_third'],
      ]),
    )
    expect(!chained.ok && chained.error.code).toBe('INVALID_ARGUMENT')
  })
})
