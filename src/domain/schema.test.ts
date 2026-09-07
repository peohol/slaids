import { describe, expect, it } from 'vitest'
import {
  CURRENT_SCHEMA_VERSION,
  validateClipboardPayload,
  validateLayoutTemplate,
  validatePresentation,
} from './schema'
import { detectSchemaVersion, migratePresentation } from './migrations'
import { createInteractiveSlide, createPresentation } from './presentation'
import { createTitledCard, createUntitledCard } from './content'
import { docToPlainText, paragraphDoc, titleDoc } from './richdoc'
import {
  DEFAULT_PILL_COLOR,
  MAX_INTERACTIVE_HTML_BYTES,
  MAX_INTERACTIVE_HTML_TOTAL_BYTES,
} from './constants'
import { FONT_SCALE_RANGE, NEUTRAL_SCALE, SPACING_RANGE } from './metrics'
import { createLeaf, createSplit } from './layout'
import type { Presentation, RichDoc } from './types'
import { contentAt, htmlOfBytes, interactiveAt, sectionAt } from './testDecks'

function sample(): Presentation {
  const presentation = createPresentation({ title: 'Prøve' })
  return {
    ...presentation,
    slides: [
      sectionAt(presentation, 0),
      {
        ...contentAt(presentation, 1),
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
        sectionAt(presentation, 0),
        {
          ...contentAt(presentation, 1),
          root: { ...contentAt(presentation, 1).root, weights: [1] },
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
        sectionAt(presentation, 0),
        {
          ...contentAt(presentation, 1),
          root: { id: 'x', kind: 'leaf', content: null, children: [createLeaf()] },
        },
      ],
    }
    // Extra keys are stripped rather than accepted as a split, so the tree stays a leaf.
    const result = validatePresentation(broken)
    expect(result.ok).toBe(true)
    expect(contentAt(result.value!, 1).root.kind).toBe('leaf')
    expect('children' in contentAt(result.value!, 1).root).toBe(false)
  })

  it('rejects zero and negative weights', () => {
    const presentation = sample()
    for (const weights of [[0, 1], [-1, 1]]) {
      const broken = {
        ...presentation,
        slides: [sectionAt(presentation, 0),{ ...contentAt(presentation, 1), root: { ...contentAt(presentation, 1).root, weights } }],
      }
      expect(validatePresentation(broken).ok).toBe(false)
    }
  })

  it('rejects a presentation with no slides', () => {
    expect(validatePresentation({ ...sample(), slides: [] }).ok).toBe(false)
  })

  it('rejects an invalid section colour', () => {
    const presentation = sample()
    const broken = {
      ...presentation,
      slides: [
        { ...sectionAt(presentation, 0), backgroundColor: 'blue' },
        ...presentation.slides.slice(1),
      ],
    }
    expect(validatePresentation(broken).ok).toBe(false)
  })

  it('rejects a deck whose first slide is not a section', () => {
    const presentation = sample()
    expect(validatePresentation({ ...presentation, slides: presentation.slides.slice(1) }).ok).toBe(
      false,
    )
  })
})

/**
 * `sample()` as a document written before sections existed.
 *
 * The front page was a `cover` field beside the slides, the slides carried no
 * `kind`, and the deck had one background colour in its theme. Every migration
 * test below starts from *that* shape rather than from today's, because a
 * migration is only interesting on a document that actually needs it.
 */
function legacySample(version: number): Record<string, unknown> {
  const presentation = sample()
  const raw = JSON.parse(JSON.stringify(presentation)) as Record<string, unknown>
  raw.schemaVersion = version
  raw.theme = { ...(raw.theme as Record<string, unknown>), backgroundColor: '#ffffff' }
  raw.slides = (raw.slides as Array<Record<string, unknown>>).slice(1).map((slide) => {
    const { kind: _kind, ...rest } = slide
    return rest
  })
  return raw
}

describe('migrations', () => {
  it('detects the version of an unversioned document as 0', () => {
    expect(detectSchemaVersion({ id: 'x' })).toBe(0)
    expect(detectSchemaVersion({ schemaVersion: 1 })).toBe(1)
  })

  it('migrates an unversioned document up to the current version', () => {
    const legacy = legacySample(0)
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
      ...legacySample(6),
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
      ...legacySample(6),
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

  it('gives a pre-section presentation a front page, titled with the deck it belongs to', () => {
    // A document from before either the cover or sections existed: the front
    // page is rebuilt from the deck's own name, exactly as it always was, and
    // it arrives as the first slide rather than as a field beside them.
    const stored = legacySample(7)

    const result = migratePresentation(stored)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const front = sectionAt(result.value, 0)
    expect(docToPlainText(front.title).trim()).toBe('Prøve')
    expect(docToPlainText(front.subtitle).trim()).toBe('')
    expect(front.accentColor).toBe(DEFAULT_PILL_COLOR)
  })

  it('turns a stored cover into the deck’s first section, colours and all', () => {
    // The version-12 shape: a `cover` beside the slides, and one background
    // colour in the theme. Both move onto the section this creates, so a
    // migrated deck is drawn exactly as it was.
    const stored = legacySample(12)
    stored.cover = {
      title: titleDoc('Forsiden'),
      subtitle: titleDoc('Undertittel'),
      pillColor: '#a64d79',
    }
    stored.theme = { ...(stored.theme as Record<string, unknown>), backgroundColor: '#101828' }

    const result = migratePresentation(stored)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const front = sectionAt(result.value, 0)
    expect(docToPlainText(front.title).trim()).toBe('Forsiden')
    expect(docToPlainText(front.subtitle).trim()).toBe('Undertittel')
    expect(front.accentColor).toBe('#a64d79')
    expect(front.backgroundColor).toBe('#101828')
    expect(result.value.slides[1].kind).toBe('content')
    expect('backgroundColor' in result.value.theme).toBe(false)
  })

  it('rebuilds a front page that is missing from a current-version document', () => {
    const presentation = sample()
    const withoutFront = { ...presentation, slides: presentation.slides.slice(1) }
    const result = migratePresentation(withoutFront)
    // No migration runs at the current version, so `repairPresentation` is the
    // only thing between a stripped page and an unopenable presentation.
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(docToPlainText(sectionAt(result.value, 0).title).trim()).toBe('Prøve')
  })

  it('lets a heading that only ever had the default colour follow the cover again', () => {
    const stored = legacySample(7)
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
    const migrated = contentAt(result.value, 1).root
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

  it('lets a titled card that only ever had the default header colour follow the cover again', () => {
    const stored = legacySample(8)
    const slides = stored.slides as Array<Record<string, unknown>>
    const root = slides[0].root as { children: Array<Record<string, unknown>> }
    root.children[0] = { ...root.children[0], content: createTitledCard('Arvet', DEFAULT_PILL_COLOR) }
    root.children[1] = { ...root.children[1], content: createTitledCard('Valgt', '#a64d79') }

    const result = migratePresentation(stored)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const migrated = contentAt(result.value, 1).root
    if (migrated.kind !== 'split') throw new Error('expected a split')
    const [first, second] = migrated.children
    if (first.kind !== 'leaf' || first.content?.kind !== 'titled-card') {
      throw new Error('expected a titled-card leaf')
    }
    if (second.kind !== 'leaf' || second.content?.kind !== 'titled-card') {
      throw new Error('expected a titled-card leaf')
    }
    // The one nobody chose loses its colour and takes the cover's; the one
    // that was picked keeps exactly what it was given.
    expect(first.content.headerColor).toBeNull()
    expect(second.content.headerColor).toBe('#a64d79')
  })

  it('refuses documents from a newer schema version', () => {
    const result = migratePresentation({ ...sample(), schemaVersion: 99 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('nyere format')
  })

  it('turns a stored figure into an empty text container', () => {
    const stored = legacySample(2)
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
    const migrated = contentAt(result.value, 1).root
    if (migrated.kind !== 'split') throw new Error('expected a split')
    const leaf = migrated.children[1]
    if (leaf.kind !== 'leaf' || leaf.content?.kind !== 'container') {
      throw new Error('expected a container leaf')
    }
    expect(leaf.content.body.subfields).toHaveLength(1)
  })

  it('drops an inline figure from a stored document', () => {
    const stored = legacySample(2)
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
    const stored = legacySample(3)
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
    const migrated = contentAt(result.value, 1).root
    if (migrated.kind !== 'split') throw new Error('expected a split')
    const leaf = migrated.children[1]
    if (leaf.kind !== 'leaf' || leaf.content?.kind !== 'container') {
      throw new Error('expected a container leaf')
    }
    const body = leaf.content.body
    expect(body.subfields).toHaveLength(1)
    expect(JSON.stringify(body.subfields[0].doc)).toContain('Beholdertekst')
    // The container's own alignment belongs to the field it became.
    expect(body.subfields[0].verticalAlign).toBe('middle')
  })

  it('lifts a picture out of the container it used to hide in', () => {
    const stored = legacySample(9)
    const slides = stored.slides as Array<Record<string, unknown>>
    const root = slides[0].root as { children: Array<Record<string, unknown>> }
    root.children[1] = {
      ...root.children[1],
      content: {
        id: 'content-bilde',
        kind: 'container',
        // `contain` no longer exists: a picture in a zone now always fills it.
        verticalAlign: 'bottom',
        payload: { type: 'asset', assetId: 'a1', fit: 'contain' },
      },
    }

    const result = migratePresentation(stored)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const migrated = contentAt(result.value, 1).root
    if (migrated.kind !== 'split') throw new Error('expected a split')
    const leaf = migrated.children[1]
    if (leaf.kind !== 'leaf' || leaf.content?.kind !== 'image') {
      throw new Error('expected a picture leaf')
    }
    expect(leaf.content.image.assetId).toBe('a1')
    // The container's alignment said which part of the file to frame, so that
    // is what it becomes rather than being dropped.
    expect(leaf.content.image.focus).toEqual({ x: 0.5, y: 1 })
    expect(leaf.content.image.caption).toBeNull()
  })

  it('unwraps a text container without touching what is in it', () => {
    const stored = legacySample(9)
    const slides = stored.slides as Array<Record<string, unknown>>
    const root = slides[0].root as { children: Array<Record<string, unknown>> }
    root.children[1] = {
      ...root.children[1],
      content: {
        id: 'content-tekst',
        kind: 'container',
        payload: {
          type: 'fields',
          body: {
            axis: 'x',
            weights: [2, 1],
            subfields: [
              { id: 'f1', doc: paragraphDoc('Venstre') },
              { id: 'f2', doc: paragraphDoc('Høyre'), verticalAlign: 'bottom' },
            ],
          },
        },
      },
    }

    const result = migratePresentation(stored)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const migrated = contentAt(result.value, 1).root
    if (migrated.kind !== 'split') throw new Error('expected a split')
    const leaf = migrated.children[1]
    if (leaf.kind !== 'leaf' || leaf.content?.kind !== 'container') {
      throw new Error('expected a container leaf')
    }
    expect(leaf.content.body.axis).toBe('x')
    expect(leaf.content.body.weights).toEqual([2, 1])
    expect(leaf.content.body.subfields.map((field) => field.id)).toEqual(['f1', 'f2'])
    expect(leaf.content.body.subfields[1].verticalAlign).toBe('bottom')
  })

  it('gives an older theme the two scales at their neutral value', () => {
    const stored = legacySample(4)
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
  it('rescues a presentation whose section colour became invalid', () => {
    const presentation = sample()
    const broken = {
      ...presentation,
      slides: [
        { ...sectionAt(presentation, 0), backgroundColor: 'rgb(1,2,3)' },
        ...presentation.slides.slice(1),
      ],
    }
    expect(validatePresentation(broken).ok).toBe(false)

    const result = migratePresentation(broken)
    expect(result.ok).toBe(true)
    if (result.ok) expect(sectionAt(result.value, 0).backgroundColor).toBe('#ffffff')
  })

  it('rescues an invalid card colour', () => {
    const presentation = sample()
    const card = createUntitledCard()
    const broken = {
      ...presentation,
      slides: [
        sectionAt(presentation, 0),
        {
          ...contentAt(presentation, 1),
          root: createLeaf({ ...card, backgroundColor: 'papayawhip' }),
        },
      ],
    }
    const result = migratePresentation(broken)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const content = (contentAt(result.value, 1).root as { content: typeof card }).content
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
        sectionAt(presentation, 0),
        { ...contentAt(presentation, 1), root: { ...contentAt(presentation, 1).root, weights: [1] } },
      ],
    }
    expect(migratePresentation(broken).ok).toBe(false)
  })
})


/**
 * Whole zone ratios, coming and going.
 *
 * The rule arrived after decks had already been saved, so the two halves are
 * tested together: a stored deck written the old way is *kept* — rewritten in
 * the ratio closest to what it described — while a document at the current
 * version cannot claim anything else.
 */
describe('zone ratios in stored data', () => {
  /* Version 11: the last one written before whole ratios were the rule, and so
     the only one `migrate11to12` has anything to quantise on. Named rather than
     derived from `CURRENT_SCHEMA_VERSION`, because it is a fact about when the
     rule arrived and not about where the chain happens to end today. */
  const DECIMAL_RATIO_VERSION = 11

  const storedWithWeights = (
    weights: number[],
    version = DECIMAL_RATIO_VERSION,
  ): Record<string, unknown> => {
    const stored = legacySample(version)
    const slides = stored.slides as Array<Record<string, unknown>>
    const root = slides[0].root as Record<string, unknown>
    root.weights = weights
    return stored
  }

  it('rewrites a deck stored with decimal ratios into whole ones', () => {
    const result = migratePresentation(storedWithWeights([0.3125, 0.6875]))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const root = contentAt(result.value, 1).root
    if (root.kind !== 'split') throw new Error('expected a split')
    // 0.3125 : 0.6875 is 5 : 11 exactly, and 11 is off the ladder. 4 : 9 is
    // the closest layout that can be written down — nearer than 5 : 10, which
    // is what rounding the numbers rather than the distribution would give.
    expect(root.weights).toEqual([4, 9])
    expect(result.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('keeps a layout that was already expressible exactly as it looked', () => {
    const stored = storedWithWeights([1.5, 2.5, 1.5])
    const slides = stored.slides as Array<Record<string, unknown>>
    const root = slides[0].root as { children: unknown[] }
    root.children = [...root.children, { id: 'third', kind: 'leaf', content: null }]
    const result = migratePresentation(stored)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const migrated = contentAt(result.value, 1).root
    if (migrated.kind !== 'split') throw new Error('expected a split')
    expect(migrated.weights).toEqual([3, 5, 3])
  })

  it('leaves a split whose shape is broken for validation to refuse', () => {
    // Two weights, three children: a migration that "fixed" this would be
    // rebuilding a slide rather than rewriting a number.
    const stored = storedWithWeights([0.5, 0.25])
    const slides = stored.slides as Array<Record<string, unknown>>
    const root = slides[0].root as { children: unknown[] }
    root.children = [...root.children, { id: 'extra', kind: 'leaf', content: null }]
    expect(migratePresentation(stored).ok).toBe(false)
  })

  it('refuses rather than throws on ratios that cannot be read at all', () => {
    // Individually finite, but their sum is not, so there is no distribution to
    // rewrite. The migration has to leave it be and let validation answer.
    const result = migratePresentation(storedWithWeights([1e308, 1e308]))
    expect(result.ok).toBe(false)
  })

  it('refuses a current-version document whose ratios are not whole numbers', () => {
    for (const weights of [[0.5, 1], [0, 1], [-1, 2], [1, 11], [1.5, 2]]) {
      const broken = JSON.parse(JSON.stringify(sample())) as Record<string, unknown>
      const slides = broken.slides as Array<Record<string, unknown>>
      ;(slides[1].root as Record<string, unknown>).weights = weights
      expect(validatePresentation(broken).ok, weights.join(':')).toBe(false)
    }
  })

  it('accepts every whole ratio on the ladder', () => {
    for (const weights of [[1, 1], [1, 10], [10, 1], [7, 3]]) {
      const deck = JSON.parse(JSON.stringify(sample())) as Record<string, unknown>
      const slides = deck.slides as Array<Record<string, unknown>>
      ;(slides[1].root as Record<string, unknown>).weights = weights
      expect(validatePresentation(deck).ok, weights.join(':')).toBe(true)
    }
  })

  it('brings a template saved before the rule up to it instead of dropping it', () => {
    const template = {
      id: 't_1',
      name: 'To spalter',
      hasTitle: true,
      root: {
        id: 'root',
        kind: 'split',
        axis: 'x',
        weights: [0.4, 0.6],
        children: [
          { id: 'a', kind: 'leaf', content: null },
          { id: 'b', kind: 'leaf', content: null },
        ],
      },
      createdAt: new Date().toISOString(),
    }
    // A template carries no schemaVersion, so validating it is the only place
    // the repair can happen — and it must repair rather than refuse, or the
    // template silently disappears from the list.
    const result = validateLayoutTemplate(template)
    expect(result.ok).toBe(true)
    const root = result.value?.root
    if (!root || root.kind !== 'split') throw new Error('expected a split')
    expect(root.weights).toEqual([2, 3])
  })
})

describe('en interaktiv slide i lagret form', () => {
  const APP =
    '<!doctype html><html><body><p>Blåbær 🙂</p><script>let n = 0; // </script</script></body></html>'

  function withApp(): Presentation {
    const presentation = sample()
    return {
      ...presentation,
      slides: [
        ...presentation.slides,
        createInteractiveSlide({ name: 'Teller', fileName: 'teller.html', html: APP }),
      ],
    }
  }

  function withSource(html: string): Record<string, unknown> {
    const presentation = withApp()
    return {
      ...presentation,
      slides: [...presentation.slides.slice(0, 2), { ...interactiveAt(presentation, 2), html }],
    }
  }

  it('valideres som den er, og leses tilbake byte for byte', () => {
    const presentation = withApp()
    const result = validatePresentation(JSON.parse(JSON.stringify(presentation)))
    expect(result.ok).toBe(true)
    if (!result.ok || !result.value) throw new Error('Dokumentet ble avvist.')
    expect(interactiveAt(result.value, 2)).toEqual(interactiveAt(presentation, 2))
  })

  it('avvises med en ukjent slide-type', () => {
    const presentation = withApp()
    const broken = {
      ...presentation,
      slides: [...presentation.slides.slice(0, 2), { ...interactiveAt(presentation, 2), kind: 'widget' }],
    }
    expect(validatePresentation(broken).ok).toBe(false)
  })

  it('avvises med en tom eller for stor kilde, og godtas på grensen', () => {
    expect(validatePresentation(withSource('')).ok).toBe(false)
    expect(validatePresentation(withSource(htmlOfBytes(MAX_INTERACTIVE_HTML_BYTES + 1))).ok).toBe(false)
    expect(validatePresentation(withSource(htmlOfBytes(MAX_INTERACTIVE_HTML_BYTES))).ok).toBe(true)
  })

  it('måler grensen i byte av UTF-8, ikke i tegn', () => {
    const html = htmlOfBytes(MAX_INTERACTIVE_HTML_BYTES + 3, 'æ')
    expect(html.length).toBeLessThan(MAX_INTERACTIVE_HTML_BYTES)
    expect(validatePresentation(withSource(html)).ok).toBe(false)
  })

  it('kan ikke stå først: forsiden er en seksjon også i lagret form', () => {
    const presentation = withApp()
    const broken = {
      ...presentation,
      slides: [interactiveAt(presentation, 2), ...presentation.slides.slice(0, 2)],
    }
    expect(validatePresentation(broken).ok).toBe(false)
  })

  /*
   * The rule this closes: a stored or imported document may not hold an
   * interactive slide the typed commands would have refused. A `.slaids`
   * archive is written by hand as easily as by Slaids, and it reaches the
   * repository without passing a command — so the load gate has to ask the
   * command's own question. See `storedInteractiveRefusal`.
   */
  it('avviser et navn, et filnavn eller en kilde kommandoene ville avvist', () => {
    const presentation = withApp()
    const bad = (fields: Record<string, unknown>): Record<string, unknown> => ({
      ...presentation,
      slides: [...presentation.slides.slice(0, 2), { ...interactiveAt(presentation, 2), ...fields }],
    })

    expect(validatePresentation(bad({ name: '   ' })).ok).toBe(false)
    expect(validatePresentation(bad({ name: 'x'.repeat(201) })).ok).toBe(false)
    expect(validatePresentation(bad({ fileName: 'teller.txt' })).ok).toBe(false)
    expect(validatePresentation(bad({ fileName: '  ' })).ok).toBe(false)
    expect(validatePresentation(bad({ html: '<p>x</p>\u0000' })).ok).toBe(false)
    expect(validatePresentation(bad({ html: 'bare tekst uten elementer' })).ok).toBe(false)

    // And the ones a command would have accepted still open.
    expect(validatePresentation(bad({ name: 'Et helt vanlig navn' })).ok).toBe(true)
    expect(validatePresentation(bad({ fileName: 'QUIZ.HTML' })).ok).toBe(true)
  })

  it('avviser et dekk som holder mer miniapp-kilde enn budsjettet, uansett hvordan det ble skrevet', () => {
    // Every file inside the per-file limit, the deck as a whole outside the
    // budget: exactly the document a hand-written archive can hold and no
    // command can produce.
    const presentation = sample()
    const count = Math.floor(MAX_INTERACTIVE_HTML_TOTAL_BYTES / MAX_INTERACTIVE_HTML_BYTES) + 1
    const overBudget = {
      ...presentation,
      slides: [
        ...presentation.slides,
        ...Array.from({ length: count }, (_, index) =>
          createInteractiveSlide({
            name: `App ${index}`,
            fileName: `app-${index}.html`,
            html: htmlOfBytes(MAX_INTERACTIVE_HTML_BYTES),
          }),
        ),
      ],
    }
    const result = validatePresentation(overBudget)
    expect(result.ok).toBe(false)
    expect(result.issues.some((issue) => /budsjett|plass/i.test(issue.message))).toBe(true)

    // One file fewer is the same deck within the budget, and it opens.
    expect(
      validatePresentation({ ...overBudget, slides: overBudget.slides.slice(0, -1) }).ok,
    ).toBe(true)
  })

  it('åpner et dokument fra før typen fantes, uendret, som gjeldende versjon', () => {
    const stored = { ...sample(), schemaVersion: 13 }
    const result = migratePresentation(JSON.parse(JSON.stringify(stored)))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(result.value.slides).toEqual(stored.slides)
  })

  it('bærer en interaktiv slide gjennom migreringskjeden uten å røre kilden', () => {
    const presentation = withApp()
    const result = migratePresentation(JSON.parse(JSON.stringify(presentation)))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(interactiveAt(result.value, 2).html).toBe(APP)
  })
})
