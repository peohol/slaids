import { describe, expect, it } from 'vitest'
import { createUntitledCard } from './content'
import { newAssetId, newSandboxId } from './ids'
import { createLeaf } from './layout'
import { SPACING_RANGE } from './metrics'
import { createInteractiveSlide, createPresentation } from './presentation'
import { CURRENT_SCHEMA_VERSION, validatePresentation } from './schema'
import {
  SHARED_SNAPSHOT_FORMAT,
  SHARED_SNAPSHOT_VERSION,
  buildSharedSnapshot,
  parseSharedSnapshot,
} from './sharing'
import { docToPlainText, imageNode } from './richdoc'
import type { AssetRef, Presentation, Reference, RichDoc } from './types'
import { contentAt, interactiveAt, sectionAt } from './testDecks'

function citing(ids: string[]): RichDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Påstand' },
          { type: 'citation', attrs: { referenceIds: ids } },
        ],
      },
    ],
  }
}

function docWith(nodes: RichDoc['content']): RichDoc {
  return { type: 'doc', content: nodes }
}

function cardWith(doc: RichDoc) {
  const card = createUntitledCard()
  return {
    ...card,
    body: { ...card.body, subfields: [{ ...card.body.subfields[0], doc }] },
  }
}

function asset(id: string): AssetRef {
  return {
    id,
    name: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 10,
    width: 4,
    height: 4,
    isVector: false,
  }
}

const SHOWN_ASSET = newAssetId()
const SANDBOX_ASSET = newAssetId()
const ORPHAN_ASSET = newAssetId()

/**
 * One presentation with something of every kind in it: a cited reference and an
 * uncited one, a picture on a slide, a picture only the sandbox uses, and a
 * picture nothing uses at all.
 */
function fullPresentation(): Presentation {
  const base = createPresentation({ title: 'Arbeidskopi' })
  const cited: Reference = {
    id: 'r-brukt',
    title: 'Sitert kilde',
    authors: 'A. Forfatter',
    url: 'https://example.com/1',
    year: '2026',
  }
  const uncited: Reference = {
    id: 'r-ubrukt',
    title: 'Kilde ingen siterer',
    authors: '',
    url: '',
    year: '',
  }
  const slideDoc = docWith([
    ...(citing([cited.id]).content ?? []),
    { type: 'paragraph', content: [imageNode(SHOWN_ASSET, { alt: 'Figur' })] },
  ])

  return {
    ...base,
    folderId: 'fl_hemmelig',
    references: [cited, uncited],
    slides: [sectionAt(base, 0),{ ...contentAt(base, 1), root: createLeaf(cardWith(slideDoc)) }],
    sandbox: [
      {
        id: newSandboxId(),
        content: cardWith(docWith([{ type: 'paragraph', content: [imageNode(SANDBOX_ASSET)] }])),
        createdAt: '2026-09-01T10:00:00.000Z',
        note: 'Utkast som ikke er ferdig',
      },
    ],
    ideas: [{ id: 'i1', kind: 'idea', text: 'Husk å nevne budsjettet' }],
    assets: [asset(SHOWN_ASSET), asset(SANDBOX_ASSET), asset(ORPHAN_ASSET)],
  }
}

describe('buildSharedSnapshot', () => {
  it('tar med det som skal til for å vise dekket', () => {
    const presentation = fullPresentation()
    const snapshot = buildSharedSnapshot(presentation, '2026-09-02T08:00:00.000Z')

    expect(snapshot.format).toBe(SHARED_SNAPSHOT_FORMAT)
    expect(snapshot.snapshotVersion).toBe(SHARED_SNAPSHOT_VERSION)
    expect(snapshot.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(snapshot.title).toBe('Arbeidskopi')
    expect(snapshot.theme).toEqual(presentation.theme)
    // The front page is the first slide now, so it travels with the rest.
    expect(snapshot.slides).toEqual(presentation.slides)
    expect(snapshot.slides[0].kind).toBe('section')
    expect(snapshot.publishedAt).toBe('2026-09-02T08:00:00.000Z')
  })

  it('publiserer ingen private arbeidsdata', () => {
    const snapshot = buildSharedSnapshot(fullPresentation())
    const fields = Object.keys(snapshot)

    // Listet felt for felt, ikke slettet: et nytt felt på Presentation er
    // privat til noen med vilje publiserer det.
    expect(fields.sort()).toEqual(
      [
        'assets',
        'format',
        'publishedAt',
        'references',
        'schemaVersion',
        'slides',
        'snapshotVersion',
        'theme',
        'title',
      ].sort(),
    )

    const json = JSON.stringify(snapshot)
    expect(json).not.toContain('Utkast som ikke er ferdig')
    expect(json).not.toContain('Husk å nevne budsjettet')
    expect(json).not.toContain('fl_hemmelig')
    expect(json).not.toContain('owner')
  })

  it('tar bare med referanser som faktisk siteres, i nummerrekkefølge', () => {
    const snapshot = buildSharedSnapshot(fullPresentation())
    expect(snapshot.references.map((reference) => reference.id)).toEqual(['r-brukt'])
  })

  it('tar bare med metadata for filer sliden faktisk viser', () => {
    const snapshot = buildSharedSnapshot(fullPresentation())
    expect(snapshot.assets.map((entry) => entry.id)).toEqual([SHOWN_ASSET])
    // Sandkassebildet hører til arbeidskopien, ikke til dekket.
    expect(snapshot.assets.some((entry) => entry.id === SANDBOX_ASSET)).toBe(false)
    expect(snapshot.assets.some((entry) => entry.id === ORPHAN_ASSET)).toBe(false)
  })

  it('deler ikke struktur med dokumentet det ble skåret ut av', () => {
    const presentation = fullPresentation()
    const snapshot = buildSharedSnapshot(presentation)
    expect(snapshot.slides).not.toBe(presentation.slides)
    expect(snapshot.slides[1]).not.toBe(presentation.slides[1])
  })
})

describe('parseSharedSnapshot', () => {
  it('leser tilbake det som ble bygget', () => {
    const snapshot = buildSharedSnapshot({
      ...fullPresentation(),
      includeReferencesInProgress: true,
    })
    const parsed = parseSharedSnapshot(JSON.parse(JSON.stringify(snapshot)))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.title).toBe('Arbeidskopi')
    expect(parsed.value.includeReferencesInProgress).toBe(true)
    expect(parsed.value.slides).toHaveLength(2)
    expect(parsed.value.assets.map((entry) => entry.id)).toEqual([SHOWN_ASSET])
  })

  it('avviser et fremmed dokument', () => {
    expect(parseSharedSnapshot({ hello: 'world' }).ok).toBe(false)
    expect(parseSharedSnapshot(null).ok).toBe(false)
    // Den private presentasjonen er ikke et snapshot, og skal ikke leses som ett.
    expect(parseSharedSnapshot(fullPresentation()).ok).toBe(false)
  })

  it('leser valgfritt visningsformat uten å kreve det på eldre delte kopier', () => {
    const snapshot = buildSharedSnapshot(fullPresentation())
    expect(parseSharedSnapshot(snapshot)).toMatchObject({ ok: true })
    expect(parseSharedSnapshot({ ...snapshot, citationStyle: 'author-year' })).toMatchObject({
      ok: true,
      value: { citationStyle: 'author-year' },
    })
    expect(parseSharedSnapshot({ ...snapshot, citationStyle: 'ukjent' }).ok).toBe(false)
  })

  it('leser en delingslenke som ble publisert før forsiden fantes', () => {
    // Et snapshot fra før v8 har ikke feltet i det hele tatt. Konvolutten må
    // slippe det gjennom til migreringene, ellers slutter hver eneste lenke som
    // allerede er delt ut å virke — og den som fikk den har ingen ny å be om.
    const snapshot = buildSharedSnapshot(fullPresentation())
    // A link shared before sections existed: no `cover`, and slides without a
    // `kind`. The migration chain builds the front page from the deck's title,
    // exactly as it does for a stored presentation.
    const legacy = { ...snapshot, schemaVersion: 7 } as Record<string, unknown>
    delete legacy.cover
    legacy.slides = (legacy.slides as Array<Record<string, unknown>>).slice(1)

    const parsed = parseSharedSnapshot(legacy)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(docToPlainText(parsed.value.slides[0].title).trim()).toBe('Arbeidskopi')
    expect(parsed.value.slides).toHaveLength(2)
  })

  it('kjører et eldre snapshot gjennom migreringene', () => {
    const snapshot = buildSharedSnapshot(fullPresentation())
    // v4 kjente verken temaskalaene eller seksjoner: skalaene fylles inn av
    // migreringen, og forsiden bygges av dekkets eget navn.
    const older = {
      ...snapshot,
      schemaVersion: 4,
      slides: (JSON.parse(JSON.stringify(snapshot.slides)) as Record<string, unknown>[])
        .slice(1)
        .map(({ kind: _kind, ...rest }) => rest),
      theme: {
        backgroundColor: '#ffffff',
        headingFontFamily: snapshot.theme.headingFontFamily,
        bodyFontFamily: snapshot.theme.bodyFontFamily,
      },
    }
    const parsed = parseSharedSnapshot(older)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    // Filled in by the migration and clamped into range by the repair.
    expect(parsed.value.theme.spacing).toBe(SPACING_RANGE.min)
  })
})

describe('deling er ikke en del av dokumentet', () => {
  it('arves aldri av en import eller en kopi', () => {
    // En `.slaids`-fil eller et fremmed dokument kan påstå hva som helst.
    // Delingsstatusen bor ikke i presentasjonen, så påstanden faller bort ved
    // validering og en importert eller duplisert presentasjon starter udelt.
    const claiming = {
      ...createPresentation({ title: 'Importert' }),
      isShared: true,
      shareToken: '3f2a1b0c-1111-4222-8333-444455556666',
      sharedDocument: { title: 'Noe' },
    }

    const validated = validatePresentation(claiming)

    expect(validated.ok).toBe(true)
    const keys = Object.keys(validated.value ?? {})
    expect(keys).not.toContain('isShared')
    expect(keys).not.toContain('shareToken')
    expect(keys).not.toContain('sharedDocument')
  })
})

describe('en interaktiv slide i et delt snapshot', () => {
  const APP = '<!doctype html><html><body><p>Blåbær 🙂</p><script>let n = 0</script></body></html>'

  function withApp(): Presentation {
    const presentation = fullPresentation()
    return {
      ...presentation,
      slides: [
        ...presentation.slides,
        createInteractiveSlide({ name: 'Teller', fileName: 'teller.html', html: APP }),
      ],
    }
  }

  it('publiseres med kilden: den som åpner lenken får filen', () => {
    const snapshot = buildSharedSnapshot(withApp())
    expect(snapshot.slides).toHaveLength(3)
    expect(snapshot.slides[2].kind).toBe('interactive')
    // Stated on purpose: sharing an interactive slide is sharing its HTML
    // source, and the upload dialog says so.
    expect(JSON.stringify(snapshot)).toContain('let n = 0')
  })

  it('leses tilbake byte for byte', () => {
    const presentation = withApp()
    const parsed = parseSharedSnapshot(JSON.parse(JSON.stringify(buildSharedSnapshot(presentation))))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.slides[2]).toEqual(interactiveAt(presentation, 2))
  })
})
