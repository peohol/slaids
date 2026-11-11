/**
 * A section as it is drawn, and the colours it lends the pages after it.
 *
 * The interesting half is the second one. A heading that was never given a
 * colour stores none, and is painted from a custom property the page sets — so
 * these tests assert on the *absence* of an inline colour as much as on its
 * presence. That absence is what lets one change on a section repaint every
 * such heading in its part of the deck without touching a stored document.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_PILL_COLOR } from '../../domain/constants'
import { bestTextColor } from '../../domain/color'
import { deckPages, deckProgress, deckSectionColors } from '../../domain/pages'
import { createPresentation, createSection } from '../../domain/presentation'
import { titleDoc } from '../../domain/richdoc'
import { createLeaf } from '../../domain/layout'
import { createTitledCard, createUntitledCard } from '../../domain/content'
import { contentAt, sectionAt } from '../../domain/testDecks'
import type { Presentation, RichDoc } from '../../domain/types'
import { DeckPageView } from './DeckPageView'
import { RichDocView } from './RichDocView'
import { SlideRenderProvider } from './SlideRenderContext'
import { SlideView } from './SlideView'

const PICKED = '#a64d79'
const SECTION_COLOR = '#bfccd9'
const SECOND_COLOR = '#2f6f4f'
const BACKGROUND = '#101828'

function headings(): RichDoc {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Arvet' }] },
      {
        type: 'heading',
        attrs: { level: 1, color: PICKED },
        content: [{ type: 'text', text: 'Valgt' }],
      },
    ],
  }
}

function deck(): Presentation {
  const presentation = createPresentation({ title: 'Dekk' })
  const card = createUntitledCard()
  return {
    ...presentation,
    slides: [
      {
        ...sectionAt(presentation, 0),
        title: titleDoc('Kvartalsrapport'),
        subtitle: titleDoc('Tall og tiltak'),
        accentColor: SECTION_COLOR,
        backgroundColor: BACKGROUND,
      },
      {
        ...contentAt(presentation, 1),
        root: createLeaf({
          ...card,
          body: { ...card.body, subfields: [{ ...card.body.subfields[0], doc: headings() }] },
        }),
      },
    ],
  }
}

function render(presentation: Presentation, node: React.ReactNode): string {
  const pages = deckPages(presentation)
  return renderToStaticMarkup(
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
      {node}
    </SlideRenderProvider>,
  )
}

describe('a section page', () => {
  it('draws both lines in the chosen colour, with the text colour contrast dictates', () => {
    const presentation = deck()
    const [front] = deckPages(presentation)
    const markup = render(presentation, <DeckPageView page={front} />)

    expect(markup).toContain('data-testid="section-page"')
    expect(markup).toContain('Kvartalsrapport')
    expect(markup).toContain('Tall og tiltak')
    expect(markup).toContain('data-section-line="title"')
    expect(markup).toContain('data-section-line="subtitle"')
    // Never picked by hand — derived, like every other text colour in Slaids.
    expect(markup).toContain(`color:${bestTextColor(SECTION_COLOR)}`)
    expect(markup).toContain(`background:${BACKGROUND}`)
  })

  it('draws no pill for a line with no text', () => {
    const presentation = deck()
    const withoutSubtitle: Presentation = {
      ...presentation,
      slides: [
        { ...sectionAt(presentation, 0), subtitle: titleDoc('') },
        ...presentation.slides.slice(1),
      ],
    }
    const [front] = deckPages(withoutSubtitle)
    const markup = render(withoutSubtitle, <DeckPageView page={front} />)

    expect(markup).toContain('data-section-line="title"')
    expect(markup).not.toContain('data-section-line="subtitle"')
  })
})

describe('a heading pill', () => {
  it('carries no colour of its own until one is picked', () => {
    const markup = render(deck(), <RichDocView doc={headings()} />)
    // The inherited one paints no background inline — its alignment is a
    // separate question, and every block carries one — while the picked one
    // paints itself.
    expect(markup).toContain('>Arvet</h1>')
    expect(markup).not.toMatch(/background:[^"]*">Arvet/)
    expect(markup).toContain(`background:${PICKED}`)
    expect(markup).not.toContain(`background:${SECTION_COLOR}`)
  })

  it('gets the section’s colour from the slide, as a token both renderers read', () => {
    const presentation = deck()
    const markup = render(presentation, <SlideView slide={contentAt(presentation, 1)} />)
    expect(markup).toContain(`--slaids-heading-pill:${SECTION_COLOR}`)
    expect(markup).toContain(`--slaids-heading-pill-text:${bestTextColor(SECTION_COLOR)}`)
  })

  it('follows a recoloured section without any slide document changing', () => {
    const presentation = deck()
    const recoloured: Presentation = {
      ...presentation,
      slides: [
        { ...sectionAt(presentation, 0), accentColor: DEFAULT_PILL_COLOR },
        ...presentation.slides.slice(1),
      ],
    }
    expect(recoloured.slides[1]).toBe(presentation.slides[1])

    const before = render(presentation, <SlideView slide={contentAt(presentation, 1)} />)
    const after = render(recoloured, <SlideView slide={contentAt(recoloured, 1)} />)
    expect(before).toContain(`--slaids-heading-pill:${SECTION_COLOR}`)
    expect(after).toContain(`--slaids-heading-pill:${DEFAULT_PILL_COLOR}`)
    // …and the heading that was given a colour is untouched by either.
    expect(before).toContain(`background:${PICKED}`)
    expect(after).toContain(`background:${PICKED}`)
  })

  it('follows the *nearest* section before it, not the deck’s first', () => {
    const presentation = deck()
    const withSecondPart: Presentation = {
      ...presentation,
      slides: [
        ...presentation.slides,
        { ...createSection({ title: 'Del to' }), accentColor: SECOND_COLOR },
        { ...contentAt(presentation, 1), id: 'later-slide' },
      ],
    }
    const markup = render(withSecondPart, <SlideView slide={contentAt(withSecondPart, 3)} />)
    expect(markup).toContain(`--slaids-heading-pill:${SECOND_COLOR}`)
    expect(markup).not.toContain(`--slaids-heading-pill:${SECTION_COLOR}`)
  })
})

describe('a titled card’s header', () => {
  function deckWithTitledCard(headerColor: string | null): Presentation {
    const presentation = deck()
    return {
      ...presentation,
      slides: [
        sectionAt(presentation, 0),
        { ...contentAt(presentation, 1), root: createLeaf(createTitledCard('Tittel', headerColor)) },
      ],
    }
  }

  it('takes the section’s accent colour when it carries none of its own', () => {
    const presentation = deckWithTitledCard(null)
    const markup = render(presentation, <SlideView slide={contentAt(presentation, 1)} />)
    expect(markup).toContain(`background:${SECTION_COLOR}`)
  })

  it('keeps a colour that was picked by hand', () => {
    const presentation = deckWithTitledCard(PICKED)
    const markup = render(presentation, <SlideView slide={contentAt(presentation, 1)} />)
    expect(markup).toContain(`background:${PICKED}`)
    expect(markup).not.toContain(`background:${SECTION_COLOR}`)
  })

  it('follows a recoloured section without the card storing anything', () => {
    const presentation = deckWithTitledCard(null)
    const recoloured: Presentation = {
      ...presentation,
      slides: [
        { ...sectionAt(presentation, 0), accentColor: DEFAULT_PILL_COLOR },
        ...presentation.slides.slice(1),
      ],
    }
    expect(recoloured.slides[1]).toBe(presentation.slides[1])

    const before = render(presentation, <SlideView slide={contentAt(presentation, 1)} />)
    const after = render(recoloured, <SlideView slide={contentAt(recoloured, 1)} />)
    expect(before).toContain(`background:${SECTION_COLOR}`)
    expect(after).toContain(`background:${DEFAULT_PILL_COLOR}`)
  })
})
