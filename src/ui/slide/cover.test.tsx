/**
 * The cover as it is drawn, and the colour it lends the rest of the deck.
 *
 * The interesting half is the second one. A heading that was never given a
 * colour stores none, and is painted from a custom property the deck sets — so
 * these tests assert on the *absence* of an inline colour as much as on its
 * presence. That absence is what lets one change on the cover repaint every
 * such heading without touching a stored document.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_PILL_COLOR } from '../../domain/constants'
import { bestTextColor } from '../../domain/color'
import { deckPages, deckProgress } from '../../domain/pages'
import { createPresentation } from '../../domain/presentation'
import { titleDoc } from '../../domain/richdoc'
import { createLeaf } from '../../domain/layout'
import { createUntitledCard } from '../../domain/content'
import type { Presentation, RichDoc } from '../../domain/types'
import { DeckPageView } from './DeckPageView'
import { RichDocView } from './RichDocView'
import { SlideRenderProvider } from './SlideRenderContext'
import { SlideView } from './SlideView'

const PICKED = '#a64d79'
const COVER_COLOR = '#bfccd9'

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
    cover: {
      title: titleDoc('Kvartalsrapport'),
      subtitle: titleDoc('Tall og tiltak'),
      pillColor: COVER_COLOR,
    },
    slides: [
      {
        ...presentation.slides[0],
        root: createLeaf({
          ...card,
          body: { ...card.body, subfields: [{ ...card.body.subfields[0], doc: headings() }] },
        }),
      },
    ],
  }
}

function render(presentation: Presentation, node: React.ReactNode): string {
  return renderToStaticMarkup(
    <SlideRenderProvider
      value={{
        theme: presentation.theme,
        numbering: new Map(),
        headingPillColor: presentation.cover.pillColor,
        progress: deckProgress(deckPages(presentation)),
        isStatic: true,
      }}
    >
      {node}
    </SlideRenderProvider>,
  )
}

describe('the cover page', () => {
  it('draws both lines in the chosen colour, with the text colour contrast dictates', () => {
    const presentation = deck()
    const [cover] = deckPages(presentation)
    const markup = render(presentation, <DeckPageView page={cover} />)

    expect(markup).toContain('data-testid="cover-page"')
    expect(markup).toContain('Kvartalsrapport')
    expect(markup).toContain('Tall og tiltak')
    expect(markup).toContain('data-cover-line="title"')
    expect(markup).toContain('data-cover-line="subtitle"')
    // Never picked by hand — derived, like every other text colour in Slaids.
    expect(markup).toContain(`color:${bestTextColor(COVER_COLOR)}`)
  })

  it('draws no pill for a line with no text', () => {
    const presentation = deck()
    const withoutSubtitle: Presentation = {
      ...presentation,
      cover: { ...presentation.cover, subtitle: titleDoc('') },
    }
    const [cover] = deckPages(withoutSubtitle)
    const markup = render(withoutSubtitle, <DeckPageView page={cover} />)

    expect(markup).toContain('data-cover-line="title"')
    expect(markup).not.toContain('data-cover-line="subtitle"')
  })
})

describe('a heading pill', () => {
  it('carries no colour of its own until one is picked', () => {
    const markup = render(deck(), <RichDocView doc={headings()} />)
    // The inherited one paints nothing inline; the picked one paints itself.
    expect(markup).toContain('<h1 class="rd-heading">Arvet</h1>')
    expect(markup).toContain(`background:${PICKED}`)
    expect(markup).not.toContain(`background:${COVER_COLOR}`)
  })

  it('gets the deck’s colour from the slide, as a token both renderers read', () => {
    const presentation = deck()
    const markup = render(presentation, <SlideView slide={presentation.slides[0]} />)
    expect(markup).toContain(`--slaids-heading-pill:${COVER_COLOR}`)
    expect(markup).toContain(`--slaids-heading-pill-text:${bestTextColor(COVER_COLOR)}`)
  })

  it('follows a recoloured cover without any slide document changing', () => {
    const presentation = deck()
    const recoloured: Presentation = {
      ...presentation,
      cover: { ...presentation.cover, pillColor: DEFAULT_PILL_COLOR },
    }
    expect(recoloured.slides).toBe(presentation.slides)

    const before = render(presentation, <SlideView slide={presentation.slides[0]} />)
    const after = render(recoloured, <SlideView slide={recoloured.slides[0]} />)
    expect(before).toContain(`--slaids-heading-pill:${COVER_COLOR}`)
    expect(after).toContain(`--slaids-heading-pill:${DEFAULT_PILL_COLOR}`)
    // …and the heading that was given a colour is untouched by either.
    expect(before).toContain(`background:${PICKED}`)
    expect(after).toContain(`background:${PICKED}`)
  })
})
