/**
 * The two states, and the one rule that makes them predictable: a focus is only
 * ever as true as what is on screen right now.
 */

import { describe, expect, it } from 'vitest'
import {
  SECTION_SUBTITLE_NODE_ID,
  SECTION_TITLE_NODE_ID,
  TITLE_NODE_ID,
} from '../../domain/geometry'
import { createPresentation } from '../../domain/presentation'
import { contentAt, sectionAt } from '../../domain/testDecks'
import { canTypeIn, focusFieldRect, isZoneField, liveFocus, type StageFocus } from './stageFocus'

const focused: StageFocus = { slideId: 'slide-1', fieldId: 'zone-a' }

/** What the editor is looking at, with the focus's own slide and field drawn. */
const here = { slideId: 'slide-1', rect: { x: 0, y: 0, width: 400, height: 300 } }

describe('liveFocus', () => {
  it('keeps a focus that is still about what is on screen', () => {
    expect(liveFocus(focused, here)).toEqual(focused)
  })

  it('is nothing at all when nothing is focused', () => {
    expect(liveFocus(null, here)).toBeNull()
  })

  it('drops when the page is turned', () => {
    expect(liveFocus(focused, { ...here, slideId: 'slide-2' })).toBeNull()
  })

  /*
   * The field stopped being drawn: an undo that deleted the zone, a heading
   * switched off, a generated page opened over the slide. Whatever the reason,
   * the answer is the same and nothing has to notice it separately.
   */
  it('drops when the page no longer draws that field', () => {
    expect(liveFocus(focused, { ...here, rect: null })).toBeNull()
  })

  it('has nothing to be true about before a slide is open', () => {
    expect(liveFocus(focused, { ...here, slideId: null })).toBeNull()
  })
})

describe('isZoneField', () => {
  it('tells a zone of the layout from text that is drawn beside it', () => {
    expect(isZoneField('node-17')).toBe(true)
    expect(isZoneField(TITLE_NODE_ID)).toBe(false)
    expect(isZoneField(SECTION_TITLE_NODE_ID)).toBe(false)
    expect(isZoneField(SECTION_SUBTITLE_NODE_ID)).toBe(false)
  })
})

describe('focusFieldRect', () => {
  const deck = createPresentation({ title: 'Fokus' })

  it('answers for a zone and for the heading of the same slide', () => {
    const slide = contentAt(deck, 1)
    expect(focusFieldRect(slide, deck.theme, slide.root.id)).not.toBeNull()
    expect(focusFieldRect(slide, deck.theme, TITLE_NODE_ID)).not.toBeNull()
  })

  it('answers for nothing a slide does not draw', () => {
    const slide = contentAt(deck, 1)
    expect(focusFieldRect(slide, deck.theme, 'a-zone-that-was-deleted')).toBeNull()
    // A section's lines are not on a content slide, nor zones on a section.
    expect(focusFieldRect(slide, deck.theme, SECTION_TITLE_NODE_ID)).toBeNull()
    expect(focusFieldRect(sectionAt(deck, 0), deck.theme, slide.root.id)).toBeNull()
    expect(focusFieldRect(null, deck.theme, slide.root.id)).toBeNull()
  })

  it('answers for both lines of a section', () => {
    const section = sectionAt(deck, 0)
    const title = focusFieldRect(section, deck.theme, SECTION_TITLE_NODE_ID)
    const subtitle = focusFieldRect(section, deck.theme, SECTION_SUBTITLE_NODE_ID)
    expect(title).not.toBeNull()
    expect(subtitle).not.toBeNull()
    // Two lines, one above the other, and never the same rect.
    expect(subtitle!.y).toBeGreaterThan(title!.y)
  })

  /*
   * A heading that was switched off is no longer drawn, so it is no longer
   * somewhere to put the caret — asked of the geometry engine rather than of a
   * list somebody has to keep in step with it.
   */
  it('stops answering for a heading the slide no longer has', () => {
    const slide = contentAt(deck, 1)
    expect(focusFieldRect({ ...slide, title: null }, deck.theme, TITLE_NODE_ID)).toBeNull()
  })
})

describe('canTypeIn', () => {
  it('is every field, no field, or exactly the focused one', () => {
    expect(canTypeIn('all', 'zone-a')).toBe(true)
    expect(canTypeIn('none', 'zone-a')).toBe(false)
    expect(canTypeIn({ only: 'zone-a' }, 'zone-a')).toBe(true)
    expect(canTypeIn({ only: 'zone-a' }, 'zone-b')).toBe(false)
    expect(canTypeIn({ only: 'zone-a' }, TITLE_NODE_ID)).toBe(false)
  })
})
