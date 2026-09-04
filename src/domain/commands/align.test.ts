/**
 * Vertical alignment is a property of the field, not of the text in it.
 *
 * It goes through a command so a headless caller has the same vocabulary as
 * the toolbar, and because the value has to survive validation and reload like
 * every other part of the document.
 */

import { describe, expect, it } from 'vitest'
import { createPresentation } from '../presentation'
import { containerWithDoc, createUntitledCard } from '../content'
import { emptyDoc } from '../richdoc'
import { validatePresentation } from '../schema'
import type { Presentation, ZoneContent } from '../types'
import { setVerticalAlign, setZoneContent } from './index'

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`)
  }
  return result.value
}

function deckWith(content: ZoneContent): Presentation {
  const presentation = createPresentation({ title: 'Justering', firstSlideHasTitle: false })
  const slide = presentation.slides[0]
  return unwrap(setZoneContent(presentation, { slideId: slide.id, nodeId: slide.root.id, content }))
    .presentation
}

describe('setVerticalAlign', () => {
  it('aligns one subfield without touching the others', () => {
    const card = createUntitledCard()
    const body = {
      ...card.body,
      weights: [1, 1],
      subfields: [
        { id: 'a', doc: emptyDoc() },
        { id: 'b', doc: emptyDoc() },
      ],
    }
    const presentation = deckWith({ ...card, body })
    const slide = presentation.slides[0]

    const aligned = unwrap(
      setVerticalAlign(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        subfieldId: 'b',
        align: 'bottom',
      }),
    )
    const content = aligned.slides[0].root.kind === 'leaf' ? aligned.slides[0].root.content : null
    if (!content || content.kind !== 'untitled-card') throw new Error('expected a card')
    expect(content.body.subfields.map((field) => field.verticalAlign)).toEqual([undefined, 'bottom'])
    expect(validatePresentation(aligned).ok).toBe(true)
  })

  it('aligns a container through its own field', () => {
    const container = containerWithDoc(emptyDoc())
    const presentation = deckWith(container)
    const slide = presentation.slides[0]
    const aligned = unwrap(
      setVerticalAlign(presentation, {
        slideId: slide.id,
        nodeId: slide.root.id,
        subfieldId: container.body.subfields[0].id,
        align: 'middle',
      }),
    )
    const content = aligned.slides[0].root.kind === 'leaf' ? aligned.slides[0].root.content : null
    expect(content?.kind === 'container' && content.body.subfields[0].verticalAlign).toBe('middle')
  })

  it('refuses a subfield that does not exist', () => {
    const presentation = deckWith(createUntitledCard())
    const slide = presentation.slides[0]
    const result = setVerticalAlign(presentation, {
      slideId: slide.id,
      nodeId: slide.root.id,
      subfieldId: 'nope',
      align: 'middle',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('SUBFIELD_NOT_FOUND')
  })
})
