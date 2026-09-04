import { describe, expect, it } from 'vitest'
import { createUntitledCard } from './content'
import { createLeaf } from './layout'
import {
  COVER_PAGE_ID,
  QR_PAGE_ID,
  deckPages,
  deckProgress,
  derivedPageNote,
  derivedPages,
  isDerivedPage,
} from './pages'
import { createPresentation } from './presentation'
import type { Presentation, RichDoc } from './types'

const SHARE_URL = 'https://slaids.example/s/3f2a1b0c-1111-4222-8333-444455556666'

function citing(id: string): RichDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Påstand' },
          { type: 'citation', attrs: { referenceIds: [id] } },
        ],
      },
    ],
  }
}

function withCitation(): Presentation {
  const base = createPresentation({ title: 'Dekk' })
  const card = createUntitledCard()
  const content = {
    ...card,
    body: { ...card.body, subfields: [{ ...card.body.subfields[0], doc: citing('r1') }] },
  }
  return {
    ...base,
    references: [{ id: 'r1', title: 'Kilde', authors: '', url: '', year: '2026' }],
    slides: [{ ...base.slides[0], root: createLeaf(content) }],
  }
}

describe('deckPages', () => {
  it('gir forsiden og de authored slidene når ingenting er sitert og ingenting er delt', () => {
    const presentation = createPresentation({ title: 'Enkel' })
    const pages = deckPages(presentation)
    expect(pages.map((page) => page.kind)).toEqual(['cover', 'authored-slide'])
  })

  it('legger forsiden aller først, alltid', () => {
    const presentation = withCitation()
    const first = deckPages(presentation, { shareUrl: SHARE_URL })[0]
    expect(first.kind).toBe('cover')
    if (first.kind !== 'cover') return
    expect(first.id).toBe(COVER_PAGE_ID)
    // The very object the deck stores: nothing here copies or rebuilds it.
    expect(first.cover).toBe(presentation.cover)
  })

  it('legger referansesidene etter de authored slidene', () => {
    const pages = deckPages(withCitation())
    expect(pages.map((page) => page.kind)).toEqual(['cover', 'authored-slide', 'reference-slide'])
  })

  it('legger QR-siden aller sist, etter referansesidene', () => {
    const pages = deckPages(withCitation(), { shareUrl: SHARE_URL })
    expect(pages.map((page) => page.kind)).toEqual([
      'cover',
      'authored-slide',
      'reference-slide',
      'qr',
    ])
    const last = pages.at(-1)
    expect(last?.kind).toBe('qr')
    if (last?.kind !== 'qr') return
    expect(last.id).toBe(QR_PAGE_ID)
    expect(last.shareUrl).toBe(SHARE_URL)
  })

  it('lager ingen QR-side uten en aktiv delingslenke', () => {
    for (const shareUrl of [undefined, null, '', '   ']) {
      const pages = deckPages(withCitation(), { shareUrl })
      expect(pages.some((page) => page.kind === 'qr')).toBe(false)
    }
  })

  it('rører aldri de lagrede slidene', () => {
    const presentation = withCitation()
    deckPages(presentation, { shareUrl: SHARE_URL })
    // Både referansesidene og QR-siden er avledet: ingenting av dette havner i
    // dokumentet, og derfor kan ingen kommando slette, flytte eller endre dem.
    expect(presentation.slides).toHaveLength(1)
    expect(JSON.stringify(presentation)).not.toContain(QR_PAGE_ID)
    expect(JSON.stringify(presentation)).not.toContain(SHARE_URL)
  })
})

describe('derivedPages', () => {
  it('regner ikke forsiden som avledet: den er lagret og redigerbar', () => {
    const [cover] = deckPages(withCitation(), { shareUrl: SHARE_URL })
    expect(isDerivedPage(cover)).toBe(false)
    expect(derivedPages(withCitation(), { shareUrl: SHARE_URL }).map((page) => page.kind)).not.toContain(
      'cover',
    )
  })

  it('er nøyaktig de genererte sidene', () => {
    const pages = derivedPages(withCitation(), { shareUrl: SHARE_URL })
    expect(pages.map((page) => page.kind)).toEqual(['reference-slide', 'qr'])
    expect(pages.every(isDerivedPage)).toBe(true)
  })

  it('mister QR-siden så snart delingen slås av', () => {
    expect(derivedPages(withCitation(), { shareUrl: null }).map((page) => page.kind)).toEqual([
      'reference-slide',
    ])
  })
})

describe('derivedPageNote', () => {
  it('sier hva som styrer siden', () => {
    const [reference, qr] = derivedPages(withCitation(), { shareUrl: SHARE_URL })
    expect(derivedPageNote(reference)).toMatch(/referansene/i)
    expect(derivedPageNote(qr)).toMatch(/Del/)
    expect(derivedPageNote(qr)).toMatch(/kan ikke redigeres/i)
  })
})

describe('deckProgress', () => {
  it('teller forsiden ut: første vanlige slide er side 1', () => {
    const presentation = createPresentation({ title: 'Tre sider' })
    const withSlides: Presentation = {
      ...presentation,
      slides: [
        presentation.slides[0],
        { ...presentation.slides[0], id: 's2' },
        { ...presentation.slides[0], id: 's3' },
      ],
    }
    const pages = deckPages(withSlides)
    const progress = deckProgress(pages)

    expect(progress.has(COVER_PAGE_ID)).toBe(false)
    expect(progress.get(withSlides.slides[0].id)).toBeCloseTo(1 / 3, 9)
    expect(progress.get('s2')).toBeCloseTo(2 / 3, 9)
    expect(progress.get('s3')).toBe(1)
  })

  it('lar den siste siden være full, uansett hva slags side det er', () => {
    const shared = deckPages(withCitation(), { shareUrl: SHARE_URL })
    const progress = deckProgress(shared)
    expect(progress.get(QR_PAGE_ID)).toBe(1)

    // Uten deling er referansesiden den siste, og da er det den som er full.
    const unshared = deckPages(withCitation(), { shareUrl: null })
    const last = unshared[unshared.length - 1]
    expect(last.kind).toBe('reference-slide')
    expect(deckProgress(unshared).get(last.id)).toBe(1)
  })

  it('teller de avledede sidene med, så bare første halvdel er authored', () => {
    const pages = deckPages(withCitation(), { shareUrl: SHARE_URL })
    const progress = deckProgress(pages)
    const authored = pages.find((page) => page.kind === 'authored-slide')
    // Én authored slide, én referanseside og én QR-side: den authored er 1 av 3.
    expect(progress.get(authored?.id ?? '')).toBeCloseTo(1 / 3, 9)
  })

  it('gir en tom presentasjon ingen fremdrift å tegne', () => {
    const pages = deckPages(createPresentation({ title: 'x' })).filter(
      (page) => page.kind === 'cover',
    )
    expect(deckProgress(pages).size).toBe(0)
  })
})
