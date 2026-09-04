/**
 * The agent asset contracts, end to end against a real repository.
 *
 * These use `DexieSlaidsRepository` rather than a stub because the contract is
 * "the file is stored and the document points at it", and a stub could only
 * confirm that the right method was called.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { MAX_ASSET_BYTES } from '../domain/constants'
import { setZoneContent, splitLeaf, unusedAssets, usedAssetIds } from '../domain/commands'
import { createPresentation } from '../domain/presentation'
import { createUntitledCard } from '../domain/content'
import { imageNode } from '../domain/richdoc'
import { presentationRevision } from '../domain/revision'
import { blobToBytes } from '../persistence/blob'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import { SlaidsDatabase } from '../persistence/db'
import { RepositoryError } from '../persistence/repository'
import { realImageBase64, realImages, IMAGE_HEIGHT, IMAGE_WIDTH } from '../domain/testImages'
import type { Presentation, RichDoc, ZoneContent } from '../domain/types'
import { createSvgAsset, deleteAsset, listAssets, setZoneAsset, uploadAsset } from './operations/assets'
import { getPresentation, inspectSlide } from './operations/deck'
import { runOperation } from './registry'
import type { AgentContext, AgentResult } from './types'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshContext(): AgentContext {
  counter += 1
  const database = new SlaidsDatabase(`slaids-agent-${counter}`)
  databases.push(database)
  return { repository: new DexieSlaidsRepository(database) }
}

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

async function seed(context: AgentContext): Promise<Presentation> {
  const presentation = createPresentation({ title: 'Agenttest' })
  await context.repository.savePresentation(presentation)
  return presentation
}

/**
 * A complete PNG, not a header: `readRasterImage` walks the whole file, so a
 * fixture that is only a signature would fail — as it should.
 */
const pngBytes = realImages.png

function expectOk<T>(result: AgentResult<T>): T {
  if (!result.ok) throw new Error(`Forventet suksess, fikk ${result.error.code}: ${result.error.message}`)
  return result.value
}

function expectErr(result: AgentResult<unknown>): {
  code: string
  message: string
  details?: Record<string, unknown>
} {
  if (result.ok) throw new Error('Forventet en feil')
  return result.error
}

const SQUARE = '<svg viewBox="0 0 120 60"><rect width="120" height="60" fill="#0af"/></svg>'

/* ------------------------------------------------------------------ *
 * upload_asset
 * ------------------------------------------------------------------ */

describe('upload_asset', () => {
  it('lagrer et rasterbilde og registrerer det i presentasjonen', async () => {
    const context = freshContext()
    const presentation = await seed(context)
    const bytes = pngBytes()

    const stored = expectOk(
      await uploadAsset.run(context, {
        presentationId: presentation.id,
        name: 'graf.png',
        content: { encoding: 'bytes', data: bytes },
      }),
    )

    expect(stored.assetId).toMatch(/^a_/)
    expect(stored.ref).toMatchObject({
      name: 'graf.png',
      mimeType: 'image/png',
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      isVector: false,
      byteSize: bytes.byteLength,
    })

    const fromStore = await context.repository.getAsset(stored.assetId)
    expect(fromStore).not.toBeNull()
    expect(await blobToBytes(fromStore!.blob)).toEqual(bytes)

    const reloaded = await context.repository.loadPresentation(presentation.id)
    expect(reloaded.assets).toEqual([stored.ref])
  })

  it('tar imot base64 og data-URL, som er det et JSON-transport kan bære', async () => {
    const context = freshContext()
    const presentation = await seed(context)
    const bytes = pngBytes()

    const plain = expectOk(
      await uploadAsset.run(context, {
        presentationId: presentation.id,
        name: 'a.png',
        content: { encoding: 'base64', data: realImageBase64.png },
      }),
    )
    const dataUrl = expectOk(
      await uploadAsset.run(context, {
        presentationId: presentation.id,
        name: 'b.png',
        content: { encoding: 'base64', data: `data:image/png;base64,${realImageBase64.png}` },
      }),
    )

    expect(plain.ref.byteSize).toBe(bytes.byteLength)
    expect(dataUrl.ref.byteSize).toBe(bytes.byteLength)
    expect(await blobToBytes((await context.repository.getAsset(dataUrl.assetId))!.blob)).toEqual(bytes)
  })

  it('holder binærdata utenfor presentasjonsdokumentet', async () => {
    const context = freshContext()
    const presentation = await seed(context)
    await uploadAsset.run(context, {
      presentationId: presentation.id,
      name: 'a.png',
      content: { encoding: 'base64', data: realImageBase64.png },
    })

    const reloaded = await context.repository.loadPresentation(presentation.id)
    const json = JSON.stringify(reloaded)
    expect(json).not.toContain(realImageBase64.png)
    expect(json).not.toContain('blob')
  })

  it('avviser noe som ikke er et bilde, uansett hva kalleren kaller det', async () => {
    const context = freshContext()
    const presentation = await seed(context)

    const error = expectErr(
      await uploadAsset.run(context, {
        presentationId: presentation.id,
        name: 'ondsinnet.png',
        content: { encoding: 'text', data: '<html><script>alert(1)</script></html>' },
      }),
    )
    expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE')

    const reloaded = await context.repository.loadPresentation(presentation.id)
    expect(reloaded.assets).toEqual([])
  })

  it('avviser en fil som er større enn grensen', async () => {
    const context = freshContext()
    const presentation = await seed(context)
    const oversized = new Uint8Array(MAX_ASSET_BYTES + 1)
    oversized.set(pngBytes())

    const error = expectErr(
      await uploadAsset.run(context, {
        presentationId: presentation.id,
        name: 'stor.png',
        content: { encoding: 'bytes', data: oversized },
      }),
    )
    expect(error.code).toBe('ASSET_TOO_LARGE')
  })

  it('avviser en SVG som blir for stor når den serialiseres på nytt', async () => {
    const context = freshContext()
    const presentation = await seed(context)
    // A raw `&` is one byte in and five bytes out (`&amp;`), so markup well
    // under the limit crosses it on the way back out. The limit is about what
    // actually gets stored.
    const ampersands = '&'.repeat(Math.ceil(MAX_ASSET_BYTES / 4))
    const markup = `<svg viewBox="0 0 1 1"><text>${ampersands}</text></svg>`
    expect(markup.length).toBeLessThan(MAX_ASSET_BYTES)

    const error = expectErr(
      await createSvgAsset.run(context, {
        presentationId: presentation.id,
        name: 'stor',
        svgMarkup: markup,
      }),
    )
    expect(error.code).toBe('ASSET_TOO_LARGE')
    expect(await context.repository.listAssets(presentation.id)).toEqual([])
  })

  it('avviser en ukjent presentasjon uten å lagre noe', async () => {
    const context = freshContext()
    const error = expectErr(
      await uploadAsset.run(context, {
        presentationId: 'finnes_ikke',
        name: 'a.png',
        content: { encoding: 'bytes', data: pngBytes() },
      }),
    )
    expect(error.code).toBe('PRESENTATION_NOT_FOUND')
    expect(await context.repository.deleteOrphanAssets()).toBe(0)
  })

  it('sanitiserer SVG som lastes opp som fil, ikke bare som markup', async () => {
    const context = freshContext()
    const presentation = await seed(context)

    const stored = expectOk(
      await uploadAsset.run(context, {
        presentationId: presentation.id,
        name: 'figur.svg',
        content: {
          encoding: 'text',
          data: `<svg viewBox="0 0 10 10"><rect width="10" height="10"/><blink/></svg>`,
        },
      }),
    )
    expect(stored.ref.isVector).toBe(true)
    expect(stored.sanitized?.removedElements).toEqual(['blink'])

    const markup = await (await context.repository.getAsset(stored.assetId))!.blob.text()
    expect(markup).not.toContain('blink')
  })
})

/* ------------------------------------------------------------------ *
 * create_svg_asset
 * ------------------------------------------------------------------ */

describe('create_svg_asset', () => {
  it('lager et vektorasset direkte fra markup', async () => {
    const context = freshContext()
    const presentation = await seed(context)

    const stored = expectOk(
      await createSvgAsset.run(context, {
        presentationId: presentation.id,
        name: 'boks',
        svgMarkup: SQUARE,
      }),
    )

    expect(stored.ref).toMatchObject({
      name: 'boks.svg',
      mimeType: 'image/svg+xml',
      isVector: true,
      width: 120,
      height: 60,
    })

    const markup = await (await context.repository.getAsset(stored.assetId))!.blob.text()
    expect(markup).toContain('<rect')
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"')

    const reloaded = await context.repository.loadPresentation(presentation.id)
    expect(reloaded.assets.map((asset) => asset.id)).toEqual([stored.assetId])
  })

  it('avviser åpenbart utrygg markup og lagrer ingenting', async () => {
    const context = freshContext()
    const presentation = await seed(context)

    const error = expectErr(
      await createSvgAsset.run(context, {
        presentationId: presentation.id,
        name: 'ond',
        svgMarkup: `<svg viewBox="0 0 1 1"><script>fetch('https://example.com')</script></svg>`,
      }),
    )
    expect(error.code).toBe('UNSAFE_SVG')

    const reloaded = await context.repository.loadPresentation(presentation.id)
    expect(reloaded.assets).toEqual([])
    expect(await context.repository.listAssets(presentation.id)).toEqual([])
  })

  it('avviser markup som ikke er en gyldig SVG', async () => {
    const context = freshContext()
    const presentation = await seed(context)

    expect(
      expectErr(
        await createSvgAsset.run(context, {
          presentationId: presentation.id,
          name: 'tekst',
          svgMarkup: 'dette er ikke svg',
        }),
      ).code,
    ).toBe('INVALID_SVG')

    expect(
      expectErr(
        await createSvgAsset.run(context, {
          presentationId: presentation.id,
          name: 'uten-forhold',
          svgMarkup: '<svg><rect width="1" height="1"/></svg>',
        }),
      ).code,
    ).toBe('INVALID_SVG')
  })
})

/* ------------------------------------------------------------------ *
 * set_zone_asset
 * ------------------------------------------------------------------ */

describe('set_zone_asset', () => {
  async function seedWithAsset(context: AgentContext) {
    const presentation = await seed(context)
    const stored = expectOk(
      await createSvgAsset.run(context, {
        presentationId: presentation.id,
        name: 'figur',
        svgMarkup: SQUARE,
      }),
    )
    const slide = presentation.slides[0]
    return { presentationId: presentation.id, slideId: slide.id, nodeId: slide.root.id, assetId: stored.assetId }
  }

  const placement = { replace: false, replacedDisposition: 'sandbox' as const }

  it('plasserer et eksisterende asset i en sone', async () => {
    const context = freshContext()
    const seeded = await seedWithAsset(context)

    const placed = expectOk(await setZoneAsset.run(context, { ...seeded, ...placement }))
    expect(placed).toMatchObject({ assetId: seeded.assetId, movedToSandbox: 0, discarded: 0 })

    const reloaded = await context.repository.loadPresentation(seeded.presentationId)
    const root = reloaded.slides[0].root
    expect(root.kind === 'leaf' && root.content).toMatchObject({
      kind: 'image',
      image: { assetId: seeded.assetId, focus: { x: 0.5, y: 0.5 }, caption: null },
    })
    expect(usedAssetIds(reloaded).has(seeded.assetId)).toBe(true)
  })

  it('nekter en tom bildetekst, uansett hvordan den ville blitt tom', async () => {
    // There is no such thing as an empty caption. The editor may hold one for a
    // moment because the caret goes straight into it and leaving it empty
    // removes it again; an agent has no such moment, so an empty one it created
    // would simply be stored — and steal the caret from whoever opens the slide.
    const context = freshContext()
    const seeded = await seedWithAsset(context)
    await setZoneAsset.run(context, { ...seeded, ...placement })
    const zone = { presentationId: seeded.presentationId, slideId: seeded.slideId, nodeId: seeded.nodeId }

    const refused = expectErr(
      await runOperation(context, 'set_image_caption', { ...zone, position: 'bottom' }),
    )
    expect(refused.code).toBe('INVALID_ARGUMENT')

    expectOk(
      await runOperation(context, 'set_image_caption', {
        ...zone,
        position: 'bottom',
        spans: [{ text: 'Et fotografi' }],
      }),
    )
    // With one there, moving or recolouring it needs no text of its own.
    expectOk(await runOperation(context, 'set_image_caption', { ...zone, position: 'middle' }))

    // Clearing the text of one that exists is the same refusal: what the call
    // ends with is what must have text, and `remove` is how a caption goes.
    expect(
      expectErr(
        await runOperation(context, 'set_image_caption', { ...zone, spans: [] }),
      ).code,
    ).toBe('INVALID_ARGUMENT')

    const reloaded = await context.repository.loadPresentation(seeded.presentationId)
    const root = reloaded.slides[0].root
    expect(root.kind === 'leaf' && root.content?.kind === 'image' && root.content.image.caption)
      .toMatchObject({ position: 'middle' })
  })

  it('flytter utsnittet uten å røre filen', async () => {
    const context = freshContext()
    const seeded = await seedWithAsset(context)
    await setZoneAsset.run(context, { ...seeded, ...placement })

    expectOk(
      await runOperation(context, 'set_image_focus', {
        presentationId: seeded.presentationId,
        slideId: seeded.slideId,
        nodeId: seeded.nodeId,
        x: 0,
        y: 0.75,
      }),
    )
    const reloaded = await context.repository.loadPresentation(seeded.presentationId)
    const root = reloaded.slides[0].root
    expect(root.kind === 'leaf' && root.content).toMatchObject({
      kind: 'image',
      image: { assetId: seeded.assetId, focus: { x: 0, y: 0.75 } },
    })
  })

  it('avviser en assetId presentasjonen ikke har', async () => {
    const context = freshContext()
    const seeded = await seedWithAsset(context)

    const error = expectErr(
      await setZoneAsset.run(context, { ...seeded, ...placement, assetId: 'a_finnes_ikke' }),
    )
    expect(error.code).toBe('ASSET_NOT_FOUND')
  })

  it('nekter å overskrive en sone som har innhold, med mindre den blir bedt om det', async () => {
    const context = freshContext()
    const seeded = await seedWithAsset(context)
    await setZoneAsset.run(context, { ...seeded, ...placement })

    expect(expectErr(await setZoneAsset.run(context, { ...seeded, ...placement })).code).toBe(
      'TARGET_OCCUPIED',
    )

    const replaced = expectOk(
      await setZoneAsset.run(context, { ...seeded, ...placement, replace: true }),
    )
    expect(replaced.movedToSandbox).toBe(1)

    const reloaded = await context.repository.loadPresentation(seeded.presentationId)
    expect(reloaded.sandbox).toHaveLength(1)
  })

  it('avviser en sone som er delt opp', async () => {
    const context = freshContext()
    const seeded = await seedWithAsset(context)
    const presentation = await context.repository.loadPresentation(seeded.presentationId)
    const split = splitLeaf(presentation, {
      slideId: seeded.slideId,
      nodeId: seeded.nodeId,
      axis: 'x',
      weights: [1, 1],
    })
    if (!split.ok) throw new Error('kunne ikke dele sonen')
    await context.repository.savePresentation(split.value.presentation)

    const error = expectErr(await setZoneAsset.run(context, { ...seeded, ...placement }))
    expect(error.code).toBe('NODE_NOT_LEAF')
  })

  it('avviser en sone og en slide som ikke finnes', async () => {
    const context = freshContext()
    const seeded = await seedWithAsset(context)

    expect(
      expectErr(await setZoneAsset.run(context, { ...seeded, ...placement, nodeId: 'n_borte' })).code,
    ).toBe('NODE_NOT_FOUND')
    expect(
      expectErr(await setZoneAsset.run(context, { ...seeded, ...placement, slideId: 's_borte' })).code,
    ).toBe('SLIDE_NOT_FOUND')
  })

  it('lar en agent finne sone-id-en gjennom inspect_slide', async () => {
    const context = freshContext()
    const seeded = await seedWithAsset(context)
    const inspection = { presentationId: seeded.presentationId, slideId: seeded.slideId }

    const before = expectOk(await inspectSlide.run(context, inspection))
    const empty = before.zones.find((zone) => zone.kind === 'leaf' && zone.empty)
    expect(empty?.nodeId).toBe(seeded.nodeId)
    expect(empty?.rect.width).toBeGreaterThan(0)

    expectOk(
      await setZoneAsset.run(context, {
        ...placement,
        presentationId: seeded.presentationId,
        slideId: before.slideId,
        nodeId: empty!.nodeId,
        assetId: seeded.assetId,
      }),
    )

    const after = expectOk(await inspectSlide.run(context, inspection))
    expect(after.zones[0]).toMatchObject({
      empty: false,
      contentKind: 'image',
      assetIds: [seeded.assetId],
      referenceIds: [],
      image: { assetId: seeded.assetId, focus: { x: 0.5, y: 0.5 } },
      subfields: [],
      fits: true,
    })
  })
})

/* ------------------------------------------------------------------ *
 * invariants
 * ------------------------------------------------------------------ */

describe('asset-invariants', () => {
  it('rører ikke filene som allerede ligger der', async () => {
    const context = freshContext()
    const presentation = await seed(context)

    const first = expectOk(
      await createSvgAsset.run(context, {
        presentationId: presentation.id,
        name: 'en',
        svgMarkup: SQUARE,
      }),
    )
    const second = expectOk(
      await uploadAsset.run(context, {
        presentationId: presentation.id,
        name: 'to.png',
        content: { encoding: 'bytes', data: pngBytes() },
      }),
    )

    expect(first.assetId).not.toBe(second.assetId)
    const reloaded = await context.repository.loadPresentation(presentation.id)
    expect(reloaded.assets.map((asset) => asset.id)).toEqual([first.assetId, second.assetId])
    expect(await context.repository.getAsset(first.assetId)).not.toBeNull()
  })

  it('et asset som ikke er plassert er ubrukt, og blir brukt når det plasseres', async () => {
    const context = freshContext()
    const presentation = await seed(context)
    const stored = expectOk(
      await createSvgAsset.run(context, {
        presentationId: presentation.id,
        name: 'figur',
        svgMarkup: SQUARE,
      }),
    )

    const before = await context.repository.loadPresentation(presentation.id)
    expect(unusedAssets(before).map((asset) => asset.id)).toEqual([stored.assetId])

    expectOk(
      await setZoneAsset.run(context, {
        presentationId: presentation.id,
        slideId: presentation.slides[0].id,
        nodeId: presentation.slides[0].root.id,
        assetId: stored.assetId,
        replace: false,
        replacedDisposition: 'sandbox',
      }),
    )

    const after = await context.repository.loadPresentation(presentation.id)
    expect(unusedAssets(after)).toEqual([])
  })

  it('list_assets sier hvilke filer som faktisk vises', async () => {
    const context = freshContext()
    const presentation = await seed(context)
    const stored = expectOk(
      await createSvgAsset.run(context, {
        presentationId: presentation.id,
        name: 'figur',
        svgMarkup: SQUARE,
      }),
    )

    const listed = expectOk(await listAssets.run(context, { presentationId: presentation.id }))
    expect(listed.assets).toEqual([{ ...stored.ref, used: false }])

    await runOperation(context, 'set_zone_asset', {
      presentationId: presentation.id,
      slideId: presentation.slides[0].id,
      nodeId: presentation.slides[0].root.id,
      assetId: stored.assetId,
    })

    const after = expectOk(await listAssets.run(context, { presentationId: presentation.id }))
    expect(after.assets[0].used).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * delete_asset
 * ------------------------------------------------------------------ */

describe('delete_asset', () => {
  /** A deck with one stored file that nothing shows yet. */
  async function seedWithFile(context: AgentContext): Promise<{
    presentationId: string
    slideId: string
    nodeId: string
    assetId: string
    revision: string
  }> {
    const presentation = await seed(context)
    const stored = expectOk(
      await createSvgAsset.run(context, {
        presentationId: presentation.id,
        name: 'figur',
        svgMarkup: SQUARE,
      }),
    )
    return {
      presentationId: presentation.id,
      slideId: presentation.slides[0].id,
      nodeId: presentation.slides[0].root.id,
      assetId: stored.assetId,
      revision: stored.revision,
    }
  }

  /** Put `content` in the deck's one zone, past the agent surface. */
  async function fillZone(
    context: AgentContext,
    seeded: { presentationId: string; slideId: string; nodeId: string },
    content: ZoneContent,
  ): Promise<void> {
    const presentation = await context.repository.loadPresentation(seeded.presentationId)
    const placed = setZoneContent(presentation, {
      slideId: seeded.slideId,
      nodeId: seeded.nodeId,
      content,
      replace: true,
      replacedDisposition: 'delete',
    })
    if (!placed.ok) throw new Error(`kunne ikke fylle sonen: ${placed.error.code}`)
    await context.repository.savePresentation(placed.value.presentation)
  }

  /**
   * A card whose text holds an inline picture.
   *
   * Built with the domain's own helpers rather than through an operation,
   * because the agent text surface has no inline image today — and the editor's
   * documents are exactly the ones `delete_asset` has to keep intact.
   */
  function cardWithInlineImage(assetId: string): ZoneContent {
    const card = createUntitledCard()
    const doc: RichDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [imageNode(assetId, { alt: 'Figur' })] }],
    }
    return { ...card, body: { ...card.body, subfields: [{ ...card.body.subfields[0], doc }] } }
  }

  it('sletter et ubrukt asset: både referansen og bytene', async () => {
    const context = freshContext()
    const seeded = await seedWithFile(context)
    expect(await context.repository.getAsset(seeded.assetId)).not.toBeNull()

    const deleted = expectOk(
      await deleteAsset.run(context, {
        presentationId: seeded.presentationId,
        assetId: seeded.assetId,
      }),
    )
    expect(deleted).toMatchObject({
      presentationId: seeded.presentationId,
      assetId: seeded.assetId,
      fileRemoved: true,
    })

    const reloaded = await context.repository.loadPresentation(seeded.presentationId)
    expect(reloaded.assets).toEqual([])
    expect(deleted.revision).toBe(presentationRevision(reloaded))
    // The bytes are gone too — this is not a metadata-only deletion.
    expect(await context.repository.getAsset(seeded.assetId)).toBeNull()
    expect(await context.repository.listAssets(seeded.presentationId)).toEqual([])
  })

  it('avviser en fil som er innholdet i en sone, og lar alt stå', async () => {
    const context = freshContext()
    const seeded = await seedWithFile(context)
    expectOk(
      await setZoneAsset.run(context, {
        ...seeded,
        replace: false,
        replacedDisposition: 'sandbox',
      }),
    )
    const before = await context.repository.loadPresentation(seeded.presentationId)

    const error = expectErr(
      await deleteAsset.run(context, {
        presentationId: seeded.presentationId,
        assetId: seeded.assetId,
      }),
    )
    expect(error.code).toBe('ASSET_IN_USE')
    expect(error.details).toMatchObject({
      assetId: seeded.assetId,
      usage: { total: 1, slides: { zoneContent: 1, inlineText: 0 } },
    })

    // Neither store moved: the document is byte for byte the one that was
    // there, and the file is still readable.
    const after = await context.repository.loadPresentation(seeded.presentationId)
    expect(after).toEqual(before)
    expect(presentationRevision(after)).toBe(presentationRevision(before))
    expect(await context.repository.getAsset(seeded.assetId)).not.toBeNull()
  })

  it('avviser en fil som bare ligger inline i rik tekst, og lar alt stå', async () => {
    // The case a zone-content check alone would miss: nothing in the layout
    // tree points at the file, only a paragraph does.
    const context = freshContext()
    const seeded = await seedWithFile(context)
    await fillZone(context, seeded, cardWithInlineImage(seeded.assetId))
    const before = await context.repository.loadPresentation(seeded.presentationId)

    const error = expectErr(
      await deleteAsset.run(context, {
        presentationId: seeded.presentationId,
        assetId: seeded.assetId,
      }),
    )
    expect(error.code).toBe('ASSET_IN_USE')
    expect(error.details).toMatchObject({
      usage: { total: 1, slides: { zoneContent: 0, inlineText: 1 } },
    })

    expect(await context.repository.loadPresentation(seeded.presentationId)).toEqual(before)
    expect(await context.repository.getAsset(seeded.assetId)).not.toBeNull()
  })

  it('avviser en fil som bare vises fra sandkassen', async () => {
    const context = freshContext()
    const seeded = await seedWithFile(context)
    expectOk(
      await setZoneAsset.run(context, {
        ...seeded,
        replace: false,
        replacedDisposition: 'sandbox',
      }),
    )
    // Cleared with the default disposition, so the picture is parked rather
    // than destroyed — and a parked picture is still a picture that is shown.
    expectOk(
      (await runOperation(context, 'clear_zone', {
        presentationId: seeded.presentationId,
        slideId: seeded.slideId,
        nodeId: seeded.nodeId,
      })) as AgentResult<unknown>,
    )

    const error = expectErr(
      await deleteAsset.run(context, {
        presentationId: seeded.presentationId,
        assetId: seeded.assetId,
      }),
    )
    expect(error.code).toBe('ASSET_IN_USE')
    expect(error.details).toMatchObject({
      usage: { total: 1, sandbox: { zoneContent: 1, inlineText: 0 } },
    })
    expect(await context.repository.getAsset(seeded.assetId)).not.toBeNull()
  })

  it('lar filen slettes så snart innholdet er borte', async () => {
    const context = freshContext()
    const seeded = await seedWithFile(context)
    await fillZone(context, seeded, cardWithInlineImage(seeded.assetId))
    expect(
      expectErr(
        await deleteAsset.run(context, {
          presentationId: seeded.presentationId,
          assetId: seeded.assetId,
        }),
      ).code,
    ).toBe('ASSET_IN_USE')

    await fillZone(context, seeded, createUntitledCard())
    expect(
      expectOk(
        await deleteAsset.run(context, {
          presentationId: seeded.presentationId,
          assetId: seeded.assetId,
        }),
      ).fileRemoved,
    ).toBe(true)
    expect(await context.repository.getAsset(seeded.assetId)).toBeNull()
  })

  it('sier ASSET_NOT_FOUND på en id presentasjonen ikke har, uten å røre noe', async () => {
    const context = freshContext()
    const seeded = await seedWithFile(context)
    const before = await context.repository.loadPresentation(seeded.presentationId)

    const error = expectErr(
      await deleteAsset.run(context, {
        presentationId: seeded.presentationId,
        assetId: 'a_finnes_ikke',
      }),
    )
    expect(error.code).toBe('ASSET_NOT_FOUND')
    expect(error.details).toMatchObject({ assetId: 'a_finnes_ikke' })
    expect(await context.repository.loadPresentation(seeded.presentationId)).toEqual(before)
    expect(await context.repository.getAsset(seeded.assetId)).not.toBeNull()
  })

  it('avviser en utdatert expectedRevision, og lar filen ligge', async () => {
    const context = freshContext()
    const seeded = await seedWithFile(context)
    // Somebody else writes, so the caller's reading is stale.
    expectOk(
      (await runOperation(context, 'set_presentation_title', {
        presentationId: seeded.presentationId,
        title: 'Endret av noen andre',
      })) as AgentResult<unknown>,
    )

    const error = expectErr(
      await deleteAsset.run(context, {
        presentationId: seeded.presentationId,
        assetId: seeded.assetId,
        expectedRevision: seeded.revision,
      }),
    )
    expect(error.code).toBe('CONFLICT')

    const after = await context.repository.loadPresentation(seeded.presentationId)
    expect(after.assets.map((asset) => asset.id)).toEqual([seeded.assetId])
    expect(await context.repository.getAsset(seeded.assetId)).not.toBeNull()

    // And the deletion goes through against the revision that is current.
    expectOk(
      await deleteAsset.run(context, {
        presentationId: seeded.presentationId,
        assetId: seeded.assetId,
        expectedRevision: presentationRevision(after),
      }),
    )
    expect(await context.repository.getAsset(seeded.assetId)).toBeNull()
  })

  /** A deck in `database`, past the operation that would refuse to build it. */
  async function orphanCase(
    make: (database: SlaidsDatabase) => DexieSlaidsRepository,
  ): Promise<{ context: AgentContext; seeded: Awaited<ReturnType<typeof seedWithFile>> }> {
    counter += 1
    const database = new SlaidsDatabase(`slaids-agent-orphan-${counter}`)
    databases.push(database)
    const context: AgentContext = { repository: make(database) }
    return { context, seeded: await seedWithFile(context) }
  }

  it('melder fileRemoved: false når slettingen kastet', async () => {
    // The document is written first on purpose: an orphan blob costs storage,
    // while a document pointing at bytes that are gone costs the slide. So a
    // store that refuses the delete does not undo the deletion — it is reported.
    class StubbornStore extends DexieSlaidsRepository {
      override deleteAsset(): Promise<never> {
        return Promise.reject(new RepositoryError('Filen kunne ikke slettes.'))
      }
    }
    const { context, seeded } = await orphanCase((database) => new StubbornStore(database))

    const deleted = expectOk(
      await deleteAsset.run(context, {
        presentationId: seeded.presentationId,
        assetId: seeded.assetId,
      }),
    )
    expect(deleted.fileRemoved).toBe(false)

    // The deck no longer lists the file — that part landed and stands.
    const reloaded = await context.repository.loadPresentation(seeded.presentationId)
    expect(reloaded.assets).toEqual([])
    expect(usedAssetIds(reloaded).has(seeded.assetId)).toBe(false)
  })

  it('melder fileRemoved: false når slettingen gikk bra og bytene likevel ble liggende', async () => {
    // The case a `try/catch` alone would report as a success, and the one that
    // actually happens in Supabase: deleting a file there is two removals, and
    // a failed object removal deliberately does not fail the call — the row is
    // gone, which is what the caller asked for. The bytes are still there, so
    // the answer has to come from the repository rather than from "it did not
    // throw". See `SlaidsRepository.deleteAsset`.
    class LeavesTheBytes extends DexieSlaidsRepository {
      override async deleteAsset(id: string): Promise<boolean> {
        await super.deleteAsset(id)
        return false
      }
    }
    const { context, seeded } = await orphanCase((database) => new LeavesTheBytes(database))

    const deleted = expectOk(
      await deleteAsset.run(context, {
        presentationId: seeded.presentationId,
        assetId: seeded.assetId,
      }),
    )
    expect(deleted.fileRemoved).toBe(false)
    expect((await context.repository.loadPresentation(seeded.presentationId)).assets).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * discovery
 * ------------------------------------------------------------------ */

describe('get_presentation og inspect_slide', () => {
  it('gir en agent id-ene den trenger, uten å utlevere dokumentet', async () => {
    const context = freshContext()
    const presentation = await seed(context)

    const view = expectOk(await getPresentation.run(context, { presentationId: presentation.id }))
    expect(view).toMatchObject({
      presentationId: presentation.id,
      title: 'Agenttest',
      slideCount: 1,
      assetCount: 0,
      referenceCount: 0,
    })
    expect(view.slides).toEqual([
      { slideId: presentation.slides[0].id, index: 0, hasTitle: true, title: '' },
    ])
    // A description, not the document: no layout tree, no rich text, no sandbox.
    expect(Object.keys(view)).not.toContain('slidesJson')
    expect(JSON.stringify(view)).not.toContain('"root"')
  })

  it('beskriver sonene i en slide med geometry engine-ens egne mål', async () => {
    const context = freshContext()
    const presentation = await seed(context)
    const slideId = presentation.slides[0].id
    const split = splitLeaf(presentation, {
      slideId,
      nodeId: presentation.slides[0].root.id,
      axis: 'x',
      weights: [1, 1],
    })
    if (!split.ok) throw new Error('kunne ikke dele sonen')
    await context.repository.savePresentation(split.value.presentation)

    const inspection = expectOk(
      await inspectSlide.run(context, { presentationId: presentation.id, slideId }),
    )
    const [root, first, second] = inspection.zones
    expect(root).toMatchObject({ kind: 'split', axis: 'x', weights: [1, 1] })
    expect(root.childNodeIds).toEqual([first.nodeId, second.nodeId])
    expect(first.rect.width).toBeCloseTo(second.rect.width, 6)
    expect(first).toMatchObject({ kind: 'leaf', empty: true })
  })

  it('sier fra når sliden ikke finnes', async () => {
    const context = freshContext()
    const presentation = await seed(context)
    expect(
      expectErr(
        await inspectSlide.run(context, { presentationId: presentation.id, slideId: 's_borte' }),
      ).code,
    ).toBe('SLIDE_NOT_FOUND')
  })
})


/* ------------------------------------------------------------------ *
 * a store that is down is not a store that is empty
 * ------------------------------------------------------------------ */

describe('lagringsfeil', () => {
  /** Reachable, but not answering — which is not the same as "does not exist". */
  class UnreachableRepository extends DexieSlaidsRepository {
    override loadPresentation(): Promise<never> {
      return Promise.reject(new RepositoryError('Basen svarer ikke.'))
    }
  }

  it('sier STORAGE_FAILED, ikke PRESENTATION_NOT_FOUND, når basen ikke svarer', async () => {
    counter += 1
    const database = new SlaidsDatabase(`slaids-agent-down-${counter}`)
    databases.push(database)
    const context: AgentContext = { repository: new UnreachableRepository(database) }

    const error = expectErr(
      await uploadAsset.run(context, {
        presentationId: 'p_finnes',
        name: 'a.png',
        content: { encoding: 'bytes', data: pngBytes() },
      }),
    )
    expect(error.code).toBe('STORAGE_FAILED')
    expect(error.message).toBe('Basen svarer ikke.')
  })

  it('sier fortsatt PRESENTATION_NOT_FOUND når raden faktisk ikke finnes', async () => {
    const context = freshContext()
    const error = expectErr(
      await listAssets.run(context, { presentationId: 'p_finnes_ikke' }),
    )
    expect(error.code).toBe('PRESENTATION_NOT_FOUND')
  })
})

/* ------------------------------------------------------------------ *
 * binærvalidering
 * ------------------------------------------------------------------ */

describe('rastervalidering', () => {
  const formats = Object.entries(realImages) as [string, () => Uint8Array][]

  it.each(formats)('godtar en komplett %s', async (name, load) => {
    const context = freshContext()
    const presentation = await seed(context)
    const stored = expectOk(
      await uploadAsset.run(context, {
        presentationId: presentation.id,
        name: `${name}-fil`,
        content: { encoding: 'bytes', data: load() },
      }),
    )
    expect(stored.ref.width).toBe(IMAGE_WIDTH)
    expect(stored.ref.height).toBe(IMAGE_HEIGHT)
  })

  it.each(formats)('avviser en avkortet %s, som bare har et gyldig filhode', async (name, load) => {
    const context = freshContext()
    const presentation = await seed(context)
    const whole = load()

    const error = expectErr(
      await uploadAsset.run(context, {
        presentationId: presentation.id,
        name: `${name}-avkortet`,
        content: { encoding: 'bytes', data: whole.subarray(0, Math.floor(whole.length / 2)) },
      }),
    )
    expect(error.code).toBe('INVALID_IMAGE')
    expect(await context.repository.listAssets(presentation.id)).toEqual([])
  })

  it('avviser en PNG der innholdet er endret etter at filhodet ble skrevet', async () => {
    const context = freshContext()
    const presentation = await seed(context)
    const tampered = realImages.png()
    tampered[40] ^= 0xff

    expect(
      expectErr(
        await uploadAsset.run(context, {
          presentationId: presentation.id,
          name: 'endret.png',
          content: { encoding: 'bytes', data: tampered },
        }),
      ).code,
    ).toBe('INVALID_IMAGE')
  })

  it('avviser AVIF i agentveien, i stedet for å gjette størrelsen', async () => {
    const context = freshContext()
    const presentation = await seed(context)
    const ftyp = [0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]
    const avif = new Uint8Array([...ftyp, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0, 0x6d, 0x69, 0x66, 0x31])

    const error = expectErr(
      await uploadAsset.run(context, {
        presentationId: presentation.id,
        name: 'bilde.avif',
        content: { encoding: 'bytes', data: avif },
      }),
    )
    expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
    expect(error.message).toContain('AVIF')
  })
})

/* ------------------------------------------------------------------ *
 * atomisitet: filen og dokumentet er to skrivinger
 * ------------------------------------------------------------------ */

describe('tvetydig registrering', () => {
  function freshDatabase(): SlaidsDatabase {
    counter += 1
    const database = new SlaidsDatabase(`slaids-agent-atomic-${counter}`)
    databases.push(database)
    return database
  }

  /** The server wrote the row and the answer never came back. */
  class LostResponseRepository extends DexieSlaidsRepository {
    override async savePresentation(presentation: Presentation): Promise<void> {
      await super.savePresentation(presentation)
      throw new RepositoryError('Forbindelsen brøt sammen etter at raden var skrevet.')
    }
  }

  /** The write was refused; nothing was committed. */
  class RefusedWriteRepository extends DexieSlaidsRepository {
    override savePresentation(): Promise<void> {
      return Promise.reject(new RepositoryError('Skrivingen ble avvist.'))
    }
  }

  /** The write failed and the store cannot be read either. */
  class UnreachableAfterWriteRepository extends DexieSlaidsRepository {
    private loads = 0

    override loadPresentation(id: string): Promise<Presentation> {
      this.loads += 1
      if (this.loads === 1) return super.loadPresentation(id)
      return Promise.reject(new RepositoryError('Basen svarer ikke.'))
    }

    override savePresentation(): Promise<void> {
      return Promise.reject(new RepositoryError('Basen svarer ikke.'))
    }
  }

  async function seedIn(database: SlaidsDatabase): Promise<Presentation> {
    const presentation = createPresentation({ title: 'Atomisitet' })
    await new DexieSlaidsRepository(database).savePresentation(presentation)
    return presentation
  }

  it('sletter aldri en fil som den lagrede presentasjonen allerede peker på', async () => {
    const database = freshDatabase()
    const presentation = await seedIn(database)
    const context: AgentContext = { repository: new LostResponseRepository(database) }

    const stored = expectOk(
      await uploadAsset.run(context, {
        presentationId: presentation.id,
        name: 'commit.png',
        content: { encoding: 'bytes', data: realImages.png() },
      }),
    )

    // The row landed, so the operation is a success — and the bytes it points
    // at have to be there. A rollback that trusted the error would have deleted
    // them and left this reference dangling.
    const verifier = new DexieSlaidsRepository(database)
    const reloaded = await verifier.loadPresentation(presentation.id)
    expect(reloaded.assets.map((asset) => asset.id)).toEqual([stored.assetId])
    expect(await verifier.getAsset(stored.assetId)).not.toBeNull()
  })

  it('rydder opp filen når skrivingen beviselig ikke landet', async () => {
    const database = freshDatabase()
    const presentation = await seedIn(database)
    const context: AgentContext = { repository: new RefusedWriteRepository(database) }

    const error = expectErr(
      await uploadAsset.run(context, {
        presentationId: presentation.id,
        name: 'avvist.png',
        content: { encoding: 'bytes', data: realImages.png() },
      }),
    )
    expect(error.code).toBe('STORAGE_FAILED')

    const verifier = new DexieSlaidsRepository(database)
    expect((await verifier.loadPresentation(presentation.id)).assets).toEqual([])
    expect(await verifier.listAssets(presentation.id)).toEqual([])
  })

  it('beholder filen når det ikke kan avgjøres, og sier hvilken', async () => {
    const database = freshDatabase()
    const presentation = await seedIn(database)
    const context: AgentContext = { repository: new UnreachableAfterWriteRepository(database) }

    const error = expectErr(
      await uploadAsset.run(context, {
        presentationId: presentation.id,
        name: 'uvisst.png',
        content: { encoding: 'bytes', data: realImages.png() },
      }),
    )
    expect(error.code).toBe('STORAGE_FAILED')
    const retained = error.details?.retainedAssetId as string | undefined
    expect(retained).toMatch(/^a_/)

    // Kept on purpose: deleting it would risk breaking a reference that may
    // have been written after all. It goes with the presentation when that goes.
    const verifier = new DexieSlaidsRepository(database)
    expect(await verifier.getAsset(retained!)).not.toBeNull()
    await verifier.deletePresentation(presentation.id)
    expect(await verifier.getAsset(retained!)).toBeNull()
  })
})

