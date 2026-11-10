/**
 * Vertical alignment, as CSS.
 *
 * One stored value drives how a field of flowing text sits inside the room it
 * was given, and the mapping is worth pinning down on its own — a picture has
 * no flow to align and answers the question with a crop instead.
 */

import { describe, expect, it } from 'vitest'
import { CARD_RADIUS, CARD_SHADOW, DEFAULT_VERTICAL_ALIGN } from '../../domain/constants'
import { themeMetrics } from '../../domain/metrics'
import { flowAlign, titledCardStyles } from './ZoneContentFrame'

describe('flowAlign', () => {
  it('reads an absent alignment as the default', () => {
    expect(flowAlign(undefined)).toBe(flowAlign(DEFAULT_VERTICAL_ALIGN))
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

describe('titledCardStyles', () => {
  const look = (style: 'joined' | 'tab' | 'floating', align: 'left' | 'center' | 'right' = 'center') =>
    titledCardStyles(themeMetrics({ titledCardStyle: style }), CARD_SHADOW, align, false)

  it('draws one card with a full-width header when joined', () => {
    const joined = look('joined')
    expect(joined.card.boxShadow).toBe(CARD_SHADOW)
    expect(joined.header.alignSelf).toBeUndefined()
    expect(joined.bodyIsCard).toBe(false)
  })

  it('makes the body a card of its own, and each box casts its own shadow, otherwise', () => {
    for (const style of ['tab', 'floating'] as const) {
      const split = look(style)
      expect(split.card.boxShadow, style).toBeUndefined()
      expect(split.card.overflow, style).toBe('visible')
      expect([split.header.boxShadow, split.body.boxShadow], style).toEqual([CARD_SHADOW, CARD_SHADOW])
      expect(split.body.borderRadius, style).toBe(CARD_RADIUS)
      expect(split.header.width, style).toBe('max-content')
      expect(split.bodyIsCard, style).toBe(true)
    }
  })

  it('runs a tab one radius down behind the body, and never wider than the body less a radius', () => {
    const tab = look('tab')
    expect(tab.header.maxWidth).toBe(`calc(100% - ${CARD_RADIUS}px)`)
    expect(tab.header.marginBottom).toBe(-CARD_RADIUS)
    expect(tab.body.zIndex).toBe(1)
  })

  it('keeps a floating header one global gap above the body, and lets it be as wide', () => {
    const tokens = themeMetrics({ titledCardStyle: 'floating' })
    const floating = look('floating')
    expect(floating.header.marginBottom).toBe(tokens.gap)
    expect(floating.header.maxWidth).toBe('calc(100% - 0px)')
  })

  it('stands the title box where its title is aligned', () => {
    expect(look('tab', 'left').header.alignSelf).toBe('flex-start')
    expect(look('tab', 'center').header.alignSelf).toBe('center')
    expect(look('floating', 'right').header.alignSelf).toBe('flex-end')
  })
})
