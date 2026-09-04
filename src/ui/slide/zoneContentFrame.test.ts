/**
 * Vertical alignment, as CSS.
 *
 * One stored value drives two very different boxes — a field of flowing text
 * and a zone filled edge to edge by a picture — so the mapping is worth
 * pinning down on its own.
 */

import { describe, expect, it } from 'vitest'
import { assetAlign, assetFlowAlign, flowAlign } from './ZoneContentFrame'

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

describe('assetAlign', () => {
  it('leaves an unaligned picture where object-position puts it', () => {
    // A picture has no flow to begin at the top of, so it stays centred in the
    // box it fills until someone chooses otherwise. `undefined` is what lets
    // the stylesheet's own default stand.
    expect(assetAlign(undefined)).toBeUndefined()
  })

  it('places a picture that was aligned', () => {
    expect(assetAlign('top')).toBe('top')
    expect(assetAlign('middle')).toBe('center')
    expect(assetAlign('bottom')).toBe('bottom')
  })
})

describe('assetFlowAlign', () => {
  it('centres a picture nobody aligned', () => {
    // The other default than a field of text: a picture has no flow to begin at
    // the top of, so the middle of the room it was given is where it belongs.
    expect(assetFlowAlign(undefined)).toBe('safe center')
    expect(flowAlign(undefined)).toBe('start')
  })

  it('places a picture that was aligned, in the same terms a field uses', () => {
    // Shown whole, the element *is* the picture — so what moves is the box
    // inside the zone, which is the very property a field of text aligns with.
    for (const align of ['top', 'middle', 'bottom'] as const) {
      expect(assetFlowAlign(align)).toBe(flowAlign(align))
    }
  })

  it('is the other half of the choice `assetAlign` makes for a cropped picture', () => {
    // Cropped to the zone, the element is the zone and the picture moves inside
    // it. One stored value, two boxes: neither mapping is the other's fallback.
    expect(assetAlign('bottom')).toBe('bottom')
    expect(assetFlowAlign('bottom')).toBe('safe end')
  })
})
