/**
 * Interactive slides through Agent Core.
 *
 * Everything goes through `runOperation`, for the reason `workflow.test.ts`
 * gives: that is where an agent enters, envelope and schema included. The
 * claims are that an agent's file meets the same door a person's does, that
 * a refusal writes nothing, that the source goes in and never comes back out
 * of a listing or an inspection, and that the slide is otherwise a slide the
 * ordinary operations move, duplicate and delete.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { MAX_INTERACTIVE_HTML_BYTES } from '../domain/constants'
import { htmlOfBytes, interactiveAt } from '../domain/testDecks'
import type { InteractiveSlideView } from './operations/interactive'
import type { InteractiveSlideInspection, PresentationView, SlideSummary } from './operations/deck'
import { findOperation } from './registry'
import {
  agentOperation,
  agentRefusal,
  closeTestDatabases,
  newAgentDeck,
  storedPresentation,
  testAgentContext,
  type NewDeck,
} from './testDeck'
import type { AgentContext } from './types'

afterEach(closeTestDatabases)

const APP =
  '<!doctype html><html><head><style>body{font:16px sans-serif}</style></head><body><p>Blåbær 🙂</p><script>let n = 0</script></body></html>'
const OTHER = '<!doctype html><html><body><p>Quiz</p></body></html>'

async function deckWithApp(
  context: AgentContext,
): Promise<{ deck: NewDeck; view: InteractiveSlideView }> {
  const deck = await newAgentDeck(context)
  const view = await agentOperation<InteractiveSlideView>(context, 'add_interactive_slide', {
    presentationId: deck.presentationId,
    fileName: 'teller.html',
    html: APP,
  })
  return { deck, view }
}

describe('add_interactive_slide', () => {
  it('legger sliden sist, navngitt etter filen, og svarer uten kilden', async () => {
    const context = testAgentContext()
    const { deck, view } = await deckWithApp(context)

    expect(view).toMatchObject({
      presentationId: deck.presentationId,
      index: 2,
      slideCount: 3,
      kind: 'interactive',
      name: 'teller',
      fileName: 'teller.html',
      htmlByteSize: new TextEncoder().encode(APP).byteLength,
    })
    expect(JSON.stringify(view)).not.toContain('<script>')

    const stored = await storedPresentation(context, deck.presentationId)
    expect(interactiveAt(stored, 2)).toMatchObject({ id: view.slideId, html: APP })
  })

  it('tar en posisjon og et navn, og aldri forsidens plass', async () => {
    const context = testAgentContext()
    const deck = await newAgentDeck(context)
    const view = await agentOperation<InteractiveSlideView>(context, 'add_interactive_slide', {
      presentationId: deck.presentationId,
      index: 1,
      name: '  Quiz ',
      fileName: 'quiz.html',
      html: APP,
    })
    expect(view).toMatchObject({ index: 1, name: 'Quiz' })

    const refused = await agentRefusal(context, 'add_interactive_slide', {
      presentationId: deck.presentationId,
      index: 0,
      fileName: 'quiz.html',
      html: APP,
    })
    expect(refused.code).toBe('FIRST_SLIDE_MUST_BE_SECTION')
  })

  it('avviser en fil som ikke kan brukes, med kode, og skriver ingenting', async () => {
    const context = testAgentContext()
    const deck = await newAgentDeck(context)
    const before = await storedPresentation(context, deck.presentationId)

    const wrongName = await agentRefusal(context, 'add_interactive_slide', {
      presentationId: deck.presentationId,
      fileName: 'bilde.png',
      html: APP,
    })
    expect(wrongName.code).toBe('INVALID_INTERACTIVE_FILE')

    const noElements = await agentRefusal(context, 'add_interactive_slide', {
      presentationId: deck.presentationId,
      fileName: 'notat.html',
      html: 'bare tekst',
    })
    expect(noElements.code).toBe('INVALID_INTERACTIVE_FILE')

    // Over the limit is refused by the transport's schema before the command
    // is reached, as `INVALID_INPUT` naming the field.
    const oversized = await agentRefusal(context, 'add_interactive_slide', {
      presentationId: deck.presentationId,
      fileName: 'stor.html',
      html: htmlOfBytes(MAX_INTERACTIVE_HTML_BYTES + 1),
    })
    expect(oversized.code).toBe('INVALID_INPUT')
    expect(JSON.stringify(oversized.details)).toContain('"path":"html"')

    const after = await storedPresentation(context, deck.presentationId)
    expect(after.slides).toHaveLength(before.slides.length)
    expect(after.updatedAt).toBe(before.updatedAt)
  })

  it('skriver mot en revisjon, som enhver annen skriving', async () => {
    const context = testAgentContext()
    const deck = await newAgentDeck(context)
    const stale = await agentRefusal(context, 'add_interactive_slide', {
      presentationId: deck.presentationId,
      expectedRevision: 'ikke-denne',
      fileName: 'teller.html',
      html: APP,
    })
    expect(stale.code).toBe('CONFLICT')
  })
})

describe('å lese en interaktiv slide', () => {
  it('listes med navn, filnavn og størrelse, og aldri med kilden', async () => {
    const context = testAgentContext()
    const { deck, view } = await deckWithApp(context)
    const presentation = await agentOperation<PresentationView>(context, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    const summary = presentation.slides.find((slide) => slide.slideId === view.slideId)
    expect(summary).toEqual({
      slideId: view.slideId,
      index: 2,
      kind: 'interactive',
      name: 'teller',
      fileName: 'teller.html',
      htmlByteSize: view.htmlByteSize,
    })
    expect(presentation.slideCount).toBe(3)
    expect(JSON.stringify(presentation)).not.toContain('<script>')
    expect(JSON.stringify(presentation)).not.toContain('Blåbær')
  })

  it('inspiseres som sitt sammendrag pluss revisjonen, uten soner og uten kilde', async () => {
    const context = testAgentContext()
    const { deck, view } = await deckWithApp(context)
    const inspected = await agentOperation<InteractiveSlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: view.slideId,
    })
    expect(inspected).toMatchObject({
      presentationId: deck.presentationId,
      slideId: view.slideId,
      kind: 'interactive',
      name: 'teller',
      fileName: 'teller.html',
      htmlByteSize: view.htmlByteSize,
    })
    expect(typeof inspected.revision).toBe('string')
    expect('zones' in inspected).toBe(false)
    expect('html' in inspected).toBe(false)
    expect(JSON.stringify(inspected)).not.toContain('<script>')
  })
})

describe('set_interactive_slide', () => {
  it('bytter navn alene', async () => {
    const context = testAgentContext()
    const { deck, view } = await deckWithApp(context)
    const renamed = await agentOperation<InteractiveSlideView>(context, 'set_interactive_slide', {
      presentationId: deck.presentationId,
      slideId: view.slideId,
      name: 'Teller for salen',
    })
    expect(renamed).toMatchObject({
      slideId: view.slideId,
      name: 'Teller for salen',
      fileName: 'teller.html',
      htmlByteSize: view.htmlByteSize,
    })
    const stored = await storedPresentation(context, deck.presentationId)
    expect(interactiveAt(stored, 2).html).toBe(APP)
  })

  it('bytter fil og filnavn sammen, og beholder id og plass', async () => {
    const context = testAgentContext()
    const { deck, view } = await deckWithApp(context)
    const replaced = await agentOperation<InteractiveSlideView>(context, 'set_interactive_slide', {
      presentationId: deck.presentationId,
      slideId: view.slideId,
      fileName: 'quiz.html',
      html: OTHER,
    })
    expect(replaced).toMatchObject({
      slideId: view.slideId,
      index: 2,
      name: 'teller',
      fileName: 'quiz.html',
      htmlByteSize: new TextEncoder().encode(OTHER).byteLength,
    })
    const stored = await storedPresentation(context, deck.presentationId)
    expect(interactiveAt(stored, 2)).toMatchObject({ id: view.slideId, html: OTHER })
  })

  it('gjør begge deler i én skriving, og ingen av dem når filen avvises', async () => {
    const context = testAgentContext()
    const { deck, view } = await deckWithApp(context)
    const both = await agentOperation<InteractiveSlideView>(context, 'set_interactive_slide', {
      presentationId: deck.presentationId,
      slideId: view.slideId,
      name: 'Quiz',
      fileName: 'quiz.html',
      html: OTHER,
    })
    expect(both).toMatchObject({ name: 'Quiz', fileName: 'quiz.html' })

    const refused = await agentRefusal(context, 'set_interactive_slide', {
      presentationId: deck.presentationId,
      slideId: view.slideId,
      name: 'Skulle ikke lagres',
      fileName: 'quiz.html',
      html: 'ingen elementer',
    })
    expect(refused.code).toBe('INVALID_INTERACTIVE_FILE')
    const stored = await storedPresentation(context, deck.presentationId)
    expect(interactiveAt(stored, 2)).toMatchObject({ name: 'Quiz', fileName: 'quiz.html', html: OTHER })
  })

  it('krever at fil og filnavn kommer sammen, og at noe faktisk endres', async () => {
    const context = testAgentContext()
    const { deck, view } = await deckWithApp(context)
    for (const input of [
      { fileName: 'quiz.html' },
      { html: OTHER },
      {},
    ]) {
      const refused = await agentRefusal(context, 'set_interactive_slide', {
        presentationId: deck.presentationId,
        slideId: view.slideId,
        ...input,
      })
      expect(refused.code).toBe('INVALID_INPUT')
    }
  })

  it('avviser en slide som ikke er interaktiv, med sin egen kode', async () => {
    const context = testAgentContext()
    const { deck } = await deckWithApp(context)
    const refused = await agentRefusal(context, 'set_interactive_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      name: 'Nei',
    })
    expect(refused.code).toBe('NOT_AN_INTERACTIVE_SLIDE')
  })
})

describe('de vanlige slide-operasjonene', () => {
  it('dupliserer, flytter og sletter en interaktiv slide som enhver annen', async () => {
    const context = testAgentContext()
    const { deck, view } = await deckWithApp(context)

    await agentOperation(context, 'duplicate_slide', {
      presentationId: deck.presentationId,
      slideId: view.slideId,
    })
    let stored = await storedPresentation(context, deck.presentationId)
    expect(stored.slides.map((slide) => slide.kind)).toEqual(['section', 'content', 'interactive', 'interactive'])
    expect(interactiveAt(stored, 3)).toMatchObject({ name: 'teller', fileName: 'teller.html', html: APP })
    expect(interactiveAt(stored, 3).id).not.toBe(view.slideId)

    await agentOperation(context, 'move_slide', {
      presentationId: deck.presentationId,
      slideId: view.slideId,
      toIndex: 1,
    })
    stored = await storedPresentation(context, deck.presentationId)
    expect(stored.slides.map((slide) => slide.kind)).toEqual(['section', 'interactive', 'content', 'interactive'])

    await agentOperation(context, 'delete_slide', {
      presentationId: deck.presentationId,
      slideId: view.slideId,
    })
    stored = await storedPresentation(context, deck.presentationId)
    expect(stored.slides.map((slide) => slide.kind)).toEqual(['section', 'content', 'interactive'])
  })

  it('lar soneoperasjoner avvise sliden som en uten soner', async () => {
    const context = testAgentContext()
    const { deck, view } = await deckWithApp(context)
    const refused = await agentRefusal(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId: view.slideId,
      spans: [{ text: 'Tittel' }],
    })
    expect(refused.code).toBe('NOT_A_CONTENT_SLIDE')
  })

  it('får ikke sitte i listen med en kilde som feilaktig ser ut som tekst', async () => {
    const context = testAgentContext()
    const { deck } = await deckWithApp(context)
    const presentation = await agentOperation<PresentationView>(context, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    const kinds = presentation.slides.map((slide: SlideSummary) => slide.kind)
    expect(kinds).toEqual(['section', 'content', 'interactive'])
  })
})

describe('katalogen', () => {
  it('fører begge operasjonene som skrivinger under presentations:write', () => {
    for (const name of ['add_interactive_slide', 'set_interactive_slide']) {
      const operation = findOperation(name)
      expect({ name, mutates: operation?.mutates, scopes: [...(operation?.scopes ?? [])] }).toEqual({
        name,
        mutates: true,
        scopes: ['presentations:write'],
      })
    }
  })
})
