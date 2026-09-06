/**
 * How a derived reference slide is drawn: left-justified entries, visually
 * separated by more than an ordinary paragraph's spacing.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildReferenceSlides } from '../../domain/referenceSlides'
import { themeMetrics } from '../../domain/metrics'
import { createPresentation } from '../../domain/presentation'
import { createLeaf } from '../../domain/layout'
import { createUntitledCard } from '../../domain/content'
import { contentAt, sectionAt } from '../../domain/testDecks'
import type { Presentation, Reference, RichDoc } from '../../domain/types'
import { deckProgress, deckSectionColors, deckPages } from '../../domain/pages'
import { SlideRenderProvider } from './SlideRenderContext'
import { SlideView } from './SlideView'

function citing(ids: string[]): RichDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Påstand' },
          { type: 'citation', attrs: { referenceIds: ids } },
        ],
      },
    ],
  }
}

function withReferences(count: number): Presentation {
  const base = createPresentation({ title: 'Referanseslides' })
  const references: Reference[] = Array.from({ length: count }, (_, index) => ({
    id: `r${index}`,
    title: `Kilde ${index}`,
    authors: '',
    url: '',
    year: '2026',
  }))
  const card = createUntitledCard()
  const content = {
    ...card,
    body: {
      ...card.body,
      subfields: [{ ...card.body.subfields[0], doc: citing(references.map((r) => r.id)) }],
    },
  }
  return {
    ...base,
    references,
    slides: [sectionAt(base, 0), { ...contentAt(base, 1), root: createLeaf(content) }],
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
        isStatic: true,
      }}
    >
      {node}
    </SlideRenderProvider>,
  )
}

describe('a derived reference slide', () => {
  it('draws every entry left-aligned, not the deck default', () => {
    const presentation = withReferences(3)
    const [slide] = buildReferenceSlides(presentation)
    const markup = render(presentation, <SlideView slide={slide} />)

    // The title pill still centers, per the deck default — only the entries
    // themselves are forced left.
    const entries = markup.split('rich-doc--reference')[1]
    expect(entries).toContain('text-align:left')
    expect(entries).not.toContain('text-align:center')
  })

  it('gives entries more room than an ordinary paragraph, via the shared theme token', () => {
    const presentation = withReferences(3)
    const [slide] = buildReferenceSlides(presentation)
    const markup = render(presentation, <SlideView slide={slide} />)
    const tokens = themeMetrics(presentation.theme)

    expect(tokens.referenceEntryGap).toBeGreaterThan(tokens.blockSpacing)
    expect(markup).toContain(`--slaids-reference-gap:${tokens.referenceEntryGap}px`)
    expect(markup).toContain('rich-doc--reference')
  })
})
