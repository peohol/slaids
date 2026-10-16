import { describe, expect, it } from 'vitest'
import { asDeckSlides, createPresentation, createSection, createSlide } from './presentation'
import { titleDoc } from './richdoc'
import { slidesTouchedBy } from './slideChanges'
import type { Presentation, Slide } from './types'

const base = createPresentation({ title: 'Endringer' })

function deck(slides: Slide[]): Presentation {
  const deckSlides = asDeckSlides(slides)
  if (!deckSlides) throw new Error('a deck opens with a section')
  return { ...base, slides: deckSlides }
}

/** A front section and `count` content slides. */
function pages(count: number): Slide[] {
  return [createSection({ title: 'Forside' }), ...Array.from({ length: count }, () => createSlide())]
}

function retitled(slide: Slide, text: string): Slide {
  if (slide.kind !== 'content') throw new Error('expected a content slide')
  return { ...slide, title: titleDoc(text) }
}

const ids = (slides: Slide[], ...at: number[]): string[] => at.map((index) => slides[index].id)

describe('slidesTouchedBy', () => {
  it('is empty when no slide changed', () => {
    const slides = pages(3)
    const from = deck(slides)
    expect(slidesTouchedBy(from, from)).toEqual([])
    expect(slidesTouchedBy(from, { ...from, title: 'Ny tittel' })).toEqual([])
    expect(slidesTouchedBy(from, { ...from, slides: deck([...slides]).slides })).toEqual([])
  })

  it('names every edited slide, in deck order', () => {
    const slides = pages(4)
    const to = [...slides]
    to[3] = retitled(slides[3], 'C')
    to[1] = retitled(slides[1], 'A')
    expect(slidesTouchedBy(deck(slides), deck(to))).toEqual(ids(slides, 1, 3))
  })

  it('does not count a slide rebuilt into an equal copy', () => {
    const slides = pages(2)
    const to = slides.map((slide) => ({ ...slide }))
    expect(slidesTouchedBy(deck(slides), deck(to))).toEqual([])
  })

  it('names a removed slide', () => {
    const slides = pages(3)
    expect(slidesTouchedBy(deck(slides), deck(slides.filter((_, index) => index !== 2)))).toEqual(
      ids(slides, 2),
    )
  })

  it('names the page an added slide will follow, or precede when nothing is before it', () => {
    const slides = pages(3)
    const added = createSlide()
    expect(slidesTouchedBy(deck(slides), deck([...slides.slice(0, 2), added, ...slides.slice(2)]))).toEqual(
      ids(slides, 1),
    )
    // A new front page has nothing before it that was there already.
    const front = createSection({ title: 'Ny forside' })
    expect(slidesTouchedBy(deck(slides), deck([front, ...slides]))).toEqual(ids(slides, 0))
  })

  it('names the slide that moved, whichever way it went', () => {
    const slides = pages(5)
    const [front, a, b, c, d, e] = slides
    expect(slidesTouchedBy(deck(slides), deck([front, e, a, b, c, d]))).toEqual([e.id])
    expect(slidesTouchedBy(deck(slides), deck([front, b, c, d, a, e]))).toEqual([a.id])
  })

  it('names both neighbours of a swap, since either could have been the one moved', () => {
    const slides = pages(3)
    const [front, a, b, c] = slides
    expect(slidesTouchedBy(deck(slides), deck([front, b, a, c]))).toEqual([a.id, b.id])
  })

  it('names both groups when two runs of equal length trade places', () => {
    const slides = pages(4)
    const [front, a, b, c, d] = slides
    expect(slidesTouchedBy(deck(slides), deck([front, c, d, a, b]))).toEqual([a.id, b.id, c.id, d.id])
  })
})
