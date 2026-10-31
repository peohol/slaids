/**
 * Where a colour nobody picked comes from, as the editor says it.
 *
 * A heading pill, a titled card's title panel and a picture's caption store no
 * colour until somebody picks one, and are painted with whatever they follow:
 * the accent of the section the slide belongs to — the nearest inndeling
 * before it, which is the front page only for the slides before the first
 * other one — or, inside a card with a title, that card's title panel, which
 * the renderer scopes the pill colour to (`ZoneContentFrame`). Every
 * «Standard (…)» choice in the toolbar, the inspector and the context menu
 * reads the colour and its source from here, so none of them can name the
 * front page for a colour that comes from somewhere else.
 */

import { hasCardTitle } from '../../domain/content'
import type { ZoneContent } from '../../domain/types'

export const INHERITS_FROM_SECTION = 'fra gjeldende inndeling'
export const INHERITS_FROM_CARD_TITLE = 'fra korttittelen'

export interface InheritedPill {
  /** What a pill with no colour of its own is painted with here, right now. */
  color: string
  /** Where that colour comes from, in the words the «Standard» choice uses. */
  from: string
}

/** Where a pill — an accent in the text, or a caption — with no colour of its own takes it from inside `content`. */
export function pillSource(content: ZoneContent | null | undefined): string {
  return content && hasCardTitle(content) ? INHERITS_FROM_CARD_TITLE : INHERITS_FROM_SECTION
}

/** The same, with the colour it resolves to, given the accent of the section the slide is in. */
export function inheritedPill(content: ZoneContent | null | undefined, sectionAccent: string): InheritedPill {
  return {
    color: content && hasCardTitle(content) ? (content.headerColor ?? sectionAccent) : sectionAccent,
    from: pillSource(content),
  }
}

/** The label of the choice that clears a picked colour and follows the source again. */
export function standardLabel(from: string): string {
  return `Standard (${from})`
}
