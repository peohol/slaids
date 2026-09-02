/**
 * The revision digest.
 *
 * What has to hold for it to be usable as a precondition: the same document
 * always gives the same value, a changed document always gives a different one,
 * and the value survives the round trip through storage — a document that came
 * back from JSONB with its keys in another order is the same document.
 */

import { describe, expect, it } from 'vitest'
import { addSlide, setSlideTitle } from './commands'
import { createPresentation } from './presentation'
import { presentationRevision } from './revision'
import { titleDoc } from './richdoc'
import type { Presentation } from './types'

function unwrap(result: { ok: boolean; value?: Presentation }): Presentation {
  if (!result.ok || !result.value) throw new Error('Forventet ok')
  return result.value
}

/** The same data with every object's keys in the opposite order. */
function reorderKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reorderKeys) as unknown as T
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).reverse()
    return Object.fromEntries(entries.map(([key, item]) => [key, reorderKeys(item)])) as T
  }
  return value
}

describe('presentationRevision', () => {
  it('gir samme verdi for samme dokument', () => {
    const presentation = createPresentation({ title: 'Revisjon' })
    expect(presentationRevision(presentation)).toBe(presentationRevision(presentation))
    expect(presentationRevision(structuredClone(presentation))).toBe(
      presentationRevision(presentation),
    )
  })

  it('endrer seg når dokumentet endres', () => {
    const presentation = createPresentation({ title: 'Revisjon' })
    const before = presentationRevision(presentation)

    const titled = unwrap(
      setSlideTitle(presentation, presentation.slides[0].id, titleDoc('Ny overskrift')),
    )
    expect(presentationRevision(titled)).not.toBe(before)

    const added = unwrap(addSlide(titled))
    expect(presentationRevision(added)).not.toBe(presentationRevision(titled))
  })

  it('ser forskjell på en tekst og et tall som ser like ut', () => {
    const presentation = createPresentation({ title: 'Revisjon' })
    const asText = { ...presentation, folderId: '1' }
    const asNumber = { ...presentation, folderId: 1 as unknown as string }
    expect(presentationRevision(asText)).not.toBe(presentationRevision(asNumber))
  })

  it('bryr seg ikke om hvilken rekkefølge nøklene kom tilbake i', () => {
    // A JSONB column and IndexedDB can hand back the same document with the
    // keys in different orders. That is not a new revision.
    const presentation = createPresentation({ title: 'Revisjon' })
    expect(presentationRevision(reorderKeys(presentation))).toBe(
      presentationRevision(presentation),
    )
  })

  it('overlever turen gjennom lagringens JSON', () => {
    // Every repository stores the document as JSON, which drops fields that are
    // explicitly `undefined`. A revision that changed on the way in and out
    // would make the revision a mutation answers with useless.
    const presentation = createPresentation({ title: 'Revisjon' })
    const withUndefined: Presentation = {
      ...presentation,
      slides: [{ ...presentation.slides[0], root: { ...presentation.slides[0].root } }],
    }
    ;(withUndefined.slides[0].root as unknown as Record<string, unknown>).extra = undefined

    const roundTripped = JSON.parse(JSON.stringify(withUndefined)) as Presentation
    expect(presentationRevision(roundTripped)).toBe(presentationRevision(withUndefined))
  })

  it('skiller dokumenter som bare er stokket om', () => {
    const presentation = unwrap(addSlide(createPresentation({ title: 'Revisjon' })))
    const swapped = {
      ...presentation,
      slides: [presentation.slides[1], presentation.slides[0]],
    }
    expect(presentationRevision(swapped)).not.toBe(presentationRevision(presentation))
  })
})
