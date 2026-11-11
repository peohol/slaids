/**
 * Referanser fra lenker som limes inn eller skrives i teksten.
 *
 * En DOI- eller PubMed-lenke blir straks en referanse med lenken alene, så
 * citation-nummeret kan settes inn i samme øyeblikk. Tittel, forfattere og år
 * hentes i bakgrunnen med det samme oppslaget som referansedialogen bruker, og
 * fylles inn når svaret kommer – uten et eget angresteg, se
 * `amendEverywhere`. Mens oppslaget pågår, står referansens id i
 * `useReferenceImports`, som citation-noden viser som en indikator.
 */

import { create } from 'zustand'
import { addReference, updateReference, type ReferenceInput } from '../domain/commands'
import { ok } from '../domain/result'
import type { Presentation, Reference } from '../domain/types'
import {
  identifierKey,
  identifierUrl,
  lookupReferenceMetadata,
  parseReferenceIdentifier,
  type ReferenceIdentifier,
} from './referenceMetadata'
import { useEditorStore } from './store'
import { notify } from './toast'

interface ReferenceImportStore {
  /** Referanser som venter på opplysningene sine. */
  pending: ReadonlySet<string>
}

export const useReferenceImports = create<ReferenceImportStore>(() => ({ pending: new Set() }))

function setPending(id: string, importing: boolean): void {
  useReferenceImports.setState(({ pending }) => {
    const next = new Set(pending)
    if (importing) next.add(id)
    else next.delete(id)
    return { pending: next }
  })
}

/**
 * Hvilken referanse en identifikator er hentet til i denne økten.
 *
 * En PubMed-referanse lagres med DOI-lenken når artikkelen har en, så lenken
 * alene kan ikke kjenne igjen en PubMed-lenke som limes inn på nytt.
 */
const importedIds = new Map<string, string>()

function existingReference(presentation: Presentation, identifier: ReferenceIdentifier): string | null {
  const key = identifierKey(identifier)
  const known = importedIds.get(key)
  if (known && presentation.references.some((reference) => reference.id === known)) return known
  const match = presentation.references.find((reference) => {
    const parsed = parseReferenceIdentifier(reference.url)
    return parsed !== null && identifierKey(parsed) === key
  })
  return match?.id ?? null
}

/**
 * Referansene lenkene viser til, i samme rekkefølge – nye opprettes, og
 * opplysningene deres hentes i bakgrunnen.
 *
 * En lenke som allerede er en referanse i presentasjonen, gjenbruker den. Alle
 * nye referanser legges til i ett angresteg. `null` når det ikke finnes noen
 * presentasjon å legge dem i.
 */
export function citeReferenceLinks(identifiers: readonly ReferenceIdentifier[]): string[] | null {
  const store = useEditorStore.getState()
  const current = store.presentation
  if (!current || identifiers.length === 0) return null

  const ids: string[] = []
  const created: { reference: Reference; identifier: ReferenceIdentifier }[] = []
  let next = current
  for (const identifier of identifiers) {
    const reused = existingReference(next, identifier)
    if (reused) {
      if (!ids.includes(reused)) ids.push(reused)
      continue
    }
    const result = addReference(next, { title: '', authors: '', year: '', url: identifierUrl(identifier) })
    if (!result.ok) return null
    next = result.value.presentation
    importedIds.set(identifierKey(identifier), result.value.reference.id)
    created.push({ reference: result.value.reference, identifier })
    ids.push(result.value.reference.id)
  }

  if (next !== current && !store.run('reference-add', () => ok(next))) return null
  for (const { reference, identifier } of created) void completeReference(reference, identifier)
  return ids
}

function sameReference(a: Reference, b: Reference): boolean {
  return a.title === b.title && a.authors === b.authors && a.year === b.year && a.url === b.url
}

/**
 * Fyll inn en referanse som så langt bare har lenken sin.
 *
 * Bare der referansen fortsatt er slik den ble opprettet: har noen rukket å
 * skrive inn opplysningene selv, er det de som gjelder.
 */
async function completeReference(placeholder: Reference, identifier: ReferenceIdentifier): Promise<void> {
  setPending(placeholder.id, true)
  try {
    const metadata = await lookupReferenceMetadata(identifier, new AbortController().signal)
    if (!metadata) {
      notify.warning('Fant ingen referanse bak lenken. Lenken er lagt inn, og resten kan fylles ut under Referanser.')
      return
    }
    const input: ReferenceInput = { ...metadata, url: metadata.url || placeholder.url }
    useEditorStore.getState().amendEverywhere((presentation) => {
      const reference = presentation.references.find(({ id }) => id === placeholder.id)
      if (!reference || !sameReference(reference, placeholder)) return presentation
      const result = updateReference(presentation, placeholder.id, input)
      return result.ok ? result.value : presentation
    })
  } catch {
    notify.warning(
      'Kunne ikke hente opplysningene om referansen. Lenken er lagt inn, og resten kan fylles ut under Referanser.',
    )
  } finally {
    setPending(placeholder.id, false)
  }
}
