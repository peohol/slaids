/**
 * The public endpoint's rules.
 *
 * These are the checks that stand between a share token and somebody else's
 * private work, so they are tested as rules rather than through the network.
 */

import { describe, expect, it } from 'vitest'
import {
  FALLBACK_CONTENT_TYPE,
  assetContentType,
  assetHeaders,
  publishedAssetIds,
  publishedAssetMimeType,
  publishedDocument,
  readShareRequest,
  shareHeaders,
} from './access'

const TOKEN = '3f2a1b0c-1111-4222-8333-444455556666'

function url(query: string): URL {
  return new URL(`https://project.functions.supabase.co/slaids-share${query}`)
}

describe('readShareRequest', () => {
  it('leser et snapshot-kall', () => {
    expect(readShareRequest('GET', url(`?token=${TOKEN}`))).toEqual({
      kind: 'snapshot',
      token: TOKEN,
    })
  })

  it('leser et asset-kall', () => {
    expect(readShareRequest('GET', url(`?token=${TOKEN}&asset=a_123`))).toEqual({
      kind: 'asset',
      token: TOKEN,
      assetId: 'a_123',
    })
  })

  it('avviser alt som ikke er et gyldig token', () => {
    for (const query of ['', '?token=', '?token=abc', '?token=' + TOKEN + 'x', '?asset=a_1']) {
      expect(readShareRequest('GET', url(query))).toBeNull()
    }
  })

  it('avviser en asset-id som ikke ser ut som en id', () => {
    for (const asset of ['', '../../secret', 'a/b', 'x'.repeat(200)]) {
      expect(readShareRequest('GET', url(`?token=${TOKEN}&asset=${asset}`))).toBeNull()
    }
  })

  it('svarer bare på lesing', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(readShareRequest(method, url(`?token=${TOKEN}`))).toBeNull()
    }
    expect(readShareRequest('HEAD', url(`?token=${TOKEN}`))).not.toBeNull()
  })

  it('har ingen listeform', () => {
    // Uansett hvordan man spør uten et token, finnes det ikke noe kall som
    // svarer med mer enn én presentasjon.
    expect(readShareRequest('GET', url('?list=1'))).toBeNull()
    expect(readShareRequest('GET', url('?all=true'))).toBeNull()
  })
})

describe('publishedDocument', () => {
  it('gir dokumentet for en aktivt delt rad', () => {
    const document = { format: 'slaids-shared', title: 'Delt' }
    expect(publishedDocument({ id: 'p1', is_shared: true, shared_document: document })).toEqual(
      document,
    )
  })

  it('gir ingenting for en rad som ikke er delt', () => {
    expect(
      publishedDocument({ id: 'p1', is_shared: false, shared_document: { title: 'Delt' } }),
    ).toBeNull()
    expect(publishedDocument({ id: 'p1', is_shared: null, shared_document: {} })).toBeNull()
  })

  it('gir ingenting når det ikke finnes noe publisert', () => {
    expect(publishedDocument({ id: 'p1', is_shared: true, shared_document: null })).toBeNull()
    expect(publishedDocument(null)).toBeNull()
    expect(publishedDocument(undefined)).toBeNull()
  })
})

describe('publishedAssetIds', () => {
  it('leser id-ene snapshotet faktisk lister', () => {
    const document = {
      assets: [{ id: 'a_1', mimeType: 'image/png' }, { id: 'a_2', mimeType: 'image/svg+xml' }],
    }
    expect([...publishedAssetIds(document)]).toEqual(['a_1', 'a_2'])
  })

  it('gir en tom mengde for alt annet', () => {
    expect(publishedAssetIds(null).size).toBe(0)
    expect(publishedAssetIds({}).size).toBe(0)
    expect(publishedAssetIds({ assets: 'nei' }).size).toBe(0)
    expect(publishedAssetIds({ assets: [{ id: 42 }, null, {}] }).size).toBe(0)
  })

  it('slipper ikke gjennom en fil som ikke er i snapshotet', () => {
    // Filen kan godt tilhøre presentasjonen — en figur i sandkassen, eller en
    // som ble fjernet fra en slide etter publisering. Den er likevel privat.
    const published = publishedAssetIds({ assets: [{ id: 'a_synlig' }] })
    expect(published.has('a_synlig')).toBe(true)
    expect(published.has('a_sandkasse')).toBe(false)
  })
})

describe('publishedAssetMimeType og assetContentType', () => {
  it('bruker typen snapshotet oppgir', () => {
    const document = { assets: [{ id: 'a_1', mimeType: 'image/webp' }] }
    expect(publishedAssetMimeType(document, 'a_1')).toBe('image/webp')
    expect(assetContentType(publishedAssetMimeType(document, 'a_1'))).toBe('image/webp')
  })

  it('faller tilbake på ugjennomsiktige bytes for alt som ikke er en MIME-type', () => {
    expect(assetContentType(null)).toBe(FALLBACK_CONTENT_TYPE)
    expect(assetContentType('')).toBe(FALLBACK_CONTENT_TYPE)
    expect(assetContentType('text/html; <script>')).toBe(FALLBACK_CONTENT_TYPE)
    expect(publishedAssetMimeType({ assets: [{ id: 'a_1' }] }, 'a_1')).toBeNull()
  })
})

describe('svarhoder', () => {
  it('hindrer caching og indeksering', () => {
    const headers = shareHeaders()
    expect(headers['Cache-Control']).toBe('no-store')
    expect(headers['X-Robots-Tag']).toBe('noindex, nofollow')
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
    expect(headers['Access-Control-Allow-Methods']).toContain('GET')
    expect(headers['Access-Control-Allow-Methods']).not.toContain('POST')
  })

  it('låser ned en fil som serveres', () => {
    const headers = assetHeaders('image/svg+xml')
    expect(headers['Content-Type']).toBe('image/svg+xml')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Content-Security-Policy']).toContain("default-src 'none'")
    expect(headers['Cache-Control']).toBe('no-store')
  })
})
