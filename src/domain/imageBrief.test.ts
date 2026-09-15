/**
 * Bildebrief: the deck's shared visual premise for its pictures.
 *
 * One optional string on the presentation, which is exactly why it is worth
 * checking: an optional field that is written as `''` the first time anybody
 * looks at it is not optional, and a document that has never had a brief must
 * come out of a save byte-identical to the one that went in.
 */

import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_BRIEF_CHARS } from './constants'
import { setImageBrief } from './commands'
import { migratePresentation } from './migrations'
import { createPresentation, duplicatePresentationDocument } from './presentation'
import { validatePresentation } from './schema'

const BRIEF =
  'Fotorealistiske vitenskapelige rekonstruksjoner, naturlig dagslys, dempet jordfargepalett, ingen tekst eller rammer.'

describe('setImageBrief', () => {
  it('skriver briefen og leser den tilbake', () => {
    const written = setImageBrief(createPresentation({ title: 'Evolusjon' }), BRIEF)
    expect(written.ok).toBe(true)
    if (written.ok) expect(written.value.imageBrief).toBe(BRIEF)
  })

  it('trimmer, fordi luft rundt en brief ikke er en brief', () => {
    const written = setImageBrief(createPresentation({ title: 'x' }), `  ${BRIEF}  `)
    expect(written.ok).toBe(true)
    if (written.ok) expect(written.value.imageBrief).toBe(BRIEF)
  })

  it('skriver ingenting inn i en presentasjon som ikke har en brief', () => {
    // The reason the field is optional at all: opening the dialog and closing
    // it again, or any other write of nothing, must leave the document alone.
    const base = createPresentation({ title: 'Uten brief' })
    expect('imageBrief' in base).toBe(false)
    for (const nothing of ['', '   ', null] as const) {
      const written = setImageBrief(base, nothing)
      expect(written.ok).toBe(true)
      if (!written.ok) continue
      expect(written.value).toBe(base)
      expect('imageBrief' in written.value).toBe(false)
    }
  })

  it('fjerner feltet igjen når briefen tømmes', () => {
    const base = setImageBrief(createPresentation({ title: 'x' }), BRIEF)
    expect(base.ok).toBe(true)
    if (!base.ok) return
    const cleared = setImageBrief(base.value, null)
    expect(cleared.ok).toBe(true)
    if (cleared.ok) expect('imageBrief' in cleared.value).toBe(false)
  })

  it('avviser en brief som er lengre enn grensen, og sier hvor grensen går', () => {
    const refused = setImageBrief(
      createPresentation({ title: 'x' }),
      'x'.repeat(MAX_IMAGE_BRIEF_CHARS + 1),
    )
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.error.code).toBe('INVALID_ARGUMENT')
      expect(refused.error.details).toMatchObject({ maxChars: MAX_IMAGE_BRIEF_CHARS })
    }
  })
})

describe('briefen overlever lagring, import og duplisering', () => {
  it('valideres som en del av dokumentet', () => {
    const written = setImageBrief(createPresentation({ title: 'x' }), BRIEF)
    expect(written.ok).toBe(true)
    if (!written.ok) return
    const validated = validatePresentation(JSON.parse(JSON.stringify(written.value)))
    expect(validated.issues).toEqual([])
    expect(validated.value?.imageBrief).toBe(BRIEF)
  })

  it('leses uendret gjennom migrasjonskjeden', () => {
    const written = setImageBrief(createPresentation({ title: 'x' }), BRIEF)
    expect(written.ok).toBe(true)
    if (!written.ok) return
    const imported = migratePresentation(JSON.parse(JSON.stringify(written.value)))
    expect(imported.ok).toBe(true)
    if (imported.ok) expect(imported.value.imageBrief).toBe(BRIEF)
  })

  it('gir et dokument uten brief ingen brief når det åpnes', () => {
    const base = createPresentation({ title: 'Gammel' })
    const imported = migratePresentation(JSON.parse(JSON.stringify(base)))
    expect(imported.ok).toBe(true)
    if (imported.ok) expect(imported.value.imageBrief).toBeUndefined()
  })

  it('følger med kopien, fordi den hører til dekket og ikke til én slide', () => {
    const written = setImageBrief(createPresentation({ title: 'x' }), BRIEF)
    expect(written.ok).toBe(true)
    if (!written.ok) return
    expect(duplicatePresentationDocument(written.value).presentation.imageBrief).toBe(BRIEF)
  })
})
