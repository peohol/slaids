/**
 * One page of a deck, whatever kind it is.
 *
 * Everything that draws a deck — presentation mode, the shared view, the
 * filmstrip thumbnails, the read-only stage — goes through this, so a page type
 * is added in one place rather than in four.
 */

import type { DeckPage } from '../../domain/pages'
import { CoverPageView } from './CoverPageView'
import { QrPageView } from './QrPageView'
import { SlideView } from './SlideView'

export function DeckPageView({ page }: { page: DeckPage }) {
  if (page.kind === 'cover') return <CoverPageView cover={page.cover} />
  if (page.kind === 'qr') return <QrPageView url={page.shareUrl} />
  return <SlideView slide={page.slide} />
}
