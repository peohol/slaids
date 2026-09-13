/**
 * What the content picker offers, and what it refuses to offer.
 *
 * Every surface that lets somebody choose a content kind — the picker drawn in
 * an empty zone, the inspector, the toolbar, the zone menu and the compact
 * tools panel — reads this one list, so this file is where «the picker disables
 * what cannot be used, and says why» is actually checked. The rule itself is
 * the domain's (`contentKindRefusal`); what is checked here is that the picker
 * asks it about the right rectangle and passes the answer through unchanged.
 */

import { describe, expect, it } from 'vitest'
import { contentKindRefusal, minimumSizeForKind } from '../../domain/contentSize'
import { themeMetrics } from '../../domain/metrics'
import { createUntitledCard, negativeSpaceRefusal } from '../../domain/content'
import { paragraphDoc } from '../../domain/richdoc'
import type { Rect, ZoneContent } from '../../domain/types'
import { contentKindOptions, CONTENT_KINDS } from './contentKinds'

const at = (width: number, height: number): Rect => ({ x: 0, y: 0, width, height })

/** A zone with room for anything: the whole design space, near enough. */
const ROOMY = at(1500, 800)

describe('contentKindOptions', () => {
  it('offers every kind the domain knows about', () => {
    expect(contentKindOptions(ROOMY).map((option) => option.kind)).toEqual(CONTENT_KINDS)
  })

  it('enables everything in a zone with room for it', () => {
    for (const option of contentKindOptions(ROOMY)) {
      expect(option.disabled, option.kind).toBe(false)
      expect(option.reason, option.kind).toBeNull()
    }
  })

  it('disables what cannot be drawn, and says why', () => {
    const narrow = at(60, 40)
    for (const option of contentKindOptions(narrow)) {
      if (option.kind === 'negative-space') {
        expect(option.disabled).toBe(false)
        continue
      }
      expect(option.disabled, option.kind).toBe(true)
      // The domain's own sentence, not a second one written here: the tooltip
      // and a refused agent call have to say the same thing.
      expect(option.reason, option.kind).toBe(
        contentKindRefusal(option.kind, narrow, themeMetrics())?.message,
      )
    }
  })

  it('loses possibilities gradually as the zone shrinks', () => {
    const available = (rect: Rect): number =>
      contentKindOptions(rect).filter((option) => !option.disabled).length
    const roomy = available(ROOMY)
    const short = available(at(1500, minimumSizeForKind('titled-card').height - 1))
    const narrow = available(at(minimumSizeForKind('image').width - 1, 800))

    expect(roomy).toBe(CONTENT_KINDS.length)
    expect(short).toBeLessThan(roomy)
    expect(narrow).toBeLessThan(short)
  })

  it('leaves negativt rom as the last choice standing', () => {
    const available = contentKindOptions(at(4, 3)).filter((option) => !option.disabled)
    expect(available.map((option) => option.kind)).toEqual(['negative-space'])
  })

  it('disables negativt rom when the zone holds something to lose', () => {
    // Only air can lose anything, and it loses everything. A button that looks
    // available and then fails on click is worse than one that was never
    // offered — so the picker asks the same question the command refuses by.
    const card = createUntitledCard()
    const filled: ZoneContent = {
      ...card,
      body: {
        ...card.body,
        subfields: [{ ...card.body.subfields[0], doc: paragraphDoc('noe tekst') }],
      },
    }
    const air = contentKindOptions(ROOMY, undefined, filled).find(
      (option) => option.kind === 'negative-space',
    )
    expect(air?.disabled).toBe(true)
    expect(air?.reason).toBe(negativeSpaceRefusal(filled))

    // An empty card has nothing to lose, so it may become air.
    const empty = contentKindOptions(ROOMY, undefined, card).find(
      (option) => option.kind === 'negative-space',
    )
    expect(empty?.disabled).toBe(false)
  })

  it('never disables the kind the zone already is', () => {
    // A zone too small for what it holds is the document that needs repairing.
    // Greying out its own kind would read as broken, and the command answers
    // «done» to that call anyway.
    const cramped = at(60, 40)
    const card = createUntitledCard()
    const own = contentKindOptions(cramped, undefined, card).find(
      (option) => option.kind === 'untitled-card',
    )
    expect(own?.disabled).toBe(false)
    // Every other kind that needs more room is still unavailable.
    const other = contentKindOptions(cramped, undefined, card).find(
      (option) => option.kind === 'titled-card',
    )
    expect(other?.disabled).toBe(true)
  })

  it('offers everything when there is no zone to measure against', () => {
    // Nothing is selected. A picker that greyed everything out because it does
    // not know the size would be telling the author something false.
    for (const option of contentKindOptions(null)) {
      expect(option.disabled, option.kind).toBe(false)
    }
  })

  it('asks the deck\'s own theme, because a card\'s chrome scales with it', () => {
    const tall = at(1500, minimumSizeForKind('titled-card', themeMetrics({ fontScale: 1.3 })).height)
    const small = contentKindOptions(tall, {
      headingFontFamily: 'a',
      bodyFontFamily: 'b',
      spacing: 2,
      fontScale: 1.3,
    })
    const large = contentKindOptions(tall, {
      headingFontFamily: 'a',
      bodyFontFamily: 'b',
      spacing: 2,
      fontScale: 2,
    })
    const titled = (options: ReturnType<typeof contentKindOptions>): boolean =>
      options.find((option) => option.kind === 'titled-card')?.disabled ?? false
    expect(titled(small)).toBe(false)
    expect(titled(large)).toBe(true)
  })
})
