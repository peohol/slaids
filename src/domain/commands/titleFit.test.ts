/**
 * Regression tests for restoring a slide title.
 *
 * Removing the title zone and putting it back is one user gesture with two
 * halves — the zone and the text — and the halves are validated against
 * different things: the zone has to leave the main area big enough, the text
 * has to fit the zone under whatever typography is in force *now*. Done as two
 * commands, the second one escaped validation entirely and a failure in the
 * middle left a bare title zone behind.
 */

import { describe, expect, it } from 'vitest'
import { createPresentation } from '../presentation'
import { estimateFitChecker, estimateTitleFitChecker } from '../fit'
import { FONT_OPTIONS } from '../fonts'
import { docToPlainText, titleDoc } from '../richdoc'
import type { Presentation, TitleDoc } from '../types'
import { addSlide, setSlideHasTitle, setTheme } from './index'

const checkers = { fits: estimateFitChecker, fitsTitle: estimateTitleFitChecker }

const stack = (id: string): string => {
  const font = FONT_OPTIONS.find((option) => option.id === id)
  if (!font) throw new Error(`unknown font ${id}`)
  return font.stack
}

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`)
  }
  return result.value
}

/** Long enough to fit the default font but not Verdana, which is 16% wider. */
const BORDERLINE_TITLE = 'Overskrift som akkurat får plass i sonen sin i dag'.padEnd(62, ' x')

function deckWithTitle(text: string): Presentation {
  const presentation = createPresentation({ title: 'Titler', firstSlideHasTitle: true })
  const slide = presentation.slides[0]
  return {
    ...presentation,
    slides: [{ ...slide, title: titleDoc(text) }],
  }
}

function titleOf(presentation: Presentation): TitleDoc | null {
  return presentation.slides[0].title
}

describe('restoring a removed title', () => {
  const removed = (text: string): { deck: Presentation; title: TitleDoc } => {
    const before = deckWithTitle(text)
    const title = titleOf(before)
    if (!title) throw new Error('expected a title')
    const deck = unwrap(
      setSlideHasTitle(before, before.slides[0].id, false, { force: true, ...checkers }),
    )
    expect(titleOf(deck)).toBeNull()
    return { deck, title }
  }

  it('puts the zone and the remembered text back in one command', () => {
    const { deck, title } = removed('Kort overskrift')
    const restored = unwrap(
      setSlideHasTitle(deck, deck.slides[0].id, true, { ...checkers, title }),
    )
    expect(docToPlainText(titleOf(restored))).toBe('Kort overskrift')
  })

  it('refuses a remembered title that no longer fits under the current font', () => {
    const { deck, title } = removed(BORDERLINE_TITLE)
    // Precondition: this title is fine as things stand, so a refusal below can
    // only come from the font change.
    expect(setSlideHasTitle(deck, deck.slides[0].id, true, { ...checkers, title }).ok).toBe(true)
    // The font changed while the title was gone — the zone was empty, so
    // nothing objected at the time.
    const widened = unwrap(
      setTheme(deck, { headingFontFamily: stack('verdana') }, checkers),
    )
    const restored = setSlideHasTitle(widened, widened.slides[0].id, true, { ...checkers, title })
    expect(restored.ok).toBe(false)
    if (!restored.ok) expect(restored.error.code).toBe('CONTENT_DOES_NOT_FIT')
  })

  it('leaves the slide exactly as it was when the restore is refused', () => {
    const { deck, title } = removed(BORDERLINE_TITLE)
    const widened = unwrap(setTheme(deck, { headingFontFamily: stack('verdana') }, checkers))
    const restored = setSlideHasTitle(widened, widened.slides[0].id, true, { ...checkers, title })
    expect(restored.ok).toBe(false)
    // No half-applied state: not even an empty title zone is left behind.
    expect(titleOf(widened)).toBeNull()
  })

  it('accepts the same title once the font is narrow again', () => {
    const { deck, title } = removed(BORDERLINE_TITLE)
    const widened = unwrap(setTheme(deck, { headingFontFamily: stack('verdana') }, checkers))
    expect(setSlideHasTitle(widened, widened.slides[0].id, true, { ...checkers, title }).ok).toBe(
      false,
    )
    const narrowed = unwrap(setTheme(widened, { headingFontFamily: stack('times') }, checkers))
    const restored = unwrap(
      setSlideHasTitle(narrowed, narrowed.slides[0].id, true, { ...checkers, title }),
    )
    expect(docToPlainText(titleOf(restored)).trim()).toBe(BORDERLINE_TITLE.trim())
  })

  it('refuses text on a title that is being removed', () => {
    const deck = deckWithTitle('Overskrift')
    const result = setSlideHasTitle(deck, deck.slides[0].id, false, {
      force: true,
      title: titleDoc('noe annet'),
      ...checkers,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('INVALID_ARGUMENT')
  })
})

describe('addSlide with a title', () => {
  it('validates a title supplied by a headless caller', () => {
    const presentation = createPresentation({ title: 'Nye slides' })
    const tooLong = addSlide(presentation, {
      hasTitle: true,
      title: 'x'.repeat(200),
      ...checkers,
    })
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) expect(tooLong.error.code).toBe('CONTENT_DOES_NOT_FIT')
  })

  it('accepts a title that fits', () => {
    const presentation = createPresentation({ title: 'Nye slides' })
    const created = unwrap(
      addSlide(presentation, { hasTitle: true, title: 'En helt vanlig overskrift', ...checkers }),
    )
    expect(docToPlainText(created.slides[created.slides.length - 1].title)).toBe(
      'En helt vanlig overskrift',
    )
  })
})
