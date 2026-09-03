// @vitest-environment node
/**
 * How a picture leaves over REST.
 *
 * Every other operation answers with the same JSON envelope, and that is worth
 * keeping — so the one operation that produces a picture is the one place this
 * layer has a choice to make, and this file is what pins the choice down:
 *
 *  - **the picture, by default.** `Content-Type: image/png` and the bytes, not
 *    a few hundred kilobytes of base64 inside an envelope a caller then has to
 *    unwrap. A machine client asking for a rendering wants a rendering.
 *  - **the envelope on request.** `Accept: application/json` gets the ordinary
 *    shape with the image base64-encoded in the field the operation put it in,
 *    so nothing an agent could read over MCP is unreachable over REST. That is
 *    what keeps "one semantic contract" true across a difference in framing.
 *  - **the same authority as any other read.** `presentations:read` and nothing
 *    more; no token, no picture.
 *  - **the same audit.** One row, naming the operation and the presentation,
 *    with no room for the bytes.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { agentImage } from '../../agent/image'
import type { SlidePreviewRenderer } from '../../agent/preview'
import { realImages } from '../../domain/testImages'
import {
  closeHarnessDatabases,
  harness,
  newPresentation,
  rest,
  restRaw,
  seedDeck,
  type Harness,
} from '../mcp/testHarness'

afterEach(closeHarnessDatabases)

const PNG = realImages.png()

/** A renderer that answers with a real PNG, so the bytes are checkable. */
const workingRenderer: SlidePreviewRenderer = () =>
  Promise.resolve({
    ok: true,
    value: {
      image: agentImage({ mimeType: 'image/png', bytes: PNG, width: 1600, height: 900 }),
      fontsReady: true,
      warnings: [],
    },
  })

const brokenRenderer: SlidePreviewRenderer = () =>
  Promise.resolve({
    ok: false,
    error: { code: 'PREVIEW_FAILED', message: 'Nettleseren svarte ikke.' },
  })

async function deckIn(harnessed: Harness): Promise<{ presentationId: string; slideId: string }> {
  const deck = await newPresentation(harnessed, 'Previewdekk')
  return { presentationId: deck.presentationId, slideId: deck.slideId }
}

describe('svaret er bildet', () => {
  it('svarer med PNG-bytes, media-typen og revisjonen i headeren', async () => {
    const harnessed = harness({ preview: workingRenderer })
    const deck = await deckIn(harnessed)

    const response = await restRaw(harnessed, 'render_slide_preview', deck)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-slaids-operation')).toBe('render_slide_preview')
    expect(response.headers.get('x-slaids-revision')).toBeTruthy()
    expect(response.headers.get('content-length')).toBe(String(PNG.byteLength))

    const bytes = new Uint8Array(await response.arrayBuffer())
    // The bytes themselves, unchanged — not re-encoded, not wrapped.
    expect(bytes).toEqual(PNG)
  })

  it('svarer med bildet også når klienten ikke sier hva den vil ha', async () => {
    const harnessed = harness({ preview: workingRenderer })
    const deck = await deckIn(harnessed)

    // A wildcard Accept is what every default HTTP client sends, and it means
    // "whatever you have".
    const response = await restRaw(harnessed, 'render_slide_preview', deck, {
      headers: { Accept: '*/*' },
    })
    expect(response.headers.get('content-type')).toBe('image/png')
  })

  it('bruker den samme revisjonen dokumentet har, så et preview aldri gjør en agent utdatert', async () => {
    const harnessed = harness({ preview: workingRenderer })
    const deck = await newPresentation(harnessed, 'Uendret')

    const response = await restRaw(harnessed, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    expect(response.headers.get('x-slaids-revision')).toBe(deck.revision)

    // And a write against that revision still lands.
    const written = await rest(harnessed, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      expectedRevision: response.headers.get('x-slaids-revision'),
      spans: [{ text: 'Etter previewet' }],
    })
    expect(written.status).toBe(200)
  })
})

describe('konvolutten, for den som ber om den', () => {
  it('gir hele resultatet som JSON med bildet som base64', async () => {
    const harnessed = harness({ preview: workingRenderer })
    const deck = await deckIn(harnessed)

    const response = await restRaw(harnessed, 'render_slide_preview', deck, {
      headers: { Accept: 'application/json' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')

    const body = (await response.json()) as {
      ok: boolean
      operation: string
      revision: string
      data: {
        presentationId: string
        slideId: string
        pageKind: string
        scale: number
        fontsReady: boolean
        warnings: string[]
        image: { mimeType: string; width: number; height: number; byteLength: number; base64: string }
      }
    }

    expect(body.ok).toBe(true)
    expect(body.operation).toBe('render_slide_preview')
    expect(body.data.presentationId).toBe(deck.presentationId)
    expect(body.data.slideId).toBe(deck.slideId)
    expect(body.data.pageKind).toBe('authored-slide')
    expect(body.data.scale).toBe(1)
    expect(body.data.fontsReady).toBe(true)
    expect(body.data.warnings).toEqual([])

    // The description survives alongside the bytes: size and media type are
    // what an agent uses to decide whether to ask for a smaller one.
    expect(body.data.image.mimeType).toBe('image/png')
    expect(body.data.image.width).toBe(1600)
    expect(body.data.image.height).toBe(900)
    expect(body.data.image.byteLength).toBe(PNG.byteLength)
    expect(new Uint8Array(Buffer.from(body.data.image.base64, 'base64'))).toEqual(PNG)
  })

  it('holder de to formene enige om hva bildet er', async () => {
    const harnessed = harness({ preview: workingRenderer })
    const deck = await deckIn(harnessed)

    const binary = new Uint8Array(
      await (await restRaw(harnessed, 'render_slide_preview', deck)).arrayBuffer(),
    )
    const envelope = (await (
      await restRaw(harnessed, 'render_slide_preview', deck, {
        headers: { Accept: 'application/json' },
      })
    ).json()) as { data: { image: { base64: string } } }

    expect(new Uint8Array(Buffer.from(envelope.data.image.base64, 'base64'))).toEqual(binary)
  })
})

describe('autoritet', () => {
  it('holder med presentations:read alene — et preview er en lesing', async () => {
    const readOnly = harness({ scopes: ['presentations:read'], preview: workingRenderer })
    // Seeded past the transport: a read-only token cannot create the deck it is
    // then supposed to be allowed to render.
    const deck = await seedDeck(readOnly)

    const response = await restRaw(readOnly, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
  })

  it('avvises med FORBIDDEN_SCOPE for et token uten leserett', async () => {
    const wrongScope = harness({ scopes: ['assets:write'], preview: workingRenderer })
    const deck = await seedDeck(wrongScope)

    const response = await restRaw(wrongScope, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })

    expect(response.status).toBe(403)
    const body = (await response.json()) as {
      error: { code: string; details: { missing: string[] } }
    }
    expect(body.error.code).toBe('FORBIDDEN_SCOPE')
    expect(body.error.details.missing).toEqual(['presentations:read'])
  })

  it.each([
    ['ingen token', null],
    ['et ukjent token', 'slaids_at_9999999999999999999999999999999999999999999'],
  ])('avvises med 401 for %s, som alt annet i API-et', async (_case, token) => {
    const harnessed = harness({ preview: workingRenderer })
    const deck = await seedDeck(harnessed)

    const response = await restRaw(
      harnessed,
      'render_slide_preview',
      { presentationId: deck.presentationId, slideId: deck.slideId },
      { token },
    )

    expect(response.status).toBe(401)
    // JSON, and no picture: an unauthenticated caller gets no rendering at all.
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNAUTHENTICATED')
  })
})

describe('når det ikke kan rendres', () => {
  it('svarer 501 når installasjonen ikke har en renderer', async () => {
    const harnessed = harness()
    const deck = await deckIn(harnessed)

    const response = await restRaw(harnessed, 'render_slide_preview', deck)
    expect(response.status).toBe(501)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PREVIEW_UNAVAILABLE')
  })

  it('svarer 502 når rendereren finnes og feilet', async () => {
    const harnessed = harness({ preview: brokenRenderer })
    const deck = await deckIn(harnessed)

    const response = await restRaw(harnessed, 'render_slide_preview', deck)
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('PREVIEW_FAILED')
    expect(body.error.message).toContain('Nettleseren svarte ikke')
  })

  it('svarer 404 med sidene som finnes for en ukjent side', async () => {
    const harnessed = harness({ preview: workingRenderer })
    const deck = await deckIn(harnessed)

    const response = await restRaw(harnessed, 'render_slide_preview', {
      presentationId: deck.presentationId,
      slideId: 's_finnes_ikke',
    })

    expect(response.status).toBe(404)
    const body = (await response.json()) as {
      error: { code: string; details: { available: { slideId: string }[] } }
    }
    expect(body.error.code).toBe('SLIDE_NOT_FOUND')
    expect(body.error.details.available.map((page) => page.slideId)).toContain(deck.slideId)
  })
})

describe('auditen', () => {
  it('skriver én rad under operasjonens navn, uten en byte av bildet i den', async () => {
    const harnessed = harness({ preview: workingRenderer })
    const deck = await deckIn(harnessed)
    const before = harnessed.audit.entries.length

    await restRaw(harnessed, 'render_slide_preview', deck)

    const written = harnessed.audit.entries.slice(before)
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      operation: 'render_slide_preview',
      presentationId: deck.presentationId,
      status: 200,
      errorCode: null,
    })
    // The row's shape is closed in `audit.ts`, and this is what that buys: the
    // picture cannot be in it, because there is nowhere for it to go.
    const serialised = JSON.stringify(written[0])
    expect(serialised).not.toContain(Buffer.from(PNG).toString('base64').slice(0, 24))
  })
})
