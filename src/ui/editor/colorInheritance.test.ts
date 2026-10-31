import { describe, expect, it } from 'vitest'
import { ZONE_CONTENT_KINDS, createContentOfKind, createTitledCard } from '../../domain/content'
import { INHERITS_FROM_CARD_TITLE, INHERITS_FROM_SECTION, inheritedPill, standardLabel } from './colorInheritance'

const SECTION = '#4d4d80'

describe('inheritedPill', () => {
  it('follows the section the slide belongs to, outside a card with a title', () => {
    for (const kind of ['container', 'untitled-card', 'image', 'negative-space'] as const) {
      expect(inheritedPill(createContentOfKind(kind), SECTION), kind).toEqual({ color: SECTION, from: INHERITS_FROM_SECTION })
    }
    expect(inheritedPill(null, SECTION)).toEqual({ color: SECTION, from: INHERITS_FROM_SECTION })
  })

  it('follows the card title inside a card with one — which follows the section until it has a colour of its own', () => {
    for (const kind of ['titled-card', 'titled-image-card'] as const) {
      expect(inheritedPill(createContentOfKind(kind), SECTION), kind).toEqual({ color: SECTION, from: INHERITS_FROM_CARD_TITLE })
    }
    const coloured = { ...createTitledCard('Kort'), headerColor: '#a64d79' }
    expect(inheritedPill(coloured, SECTION)).toEqual({ color: '#a64d79', from: INHERITS_FROM_CARD_TITLE })
  })

  it('never names the front page: the source is the current section, whichever that is', () => {
    for (const kind of ZONE_CONTENT_KINDS) {
      const label = standardLabel(inheritedPill(createContentOfKind(kind), SECTION).from)
      expect(label).toMatch(/^Standard \(fra (gjeldende inndeling|korttittelen)\)$/)
      expect(label).not.toMatch(/forside/)
    }
  })
})
