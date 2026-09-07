/**
 * Interactive slide commands.
 *
 * The rule under test is that an interactive slide is a slide — moved,
 * duplicated and deleted by the ordinary commands, kept behind the front
 * section like every other — with exactly three things of its own: a file it
 * is created from, a name, and a file it can be replaced with. Every refusal
 * must leave the presentation as the same object, so that a replacement that
 * fails keeps the app that was there.
 */

import { describe, expect, it } from 'vitest'
import { MAX_INTERACTIVE_HTML_BYTES, MAX_INTERACTIVE_HTML_TOTAL_BYTES } from '../constants'
import { interactiveHtmlBytesIn } from '../interactive'
import { createPresentation } from '../presentation'
import { titleDoc } from '../richdoc'
import { htmlOfBytes, interactiveAt } from '../testDecks'
import type { Presentation } from '../types'
import {
  addInteractiveSlide,
  deleteSlide,
  duplicateSlide,
  moveSlide,
  setInteractiveSlideHtml,
  setInteractiveSlideName,
  setSlideTitle,
  splitLeaf,
} from './index'
import { interactiveSlide } from './interactive'

const APP = '<!doctype html><html><body><p>Teller</p><script>let n = 0</script></body></html>'
const OTHER = '<!doctype html><html><body><p>Quiz</p></body></html>'

function base(): Presentation {
  return createPresentation({ title: 'Interaktiv' })
}

function unwrap(result: { ok: true; value: Presentation } | { ok: false; error: { code: string; message: string } }): Presentation {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

function refused(result: { ok: boolean; error?: { code: string } }): string {
  if (result.ok || !result.error) throw new Error('Forventet en avvisning.')
  return result.error.code
}

/**
 * A deck holding exactly the budget's worth of miniapp source, built from
 * files that each stay within the per-slide limit — however the two limits
 * relate. There is no room for one more byte afterwards.
 */
function filledToBudget(leadingBytes = 0): Presentation {
  let presentation = base()
  const room = () => MAX_INTERACTIVE_HTML_TOTAL_BYTES - interactiveHtmlBytesIn(presentation)
  if (leadingBytes > 0) {
    presentation = unwrap(
      addInteractiveSlide(presentation, { fileName: 'liten.html', html: htmlOfBytes(leadingBytes) }),
    )
  }
  while (room() >= MAX_INTERACTIVE_HTML_BYTES) {
    presentation = unwrap(
      addInteractiveSlide(presentation, {
        fileName: `fyll-${presentation.slides.length}.html`,
        html: htmlOfBytes(MAX_INTERACTIVE_HTML_BYTES),
      }),
    )
  }
  if (room() > 0) {
    presentation = unwrap(
      addInteractiveSlide(presentation, { fileName: 'rest.html', html: htmlOfBytes(room()) }),
    )
  }
  expect(room()).toBe(0)
  return presentation
}

/** A deck with one interactive slide at the end, and the slide's id. */
function withApp(presentation = base()): { presentation: Presentation; slideId: string } {
  const added = unwrap(
    addInteractiveSlide(presentation, { fileName: 'teller.html', html: APP }),
  )
  return { presentation: added, slideId: interactiveAt(added, added.slides.length - 1).id }
}

describe('addInteractiveSlide', () => {
  it('legger sliden sist når ingen posisjon er oppgitt, med navnet fra filen', () => {
    const before = base()
    const after = unwrap(addInteractiveSlide(before, { fileName: 'Quiz om budsjettet.html', html: APP }))
    expect(after.slides).toHaveLength(before.slides.length + 1)
    const slide = interactiveAt(after, after.slides.length - 1)
    expect(slide).toMatchObject({
      kind: 'interactive',
      name: 'Quiz om budsjettet',
      fileName: 'Quiz om budsjettet.html',
      html: APP,
    })
    expect(slide.id).toBeTruthy()
    expect(after.updatedAt >= before.updatedAt).toBe(true)
  })

  it('setter inn på en oppgitt posisjon, bak forsiden', () => {
    const after = unwrap(
      addInteractiveSlide(base(), { index: 1, name: 'Teller', fileName: 'teller.html', html: APP }),
    )
    expect(after.slides.map((slide) => slide.kind)).toEqual(['section', 'interactive', 'content'])
    expect(interactiveAt(after, 1).name).toBe('Teller')
  })

  it('kan ikke bli dekkets første slide: forsiden er en seksjon', () => {
    const before = base()
    expect(refused(addInteractiveSlide(before, { index: 0, fileName: 'a.html', html: APP }))).toBe(
      'FIRST_SLIDE_MUST_BE_SECTION',
    )
  })

  it('avviser en posisjon utenfor dekket', () => {
    const before = base()
    expect(
      refused(addInteractiveSlide(before, { index: before.slides.length + 1, fileName: 'a.html', html: APP })),
    ).toBe('SLIDE_INDEX_OUT_OF_RANGE')
    expect(refused(addInteractiveSlide(before, { index: -1, fileName: 'a.html', html: APP }))).toBe(
      'SLIDE_INDEX_OUT_OF_RANGE',
    )
  })

  it('oppretter ingenting når filen avvises', () => {
    const before = base()
    for (const input of [
      { fileName: 'bilde.png', html: APP },
      { fileName: 'tom.html', html: '   ' },
      { fileName: 'tekst.html', html: 'ingen elementer her' },
      { fileName: 'stor.html', html: htmlOfBytes(MAX_INTERACTIVE_HTML_BYTES + 1) },
    ]) {
      const result = addInteractiveSlide(before, input)
      expect(result.ok).toBe(false)
    }
    // Not merely unchanged: the very same object, so nothing downstream can
    // mistake a refusal for an edit.
    expect(before.slides).toHaveLength(2)
  })

  it('avviser et tomt navn uten å opprette sliden', () => {
    expect(refused(addInteractiveSlide(base(), { name: '   ', fileName: 'a.html', html: APP }))).toBe(
      'INVALID_ARGUMENT',
    )
  })

  it('trimmer navnet og filnavnet', () => {
    const after = unwrap(
      addInteractiveSlide(base(), { name: '  Quiz ', fileName: ' quiz.html ', html: APP }),
    )
    expect(interactiveAt(after, 2)).toMatchObject({ name: 'Quiz', fileName: 'quiz.html' })
  })

  it('holder dekket innenfor budsjettet for miniapp-kilde', () => {
    const presentation = filledToBudget()
    const slideCount = presentation.slides.length
    // One more byte anywhere: refused, and nothing added.
    const result = addInteractiveSlide(presentation, { fileName: 'over.html', html: '<p>x</p>' })
    expect(refused(result)).toBe('INTERACTIVE_BUDGET_EXCEEDED')
    expect(presentation.slides).toHaveLength(slideCount)
  })

  it('endrer ikke dokumentet det fikk', () => {
    const before = base()
    const snapshot = JSON.stringify(before)
    unwrap(addInteractiveSlide(before, { fileName: 'a.html', html: APP }))
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('interactiveSlide', () => {
  it('skiller mellom en slide som ikke finnes og en som ikke er interaktiv', () => {
    const { presentation, slideId } = withApp()
    expect(interactiveSlide(presentation, slideId).ok).toBe(true)
    expect(refused(interactiveSlide(presentation, presentation.slides[1].id))).toBe(
      'NOT_AN_INTERACTIVE_SLIDE',
    )
    expect(refused(interactiveSlide(presentation, 'finnes-ikke'))).toBe('SLIDE_NOT_FOUND')
  })
})

describe('setInteractiveSlideName', () => {
  it('bytter navnet og ingenting annet', () => {
    const { presentation, slideId } = withApp()
    const after = unwrap(setInteractiveSlideName(presentation, slideId, '  Nytt navn '))
    const slide = interactiveAt(after, 2)
    expect(slide.name).toBe('Nytt navn')
    expect(slide.fileName).toBe('teller.html')
    expect(slide.html).toBe(APP)
    expect(slide.id).toBe(slideId)
  })

  it('er samme objekt når navnet ikke endres', () => {
    const { presentation, slideId } = withApp()
    expect(unwrap(setInteractiveSlideName(presentation, slideId, 'teller'))).toBe(presentation)
  })

  it('avviser et tomt navn og en slide av feil slag', () => {
    const { presentation, slideId } = withApp()
    expect(refused(setInteractiveSlideName(presentation, slideId, ' '))).toBe('INVALID_ARGUMENT')
    expect(refused(setInteractiveSlideName(presentation, presentation.slides[0].id, 'x'))).toBe(
      'NOT_AN_INTERACTIVE_SLIDE',
    )
  })
})

describe('setInteractiveSlideHtml', () => {
  it('bytter fil og filnavn sammen, og beholder id, plass og navn', () => {
    const { presentation, slideId } = withApp()
    const after = unwrap(
      setInteractiveSlideHtml(presentation, slideId, { fileName: 'quiz.html', html: OTHER }),
    )
    const slide = interactiveAt(after, 2)
    expect(slide).toMatchObject({ id: slideId, name: 'teller', fileName: 'quiz.html', html: OTHER })
    expect(after.slides.map((entry) => entry.id)).toEqual(presentation.slides.map((entry) => entry.id))
  })

  it('beholder appen som ligger der når den nye filen avvises', () => {
    const { presentation, slideId } = withApp()
    for (const input of [
      { fileName: 'quiz.txt', html: OTHER },
      { fileName: 'quiz.html', html: '' },
      { fileName: 'quiz.html', html: 'bare tekst' },
      { fileName: 'quiz.html', html: htmlOfBytes(MAX_INTERACTIVE_HTML_BYTES + 1) },
    ]) {
      const result = setInteractiveSlideHtml(presentation, slideId, input)
      expect(result.ok).toBe(false)
    }
    expect(interactiveAt(presentation, 2).html).toBe(APP)
  })

  it('er samme objekt når filen er den samme', () => {
    const { presentation, slideId } = withApp()
    expect(
      unwrap(setInteractiveSlideHtml(presentation, slideId, { fileName: 'teller.html', html: APP })),
    ).toBe(presentation)
  })

  it('måler budsjettet uten sliden som byttes ut', () => {
    // A deck with no room left, one of whose slides is small: replacing that
    // slide with a file of the same size must still be allowed, since the old
    // source leaves as the new one arrives — and one byte more is one byte
    // over the budget, well within what a single file may be.
    const small = 64
    const presentation = filledToBudget(small)
    const slide = interactiveAt(presentation, 2)
    expect(interactiveHtmlBytesIn(presentation, { excludingSlideId: slide.id })).toBe(
      MAX_INTERACTIVE_HTML_TOTAL_BYTES - small,
    )

    expect(
      setInteractiveSlideHtml(presentation, slide.id, { fileName: 'c.html', html: htmlOfBytes(small) }).ok,
    ).toBe(true)
    expect(
      refused(
        setInteractiveSlideHtml(presentation, slide.id, { fileName: 'c.html', html: htmlOfBytes(small + 1) }),
      ),
    ).toBe('INTERACTIVE_BUDGET_EXCEEDED')
  })

  it('avviser en slide av feil slag', () => {
    const { presentation } = withApp()
    expect(
      refused(setInteractiveSlideHtml(presentation, presentation.slides[1].id, { fileName: 'a.html', html: APP })),
    ).toBe('NOT_AN_INTERACTIVE_SLIDE')
  })
})

describe('de vanlige slide-kommandoene', () => {
  it('dupliserer med ny id og samme innhold, rett etter originalen', () => {
    const { presentation, slideId } = withApp()
    const after = unwrap(duplicateSlide(presentation, slideId))
    expect(after.slides).toHaveLength(4)
    const original = interactiveAt(after, 2)
    const copy = interactiveAt(after, 3)
    expect(copy.id).not.toBe(original.id)
    expect(copy).toMatchObject({ name: original.name, fileName: original.fileName, html: original.html })
  })

  it('flytter en interaktiv slide som enhver annen, men aldri foran forsiden', () => {
    const { presentation, slideId } = withApp()
    const moved = unwrap(moveSlide(presentation, slideId, 1))
    expect(moved.slides.map((slide) => slide.kind)).toEqual(['section', 'interactive', 'content'])
    expect(refused(moveSlide(presentation, slideId, 0))).toBe('FIRST_SLIDE_MUST_BE_SECTION')
  })

  it('sletter en interaktiv slide og lar resten stå', () => {
    const { presentation, slideId } = withApp()
    const after = unwrap(deleteSlide(presentation, slideId))
    expect(after.slides.map((slide) => slide.kind)).toEqual(['section', 'content'])
  })

  it('lar sone- og tittelkommandoer avvise en slide uten soner', () => {
    const { presentation, slideId } = withApp()
    expect(refused(setSlideTitle(presentation, slideId, titleDoc('Tittel')))).toBe(
      'NOT_A_CONTENT_SLIDE',
    )
    expect(
      refused(splitLeaf(presentation, { slideId, nodeId: 'ingen-sone', axis: 'x', weights: [1, 1] })),
    ).toBe('NOT_A_CONTENT_SLIDE')
  })
})
