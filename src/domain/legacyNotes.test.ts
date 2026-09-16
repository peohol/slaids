/**
 * Notes, retired.
 *
 * `note` was a content kind: editorial text parked in a zone, with
 * `purpose: 'image-prompt'` as the way an agent reserved geometry for a picture
 * it could not make. It is gone — the reservation is a real picture zone now,
 * and the motif lives in the deck's image plan (`imagePlan.ts`).
 *
 * Two things have to be true for that removal to be safe, and neither of them
 * is obvious from the type system:
 *
 *  - **A deck that has one still opens.** Somebody's saved presentation has
 *    notes in it, and «the type no longer exists» must not mean «the file no
 *    longer loads». That is what `schemaVersion` 16 is for.
 *  - **The text does not surface.** A note was working material nobody had
 *    shown to anybody. The one outcome a migration must never produce is that
 *    text appearing on a slide an audience reads — so this pins what it becomes
 *    (deliberate air) rather than leaving it to whichever branch ran.
 */

import { describe, expect, it } from 'vitest'
import { ZONE_CONTENT_KINDS, CONTENT_KIND_LABELS, createContentOfKind } from './content'
import { availableContentKinds, minimumSizeForKind } from './contentSize'
import { migratePresentation } from './migrations'
import { buildSharedSnapshot } from './sharing'
import { CURRENT_SCHEMA_VERSION, validatePresentation } from './schema'
import { docToPlainText } from './richdoc'
import { collectLeaves } from './layout'
import type { Presentation } from './types'

const PROMPT =
  'Vitenskapelig rekonstruksjon av Australopithecus afarensis i helfigur, nøytral bakgrunn.'

/** A v15 document with both kinds of note in it, as one was actually stored. */
function deckWithNotes(): Record<string, unknown> {
  return {
    schemaVersion: 15,
    id: 'p_legacy',
    title: 'Menneskets evolusjon',
    folderId: null,
    imageBrief: 'Dempet jordfargepalett, naturlig dagslys.',
    theme: {
      headingFontFamily: 'Inter, sans-serif',
      bodyFontFamily: 'Inter, sans-serif',
      spacing: 2,
      fontScale: 1.45,
    },
    slides: [
      {
        id: 's0',
        kind: 'section',
        title: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Forside' }] }] },
        subtitle: { type: 'doc' },
        accentColor: '#4d6b8c',
        backgroundColor: '#ffffff',
      },
      {
        id: 's1',
        kind: 'content',
        title: null,
        root: {
          id: 'n0',
          kind: 'split',
          axis: 'x',
          weights: [1, 1],
          children: [
            { id: 'n1', kind: 'leaf', content: { id: 'c1', kind: 'note', text: PROMPT, purpose: 'image-prompt' } },
            { id: 'n2', kind: 'leaf', content: { id: 'c2', kind: 'note', text: 'Sjekk dateringen.', purpose: 'general' } },
          ],
        },
      },
    ],
    references: [],
    sandbox: [
      { id: 'sb1', content: { id: 'c3', kind: 'note', text: PROMPT, purpose: 'image-prompt' }, createdAt: '', note: '' },
    ],
    ideas: [],
    assets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function migrated(): Presentation {
  const result = migratePresentation(deckWithNotes())
  expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

describe('`note` er ikke lenger en aktiv innholdstype', () => {
  it('finnes ikke blant innholdstypene noen flate tilbyr', () => {
    expect(ZONE_CONTENT_KINDS).not.toContain('note')
    expect(Object.keys(CONTENT_KIND_LABELS)).not.toContain('note')
    // Including in the one place a kind is offered when nothing else fits: a
    // sliver of a zone used to offer air *and* a note.
    const tiny = { x: 0, y: 0, width: 4, height: 3 }
    expect(availableContentKinds(tiny, null)).toEqual(['negative-space'])
  })

  it('er ikke lenger den ene typen uten minstestørrelse ved siden av luft', () => {
    const sizeless = ZONE_CONTENT_KINDS.filter((kind) => minimumSizeForKind(kind).height === 0)
    expect(sizeless).toEqual(['negative-space'])
  })

  it('avvises av skjemaet som en ukjent innholdstype', () => {
    const stored = {
      ...deckWithNotes(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    }
    // Straight at the current version, so no migration runs: a document that
    // claims to be current and holds a note is not a current document.
    expect(validatePresentation(stored).ok).toBe(false)
  })

  it('er ikke noe agenten kan be om, og ikke noe den kan lese tilbake', () => {
    for (const kind of ZONE_CONTENT_KINDS) {
      const content = createContentOfKind(kind)
      expect(content.kind).not.toBe('note')
      expect(Object.keys(content)).not.toContain('purpose')
    }
  })
})

describe('et gammelt dekk med notater åpner fortsatt', () => {
  it('migrerer til gjeldende versjon uten å feile', () => {
    const deck = migrated()
    expect(deck.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(deck.slides).toHaveLength(2)
  })

  it('gjør hver notatsone til bevisst luft, med sonen på samme plass i treet', () => {
    const slide = migrated().slides[1]
    if (slide.kind !== 'content') throw new Error('Forventet en innholdsslide')
    const leaves = collectLeaves(slide.root)

    // The rectangle and its place in the tree survive: removing the zone would
    // have reflowed every sibling, so an old deck would open as a composition
    // its author never laid out.
    expect(leaves.map((leaf) => leaf.id)).toEqual(['n1', 'n2'])
    expect(leaves.map((leaf) => leaf.content?.kind)).toEqual(['negative-space', 'negative-space'])
  })

  it('lar ikke notatteksten dukke opp noe sted i dokumentet', () => {
    // The outcome a migration must never produce: editorial working material
    // becoming text an audience reads, without the author doing anything.
    const deck = migrated()
    expect(JSON.stringify(deck)).not.toContain(PROMPT)
    expect(JSON.stringify(deck)).not.toContain('Sjekk dateringen')

    const slide = deck.slides[1]
    if (slide.kind !== 'content') throw new Error('Forventet en innholdsslide')
    for (const leaf of collectLeaves(slide.root)) {
      expect(leaf.content && 'body' in leaf.content).toBeFalsy()
    }
  })

  it('fjerner et parkert notat fra sandkassen, som ikke har noen sone å gå tilbake til', () => {
    expect(migrated().sandbox).toEqual([])
  })

  it('døper om bildebriefen til den felles bildekonteksten', () => {
    // «Brief» now means the one generated, copy-paste message; the stored field
    // is the shared visual context that heads it.
    const deck = migrated()
    expect(deck.imageContext).toBe('Dempet jordfargepalett, naturlig dagslys.')
    expect((deck as unknown as Record<string, unknown>).imageBrief).toBeUndefined()
  })

  it('publiserer det migrerte dekket uten å ta noe redaksjonelt med seg', () => {
    // The old sanitiser emptied a note's text on the way out. Nothing is left
    // to empty — the working material lives beside the slides now — and the
    // snapshot lists what goes, so this is the check that it still does.
    const snapshot = buildSharedSnapshot(migrated())
    const published = JSON.stringify(snapshot)
    expect(published).not.toContain(PROMPT)
    expect(published).not.toContain('imageContext')
    expect(published).not.toContain('imagePlan')
    expect(docToPlainText(snapshot.slides[0].title)).toBe('Forside')
  })
})
