/**
 * Vertical alignment, as CSS.
 *
 * One stored value drives how a field of flowing text sits inside the room it
 * was given, and the mapping is worth pinning down on its own — a picture has
 * no flow to align and answers the question with a crop instead.
 */

import { describe, expect, it } from 'vitest'
import { flowAlign } from './ZoneContentFrame'

describe('flowAlign', () => {
  it('defaults to the top of the field', () => {
    expect(flowAlign(undefined)).toBe(flowAlign('top'))
    expect(flowAlign('top')).toBe('start')
  })

  it('keeps overflow measurable by aligning safely', () => {
    // Content taller than its field overflows downwards, never up through the
    // top edge: `scrollHeight` only sees what grows past the bottom, and the
    // fit guard reads `scrollHeight`. Plain `center` would hide half of an
    // overflow from the very check meant to catch it.
    for (const align of ['middle', 'bottom'] as const) {
      expect(flowAlign(align).startsWith('safe ')).toBe(true)
    }
    expect(flowAlign('middle')).toBe('safe center')
    expect(flowAlign('bottom')).toBe('safe end')
  })
})
