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
  publishedFolderDocument,
  publishedFolderListing,
  readShareRequest,
  shareHeaders,
  sharedFolder,
  type SharedFolderRow,
} from './access'

const TOKEN = '3f2a1b0c-1111-4222-8333-444455556666'
const FOLDER_TOKEN = '9a8b7c6d-1111-4222-8333-444455556666'

function url(query: string): URL {
  return new URL(`https://project.functions.supabase.co/slaids-share${query}`)
}

describe('readShareRequest', () => {
  it('leser et snapshot-kall', () => {
    expect(readShareRequest('GET', url(`?token=${TOKEN}`))).toEqual({
      kind: 'snapshot',
      deck: { kind: 'presentation', token: TOKEN },
    })
  })

  it('leser et asset-kall', () => {
    expect(readShareRequest('GET', url(`?token=${TOKEN}&asset=a_123`))).toEqual({
      kind: 'asset',
      deck: { kind: 'presentation', token: TOKEN },
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
    expect(readShareRequest('GET', url('?presentation=p_1'))).toBeNull()
  })

  it('leser en delt mappe, en presentasjon i den og en fil den viser', () => {
    expect(readShareRequest('GET', url(`?folder=${FOLDER_TOKEN}`))).toEqual({
      kind: 'folder',
      folderToken: FOLDER_TOKEN,
    })
    const deck = { kind: 'folder', folderToken: FOLDER_TOKEN, presentationId: 'p_abc' }
    expect(readShareRequest('GET', url(`?folder=${FOLDER_TOKEN}&presentation=p_abc`))).toEqual({
      kind: 'snapshot',
      deck,
    })
    expect(
      readShareRequest('GET', url(`?folder=${FOLDER_TOKEN}&presentation=p_abc&asset=a_1`)),
    ).toEqual({ kind: 'asset', deck, assetId: 'a_1' })
  })

  it('avviser mappekall som ikke er nøyaktig ett av de tre', () => {
    for (const query of [
      '?folder=',
      '?folder=abc',
      `?folder=${FOLDER_TOKEN}x`,
      // En fil uten en presentasjon å høre til.
      `?folder=${FOLDER_TOKEN}&asset=a_1`,
      // En id som ikke ser ut som en id.
      `?folder=${FOLDER_TOKEN}&presentation=../p`,
      `?folder=${FOLDER_TOKEN}&presentation=`,
      // To slags token på en gang adresserer ingenting.
      `?folder=${FOLDER_TOKEN}&token=${TOKEN}`,
      `?token=${TOKEN}&presentation=p_abc`,
    ]) {
      expect(readShareRequest('GET', url(query))).toBeNull()
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(readShareRequest(method, url(`?folder=${FOLDER_TOKEN}`))).toBeNull()
    }
  })
})

describe('delte mapper', () => {
  const folder: SharedFolderRow = { id: 'fl_1', owner_id: 'u1', name: 'Kurs', is_shared: true }
  const document = { format: 'slaids-shared', title: 'Delt' }
  const deck = {
    id: 'p_1',
    folder_id: 'fl_1',
    is_published: true,
    deleted_at: null,
    shared_document: document,
  }

  it('svarer bare for en mappe som er delt', () => {
    expect(sharedFolder(folder)).toBe(folder)
    expect(sharedFolder({ ...folder, is_shared: false })).toBeNull()
    expect(sharedFolder({ ...folder, is_shared: null })).toBeNull()
    expect(sharedFolder(null)).toBeNull()
  })

  it('gir det publiserte dokumentet til en presentasjon i mappen', () => {
    expect(publishedFolderDocument(folder, deck)).toEqual(document)
  })

  it('gir ingenting for en presentasjon i en annen mappe, i søppelkassen eller uten kopi', () => {
    expect(publishedFolderDocument(folder, { ...deck, folder_id: 'fl_2' })).toBeNull()
    expect(publishedFolderDocument(folder, { ...deck, folder_id: null })).toBeNull()
    expect(publishedFolderDocument(folder, { ...deck, is_published: false })).toBeNull()
    expect(
      publishedFolderDocument(folder, { ...deck, deleted_at: '2026-10-01T08:00:00+00:00' }),
    ).toBeNull()
    expect(publishedFolderDocument(folder, { ...deck, shared_document: null })).toBeNull()
    expect(publishedFolderDocument(null, deck)).toBeNull()
    expect(publishedFolderDocument(folder, null)).toBeNull()
  })

  it('lister bare publiserte presentasjoner, med publisert tittel, i tittelrekkefølge', () => {
    const listing = publishedFolderListing(folder, [
      { id: 'p_b', is_published: true, deleted_at: null, slide_count: 4, title: 'Øving' },
      { id: 'p_a', is_published: true, deleted_at: null, slide_count: 2, title: 'Arbeid' },
      // Publisert, men uten kopi ennå: ikke listet som noe som ikke kan åpnes.
      { id: 'p_c', is_published: true, deleted_at: null, slide_count: 1, title: null },
      { id: 'p_d', is_published: false, deleted_at: null, slide_count: 1, title: 'Privat' },
      { id: 'p_e', is_published: true, deleted_at: '2026-10-01', slide_count: 1, title: 'Slettet' },
    ])
    expect(listing).toEqual({
      format: 'slaids-shared-folder',
      folderVersion: 1,
      name: 'Kurs',
      presentations: [
        { id: 'p_a', title: 'Arbeid', slideCount: 2 },
        { id: 'p_b', title: 'Øving', slideCount: 4 },
      ],
    })
  })

  it('bærer verken eier, mappe-id eller noe annet privat', () => {
    const listing = publishedFolderListing(folder, [
      { id: 'p_a', is_published: true, deleted_at: null, slide_count: 2, title: 'Arbeid' },
    ])
    const text = JSON.stringify(listing)
    expect(text).not.toContain('u1')
    expect(text).not.toContain('fl_1')
    expect(Object.keys(listing.presentations[0]).sort()).toEqual(['id', 'slideCount', 'title'])
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

  it('gir ingenting for en rad som ligger i søppelkassen', () => {
    // Slettet er slettet for offentligheten, selv om eieren kan angre i tretti
    // dager: delingskolonnene står urørt på raden, og lenken er død likevel.
    const document = { format: 'slaids-shared', title: 'Delt' }
    expect(
      publishedDocument({
        id: 'p1',
        is_shared: true,
        shared_document: document,
        deleted_at: '2026-09-07T08:00:00+00:00',
      }),
    ).toBeNull()
    // `null` og fraværende er det samme: ikke i søppelkassen.
    expect(
      publishedDocument({ id: 'p1', is_shared: true, shared_document: document, deleted_at: null }),
    ).toEqual(document)
    expect(publishedDocument({ id: 'p1', is_shared: true, shared_document: document })).toEqual(
      document,
    )
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
