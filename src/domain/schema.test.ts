import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION, validateClipboardPayload, validatePresentation } from './schema'
import { detectSchemaVersion, migratePresentation } from './migrations'
import { createPresentation } from './presentation'
import { createUntitledCard } from './content'
import { docToPlainText, paragraphDoc } from './richdoc'
import { DEFAULT_PILL_COLOR } from './constants'
import { FONT_SCALE_RANGE, NEUTRAL_SCALE, SPACING_RANGE } from './metrics'
import { createLeaf, createSplit } from './layout'
import type { Presentation, RichDoc } from './types'

function sample(): Presentation {
  const presentation = createPresentation({ title: 'Prøve' })
  return {
    ...presentation,
    slides: [
      {
        ...presentation.slides[0],
        root: createSplit('x', [2, 3], [createLeaf(createUntitledCard()), createLeaf()]),
      },
    ],
  }
}

describe('validatePresentation', () => {
  it('accepts a freshly created presentation', () => {
    const result = validatePresentation(sample())
    expect(result.ok).toBe(true)
  })

  it('rejects a missing schemaVersion', () => {
    const { schemaVersion: _schemaVersion, ...rest } = sample()
    expect(validatePresentation(rest).ok).toBe(false)
  })

  it('rejects a split with mismatched weights', () => {
    const presentation = sample()
    const broken = {
      ...presentation,
      slides: [
        {
          ...presentation.slides[0],
          root: { ...presentation.slides[0].root, weights: [1] },
        },
      ],
    }
    expect(validatePresentation(broken).ok).toBe(false)
  })

  it('rejects a leaf that also has children', () => {
    const presentation = sample()
    const broken = {
      ...presentation,
      slides: [
        {
          ...presentation.slides[0],
          root: { id: 'x', kind: 'leaf', content: null, children: [createLeaf()] },
        },
      ],
    }
    // Extra keys are stripped rather than accepted as a split, so the tree stays a leaf.
    const result = validatePresentation(broken)
    expect(result.ok).toBe(true)
    expect(result.value?.slides[0].root.kind).toBe('leaf')
    expect('children' in (result.value?.slides[0].root ?? {})).toBe(false)
  })

  it('rejects zero and negative weights', () => {
    const presentation = sample()
    for (const weights of [[0, 1], [-1, 1]]) {
      const broken = {
        ...presentation,
        slides: [{ ...presentation.slides[0], root: { ...presentation.slides[0].root, weights } }],
      }
      expect(validatePresentation(broken).ok).toBe(false)
    }
  })

  it('rejects a presentation with no slides', () => {
    expect(validatePresentation({ ...sample(), slides: [] }).ok).toBe(false)
  })

  it('rejects an invalid background colour', () => {
    const presentation = sample()
    const broken = { ...presentation, theme: { ...presentation.theme, backgroundColor: 'blue' } }
    expect(validatePresentation(broken).ok).toBe(false)
  })
})

describe('migrations', () => {
  it('detects the version of an unversioned document as 0', () => {
    expect(detectSchemaVersion({ id: 'x' })).toBe(0)
    expect(detectSchemaVersion({ schemaVersion: 1 })).toBe(1)
  })

  it('migrates an unversioned document up to the current version', () => {
    const presentation = sample()
    const legacy: Record<string, unknown> = { ...presentation }
    delete legacy.schemaVersion
    delete legacy.sandbox
    delete legacy.ideas
    delete legacy.ideaCategories
    delete legacy.assets
    delete legacy.folderId

    const result = migratePresentation(legacy)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
      expect(result.value.sandbox).toEqual([])
      expect(result.value.folderId).toBeNull()
    }
  })

  it('folds a v6 ideas list into one ordered list', () => {
    const legacy = {
      ...sample(),
      schemaVersion: 6,
      ideas: [
        { id: 'i1', categoryId: null, text: 'løs', done: false },
        { id: 'i2', categoryId: 'c1', text: 'under kilder', done: true },
        { id: 'i3', categoryId: 'c1', text: 'også under kilder', done: false },
        { id: 'i4', categoryId: 'c2', text: 'under å gjøre', done: false },
      ],
      ideaCategories: [
        { id: 'c1', name: 'Kilder', color: '#4d6b8c' },
        { id: 'c2', name: 'Å gjøre', color: '#8c6b4d' },
      ],
    }

    const result = migratePresentation(legacy)
    expect(result.ok).toBe(true)
    if (!result.ok || !result.value) return

    // The loose ideas came first on screen, and they still do; each category
    // then carries the notes that named it, in the order they had.
    expect(result.value.ideas.map((row) => row.text)).toEqual(['løs', 'Kilder', 'Å gjøre'])
    expect(result.value.ideas.map((row) => row.kind)).toEqual(['idea', 'category', 'category'])
    const kilder = result.value.ideas[1]
    expect(kilder.kind === 'category' ? kilder.ideas.map((idea) => idea.text) : null).toEqual([
      'under kilder',
      'også under kilder',
    ])
    // The colour comes along: it is what tells two lists apart, and a list that
    // changed shape should still look like the one the author left.
    expect(result.value.ideas.filter((row) => row.kind === 'category').map((row) => row.color)).toEqual([
      '#4d6b8c',
      '#8c6b4d',
    ])
    // Nothing that was written is lost, and the old pair of arrays is gone.
    expect((result.value as unknown as Record<string, unknown>).ideaCategories).toBeUndefined()
  })

  it('keeps an idea whose category is not there, rather than dropping it', () => {
    const result = migratePresentation({
      ...sample(),
      schemaVersion: 6,
      ideas: [
        { id: 'i1', categoryId: 'gone', text: 'kategorien finnes ikke', done: false },
        { id: 'i2', categoryId: 'c1', text: 'under kilder', done: false },
        { id: 'i3', categoryId: null, text: 'løs', done: false },
      ],
      ideaCategories: [{ id: 'c1', name: 'Kilder', color: '#4d6b8c' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok || !result.value) return
    // A dangling category id means uncategorised, exactly as v5 to v6 decided.
    // Losing the note instead would lose the one thing the list is for.
    expect(result.value.ideas.map((row) => row.text)).toEqual([
      'kategorien finnes ikke',
      'løs',
      'Kilder',
    ])
    const kilder = result.value.ideas[2]
    expect(kilder.kind === 'category' ? kilder.ideas.map((idea) => idea.text) : null).toEqual([
      'under kilder',
    ])
  })

  it('repairs a current-version ideas list instead of refusing the presentation', () => {
    // Already at the current version, so no migration runs: this is `repairPresentation`
    // alone, on the shapes the schema would otherwise reject outright.
    const result = migratePresentation({
      ...sample(),
      ideas: [
        {
          id: 'k1',
          kind: 'category',
          text: 'Ytre',
          color: '#402626',
          ideas: [
            { id: 'i1', kind: 'idea', text: '  flere    mellomrom  ' },
            { id: 'k2', kind: 'category', text: 'Indre', ideas: [{ id: 'i2', kind: 'idea', text: 'b' }] },
          ],
        },
        { id: 'i1', kind: 'idea', text: 'samme id som over' },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok || !result.value) return

    const outer = result.value.ideas[0]
    expect(outer.kind).toBe('category')
    // A category inside a category is flattened rather than rejected, and no
    // text goes missing on the way down.
    expect(outer.kind === 'category' ? outer.ideas.map((idea) => idea.text) : null).toEqual([
      'flere mellomrom',
      'Indre',
      'b',
    ])
    expect(outer.kind === 'category' ? outer.color : null).toBe('#402626')
    // Two rows cannot share one id.
    const ids = result.value.ideas.flatMap((row) =>
      row.kind === 'category' ? [row.id, ...row.ideas.map((idea) => idea.id)] : [row.id],
    )
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives a category without a usable colour one, rather than refusing to open', () => {
    const category = { id: 'k1', kind: 'category', text: 'Kilder', ideas: [] }
    for (const broken of [category, { ...category, color: 'papayawhip' }]) {
      const result = migratePresentation({ ...sample(), ideas: [broken] })
      expect(result.ok).toBe(true)
      if (!result.ok || !result.value) continue
      const repaired = result.value.ideas[0]
      expect(repaired.kind === 'category' ? repaired.color : null).toMatch(/^#[0-9a-f]{6}$/)
      // The note the heading stood over is untouched by the repair.
      expect(repaired.text).toBe('Kilder')
    }
  })

  it('passes a current-version document straight through', () => {
    const result = migratePresentation(sample())
    expect(result.ok).toBe(true)
  })

  it('gives a pre-cover presentation a cover, titled with the deck it belongs to', () => {
    const presentation = sample()
    const stored = JSON.parse(JSON.stringify(presentation)) as Record<string, unknown>
    stored.schemaVersion = 7
    delete stored.cover

    const result = migratePresentation(stored)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docToPlainText(result.value.cover.title).trim()).toBe('Prøve')
    expect(docToPlainText(result.value.cover.subtitle).trim()).toBe('')
    expect(result.value.cover.pillColor).toBe(DEFAULT_PILL_COLOR)
  })

  it('rebuilds a cover that is missing from a current-version document', () => {
    const { cover: _cover, ...withoutCover } = sample()
    const result = migratePresentation(withoutCover)
    // No migration runs at the current version, so `repairPresentation` is the
    // only thing between a stripped field and an unopenable presentation.
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docToPlainText(result.value.cover.title).trim()).toBe('Prøve')
  })

  it('lets a heading that only ever had the default colour follow the cover again', () => {
    const presentation = sample()
    const stored = JSON.parse(JSON.stringify(presentation)) as Record<string, unknown>
    stored.schemaVersion = 7
    delete stored.cover
    const slides = stored.slides as Array<Record<string, unknown>>
    const root = slides[0].root as { children: Array<Record<string, unknown>> }
    const leaf = root.children[0] as { content: Record<string, unknown> }
    const body = leaf.content.body as { subfields: Array<{ doc: RichDoc }> }
    body.subfields[0].doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1, color: DEFAULT_PILL_COLOR },
          content: [{ type: 'text', text: 'Arvet' }],
        },
        {
          type: 'heading',
          attrs: { level: 1, color: '#a64d79' },
          content: [{ type: 'text', text: 'Valgt' }],
        },
      ],
    }

    const result = migratePresentation(stored)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const migrated = result.value.slides[0].root
    if (migrated.kind !== 'split') throw new Error('expected a split')
    const first = migrated.children[0]
    if (first.kind !== 'leaf' || first.content?.kind !== 'untitled-card') {
      throw new Error('expected a card leaf')
    }
    const headings = first.content.body.subfields[0].doc.content ?? []
    // The one nobody chose loses its colour and takes the cover's; the one that
    // was picked keeps exactly what it was given.
    expect(headings[0].attrs).not.toHaveProperty('color')
    expect(headings[1].attrs?.color).toBe('#a64d79')
  })

  it('refuses documents from a newer schema version', () => {
    const result = migratePresentation({ ...sample(), schemaVersion: 99 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('nyere format')
  })

  it('turns a stored figure into an empty text container', () => {
    const presentation = sample()
    const stored = JSON.parse(JSON.stringify(presentation)) as Record<string, unknown>
    stored.schemaVersion = 2
    const slides = stored.slides as Array<Record<string, unknown>>
    const root = slides[0].root as { children: Array<Record<string, unknown>> }
    root.children[1] = {
      ...root.children[1],
      content: {
        id: 'content-figure',
        kind: 'container',
        payload: { type: 'shape', shape: { kind: 'ellipse', fill: '#bfccd9' } },
      },
    }

    const result = migratePresentation(stored)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const migrated = result.value.slides[0].root
    if (migrated.kind !== 'split') throw new Error('expected a split')
    const leaf = migrated.children[1]
    if (leaf.kind !== 'leaf' || leaf.content?.kind !== 'container') {
      throw new Error('expected a container leaf')
    }
    expect(leaf.content.payload.type).toBe('fields')
  })

  it('drops an inline figure from a stored document', () => {
    const presentation = sample()
    const stored = JSON.parse(JSON.stringify(presentation)) as Record<string, unknown>
    stored.schemaVersion = 2
    const slides = stored.slides as Array<Record<string, unknown>>
    const root = slides[0].root as { children: Array<Record<string, unknown>> }
    const leaf = root.children[0] as { content: Record<string, unknown> }
    const body = leaf.content.body as { subfields: Array<{ doc: RichDoc }> }
    body.subfields[0].doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Beholdes' }] },
        { type: 'slaidsShape', attrs: { kind: 'ellipse', height: 160 } },
      ],
    }

    const result = migratePresentation(stored)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(result.value)).not.toContain('slaidsShape')
    expect(JSON.stringify(result.value)).toContain('Beholdes')
  })

  it("turns a container's document into a single subfield", () => {
    const presentation = sample()
    const stored = JSON.parse(JSON.stringify(presentation)) as Record<string, unknown>
    stored.schemaVersion = 3
    const slides = stored.slides as Array<Record<string, unknown>>
    const root = slides[0].root as { children: Array<Record<string, unknown>> }
    root.children[1] = {
      ...root.children[1],
      content: {
        id: 'content-text',
        kind: 'container',
        verticalAlign: 'middle',
        payload: { type: 'richdoc', doc: paragraphDoc('Beholdertekst') },
      },
    }

    const result = migratePresentation(stored)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const migrated = result.value.slides[0].root
    if (migrated.kind !== 'split') throw new Error('expected a split')
    const leaf = migrated.children[1]
    if (leaf.kind !== 'leaf' || leaf.content?.kind !== 'container') {
      throw new Error('expected a container leaf')
    }
    const payload = leaf.content.payload
    if (payload.type !== 'fields') throw new Error('expected a fields payload')
    expect(payload.body.subfields).toHaveLength(1)
    expect(JSON.stringify(payload.body.subfields[0].doc)).toContain('Beholdertekst')
    // The container's own alignment belongs to the field it became.
    expect(payload.body.subfields[0].verticalAlign).toBe('middle')
    expect(leaf.content.verticalAlign).toBeUndefined()
  })

  it('gives an older theme the two scales at their neutral value', () => {
    const presentation = sample()
    const stored = JSON.parse(JSON.stringify(presentation)) as Record<string, unknown>
    stored.schemaVersion = 4
    const theme = stored.theme as Record<string, unknown>
    delete theme.spacing
    delete theme.fontScale

    const result = migratePresentation(stored)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The migration fills in the neutral multiplier — what the deck already
    // looked like — and the repair then clamps it into the range the theme
    // still offers, which has since moved past it. Both steps are deliberate:
    // one is a fact about the document, the other a decision about the ladder.
    expect(NEUTRAL_SCALE).toBeLessThan(SPACING_RANGE.min)
    expect(result.value.theme.spacing).toBe(SPACING_RANGE.min)
    expect(result.value.theme.fontScale).toBe(FONT_SCALE_RANGE.min)
  })

  it('repairs a theme scale that is out of range rather than refusing the file', () => {
    const presentation = sample()
    const result = migratePresentation({
      ...presentation,
      theme: { ...presentation.theme, spacing: 99, fontScale: -1 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.theme.spacing).toBeLessThanOrEqual(SPACING_RANGE.max)
    expect(result.value.theme.fontScale).toBeGreaterThanOrEqual(FONT_SCALE_RANGE.min)
  })

  it('reports invalid data instead of throwing', () => {
    expect(migratePresentation(null).ok).toBe(false)
    expect(migratePresentation('nope').ok).toBe(false)
    expect(migratePresentation({ schemaVersion: 1 }).ok).toBe(false)
  })
})

describe('clipboard payload', () => {
  it('accepts a well-formed payload', () => {
    const result = validateClipboardPayload({
      format: 'application/x-slaids-content',
      version: 1,
      content: createUntitledCard(),
      assets: [],
    })
    expect(result.ok).toBe(true)
  })

  it('rejects a foreign payload', () => {
    expect(validateClipboardPayload({ format: 'text/html', version: 1 }).ok).toBe(false)
    expect(validateClipboardPayload({}).ok).toBe(false)
  })
})

describe('repair on load', () => {
  it('rescues a presentation whose theme colour became invalid', () => {
    const presentation = sample()
    const broken = {
      ...presentation,
      theme: { ...presentation.theme, backgroundColor: 'rgb(1,2,3)' },
    }
    expect(validatePresentation(broken).ok).toBe(false)

    const result = migratePresentation(broken)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.theme.backgroundColor).toBe('#667788')
  })

  it('rescues an invalid card colour', () => {
    const presentation = sample()
    const card = createUntitledCard()
    const broken = {
      ...presentation,
      slides: [
        {
          ...presentation.slides[0],
          root: createLeaf({ ...card, backgroundColor: 'papayawhip' }),
        },
      ],
    }
    const result = migratePresentation(broken)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const content = (result.value.slides[0].root as { content: typeof card }).content
      expect(content.backgroundColor).toBe('#ffffff')
    }
  })

  it('rescues an empty font stack', () => {
    const presentation = sample()
    const result = migratePresentation({
      ...presentation,
      theme: { ...presentation.theme, bodyFontFamily: '   ' },
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.theme.bodyFontFamily.length).toBeGreaterThan(0)
  })

  it('still rejects structural corruption instead of rewriting it', () => {
    const presentation = sample()
    const broken = {
      ...presentation,
      slides: [
        { ...presentation.slides[0], root: { ...presentation.slides[0].root, weights: [1] } },
      ],
    }
    expect(migratePresentation(broken).ok).toBe(false)
  })
})
