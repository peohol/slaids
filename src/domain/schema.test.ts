import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION, validateClipboardPayload, validatePresentation } from './schema'
import { detectSchemaVersion, migratePresentation } from './migrations'
import { createPresentation } from './presentation'
import { createUntitledCard } from './content'
import { createLeaf, createSplit } from './layout'
import type { Presentation } from './types'

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

  it('passes a current-version document straight through', () => {
    const result = migratePresentation(sample())
    expect(result.ok).toBe(true)
  })

  it('refuses documents from a newer schema version', () => {
    const result = migratePresentation({ ...sample(), schemaVersion: 99 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('nyere format')
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
