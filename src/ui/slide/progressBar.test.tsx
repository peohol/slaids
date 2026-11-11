/**
 * The progress indicator, as it is actually drawn.
 *
 * The strip it occupies is the geometry engine's business and is tested there.
 * What is tested here is the part only the renderer can answer: which pages get
 * one, how full it is, what colour it takes, and that the track's 30 % does not
 * end up on the fill.
 */

import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  PROGRESS_BAR_HEIGHT,
  PROGRESS_TRACK_OPACITY,
  PROGRESS_TRANSITION_MS,
} from '../../domain/constants'
import { deckPages, deckProgress, deckSectionColors, type DeckPage } from '../../domain/pages'
import { createPresentation } from '../../domain/presentation'
import { contentAt, sectionAt } from '../../domain/testDecks'
import type { Presentation } from '../../domain/types'
import { DeckPageView } from './DeckPageView'
import { SlideRenderProvider } from './SlideRenderContext'

const ACCENT = '#8e44ad'
const SHARE_URL = 'https://slaids.example/s/3f2a1b0c-1111-4222-8333-444455556666'

/** A front section, then `slideCount` ordinary slides after it. */
function deck(slideCount = 3): Presentation {
  const base = createPresentation({ title: 'Fremdrift' })
  return {
    ...base,
    slides: [
      { ...sectionAt(base, 0), accentColor: ACCENT },
      ...Array.from({ length: slideCount }, (_, index) => ({
        ...contentAt(base, 1),
        id: `slide-${index}`,
      })),
    ],
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
          sectionColors: deckSectionColors(pages),
          progress,
          logo: null,
          isStatic: true,
        }}
      >
        <DeckPageView page={page} />
      </SlideRenderProvider>,
    ),
  )
}

/** The same provider, for the cases that need a live DOM rather than markup. */
function Deck({
  presentation,
  page,
  shareUrl,
}: {
  presentation: Presentation
  page: DeckPage
  shareUrl: string | null
}) {
  const pages = deckPages(presentation, { shareUrl })
  return (
    <SlideRenderProvider
      value={{
        theme: presentation.theme,
        numbering: new Map(),
        sectionColors: deckSectionColors(pages),
        progress: deckProgress(pages),
        logo: null,
        isStatic: true,
      }}
    >
      <DeckPageView page={page} />
    </SlideRenderProvider>
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
    const [front] = pageMarkup(deck())
    expect(front).toContain('data-testid="section-page"')
    expect(front).not.toContain('slide-progress')
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

  it('arver seksjonens aksentfarge, i både beholderen og den voksende delen', () => {
    const [, first] = pageMarkup(deck())
    const track = first.split('slide-progress__track')[1]
    const fill = first.split('slide-progress__fill')[1]
    expect(track).toContain(ACCENT)
    expect(fill).toContain(ACCENT)
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

  it('dekker hele beholderen på den siste siden, uten runde hjørner igjen', () => {
    // A rounded end sitting exactly on the track's own end would leave two
    // slivers of track showing past it, and the last page is supposed to read
    // as full.
    const pages = pageMarkup(deck())
    const last = pages[pages.length - 1]
    expect(fillPercent(last)).toBe(100)
    expect(last).toContain('border-radius:0 0px 0px 0')
    expect(last).not.toContain(`border-radius:0 ${PROGRESS_BAR_HEIGHT / 2}px`)
  })
})

/* ------------------------------------------------------------------ *
 * The one thing the markup cannot show: what survives a page turn
 * ------------------------------------------------------------------ */

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
})

function mount(node: React.ReactNode): HTMLElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(node))
  return container
}

function fillElement(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('[data-testid="slide-progress-fill"]')
}

describe('fremdriftsindikatoren over et sidebytte', () => {
  it('beholder det samme elementet når siden bytter type', () => {
    // The animation is a CSS transition, and a transition needs a previous
    // computed width to run from. A brand new element has none — so an
    // indicator that lived inside the page view would jump on exactly the page
    // turn where the deck changes kind: the last slide to the QR page, and back.
    const presentation = deck()
    const shareUrl = SHARE_URL
    const pages = deckPages(presentation, { shareUrl })
    const lastSlide = pages[pages.length - 2]
    const qr = pages[pages.length - 1]
    expect(lastSlide.kind).toBe('authored-slide')
    expect(qr.kind).toBe('qr')

    const host = mount(<Deck presentation={presentation} page={lastSlide} shareUrl={shareUrl} />)
    const before = fillElement(host)
    expect(before).not.toBeNull()
    const beforeWidth = before?.style.width

    act(() => root!.render(<Deck presentation={presentation} page={qr} shareUrl={shareUrl} />))

    // The page itself was replaced — the QR page is not a slide.
    expect(host.querySelector('[data-testid="qr-page"]')).not.toBeNull()
    // The indicator was not: same node, new width, so the browser has something
    // to animate from.
    expect(fillElement(host)).toBe(before)
    expect(fillElement(host)?.style.width).not.toBe(beforeWidth)
    expect(fillElement(host)?.style.width).toBe('100%')
  })

  it('lar forsiden bytte til en vanlig side uten å etterlate en indikator', () => {
    const presentation = deck()
    const pages = deckPages(presentation)
    const host = mount(<Deck presentation={presentation} page={pages[0]} shareUrl={null} />)
    expect(fillElement(host)).toBeNull()

    act(() => root!.render(<Deck presentation={presentation} page={pages[1]} shareUrl={null} />))
    expect(fillElement(host)).not.toBeNull()
  })
})
