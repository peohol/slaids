import { afterEach, describe, expect, it } from 'vitest'
import { createUntitledCard } from '../domain/content'
import { fitContextFor } from '../domain/commands'
import { estimateFitChecker } from '../domain/fit'
import { computeMainRect } from '../domain/geometry'
import { createLeaf } from '../domain/layout'
import { geometryForTheme } from '../domain/metrics'
import { createPresentation } from '../domain/presentation'
import { contentAt, sectionAt } from '../domain/testDecks'
import type { Presentation, RichDoc } from '../domain/types'
import { SlaidsDatabase } from '../persistence/db'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import { runOperation } from './registry'

const database = new SlaidsDatabase('slaids-reference-fit')

afterEach(async () => {
  await database.delete()
})

describe('agentens retting av referanser', () => {
  it('avviser et lengre forfatternavn når henvisningen ville skyve tekst ut av en full sone', async () => {
    const repository = new DexieSlaidsRepository(database)
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
              { type: 'text', text: ' ' },
              { type: 'citation', attrs: { referenceIds: ['r_kilde'] } },
            ]).flat(),
          ],
        }],
      }
      return { ...card, body: { ...card.body, subfields: [{ ...card.body.subfields[0], doc }] } }
    }
    const rect = computeMainRect(false, geometryForTheme(base.theme))
    const context = fitContextFor({
      ...base,
      slides: [sectionAt(base, 0), { ...contentAt(base, 1), root: createLeaf(contentFor(1)) }],
    }, 'author-year')
    let low = 1
    let high = 20000
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2)
      if (estimateFitChecker(contentFor(middle), rect, context).fits) low = middle
      else high = middle
    }
    expect(estimateFitChecker(contentFor(low), rect, context).fits).toBe(true)
    expect(estimateFitChecker(contentFor(low + 1), rect, context).fits).toBe(false)
    const full: Presentation = {
      ...base,
      slides: [sectionAt(base, 0), { ...contentAt(base, 1), root: createLeaf(contentFor(low)) }],
    }
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
})
