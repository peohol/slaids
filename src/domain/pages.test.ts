import { describe, expect, it } from 'vitest'
import { createUntitledCard } from './content'
import { createLeaf } from './layout'
import {
  QR_PAGE_ID,
  deckSectionColors,
  deckPages,
  deckProgress,
  derivedPageNote,
  derivedPages,
  isDerivedPage,
} from './pages'
import { createPresentation } from './presentation'
import { contentAt, sectionAt } from './testDecks'
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
    slides: [sectionAt(base, 0), { ...contentAt(base, 1), root: createLeaf(content) }],
  }
}

describe('deckPages', () => {
  it('gir de authored slidene når ingenting er sitert og ingenting er delt', () => {
    const presentation = createPresentation({ title: 'Enkel' })
    const pages = deckPages(presentation)
    expect(pages.map((page) => page.kind)).toEqual(['authored-slide', 'authored-slide'])
  })

  it('legger forsiden aller først: dekkets første seksjon', () => {
    const presentation = withCitation()
    const first = deckPages(presentation, { shareUrl: SHARE_URL })[0]
    expect(first.kind).toBe('authored-slide')
    if (first.kind !== 'authored-slide') return
    expect(first.id).toBe(presentation.slides[0].id)
    // The very object the deck stores: nothing here copies or rebuilds it.
    expect(first.slide).toBe(presentation.slides[0])
    expect(first.slide.kind).toBe('section')
  })

  it('legger referansesidene etter de authored slidene', () => {
    const pages = deckPages(withCitation())
    expect(pages.map((page) => page.kind)).toEqual([
      'authored-slide',
      'authored-slide',
      'reference-slide',
    ])
  })

  it('legger QR-siden aller sist, etter referansesidene', () => {
    const pages = deckPages(withCitation(), { shareUrl: SHARE_URL })
    expect(pages.map((page) => page.kind)).toEqual([
      'authored-slide',
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
    expect(presentation.slides).toHaveLength(2)
    expect(JSON.stringify(presentation)).not.toContain(QR_PAGE_ID)
    expect(JSON.stringify(presentation)).not.toContain(SHARE_URL)
  })
})

describe('derivedPages', () => {
  it('regner ikke forsiden som avledet: den er lagret og redigerbar', () => {
    const [front] = deckPages(withCitation(), { shareUrl: SHARE_URL })
    expect(isDerivedPage(front)).toBe(false)
    expect(
      derivedPages(withCitation(), { shareUrl: SHARE_URL }).map((page) => page.kind),
    ).not.toContain('authored-slide')
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
        sectionAt(presentation, 0),
        contentAt(presentation, 1),
        { ...contentAt(presentation, 1), id: 's2' },
        { ...contentAt(presentation, 1), id: 's3' },
      ],
    }
    const pages = deckPages(withSlides)
    const progress = deckProgress(pages)

    expect(progress.has(withSlides.slides[0].id)).toBe(false)
    expect(progress.get(withSlides.slides[1].id)).toBeCloseTo(1 / 3, 9)
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
    const presentation = withCitation()
    const pages = deckPages(presentation, { shareUrl: SHARE_URL })
    const progress = deckProgress(pages)
    // Forsiden, én authored slide, én referanseside og én QR-side: den authored
    // er 1 av de 3 som telles.
    expect(progress.get(presentation.slides[1].id)).toBeCloseTo(1 / 3, 9)
  })

  it('gir en presentasjon med bare en forside ingen fremdrift å tegne', () => {
    const presentation = createPresentation({ title: 'x' })
    const pages = deckPages({ ...presentation, slides: [sectionAt(presentation, 0)] })
    expect(deckProgress(pages).size).toBe(0)
  })
})

describe('deckSectionColors', () => {
  it('gir hver side fargene fra seksjonen foran den', () => {
    const presentation = createPresentation({ title: 'Deler' })
    const deck: Presentation = {
      ...presentation,
      slides: [
        { ...sectionAt(presentation, 0), accentColor: '#111111', backgroundColor: '#222222' },
        contentAt(presentation, 1),
        {
          ...sectionAt(presentation, 0),
          id: 'del-2',
          accentColor: '#333333',
          backgroundColor: '#444444',
        },
        { ...contentAt(presentation, 1), id: 'etter' },
      ],
    }
    const colors = deckSectionColors(deckPages(deck))
    expect(colors.get(deck.slides[0].id)).toEqual({ accent: '#111111', background: '#222222' })
    expect(colors.get(deck.slides[1].id)).toEqual({ accent: '#111111', background: '#222222' })
    expect(colors.get('del-2')).toEqual({ accent: '#333333', background: '#444444' })
    expect(colors.get('etter')).toEqual({ accent: '#333333', background: '#444444' })
  })

  it('lar de avledede sidene fortsette den siste seksjonen', () => {
    const presentation = withCitation()
    const recoloured: Presentation = {
      ...presentation,
      slides: [
        { ...sectionAt(presentation, 0), accentColor: '#abcdef', backgroundColor: '#fedcba' },
        ...presentation.slides.slice(1),
      ],
    }
    const pages = deckPages(recoloured, { shareUrl: SHARE_URL })
    const colors = deckSectionColors(pages)
    for (const page of pages) {
      expect(colors.get(page.id)).toEqual({ accent: '#abcdef', background: '#fedcba' })
    }
  })
})
