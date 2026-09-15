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
import {
  MAX_INTERACTIVE_HTML_BYTES,
  MAX_INTERACTIVE_HTML_TOTAL_BYTES,
} from '../domain/constants'
import {
  INTERACTIVE_LAYOUT_RULES,
  INTERACTIVE_RESTRICTIONS,
  INTERACTIVE_STARTER_SKELETON,
  interactiveThemeTokens,
} from '../domain/interactiveStyle'
import { defaultTheme } from '../domain/presentation'
import { encodeBase64 } from './binary'
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
      // Which design contract the app was written against: what it inherits.
      styleContract: 1,
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

describe('get_interactive_contract', () => {
  it('sier hva en miniapp skrives mot, som data', async () => {
    const context = testAgentContext()
    const contract = await agentOperation<{
      styleContract: number
      supportedStyleContracts: number[]
      canvas: { width: number; height: number }
      limits: { htmlByteSize: number; deckHtmlByteSize: number; fileExtension: string }
      variables: string[]
      layout: string[]
      starter: string
      restrictions: string[]
      documentation: string
    }>(context, 'get_interactive_contract', {})

    expect(contract.styleContract).toBe(1)
    expect(contract.supportedStyleContracts).toContain(contract.styleContract)
    // The frame is the slide, so the app's viewport is the design space.
    expect(contract.canvas).toEqual({ width: 1600, height: 900 })
    expect(contract.limits).toEqual({
      htmlByteSize: MAX_INTERACTIVE_HTML_BYTES,
      deckHtmlByteSize: MAX_INTERACTIVE_HTML_TOTAL_BYTES,
      fileExtension: '.html',
    })
    expect(contract.documentation).toBe('docs/INTERACTIVE_MINIAPPS.md')
  })

  it('navngir nøyaktig de variablene Slaids faktisk setter', async () => {
    const context = testAgentContext()
    const contract = await agentOperation<{ variables: string[] }>(
      context,
      'get_interactive_contract',
      {},
    )

    // Read off the tokens rather than listed beside them: an agent that writes
    // `var(--slaids-accent)` must be writing a name Slaids sets, or its CSS
    // silently does nothing.
    const set = Object.keys(
      interactiveThemeTokens({
        theme: defaultTheme(),
        colors: { accent: '#bfccd9', background: '#101828' },
      }),
    )
    expect(contract.variables).toEqual(set)
    for (const required of ['--slaids-heading-font', '--slaids-body-font', '--slaids-accent']) {
      expect(contract.variables).toContain(required)
    }
  })

  it('sier hva sandkassen nekter, så en agent slipper å oppdage det ved å prøve', async () => {
    const context = testAgentContext()
    const contract = await agentOperation<{ restrictions: string[] }>(
      context,
      'get_interactive_contract',
      {},
    )
    expect(contract.restrictions).toEqual([...INTERACTIVE_RESTRICTIONS])
  })

  it('gir strukturreglene direkte, ikke som en henvisning til et dokument', async () => {
    // The point of this field: an agent on the other side of MCP has no
    // checkout to read. Colours it would get right anyway from the variables;
    // the height chain, the single scroll owner and the spacing ownership are
    // the half that silently goes wrong, so they are handed over as text.
    const context = testAgentContext()
    const contract = await agentOperation<{ layout: string[]; starter: string }>(
      context,
      'get_interactive_contract',
      {},
    )

    expect(contract.layout).toEqual([...INTERACTIVE_LAYOUT_RULES])
    const stated = contract.layout.join('\n')
    for (const required of [
      '#miniapp',
      'box-sizing: border-box',
      'min-height: 0',
      'overflow-y: auto',
      'overflow-x',
      '--slaids-gap',
      '--slaids-padding',
      '--slaids-block-spacing',
    ]) {
      expect(stated).toContain(required)
    }

    // And the same rules as a file to start from, rather than only as prose.
    expect(contract.starter).toBe(INTERACTIVE_STARTER_SKELETON)
    expect(contract.starter).toContain('id="miniapp"')
    expect(contract.starter).toContain('overflow-y: auto')
  })
})

describe('filen over ledningen', () => {
  /*
   * The shapes an agent can send a file in, and the promise that they all mean
   * the same thing. The raw-bytes shape a REST upload produces is exercised
   * against the real transport in `server/agent/handler.test.ts`, where the
   * bytes come off an actual request rather than out of a test realm.
   */
  it('kan sendes som fil i stedet for som JSON-streng, gjennom den samme døren', async () => {
    const context = testAgentContext()
    const deck = await newAgentDeck(context)

    const view = await agentOperation<InteractiveSlideView>(context, 'add_interactive_slide', {
      presentationId: deck.presentationId,
      fileName: 'teller.html',
      content: { encoding: 'text', data: APP },
    })

    expect(view.htmlByteSize).toBe(new TextEncoder().encode(APP).byteLength)
    const stored = await storedPresentation(context, deck.presentationId)
    // Byte for byte: nothing about the file changed on the way in.
    expect(interactiveAt(stored, 2).html).toBe(APP)
  })

  it('tar den samme filen som base64, som er alt en MCP-klient kan sende', async () => {
    const context = testAgentContext()
    const deck = await newAgentDeck(context)

    const view = await agentOperation<InteractiveSlideView>(context, 'add_interactive_slide', {
      presentationId: deck.presentationId,
      fileName: 'teller.html',
      content: { encoding: 'base64', data: encodeBase64(new TextEncoder().encode(APP)) },
    })
    expect(view.htmlByteSize).toBe(new TextEncoder().encode(APP).byteLength)
    expect(interactiveAt(await storedPresentation(context, deck.presentationId), 2).html).toBe(APP)
  })

  it('avviser en fil som er sendt to ganger, i to former', async () => {
    const context = testAgentContext()
    const deck = await newAgentDeck(context)
    const refused = await agentRefusal(context, 'add_interactive_slide', {
      presentationId: deck.presentationId,
      fileName: 'teller.html',
      html: APP,
      content: { encoding: 'text', data: OTHER },
    })
    // Two files in one call is a call that said two different things; picking
    // one of them would be a guess.
    expect(refused.code).toBe('INVALID_INPUT')
  })

  it('bytter fil med bytes, og lar navnet stå', async () => {
    const context = testAgentContext()
    const { deck, view } = await deckWithApp(context)
    const replaced = await agentOperation<InteractiveSlideView>(context, 'set_interactive_slide', {
      presentationId: deck.presentationId,
      slideId: view.slideId,
      fileName: 'quiz.html',
      content: { encoding: 'text', data: OTHER },
    })
    expect(replaced).toMatchObject({ name: 'teller', fileName: 'quiz.html' })
    expect(interactiveAt(await storedPresentation(context, deck.presentationId), 2).html).toBe(OTHER)
  })

  it('avviser bytes som ikke er gyldig UTF-8, som den samme døren gjør for et menneske', async () => {
    const context = testAgentContext()
    const deck = await newAgentDeck(context)
    const refused = await agentRefusal(context, 'add_interactive_slide', {
      presentationId: deck.presentationId,
      fileName: 'teller.html',
      // Latin-1 «ø» as a lone 0xf8: not a UTF-8 lead byte.
      content: { encoding: 'base64', data: encodeBase64(new Uint8Array([0x3c, 0x70, 0x3e, 0xf8])) },
    })
    expect(refused.code).toBe('INVALID_INTERACTIVE_FILE')
    expect((await storedPresentation(context, deck.presentationId)).slides).toHaveLength(2)
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
