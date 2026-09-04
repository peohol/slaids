/**
 * The progress indicator, as it is actually drawn.
 *
 * The strip it occupies is the geometry engine's business and is tested there.
 * What is tested here is the part only the renderer can answer: which pages get
 * one, how full it is, what colour it takes, and that the track's 30 % does not
 * end up on the fill.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  PROGRESS_BAR_HEIGHT,
  PROGRESS_TRACK_OPACITY,
  PROGRESS_TRANSITION_MS,
} from '../../domain/constants'
import { deckPages, deckProgress } from '../../domain/pages'
import { createPresentation } from '../../domain/presentation'
import type { Presentation } from '../../domain/types'
import { DeckPageView } from './DeckPageView'
import { SlideRenderProvider } from './SlideRenderContext'

const COVER_COLOR = '#8e44ad'
const SHARE_URL = 'https://slaids.example/s/3f2a1b0c-1111-4222-8333-444455556666'

function deck(slideCount = 3): Presentation {
  const base = createPresentation({ title: 'Fremdrift' })
  return {
    ...base,
    cover: { ...base.cover, pillColor: COVER_COLOR },
    slides: Array.from({ length: slideCount }, (_, index) => ({
      ...base.slides[0],
      id: `slide-${index}`,
    })),
  }
}

/** Every page of a deck, drawn exactly as presentation mode draws it. */
function pageMarkup(presentation: Presentation, shareUrl: string | null = null): string[] {
  const pages = deckPages(presentation, { shareUrl })
  const progress = deckProgress(pages)
  return pages.map((page) =>
    renderToStaticMarkup(
      <SlideRenderProvider
        value={{
          theme: presentation.theme,
          numbering: new Map(),
          headingPillColor: presentation.cover.pillColor,
          progress,
          isStatic: true,
        }}
      >
        <DeckPageView page={page} />
      </SlideRenderProvider>,
    ),
  )
}

/** The `width` the fill was given, in per cent. */
function fillPercent(markup: string): number | null {
  const fill = markup.split('slide-progress__fill')[1]
  if (fill === undefined) return null
  const match = /width:([0-9.]+)%/.exec(fill)
  return match ? Number(match[1]) : null
}

describe('fremdriftsindikatoren', () => {
  it('tegnes ikke på forsiden', () => {
    const [cover] = pageMarkup(deck())
    expect(cover).toContain('data-testid="cover-page"')
    expect(cover).not.toContain('slide-progress')
  })

  it('tegnes på hver eneste side etter forsiden', () => {
    const pages = pageMarkup(deck(), SHARE_URL).slice(1)
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) expect(page).toContain('data-testid="slide-progress"')
  })

  it('lar første vanlige slide være side 1 og den siste siden være full', () => {
    const [, first, second, third] = pageMarkup(deck())
    expect(fillPercent(first)).toBeCloseTo(100 / 3, 6)
    expect(fillPercent(second)).toBeCloseTo(200 / 3, 6)
    expect(fillPercent(third)).toBe(100)
  })

  it('regner QR-siden som den siste siden når delingen er på', () => {
    const shared = pageMarkup(deck(), SHARE_URL)
    const qr = shared[shared.length - 1]
    expect(qr).toContain('data-testid="qr-page"')
    expect(fillPercent(qr)).toBe(100)
    // Og da er ikke den siste authored sliden full lenger.
    expect(fillPercent(shared[3])).toBeLessThan(100)
  })

  it('arver forsidens pillefarge, i både beholderen og den voksende delen', () => {
    const [, first] = pageMarkup(deck())
    const track = first.split('slide-progress__track')[1]
    const fill = first.split('slide-progress__fill')[1]
    expect(track).toContain(COVER_COLOR)
    expect(fill).toContain(COVER_COLOR)
  })

  it('holder de 30 prosentene på beholderen, ikke på den voksende delen', () => {
    // Nested inside the track, the fill would inherit its opacity — `opacity`
    // applies to the whole group. The two are siblings for exactly that reason.
    const [, first] = pageMarkup(deck())
    const track = first.split('slide-progress__track')[1].split('</div>')[0]
    const fill = first.split('slide-progress__fill')[1].split('</div>')[0]
    expect(track).toContain(`opacity:${PROGRESS_TRACK_OPACITY}`)
    expect(fill).not.toContain('opacity')
  })

  it('er en lav stripe med rund høyreende og en animert bevegelse', () => {
    const [, first] = pageMarkup(deck())
    expect(first).toContain(`height:${PROGRESS_BAR_HEIGHT}px`)
    // Rounded where it grows and square where it starts.
    expect(first).toContain(`border-radius:0 ${PROGRESS_BAR_HEIGHT / 2}px ${PROGRESS_BAR_HEIGHT / 2}px 0`)
    expect(first).toContain(`transition-duration:${PROGRESS_TRANSITION_MS}ms`)
  })
})
