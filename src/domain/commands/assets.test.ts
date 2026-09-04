/**
 * Removing a file from a deck, and the one question that decides whether it may
 * happen: does anything still show it?
 *
 * The interesting half is the refusal. A `AssetRef` removed while a zone or a
 * paragraph still points at it leaves the document referencing a file it does
 * not contain — a slide that renders a hole, which `validate_presentation`
 * would then report about a deck nobody edited. So every way a file can be
 * shown is exercised here, including the two the agent surface cannot itself
 * produce today: a picture sitting inline in rich text, and content parked in
 * the sandbox.
 */

import { describe, expect, it } from 'vitest'
import { createImage, createUntitledCard } from '../content'
import { createPresentation } from '../presentation'
import { imageNode } from '../richdoc'
import type { AssetRef, Presentation, RichDoc, ZoneContent } from '../types'
import {
  pruneAssets,
  registerAsset,
  removeAsset,
  summarizeAssetUsage,
  unusedAssets,
  usedAssetIds,
} from './assets'
import { setZoneContent } from './index'

const FILE: AssetRef = {
  id: 'a_fig',
  name: 'figur.png',
  mimeType: 'image/png',
  byteSize: 1024,
  width: 400,
  height: 300,
  isVector: false,
}

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`Forventet ok, fikk ${JSON.stringify(result.error)}`)
  }
  return result.value
}

/** A deck that knows about the file but does not show it anywhere. */
function deckWithFile(): Presentation {
  return unwrap(registerAsset(createPresentation({ title: 'Filer' }), FILE))
}

/** The one leaf a fresh slide has. */
function rootNodeId(presentation: Presentation): string {
  return presentation.slides[0].root.id
}

/** A card whose only text field holds an inline picture. */
function cardWithInlineImage(assetId: string, times = 1): ZoneContent {
  const card = createUntitledCard()
  const doc: RichDoc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: Array.from({ length: times }, () => imageNode(assetId, 'Figur')),
      },
    ],
  }
  return { ...card, body: { ...card.body, subfields: [{ ...card.body.subfields[0], doc }] } }
}

function place(presentation: Presentation, content: ZoneContent): Presentation {
  return unwrap(
    setZoneContent(presentation, {
      slideId: presentation.slides[0].id,
      nodeId: rootNodeId(presentation),
      content,
      replace: true,
      // Thrown away rather than parked: content displaced into the sandbox is
      // still content that shows the file, which is a case of its own below.
      replacedDisposition: 'delete',
    }),
  ).presentation
}

function park(presentation: Presentation, content: ZoneContent): Presentation {
  return {
    ...presentation,
    sandbox: [{ id: 'sb_1', content, createdAt: '2026-09-04T00:00:00.000Z', note: 'Parkert' }],
  }
}

describe('summarizeAssetUsage', () => {
  it('teller ingenting for en fil ingen viser', () => {
    expect(summarizeAssetUsage(deckWithFile(), FILE.id)).toEqual({
      total: 0,
      slides: { zoneContent: 0, inlineText: 0 },
      sandbox: { zoneContent: 0, inlineText: 0 },
    })
  })

  it('skiller soneinnhold fra bilder inne i tekst, og slides fra sandkassen', () => {
    let presentation = place(
      deckWithFile(),
      createImage(FILE.id),
    )
    presentation = park(presentation, cardWithInlineImage(FILE.id, 2))

    expect(summarizeAssetUsage(presentation, FILE.id)).toEqual({
      total: 3,
      slides: { zoneContent: 1, inlineText: 0 },
      sandbox: { zoneContent: 0, inlineText: 2 },
    })
  })

  it('svarer det samme som usedAssetIds om filen er i bruk i det hele tatt', () => {
    // Two traversals over the same question, and they must never disagree: one
    // saying "unused" while the other can point somewhere is exactly the bug
    // that would let a deletion break a slide.
    const cases: Presentation[] = [
      deckWithFile(),
      place(deckWithFile(), createImage(FILE.id)),
      place(deckWithFile(), cardWithInlineImage(FILE.id)),
      park(deckWithFile(), cardWithInlineImage(FILE.id)),
    ]
    for (const presentation of cases) {
      const used = usedAssetIds(presentation).has(FILE.id)
      expect(summarizeAssetUsage(presentation, FILE.id).total > 0).toBe(used)
    }
  })
})

describe('removeAsset', () => {
  it('fjerner en ubrukt fil fra dokumentet', () => {
    const presentation = deckWithFile()
    expect(unusedAssets(presentation).map((asset) => asset.id)).toEqual([FILE.id])

    const without = unwrap(removeAsset(presentation, FILE.id))
    expect(without.assets).toEqual([])
    // Purely functional: the document that was handed in is untouched.
    expect(presentation.assets).toEqual([FILE])
  })

  it('avviser en id presentasjonen ikke kjenner, med id-en i feilen', () => {
    const result = removeAsset(deckWithFile(), 'a_finnes_ikke')
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'ASSET_NOT_FOUND', details: { assetId: 'a_finnes_ikke' } },
    })
  })

  it('avviser en fil som er innholdet i en sone, og sier hvor mange steder', () => {
    const presentation = place(
      deckWithFile(),
      createImage(FILE.id),
    )

    const result = removeAsset(presentation, FILE.id)
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'ASSET_IN_USE',
        details: {
          assetId: FILE.id,
          usage: { total: 1, slides: { zoneContent: 1, inlineText: 0 } },
        },
      },
    })
  })

  it('avviser en fil som bare ligger inline i rik tekst', () => {
    // The case a zone-content check alone would miss: nothing points at the
    // file from the layout tree, only from inside a paragraph.
    const presentation = place(deckWithFile(), cardWithInlineImage(FILE.id))

    expect(removeAsset(presentation, FILE.id)).toMatchObject({
      ok: false,
      error: {
        code: 'ASSET_IN_USE',
        details: { usage: { total: 1, slides: { zoneContent: 0, inlineText: 1 } } },
      },
    })
  })

  it('avviser en fil som bare vises fra sandkassen', () => {
    // Parked content is unfinished work, not deleted work: deleting the file it
    // shows would break the item the moment it is placed back on a slide.
    const presentation = park(deckWithFile(), cardWithInlineImage(FILE.id))

    expect(removeAsset(presentation, FILE.id)).toMatchObject({
      ok: false,
      error: {
        code: 'ASSET_IN_USE',
        details: { usage: { total: 1, sandbox: { zoneContent: 0, inlineText: 1 } } },
      },
    })
  })

  it('navngir aldri en slide, en sone eller et sandkasseelement i avvisningen', () => {
    // `delete_asset` is an `assets:write` operation. The refusal has to say
    // *why* without handing a token that may only store files a map of a deck
    // it may not read, so the details are counts and the asset's own id.
    const presentation = place(
      deckWithFile(),
      createImage(FILE.id),
    )
    const result = removeAsset(presentation, FILE.id)
    if (result.ok) throw new Error('Forventet en avvisning')

    const serialized = JSON.stringify(result.error.details)
    expect(serialized).not.toContain(presentation.slides[0].id)
    expect(serialized).not.toContain(rootNodeId(presentation))
    expect(Object.keys(result.error.details ?? {}).sort()).toEqual(['assetId', 'usage'])
  })

  it('lar filen slettes igjen så snart innholdet er borte', () => {
    // The loop an agent walks: refused → clear the zone → accepted.
    const shown = place(
      deckWithFile(),
      createImage(FILE.id),
    )
    expect(removeAsset(shown, FILE.id).ok).toBe(false)

    const cleared = place(shown, createUntitledCard())
    expect(unwrap(removeAsset(cleared, FILE.id)).assets).toEqual([])
  })
})

describe('pruneAssets', () => {
  it('rydder bare det ingen viser, og lar dokumentet stå når det ikke er noe å rydde', () => {
    const shown = place(
      deckWithFile(),
      createImage(FILE.id),
    )
    const kept = pruneAssets(shown)
    expect(kept.removed).toEqual([])
    // Identity, not just equality: nothing to do means nothing was rebuilt.
    expect(kept.presentation).toBe(shown)

    const pruned = pruneAssets(deckWithFile())
    expect(pruned.removed.map((asset) => asset.id)).toEqual([FILE.id])
    expect(pruned.presentation.assets).toEqual([])
  })
})
