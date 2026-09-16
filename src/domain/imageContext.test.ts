/**
 * The deck's shared visual context for its pictures.
 *
 * One optional string on the presentation, which is exactly why it is worth
 * checking: an optional field that is written as `''` the first time anybody
 * looks at it is not optional, and a document that has never had one must come
 * out of a save byte-identical to the one that went in.
 *
 * It is the *context*, not the brief. «Brief» means the one generated,
 * copy-paste message an author hands an image generator, which is composed from
 * this plus the image plan — see `imagePlan.ts`.
 */

import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_CONTEXT_CHARS } from './constants'
import { setImageContext } from './commands'
import { migratePresentation } from './migrations'
import { createPresentation, duplicatePresentationDocument } from './presentation'
import { validatePresentation } from './schema'

const CONTEXT =
  'Fotorealistiske vitenskapelige rekonstruksjoner, naturlig dagslys, dempet jordfargepalett, ingen tekst eller rammer.'

describe('setImageContext', () => {
  it('skriver konteksten og leser den tilbake', () => {
    const written = setImageContext(createPresentation({ title: 'Evolusjon' }), CONTEXT)
    expect(written.ok).toBe(true)
    if (written.ok) expect(written.value.imageContext).toBe(CONTEXT)
  })

  it('lagrer nøyaktig det den fikk, uten å normalisere noe', () => {
    // Deliberately not trimmed: see the note on the command. Whitespace around
    // a context is harmless, and rewriting the value is not — the editor's field
    // is controlled by what is stored, so every normalisation is a keystroke
    // the author loses.
    const padded = `  ${CONTEXT}\n`
    const written = setImageContext(createPresentation({ title: 'x' }), padded)
    expect(written.ok).toBe(true)
    if (written.ok) expect(written.value.imageContext).toBe(padded)
  })

  it('skriver ingenting inn i en presentasjon som ikke har en kontekst', () => {
    // The reason the field is optional at all: opening the dialog and closing
    // it again, or any other write of nothing, must leave the document alone.
    const base = createPresentation({ title: 'Uten kontekst' })
    expect('imageContext' in base).toBe(false)
    // Air is not a context, so none of these writes anything — and the one
    // keystroke this costs is a leading space in an empty field, which is the
    // one place there is genuinely nothing to lose.
    for (const nothing of ['', ' ', '   ', '\n', null] as const) {
      const written = setImageContext(base, nothing)
      expect(written.ok, JSON.stringify(nothing)).toBe(true)
      if (!written.ok) continue
      expect(written.value, JSON.stringify(nothing)).toBe(base)
      expect('imageContext' in written.value).toBe(false)
    }
  })

  it('fjerner konteksten når forfatteren tømmer feltet helt', () => {
    const base = setImageContext(createPresentation({ title: 'x' }), CONTEXT)
    expect(base.ok).toBe(true)
    if (!base.ok) return
    for (const emptied of ['', '  '] as const) {
      const cleared = setImageContext(base.value, emptied)
      expect(cleared.ok, JSON.stringify(emptied)).toBe(true)
      if (cleared.ok) expect('imageContext' in cleared.value).toBe(false)
    }
  })

  it('fjerner feltet igjen når konteksten tømmes', () => {
    const base = setImageContext(createPresentation({ title: 'x' }), CONTEXT)
    expect(base.ok).toBe(true)
    if (!base.ok) return
    const cleared = setImageContext(base.value, null)
    expect(cleared.ok).toBe(true)
    if (cleared.ok) expect('imageContext' in cleared.value).toBe(false)
  })

  it('avviser en kontekst som er lengre enn grensen, og sier hvor grensen går', () => {
    const refused = setImageContext(
      createPresentation({ title: 'x' }),
      'x'.repeat(MAX_IMAGE_CONTEXT_CHARS + 1),
    )
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.error.code).toBe('INVALID_ARGUMENT')
      expect(refused.error.details).toMatchObject({ maxChars: MAX_IMAGE_CONTEXT_CHARS })
    }
  })
})

describe('feltet skrives aldri om under markøren', () => {
  /**
   * The editor's dialog is a controlled textarea that runs this command on
   * every keystroke and then shows back whatever was stored. So anything this
   * command rewrites is a character the user watches disappear as they type
   * it — and a command that normalised the value would make a trailing space
   * impossible to type, which is most of the spaces in a sentence.
   *
   * Modelled as the loop the component actually is, rather than as one call:
   * what the field shows after a keystroke is what was stored, and the next
   * keystroke is appended to *that*.
   */
  function typed(text: string): string {
    let presentation = createPresentation({ title: 'Skriver' })
    let shown = ''
    for (const character of text) {
      const written = setImageContext(presentation, shown + character)
      expect(written.ok, `avvist etter «${shown}»`).toBe(true)
      if (!written.ok) return shown
      presentation = written.value
      shown = presentation.imageContext ?? ''
    }
    return shown
  }

  it('lar forfatteren skrive en helt vanlig setning, mellomrom og alt', () => {
    expect(typed(CONTEXT)).toBe(CONTEXT)
  })

  it('lar linjeskift stå, så konteksten kan ha avsnitt', () => {
    const paragraphs = 'Naturlig dagslys.\n\nIngen tekst i bildene.'
    expect(typed(paragraphs)).toBe(paragraphs)
  })

  it('beholder et avsluttende mellomrom, som er halve veien til neste ord', () => {
    const written = setImageContext(createPresentation({ title: 'x' }), 'Dempet ')
    expect(written.ok).toBe(true)
    if (written.ok) expect(written.value.imageContext).toBe('Dempet ')
  })
})

describe('konteksten overlever lagring, import og duplisering', () => {
  it('valideres som en del av dokumentet', () => {
    const written = setImageContext(createPresentation({ title: 'x' }), CONTEXT)
    expect(written.ok).toBe(true)
    if (!written.ok) return
    const validated = validatePresentation(JSON.parse(JSON.stringify(written.value)))
    expect(validated.issues).toEqual([])
    expect(validated.value?.imageContext).toBe(CONTEXT)
  })

  it('leses uendret gjennom migrasjonskjeden', () => {
    const written = setImageContext(createPresentation({ title: 'x' }), CONTEXT)
    expect(written.ok).toBe(true)
    if (!written.ok) return
    const imported = migratePresentation(JSON.parse(JSON.stringify(written.value)))
    expect(imported.ok).toBe(true)
    if (imported.ok) expect(imported.value.imageContext).toBe(CONTEXT)
  })

  it('gir et dokument uten kontekst ingen kontekst når det åpnes', () => {
    const base = createPresentation({ title: 'Gammel' })
    const imported = migratePresentation(JSON.parse(JSON.stringify(base)))
    expect(imported.ok).toBe(true)
    if (imported.ok) expect(imported.value.imageContext).toBeUndefined()
  })

  it('følger med kopien, fordi den hører til dekket og ikke til én slide', () => {
    const written = setImageContext(createPresentation({ title: 'x' }), CONTEXT)
    expect(written.ok).toBe(true)
    if (!written.ok) return
    expect(duplicatePresentationDocument(written.value).presentation.imageContext).toBe(CONTEXT)
  })
})
