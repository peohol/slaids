/**
 * Sections: the deck's front page, the parts after it, and the colours they set.
 *
 * Four things are worth pinning down here, because each is a rule rather than
 * an implementation detail:
 *
 *  - every deck opens with a section, and no command can leave it opening with
 *    anything else;
 *  - a section line is one line, so text that would be clipped is refused — and
 *    so is a *theme* that would clip a line that fits today;
 *  - the two colours belong to the section and reach every page after it, and
 *    picking one never touches a heading that was given a colour of its own;
 *  - a new section inherits the colours of the one before it.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_BACKGROUND_COLOR, DEFAULT_PILL_COLOR } from '../constants'
import { estimateFitChecker, estimateTitleFitChecker } from '../fit'
import { FONT_OPTIONS } from '../fonts'
import { SECTION_SUBTITLE_NODE_ID, SECTION_TITLE_NODE_ID } from '../geometry'
import { deckPages, deckSectionColors } from '../pages'
import { FONT_SCALE_RANGE } from '../metrics'
import { createPresentation } from '../presentation'
import { docToPlainText, titleDoc } from '../richdoc'
import { sectionAt } from '../testDecks'
import type { Presentation } from '../types'
import {
  addSection,
  addSlide,
  createDeck,
  deleteSlide,
  moveSlide,
  setSectionAccentColor,
  setSectionBackgroundColor,
  setSectionSubtitle,
  setSectionTitle,
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

/** The deck's front page: the first slide, which is always a section. */
function front(presentation: Presentation) {
  return sectionAt(presentation, 0)
}

describe('every deck opens with a section', () => {
  it('creates one from the deck’s own name', () => {
    const presentation = deck()
    expect(docToPlainText(front(presentation).title).trim()).toBe('Kvartalsrapport')
    expect(docToPlainText(front(presentation).subtitle).trim()).toBe('')
    expect(front(presentation).accentColor).toBe(DEFAULT_PILL_COLOR)
    expect(front(presentation).backgroundColor).toBe(DEFAULT_BACKGROUND_COLOR)
  })

  it('puts it first, and the pages start there', () => {
    const presentation = deck()
    const first = deckPages(presentation)[0]
    expect(first.kind).toBe('authored-slide')
    expect(first.id).toBe(presentation.slides[0].id)
  })

  it('refuses a deletion that would leave a content slide first', () => {
    const presentation = deck()
    const result = deleteSlide(presentation, presentation.slides[0].id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FIRST_SLIDE_MUST_BE_SECTION')
  })

  it('allows deleting the front page when the next section takes over', () => {
    // The rule is about the *result*, not about position 0: dropping the first
    // part of a deck is a thing an author means to do.
    let presentation = deck()
    presentation = unwrap(addSection(presentation, { index: 1, title: 'Del to', ...checkers }))
    const next = unwrap(deleteSlide(presentation, presentation.slides[0].id))
    expect(next.slides[0].kind).toBe('section')
    expect(docToPlainText(sectionAt(next, 0).title).trim()).toBe('Del to')
  })

  it('refuses a reordering that would move the last section out of first place', () => {
    const presentation = unwrap(addSlide(deck(), {}))
    const result = moveSlide(presentation, presentation.slides[0].id, 2, checkers)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('FIRST_SLIDE_MUST_BE_SECTION')
  })
})

describe('creating a deck', () => {
  it('seeds the front page from the name and accepts an ordinary one', () => {
    const created = unwrap(createDeck({ title: 'Kvartalsrapport' }, checkers))
    expect(docToPlainText(front(created).title).trim()).toBe('Kvartalsrapport')
  })

  it('refuses a name too long for the one line the front page gives it', () => {
    // The name is the front page's first line, so creation is measured exactly
    // as editing that line would be — otherwise a deck could be born in a state
    // its very next edit would refuse.
    const result = createDeck({ title: 'Et navn som er altfor langt '.repeat(6) }, checkers)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(result.error.details).toMatchObject({ nodeId: SECTION_TITLE_NODE_ID })
  })

  it('refuses an over-long front-page line a caller supplied itself', () => {
    const result = createDeck(
      { title: 'Kort', frontSubtitle: 'En undertittel som er altfor lang '.repeat(6) },
      checkers,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.details).toMatchObject({ nodeId: SECTION_SUBTITLE_NODE_ID })
  })

  it('measures against the theme the deck is actually created with', () => {
    const near = { title: 'Kvartalsrapport for hele konsernet'.padEnd(44, ' x') }
    expect(createDeck(near, checkers).ok).toBe(true)
    expect(
      createDeck({ ...near, theme: { headingFontFamily: stack('verdana') } }, checkers).ok,
    ).toBe(false)
  })

  it('takes the colours the front section starts in', () => {
    const created = unwrap(
      createDeck({ title: 'Kort', accentColor: '#a64d79', backgroundColor: '#101828' }, checkers),
    )
    expect(front(created).accentColor).toBe('#a64d79')
    expect(front(created).backgroundColor).toBe('#101828')
  })

  it('leaves the pure factory alone: loading and importing are never gated', () => {
    // `createPresentation` is what migrations and imports go through, and a
    // document that arrives over-long has to arrive.
    const long = createPresentation({ title: 'Et navn som er altfor langt '.repeat(6) })
    expect(docToPlainText(front(long).title).length).toBeGreaterThan(100)
  })
})

describe('section text', () => {
  const id = (presentation: Presentation): string => presentation.slides[0].id

  it('takes a heading and a subheading', () => {
    const base = deck()
    const withTitle = unwrap(setSectionTitle(base, id(base), titleDoc('Andre kvartal'), checkers))
    const both = unwrap(
      setSectionSubtitle(withTitle, id(base), titleDoc('Tall og tiltak'), checkers),
    )
    expect(docToPlainText(front(both).title).trim()).toBe('Andre kvartal')
    expect(docToPlainText(front(both).subtitle).trim()).toBe('Tall og tiltak')
  })

  it('refuses a heading too long for one line, and says which line', () => {
    const base = deck()
    const result = setSectionTitle(base, id(base), titleDoc('Forsidetittel '.repeat(20)), checkers)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(result.error.details).toMatchObject({
      slideId: id(base),
      nodeId: SECTION_TITLE_NODE_ID,
    })
  })

  it('lets the subheading be longer than the heading, because it is set smaller', () => {
    // Measured at the heading's size this would be refused; the subheading is a
    // step down, and the checker is told which size it is looking at.
    const base = deck()
    const line = titleDoc('En ganske lang undertittel som beskriver hele innhold')
    expect(setSectionTitle(base, id(base), line, checkers).ok).toBe(false)
    expect(setSectionSubtitle(base, id(base), line, checkers).ok).toBe(true)
  })

  it('refuses a theme that would clip a section line that fits today', () => {
    // Long enough for the default heading font and no longer: this many
    // characters fill the pill at the deck's own type size, and Verdana is
    // 12 % wider per glyph.
    const base = deck()
    const near = 'Kvartalsrapport for hele konsernet'.padEnd(44, ' x')
    const presentation = unwrap(setSectionTitle(base, id(base), titleDoc(near), checkers))

    // Nothing about the section changes here — the type it is set in does, and
    // a section is measured for it exactly as every slide is.
    expect(setTheme(presentation, { headingFontFamily: stack('verdana') }, checkers).ok).toBe(false)
    expect(setTheme(presentation, { fontScale: FONT_SCALE_RANGE.max }, checkers).ok).toBe(false)
    // A narrower font has more room, not less, so it stays available.
    expect(setTheme(presentation, { headingFontFamily: stack('times') }, checkers).ok).toBe(true)
  })

  it('always lets an over-long line be shortened again', () => {
    const presentation = deck()
    const overfull: Presentation = {
      ...presentation,
      slides: [
        { ...front(presentation), title: titleDoc('Altfor lang tittel '.repeat(10)) },
        ...presentation.slides.slice(1),
      ],
    }
    // The gate is a regression test, not an absolute one: a document that
    // arrives too long has to be repairable by editing it.
    const repaired = setSectionTitle(
      overfull,
      id(overfull),
      titleDoc('Altfor lang tittel '.repeat(5)),
      checkers,
    )
    expect(repaired.ok).toBe(true)
  })

  it('refuses to set section text on a slide with zones', () => {
    const presentation = deck()
    const result = setSectionTitle(presentation, presentation.slides[1].id, titleDoc('Hei'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_A_SECTION_SLIDE')
  })
})

describe('the section colours', () => {
  const id = (presentation: Presentation): string => presentation.slides[0].id

  it('normalises what it stores and refuses what is not a colour', () => {
    const base = deck()
    expect(front(unwrap(setSectionAccentColor(base, id(base), '#ABC'))).accentColor).toBe('#aabbcc')
    expect(setSectionAccentColor(base, id(base), 'blå').ok).toBe(false)
    expect(
      front(unwrap(setSectionBackgroundColor(base, id(base), '#ABC'))).backgroundColor,
    ).toBe('#aabbcc')
    expect(setSectionBackgroundColor(base, id(base), 'blå').ok).toBe(false)
  })

  it('changes nothing in any other slide document', () => {
    const presentation = deck()
    const recoloured = unwrap(setSectionAccentColor(presentation, id(presentation), '#a64d79'))
    // Every heading that follows the section follows it at *render* time, so
    // recolouring is one field, not a sweep over the deck.
    expect(recoloured.slides.slice(1)).toEqual(presentation.slides.slice(1))
    expect(front(recoloured).title).toBe(front(presentation).title)
  })

  it('is a no-op when it is already that colour', () => {
    const presentation = deck()
    expect(unwrap(setSectionAccentColor(presentation, id(presentation), DEFAULT_PILL_COLOR))).toBe(
      presentation,
    )
  })

  it('reaches every page up to the next section, and no further', () => {
    let presentation = deck()
    presentation = unwrap(setSectionAccentColor(presentation, id(presentation), '#a64d79'))
    presentation = unwrap(setSectionBackgroundColor(presentation, id(presentation), '#101828'))
    presentation = unwrap(addSection(presentation, { title: 'Del to', ...checkers }))
    presentation = unwrap(
      setSectionAccentColor(presentation, presentation.slides[2].id, '#2f6f4f'),
    )
    presentation = unwrap(addSlide(presentation, {}))

    const colors = deckSectionColors(deckPages(presentation))
    const [firstSection, contentSlide, secondSection, afterSecond] = presentation.slides
    expect(colors.get(firstSection.id)).toEqual({ accent: '#a64d79', background: '#101828' })
    expect(colors.get(contentSlide.id)).toEqual({ accent: '#a64d79', background: '#101828' })
    expect(colors.get(secondSection.id)).toEqual({ accent: '#2f6f4f', background: '#101828' })
    expect(colors.get(afterSecond.id)).toEqual({ accent: '#2f6f4f', background: '#101828' })
  })
})

describe('adding a section', () => {
  it('inherits the previous section’s colours', () => {
    let presentation = deck()
    presentation = unwrap(setSectionAccentColor(presentation, presentation.slides[0].id, '#a64d79'))
    presentation = unwrap(
      setSectionBackgroundColor(presentation, presentation.slides[0].id, '#101828'),
    )
    presentation = unwrap(addSection(presentation, { title: 'Del to', ...checkers }))
    const added = sectionAt(presentation, presentation.slides.length - 1)
    expect(added.accentColor).toBe('#a64d79')
    expect(added.backgroundColor).toBe('#101828')
  })

  it('takes colours of its own when they are given', () => {
    const presentation = unwrap(
      addSection(deck(), {
        title: 'Del to',
        accentColor: '#2f6f4f',
        backgroundColor: '#fdf6e3',
        ...checkers,
      }),
    )
    const added = sectionAt(presentation, presentation.slides.length - 1)
    expect(added.accentColor).toBe('#2f6f4f')
    expect(added.backgroundColor).toBe('#fdf6e3')
  })

  it('lands where it is asked to, and keeps the deck opening with a section', () => {
    const presentation = unwrap(addSection(deck(), { index: 1, title: 'Del to', ...checkers }))
    expect(presentation.slides.map((slide) => slide.kind)).toEqual([
      'section',
      'section',
      'content',
    ])
  })

  it('refuses a heading too long for one line', () => {
    const result = addSection(deck(), { title: 'En altfor lang overskrift '.repeat(6), ...checkers })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(result.error.details).toMatchObject({ nodeId: SECTION_TITLE_NODE_ID })
  })

  it('refuses an out-of-range position', () => {
    const result = addSection(deck(), { index: 9, title: 'Del to' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('SLIDE_INDEX_OUT_OF_RANGE')
  })
})
