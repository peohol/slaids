/**
 * The four steps, and the one rule that makes them predictable: a focus is only
 * ever as true as what is on screen right now.
 */

import { describe, expect, it } from 'vitest'
import { liveFocus, type StageFocus } from './stageFocus'

const focused: StageFocus = { slideId: 'slide-1', nodeId: 'zone-a', editing: false }
const typing: StageFocus = { ...focused, editing: true }

/** What the editor is looking at, with the focus's own slide and zone. */
const here = {
  slideId: 'slide-1',
  selectedNodeId: 'zone-a',
  focusable: true,
  hasText: true,
}

describe('liveFocus', () => {
  it('keeps a focus that is still about what is on screen', () => {
    expect(liveFocus(focused, here)).toEqual(focused)
    expect(liveFocus(typing, here)).toEqual(typing)
  })

  it('is nothing at all when nothing is focused', () => {
    expect(liveFocus(null, here)).toBeNull()
  })

  it('drops when the page is turned', () => {
    expect(liveFocus(typing, { ...here, slideId: 'slide-2' })).toBeNull()
  })

  it('drops when another zone is selected', () => {
    expect(liveFocus(typing, { ...here, selectedNodeId: 'zone-b' })).toBeNull()
  })

  it('drops when the zone stops being one worth focusing', () => {
    // An undo that deleted the zone, or a selection that became the root — the
    // root *is* the slide, so filling the stage with it is the view already on.
    expect(liveFocus(focused, { ...here, focusable: false })).toBeNull()
  })

  /*
   * The one step that comes down on its own without the whole ladder going
   * with it: a zone can lose its text — an undo, a content kind changed from
   * another surface — while the view of it stays perfectly sensible.
   */
  it('stops typing, but stays focused, when the zone loses its text', () => {
    expect(liveFocus(typing, { ...here, hasText: false })).toEqual(focused)
    expect(liveFocus(focused, { ...here, hasText: false })).toEqual(focused)
  })

  it('has nothing to be true about before a slide is open', () => {
    expect(liveFocus(typing, { ...here, slideId: null })).toBeNull()
    expect(liveFocus(typing, { ...here, selectedNodeId: null })).toBeNull()
  })
})
