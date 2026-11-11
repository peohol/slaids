/**
 * Where an uncoloured caption gets its background from.
 *
 * A plain picture has no title panel, so its caption falls back to the
 * governing section's accent colour exactly as a heading does. A titled image
 * card has one, and its caption is supposed to follow *that* header —
 * including the header's own fallback to the section when the header itself was
 * never coloured — so that recolouring the panel repaints the caption without
 * touching the stored document.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { bestTextColor } from '../../domain/color'
import { createCaption, createImage, createTitledImageCard } from '../../domain/content'
import { createPresentation } from '../../domain/presentation'
import type { ZoneContent } from '../../domain/types'
import { ZoneContentView } from './ZoneContentView'
import { PageColorsProvider, SlideRenderProvider } from './SlideRenderContext'

const ACCENT = '#bfccd9'
const BACKGROUND = '#101828'
const HEADER_COLOR = '#a64d79'

/**
 * One zone, drawn as a page in a section would draw it.
 *
 * The colours come through `PageColorsProvider` rather than the deck-wide
 * context because that is how a real page hands them down: which section
 * governs a page is decided once, above it, and everything inside reads the
 * answer.
 */
function render(content: ZoneContent): string {
  const presentation = createPresentation({ title: 'Dekk' })
  return renderToStaticMarkup(
    <SlideRenderProvider
      value={{
        theme: presentation.theme,
        numbering: new Map(),
        sectionColors: new Map(),
        progress: new Map(),
        logo: null,
        isStatic: true,
      }}
    >
      <PageColorsProvider colors={{ accent: ACCENT, background: BACKGROUND }}>
        <ZoneContentView content={content} />
      </PageColorsProvider>
    </SlideRenderProvider>,
  )
}

describe('an uncoloured caption', () => {
  it('reads the section’s accent on a plain picture, which has no header', () => {
    const content = createImage('asset-1')
    content.image.caption = createCaption('bottom')
    const markup = render(content)
    expect(markup).toContain('color-mix(in srgb, var(--slaids-heading-pill)')
    expect(markup).not.toContain(`--slaids-heading-pill:${ACCENT}`)
  })

  it('reads its own title panel’s header on a titled image card', () => {
    const content = createTitledImageCard('asset-1', 'Fjord', HEADER_COLOR)
    content.image.caption = createCaption('bottom')
    const markup = render(content)
    expect(markup).toContain(`--slaids-heading-pill:${HEADER_COLOR}`)
    expect(markup).toContain(`--slaids-heading-pill-text:${bestTextColor(HEADER_COLOR)}`)
  })

  it('follows the header to the section when the header itself has no colour', () => {
    const content = createTitledImageCard('asset-1', 'Fjord', null)
    content.image.caption = createCaption('bottom')
    const markup = render(content)
    expect(markup).toContain(`--slaids-heading-pill:${ACCENT}`)
  })

  it('keeps a caption’s own colour regardless of the header', () => {
    const content = createTitledImageCard('asset-1', 'Fjord', HEADER_COLOR)
    content.image.caption = { ...createCaption('bottom'), color: '#112233' }
    const markup = render(content)
    expect(markup).toContain('color-mix(in srgb, #112233')
  })
})
