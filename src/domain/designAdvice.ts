/**
 * Findings about slides that are legal but probably not what was meant.
 *
 * `validation.ts` answers one question — what is *wrong* with this document —
 * and everything it reports is a broken invariant: a tree that is not a tree, a
 * rect outside its parent, text pushed out of sight, a pointer to a file that
 * is not there. This module answers a different one, and it is kept separate
 * for exactly that reason: what it finds is not invalid, and calling it invalid
 * would leave a caller that made the choice deliberately with a document it can
 * never get a clean answer about.
 *
 * So the two never mix. A design finding is advice: it names one structure, says
 * what the ordinary repair is, and says when keeping it is a real choice. It is
 * the mechanism half of a rule the agent contract already states in prose (see
 * `agent/design.ts` — `PRIMARY_TEXT_RULE` and `ACCENT_RULE`); the rule is not
 * restated here, only the structure that violates it and the repair.
 *
 * The heuristics are structural on purpose. Whether a sentence *reads* as a
 * heading is not something this can know, and guessing at it with word counts
 * or language rules would produce a check nobody could predict. What it can
 * know is where a block sits, what kind of block it is, and what surrounds it —
 * and the observed anti-pattern is visible in exactly that.
 */

import { bodyOf } from './content'
import { collectLeaves } from './layout'
import { ACCENT_NODE, isDocEmpty } from './richdoc'
import type { NodeId, Presentation, RichDoc, RichNode, Slide, ZoneContent } from './types'

export type AdviceCode =
  /** An accent at the top of an `untitled-card` is standing in for a card title. */
  'ACCENT_AS_CARD_TITLE'

/**
 * One finding, addressed the way a caller would act on it.
 *
 * The same shape as an `InvariantIssue` minus the codes and plus nothing: a
 * caller that already knows how to read one reads this the same way, and the
 * separate type is what keeps «the deck is broken» and «the deck could be
 * better» from ending up in the same list.
 */
export interface DesignAdvice {
  code: AdviceCode
  message: string
  slideId: string
  nodeId: NodeId
  details?: Record<string, unknown>
}

const ACCENT_AS_CARD_TITLE_MESSAGE =
  'Denne sonen ser ut som primært tekstinnhold, men bruker `untitled-card` med en aksent som overskrift. Bruk normalt `titled-card` og flytt overskriften til korttittelen. Behold `untitled-card` bare dersom en manglende korttittel er et bevisst semantisk valg.'

/**
 * The blocks in a document that draw something.
 *
 * An empty paragraph is real in the document — it is how a person makes room
 * between two paragraphs — and it draws nothing, so counting it would make
 * «the accent is first» depend on whether somebody pressed Enter first. The
 * same question `isDocEmpty` already answers, asked of one block at a time.
 */
function drawnBlocks(doc: RichDoc | null | undefined): RichNode[] {
  return (doc?.content ?? []).filter((node) => !isDocEmpty({ type: 'doc', content: [node] }))
}

/**
 * Whether a card is using a leading accent as the card title it does not have.
 *
 * Three conditions, and all three are load-bearing:
 *
 *  - The card is an `untitled-card`. A `titled-card` already has somewhere for
 *    a heading to live, and a `container` is the secondary format for support
 *    text that is deliberately not a unit of its own — neither is the observed
 *    failure, and flagging them would be the over-correction.
 *  - The accent is the first thing drawn in the card, and there is something
 *    after it. An accent with nothing under it *is* the card's whole message,
 *    which is precisely the case `untitled-card` exists for; an accent further
 *    down is a highlighted point inside prose, which is what an accent is for.
 *  - It is the card's only accent. A card divided by several accents is a card
 *    with several named sub-points — the internal division `ACCENT_RULE`
 *    describes — and no single one of them is pretending to be the card's
 *    heading.
 *
 * Read across the subfields in order rather than per field, because the fields
 * are one card: an accent at the top of the first field heads everything the
 * card draws, whichever field the prose under it happens to sit in.
 */
export function accentUsedAsCardTitle(content: ZoneContent): boolean {
  if (content.kind !== 'untitled-card') return false
  const body = bodyOf(content)
  if (!body) return false

  const blocks = body.subfields.flatMap((field) => drawnBlocks(field.doc))
  if (blocks.length < 2 || blocks[0].type !== ACCENT_NODE) return false
  return blocks.filter((node) => node.type === ACCENT_NODE).length === 1
}

/** Everything worth saying about one slide's composition. */
export function findSlideAdvice(slide: Slide): DesignAdvice[] {
  if (slide.kind !== 'content') return []
  const advice: DesignAdvice[] = []
  for (const leaf of collectLeaves(slide.root)) {
    if (!leaf.content || !accentUsedAsCardTitle(leaf.content)) continue
    advice.push({
      code: 'ACCENT_AS_CARD_TITLE',
      message: ACCENT_AS_CARD_TITLE_MESSAGE,
      slideId: slide.id,
      nodeId: leaf.id,
      details: { contentKind: leaf.content.kind },
    })
  }
  return advice
}

/**
 * The same pass over the whole deck.
 *
 * Slides only. The sandbox holds content that is not on a slide, and content
 * nobody is currently looking at is not a composition to advise about — it is
 * material parked for later, and the advice is due the day it is placed.
 */
export function findPresentationAdvice(presentation: Presentation): DesignAdvice[] {
  return presentation.slides.flatMap(findSlideAdvice)
}
