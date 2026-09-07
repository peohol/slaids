/**
 * One page of a deck, whatever kind it is.
 *
 * Everything that draws a deck — presentation mode, the shared view, the
 * filmstrip thumbnails, the read-only stage — goes through this, so a page type
 * is added in one place rather than in four.
 *
 * The page box is this component's own element rather than the page view's, and
 * the progress indicator hangs in it. That is what keeps the indicator mounted
 * across a page turn: the kinds are different components, so React replaces the
 * view when the deck moves from the last slide to the QR page — and an
 * indicator that went with it would be a new element with no previous width for
 * the transition to run from, which is exactly the page turn that would jump.
 */

import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import type { DeckPage } from '../../domain/pages'
import { InteractivePageView } from './InteractivePageView'
import { SectionPageView } from './SectionPageView'
import { QrPageView } from './QrPageView'
import { SlideProgressBar } from './SlideProgressBar'
import { SlideView } from './SlideView'

/**
 * Every kind of page, named. An interactive slide is drawn as its cover here
 * and everywhere: what may *run* it is decided by the surface around this
 * component, never by this component.
 */
function PageBody({ page }: { page: DeckPage }) {
  if (page.kind === 'qr') return <QrPageView url={page.shareUrl} />
  switch (page.slide.kind) {
    case 'section':
      return <SectionPageView section={page.slide} />
    case 'interactive':
      return <InteractivePageView slide={page.slide} />
    case 'content':
      return <SlideView slide={page.slide} />
  }
}

export function DeckPageView({ page }: { page: DeckPage }) {
  return (
    <div className="deck-page" style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT }}>
      <PageBody page={page} />
      <SlideProgressBar pageId={page.id} />
    </div>
  )
}
