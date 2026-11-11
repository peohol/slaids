import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createUntitledCard } from '../domain/content'
import { fitContextFor } from '../domain/commands'
import { estimateFitChecker } from '../domain/fit'
import { computeLayoutRects, computeMainRect } from '../domain/geometry'
import { createLeaf, createSplit } from '../domain/layout'
import { geometryForTheme } from '../domain/metrics'
import { createPresentation } from '../domain/presentation'
import { contentAt, sectionAt } from '../domain/testDecks'
import type { CitationStyle } from '../domain/references'
import type { Presentation, Rect, RichDoc } from '../domain/types'
import { SlaidsDatabase } from '../persistence/db'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import { runOperation } from './registry'
import { docToBlocks } from './text'

let database: SlaidsDatabase

beforeEach(() => {
  database = new SlaidsDatabase('slaids-reference-fit')
})

afterEach(async () => {
  await database.delete()
})

function fullDeck(style: CitationStyle, targetRect?: Rect) {
  const base: Presentation = {
    ...createPresentation({ title: 'Full sone', firstSlideHasTitle: false }),
    references: [{ id: 'r_kilde', title: 'Kilde', authors: 'Hansen', year: '2024', url: '' }],
  }
  const card = createUntitledCard()
  const contentFor = (length: number) => {
    const doc: RichDoc = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'x'.repeat(length) || 'x' },
          ...Array.from({ length: 30 }, () => [
            { type: 'text', text: ' x' },
            { type: 'citation', attrs: { referenceIds: ['r_kilde'] } },
          ]).flat(),
        ],
      }],
    }
    return { ...card, body: { ...card.body, subfields: [{ ...card.body.subfields[0], doc }] } }
  }
  const rect = targetRect ?? computeMainRect(false, geometryForTheme(base.theme))
  const context = fitContextFor({
    ...base,
    slides: [sectionAt(base, 0), { ...contentAt(base, 1), root: createLeaf(contentFor(1)) }],
  }, style)
  let low = 1
  let high = 20000
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (estimateFitChecker(contentFor(middle), rect, context).fits) low = middle
    else high = middle
  }
  expect(estimateFitChecker(contentFor(low), rect, context).fits).toBe(true)
  expect(estimateFitChecker(contentFor(low + 1), rect, context).fits).toBe(false)
  const content = contentFor(low)
  const slide = { ...contentAt(base, 1), root: createLeaf(content) }
  const presentation: Presentation = { ...base, slides: [sectionAt(base, 0), slide] }
  return { presentation, slide, content, rect }
}

describe('agentens henvisningsformat', () => {
  it('avviser et lengre forfatternavn når henvisningen ville skyve tekst ut av en full sone', async () => {
    const repository = new DexieSlaidsRepository(database)
    const { presentation: full } = fullDeck('author-year')
    await repository.savePresentation(full)
    await repository.updateUserSettings(null, { citationStyle: 'author-year' })

    const result = await runOperation({ repository }, 'update_reference', {
      presentationId: full.id,
      referenceId: 'r_kilde',
      title: 'Kilde',
      authors: 'Et mye lengre forfatternavn som krever mer plass i hver eneste henvisning',
      year: '2025',
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'CONTENT_DOES_NOT_FIT' } })
    expect(await repository.loadPresentation(full.id)).toEqual(full)
  })

  it('bruker formatet i tekstskriving, inspeksjon og validering, og leser et endret valg på neste kall', async () => {
    const repository = new DexieSlaidsRepository(database)
    const { presentation, slide, content, rect } = fullDeck('numbered')
    expect(estimateFitChecker(content, rect, fitContextFor(presentation, 'author-year')).fits).toBe(false)
    const empty: Presentation = {
      ...presentation,
      slides: [presentation.slides[0], {
        ...slide,
        root: { ...slide.root, content: createUntitledCard() },
      }],
    }
    await repository.savePresentation(empty)
    await repository.updateUserSettings(null, { citationStyle: 'author-year' })
    const context = { repository }
    const input = {
      presentationId: presentation.id,
      slideId: slide.id,
      nodeId: slide.root.id,
      blocks: docToBlocks(content.body.subfields[0].doc),
    }
    expect(await runOperation(context, 'set_zone_text', input)).toMatchObject({
      ok: false, error: { code: 'CONTENT_DOES_NOT_FIT' },
    })
    expect(await repository.loadPresentation(presentation.id)).toEqual(empty)

    await repository.updateUserSettings(null, { citationStyle: 'numbered' })
    expect(await runOperation(context, 'set_zone_text', input)).toMatchObject({ ok: true })
    await repository.updateUserSettings(null, { citationStyle: 'author-year' })
    for (const operation of ['validate_slide', 'validate_presentation']) {
      const target = operation === 'validate_slide'
        ? { presentationId: presentation.id, slideId: slide.id }
        : { presentationId: presentation.id }
      expect(await runOperation(context, operation, target)).toMatchObject({
        ok: true,
        value: { valid: false, issues: expect.arrayContaining([
          expect.objectContaining({ code: 'CONTENT_DOES_NOT_FIT' }),
        ]) },
      })
    }
    expect(await runOperation(context, 'inspect_slide', {
      presentationId: presentation.id, slideId: slide.id,
    })).toMatchObject({
      ok: true,
      value: { zones: expect.arrayContaining([expect.objectContaining({ fits: false })]) },
    })
    expect(context).not.toHaveProperty('userSettings')
  })

  it('bruker formatet når sonen deles', async () => {
    const repository = new DexieSlaidsRepository(database)
    const base = createPresentation({ title: 'Deling', firstSlideHasTitle: false })
    const geometry = geometryForTheme(base.theme)
    const split = createSplit('x', [1, 1], [createLeaf(), createLeaf()])
    const rect = computeLayoutRects(split, computeMainRect(false, geometry), geometry.gap).get(split.children[0].id)
    if (!rect) throw new Error('Fant ikke den første subsonen.')
    const { presentation, slide, content } = fullDeck('numbered', rect)
    expect(estimateFitChecker(content, rect, fitContextFor(presentation, 'author-year')).fits).toBe(false)
    await repository.savePresentation(presentation)
    await repository.updateUserSettings(null, { citationStyle: 'author-year' })
    const input = {
      presentationId: presentation.id, slideId: slide.id, nodeId: slide.root.id,
      axis: 'x', weights: [1, 1], contentFallback: 'delete',
    }
    expect(await runOperation({ repository }, 'split_zone', input)).toMatchObject({
      ok: false, error: { code: 'CONTENT_DOES_NOT_FIT' },
    })
    expect(await repository.loadPresentation(presentation.id)).toEqual(presentation)
    await repository.updateUserSettings(null, { citationStyle: 'numbered' })
    expect(await runOperation({ repository }, 'split_zone', input)).toMatchObject({ ok: true })
  })
})
