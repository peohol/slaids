/**
 * The cover: mandatory, unmovable, and the source of the deck's heading colour.
 *
 * Three things are worth pinning down here, because each of them is a rule
 * rather than an implementation detail:
 *
 *  - the cover exists on every presentation and no command can remove it;
 *  - a cover line is one line, so text that would be clipped is refused — and
 *    so is a *theme* that would clip a line that fits today;
 *  - the pill colour is one value with two jobs, and picking it never touches a
 *    heading that was given a colour of its own.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_PILL_COLOR } from '../constants'
import { estimateFitChecker, estimateTitleFitChecker } from '../fit'
import { FONT_OPTIONS } from '../fonts'
import { COVER_SUBTITLE_NODE_ID, COVER_TITLE_NODE_ID } from '../geometry'
import { COVER_PAGE_ID, deckPages } from '../pages'
import { createPresentation } from '../presentation'
import { docToPlainText, titleDoc } from '../richdoc'
import type { Presentation } from '../types'
import {
  createDeck,
  deleteSlide,
  setCoverPillColor,
  setCoverSubtitle,
  setCoverTitle,
  setTheme,
} from './index'

const checkers = { fits: estimateFitChecker, fitsTitle: estimateTitleFitChecker }

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`)
  }
  return result.value
}

const stack = (id: string): string => {
  const font = FONT_OPTIONS.find((option) => option.id === id)
  if (!font) throw new Error(`unknown font ${id}`)
  return font.stack
}

function deck(): Presentation {
  return createPresentation({ title: 'Kvartalsrapport' })
}

describe('every deck has a cover', () => {
  it('creates one from the deck’s own name', () => {
    const presentation = deck()
    expect(docToPlainText(presentation.cover.title).trim()).toBe('Kvartalsrapport')
    expect(docToPlainText(presentation.cover.subtitle).trim()).toBe('')
    expect(presentation.cover.pillColor).toBe(DEFAULT_PILL_COLOR)
  })

  it('puts it first, and keeps it there when the last slide is gone', () => {
    const presentation = deck()
    expect(deckPages(presentation)[0].kind).toBe('cover')
    // There is no command that removes a cover, and the one that empties a deck
    // of slides is refused for its own reasons — so the first page never moves.
    expect(deleteSlide(presentation, presentation.slides[0].id).ok).toBe(false)
  })
})

describe('creating a deck', () => {
  it('seeds the cover from the name and accepts an ordinary one', () => {
    const created = unwrap(createDeck({ title: 'Kvartalsrapport' }, checkers))
    expect(docToPlainText(created.cover.title).trim()).toBe('Kvartalsrapport')
  })

  it('refuses a name too long for the one line the cover gives it', () => {
    // The name is the cover's first line, so creation is measured exactly as
    // editing that line would be — otherwise a deck could be born in a state
    // its very next edit would refuse.
    const result = createDeck({ title: 'Et navn som er altfor langt '.repeat(6) }, checkers)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(result.error.details).toMatchObject({ slideId: COVER_PAGE_ID })
  })

  it('refuses an over-long cover line a caller supplied itself', () => {
    const result = createDeck(
      { title: 'Kort', coverSubtitle: 'En undertittel som er altfor lang '.repeat(6) },
      checkers,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.details).toMatchObject({ nodeId: COVER_SUBTITLE_NODE_ID })
  })

  it('measures against the theme the deck is actually created with', () => {
    const near = { title: 'Kvartalsrapport for hele konsernet'.padEnd(52, ' x') }
    expect(createDeck(near, checkers).ok).toBe(true)
    expect(
      createDeck({ ...near, theme: { headingFontFamily: stack('verdana') } }, checkers).ok,
    ).toBe(false)
  })

  it('leaves the pure factory alone: loading and importing are never gated', () => {
    // `createPresentation` is what migrations and imports go through, and a
    // document that arrives over-long has to arrive.
    const long = createPresentation({ title: 'Et navn som er altfor langt '.repeat(6) })
    expect(docToPlainText(long.cover.title).length).toBeGreaterThan(100)
  })
})

describe('cover text', () => {
  it('takes a title and a subtitle', () => {
    const withTitle = unwrap(setCoverTitle(deck(), titleDoc('Andre kvartal'), checkers))
    const both = unwrap(setCoverSubtitle(withTitle, titleDoc('Tall og tiltak'), checkers))
    expect(docToPlainText(both.cover.title).trim()).toBe('Andre kvartal')
    expect(docToPlainText(both.cover.subtitle).trim()).toBe('Tall og tiltak')
  })

  it('refuses a title too long for one line, and says which line', () => {
    const result = setCoverTitle(deck(), titleDoc('Forsidetittel '.repeat(20)), checkers)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(result.error.details).toMatchObject({
      slideId: COVER_PAGE_ID,
      nodeId: COVER_TITLE_NODE_ID,
    })
  })

  it('lets the subtitle be longer than the title, because it is set smaller', () => {
    // Measured at the title's size this would be refused; the subtitle is a
    // step down, and the checker is told which size it is looking at.
    const line = titleDoc('En ganske lang undertittel som beskriver hele innholdet i dekket')
    expect(setCoverTitle(deck(), line, checkers).ok).toBe(false)
    expect(setCoverSubtitle(deck(), line, checkers).ok).toBe(true)
  })

  it('refuses a theme that would clip a cover line that fits today', () => {
    // Long enough for the default heading font and no longer: this many
    // characters fill the pill at the deck's own type size, and Verdana is
    // 12 % wider per glyph.
    const near = 'Kvartalsrapport for hele konsernet'.padEnd(52, ' x')
    const presentation = unwrap(setCoverTitle(deck(), titleDoc(near), checkers))

    // Nothing about the cover changes here — the type it is set in does, and
    // the cover is measured for it exactly as every slide is.
    expect(setTheme(presentation, { headingFontFamily: stack('verdana') }, checkers).ok).toBe(false)
    expect(setTheme(presentation, { fontScale: 1.6 }, checkers).ok).toBe(false)
    // A narrower font has more room, not less, so it stays available.
    expect(setTheme(presentation, { headingFontFamily: stack('times') }, checkers).ok).toBe(true)
  })

  it('always lets an over-long line be shortened again', () => {
    const presentation = deck()
    const overfull: Presentation = {
      ...presentation,
      cover: { ...presentation.cover, title: titleDoc('Altfor lang tittel '.repeat(10)) },
    }
    // The gate is a regression test, not an absolute one: a document that
    // arrives too long has to be repairable by editing it.
    const repaired = setCoverTitle(overfull, titleDoc('Altfor lang tittel '.repeat(5)), checkers)
    expect(repaired.ok).toBe(true)
  })
})

describe('the pill colour', () => {
  it('normalises what it stores and refuses what is not a colour', () => {
    expect(unwrap(setCoverPillColor(deck(), '#ABC')).cover.pillColor).toBe('#aabbcc')
    expect(setCoverPillColor(deck(), 'blå').ok).toBe(false)
  })

  it('changes nothing in any slide document', () => {
    const presentation = deck()
    const recoloured = unwrap(setCoverPillColor(presentation, '#a64d79'))
    // Every heading that follows the default follows it at *render* time, so
    // recolouring is one field, not a sweep over the deck.
    expect(recoloured.slides).toBe(presentation.slides)
    expect(recoloured.cover.title).toBe(presentation.cover.title)
  })

  it('is a no-op when it is already that colour', () => {
    const presentation = deck()
    expect(unwrap(setCoverPillColor(presentation, DEFAULT_PILL_COLOR))).toBe(presentation)
  })
})
