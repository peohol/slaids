/**
 * Agent Core, end to end.
 *
 * Everything here goes through `runOperation` against a real
 * `DexieSlaidsRepository`, for two reasons. The dispatch path is where an agent
 * actually enters — schema validation, defaults and error envelopes included —
 * so testing the functions directly would test something no caller uses. And
 * the claims worth making are about stored state ("nothing was written", "the
 * newer version is still there"), which a stub could only answer with "the
 * right method was called".
 *
 * The list of cases is the one in `IMPLEMENTATION_PLAN.md` §44, "Tester".
 */

import { afterEach, describe, expect, it } from 'vitest'
import { findLeaf } from '../domain/layout'
import { createPresentation } from '../domain/presentation'
import { docToPlainText } from '../domain/richdoc'
import { computeReferenceNumbering } from '../domain/references'
import { presentationRevision } from '../domain/revision'
import { SlaidsDatabase } from '../persistence/db'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import type { Presentation, Rect, ZoneContent } from '../domain/types'
import type { ZoneChange, ZoneContentMove } from './operations/layout'
import type { CoverView } from './operations/cover'
import type { PresentationView, SlideInspection, ZoneInspection } from './operations/deck'
import type { Mutated } from './presentation'
import type { SubfieldLayout } from './operations/content'
import type { SandboxItemView, SandboxPlacement } from './operations/sandbox'
import type { SlidePlacement } from './operations/slides'
import type { ValidationReport } from './operations/validation'
import { runOperation } from './registry'
import type { TextBlock } from './text'
import type { AgentContext, AgentError, AgentResult } from './types'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshContext(): AgentContext {
  counter += 1
  const database = new SlaidsDatabase(`slaids-workflow-${counter}`)
  databases.push(database)
  return { repository: new DexieSlaidsRepository(database) }
}

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

/** One typed call through the same door a REST route or an MCP tool would use. */
async function call<T>(
  context: AgentContext,
  name: string,
  input: Record<string, unknown> = {},
): Promise<AgentResult<T>> {
  return (await runOperation(context, name, input)) as AgentResult<T>
}

function expectOk<T>(result: AgentResult<T>): T {
  if (!result.ok) {
    throw new Error(`Forventet suksess, fikk ${result.error.code}: ${result.error.message}`)
  }
  return result.value
}

function expectErr(result: AgentResult<unknown>): AgentError {
  if (result.ok) throw new Error('Forventet en feil')
  return result.error
}

async function ok<T>(
  context: AgentContext,
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  return expectOk(await call<T>(context, name, input))
}

async function fails(
  context: AgentContext,
  name: string,
  input: Record<string, unknown> = {},
): Promise<AgentError> {
  return expectErr(await call(context, name, input))
}

/** A deck with one slide, created the way an agent would create one. */
async function newDeck(
  context: AgentContext,
  input: Record<string, unknown> = {},
): Promise<PresentationView> {
  return ok<PresentationView>(context, 'create_presentation', { title: 'Agentdekk', ...input })
}

function paragraph(text: string): TextBlock[] {
  return [{ type: 'paragraph', spans: [{ text }] }]
}

/**
 * The longest text this zone accepts, left in place.
 *
 * Bisected through the operation itself rather than computed from the
 * estimator's constants: what "full" means is whatever the fit checker says,
 * and a test that re-derives it would be testing its own arithmetic.
 */
async function fillToCapacity(
  context: AgentContext,
  target: { presentationId: string; slideId: string; nodeId: string },
  blocksFor: (text: string) => TextBlock[],
): Promise<number> {
  const accepts = async (length: number): Promise<boolean> => {
    const result = await call(context, 'set_zone_text', {
      ...target,
      blocks: blocksFor('x'.repeat(length)),
    })
    return result.ok
  }

  let low = 1
  let high = 20000
  if (!(await accepts(low))) throw new Error('Sonen tar ikke imot noe tekst i det hele tatt.')
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (await accepts(middle)) low = middle
    else high = middle
  }
  // End on the accepted state: the zone is now exactly full.
  await accepts(low)
  return low
}

/**
 * A paragraph of citation pills of one reference, separated so no two merge,
 * with a run of filler whose length the caller controls.
 *
 * The filler is one span of its own rather than a share of every pill's text,
 * and that is the point: these cases turn a one-digit label into a two-digit
 * one, which widens each pill by a fraction of a character. Spread across the
 * pills, one step of `fillToCapacity`'s search moved the paragraph by a whole
 * character *per pill* — several times the width the pills themselves gain — so
 * whether the change was caught came down to where the search happened to stop.
 * With the filler in one span, a step is one character and the pills' own
 * growth is the larger of the two.
 */
const PILL_COUNT = 30

function pillParagraph(referenceId: string, text: string): TextBlock[] {
  return [
    {
      type: 'paragraph',
      spans: [
        { text },
        ...Array.from({ length: PILL_COUNT }, () => [
          { text: 'x' },
          { citation: [referenceId] },
        ]).flat(),
      ],
    },
  ]
}

async function stored(context: AgentContext, presentationId: string): Promise<Presentation> {
  return context.repository.loadPresentation(presentationId)
}

/** What number a reference renders as, from the deck's own numbering. */
function citationNumber(presentation: Presentation, referenceId: string): number | undefined {
  return computeReferenceNumbering(presentation).get(referenceId)
}

function firstZone(inspection: SlideInspection): string {
  const leaf = inspection.zones.find((zone) => zone.kind === 'leaf')
  if (!leaf) throw new Error('Sliden har ingen bladsone.')
  return leaf.nodeId
}

/* ------------------------------------------------------------------ *
 * Building a deck
 * ------------------------------------------------------------------ */

describe('å bygge en presentasjon uten React', () => {
  it('oppretter en presentasjon og finner den igjen', async () => {
    const context = freshContext()
    const created = await newDeck(context, { title: 'Farmakologi' })

    expect(created.title).toBe('Farmakologi')
    expect(created.slideCount).toBe(1)
    expect(created.slides[0].hasTitle).toBe(true)

    const listed = await ok<{ presentations: { id: string }[] }>(context, 'list_presentations')
    expect(listed.presentations.map((entry) => entry.id)).toEqual([created.presentationId])

    // The same reading twice is the same revision: it describes the document,
    // not the moment it was read.
    const fetched = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: created.presentationId,
    })
    expect(fetched.revision).toBe(created.revision)
  })

  it('bygger en slide programmatisk: tittel, sone og tekst', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const added = await ok<SlidePlacement>(context, 'add_slide', {
      presentationId: deck.presentationId,
    })
    expect(added.index).toBe(1)
    expect(added.slideCount).toBe(2)

    await ok(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId: added.slideId,
      spans: [{ text: 'Virkningsmekanisme' }],
    })

    const inspection = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: added.slideId,
    })
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: added.slideId,
      nodeId: firstZone(inspection),
      blocks: [
        { type: 'heading', spans: [{ text: 'Kort fortalt' }] },
        { type: 'bullets', items: [[{ text: 'Binder reseptoren' }], [{ text: 'Halveringstid 6 t' }]] },
      ],
    })

    const after = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: added.slideId,
    })
    expect(after.title).toBe('Virkningsmekanisme')
    expect(after.titleSpans).toEqual([{ text: 'Virkningsmekanisme' }])

    // Read back in the same vocabulary it was written in: the agent never sees
    // the editor's own JSON.
    const zone = after.zones.find((entry) => entry.nodeId === firstZone(inspection))
    expect(zone?.subfields?.[0].blocks).toEqual([
      { type: 'heading', spans: [{ text: 'Kort fortalt' }] },
      { type: 'bullets', items: [[{ text: 'Binder reseptoren' }], [{ text: 'Halveringstid 6 t' }]] },
    ])
    expect(zone?.fits).toBe(true)
  })

  it('lar en agent duplisere, flytte og slette slides', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const first = deck.slides[0].slideId

    const copy = await ok<SlidePlacement>(context, 'duplicate_slide', {
      presentationId: deck.presentationId,
      slideId: first,
    })
    expect(copy.index).toBe(1)
    expect(copy.slideId).not.toBe(first)

    await ok(context, 'move_slide', {
      presentationId: deck.presentationId,
      slideId: copy.slideId,
      toIndex: 0,
    })
    const moved = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    expect(moved.slides.map((slide) => slide.slideId)).toEqual([copy.slideId, first])

    await ok(context, 'delete_slide', {
      presentationId: deck.presentationId,
      slideId: copy.slideId,
    })
    const left = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    expect(left.slides.map((slide) => slide.slideId)).toEqual([first])

    // The last slide is the domain's floor, and an agent meets it too.
    expect(
      (
        await fails(context, 'delete_slide', {
          presentationId: deck.presentationId,
          slideId: first,
        })
      ).code,
    ).toBe('CANNOT_DELETE_LAST_SLIDE')
  })
})

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - 0.001 &&
    inner.y >= outer.y - 0.001 &&
    inner.x + inner.width <= outer.x + outer.width + 0.001 &&
    inner.y + inner.height <= outer.y + outer.height + 0.001
  )
}

describe('layout', () => {
  it('deler en sone, og deler en av delene igjen', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const root = (
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      })
    ).rootNodeId

    const split = await ok<ZoneChange & { childNodeIds: string[] }>(context, 'split_zone', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: root,
      axis: 'x',
      weights: [2, 1],
    })
    expect(split.childNodeIds).toHaveLength(2)

    const nested = await ok<ZoneChange & { childNodeIds: string[] }>(context, 'split_zone', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: split.childNodeIds[1],
      axis: 'y',
      weights: [1, 1],
    })
    expect(nested.childNodeIds).toHaveLength(2)

    // The ids from one call address the zones in the next, and the geometry
    // that comes back is the geometry engine's own — children inside parents,
    // in the 1600 × 900 design space.
    const inspection = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    const rects = new Map(inspection.zones.map((zone) => [zone.nodeId, zone.rect]))
    const rootRect = rects.get(root)
    expect(rootRect).toBeDefined()
    for (const child of split.childNodeIds) {
      expect(contains(rootRect as Rect, rects.get(child) as Rect)).toBe(true)
    }
    for (const grandchild of nested.childNodeIds) {
      expect(contains(rects.get(split.childNodeIds[1]) as Rect, rects.get(grandchild) as Rect)).toBe(
        true,
      )
    }
    // The wider column is the one that asked for twice the weight.
    expect((rects.get(split.childNodeIds[0]) as Rect).width).toBeGreaterThan(
      (rects.get(split.childNodeIds[1]) as Rect).width,
    )
  })

  it('lar ingen omgå minstemålene for en sone', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const root = (
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      })
    ).rootNodeId

    const split = await ok<ZoneChange & { childNodeIds: string[] }>(context, 'split_zone', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: root,
      axis: 'x',
      weights: [1, 1, 1, 1],
    })

    const refused = await fails(context, 'split_zone', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: split.childNodeIds[0],
      axis: 'x',
      weights: [1, 1, 1],
    })
    expect(refused.code).toBe('ZONE_TOO_SMALL')
    expect(refused.details).toMatchObject({ slideId, nodeId: split.childNodeIds[0] })

    // Refused means refused: the tree is exactly what it was.
    const after = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    expect(after.zones.filter((zone) => zone.kind === 'leaf')).toHaveLength(4)
  })

  it('endrer forholdstall og antall subsoner, og tar vare på innhold som fortrenges', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const root = (
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      })
    ).rootNodeId

    const split = await ok<ZoneChange & { childNodeIds: string[] }>(context, 'split_zone', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: root,
      axis: 'x',
      weights: [1, 1, 1],
    })
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: split.childNodeIds[2],
      blocks: paragraph('Innhold i den siste kolonnen'),
    })

    const adjusted = await ok<ZoneChange & { childNodeIds: string[] }>(context, 'adjust_split', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: root,
      childCount: 2,
      weights: [3, 1],
    })
    expect(adjusted.childNodeIds).toHaveLength(2)
    expect(adjusted.movedToSandbox).toBe(1)
    expect((await stored(context, deck.presentationId)).sandbox).toHaveLength(1)
  })

  it('tømmer en sone og fjerner en subsone', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const root = (
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      })
    ).rootNodeId

    const split = await ok<ZoneChange & { childNodeIds: string[] }>(context, 'split_zone', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: root,
      axis: 'y',
      weights: [1, 1],
    })
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: split.childNodeIds[0],
      blocks: paragraph('Noe tekst'),
    })

    const cleared = await ok<ZoneChange>(context, 'clear_zone', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: split.childNodeIds[0],
      contentDisposition: 'delete',
    })
    expect(cleared.discarded).toBe(1)

    await ok(context, 'delete_zone', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: split.childNodeIds[1],
    })
    const after = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    // Removing one of two children collapses the split back to a single zone.
    expect(after.zones).toHaveLength(1)
    expect(after.zones[0].kind).toBe('leaf')

    // The main zone is not a subzone and cannot be deleted.
    expect(
      (
        await fails(context, 'delete_zone', {
          presentationId: deck.presentationId,
          slideId,
          nodeId: after.rootNodeId,
        })
      ).code,
    ).toBe('ROOT_CANNOT_BE_DELETED')
  })
})

/* ------------------------------------------------------------------ *
 * Fit
 * ------------------------------------------------------------------ */

describe('innhold som får plass, og innhold som ikke gjør det', () => {
  it('godtar tekst som får plass', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const inspection = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })

    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: firstZone(inspection),
      blocks: paragraph('En setning som helt sikkert får plass.'),
    })
    const after = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    expect(after.zones[0].fits).toBe(true)
    expect(after.zones[0].overflow).toBe(0)
  })

  it('avviser tekst som ikke får plass, uten å endre noe', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const nodeId = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      }),
    )
    const before = await stored(context, deck.presentationId)

    const failure = await fails(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      blocks: paragraph('for mye tekst '.repeat(2000)),
    })

    expect(failure.code).toBe('CONTENT_DOES_NOT_FIT')
    // Everything the loop in §44 needs: where it happened, what did not fit, by
    // how much, and how much room there was.
    expect(failure.details).toMatchObject({
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      subject: 'zone-content',
    })
    expect(failure.details?.overflow).toBeGreaterThan(0)
    expect(failure.details?.rect).toMatchObject({ width: expect.any(Number) })

    // Not a byte of it was written.
    const after = await stored(context, deck.presentationId)
    expect(presentationRevision(after)).toBe(presentationRevision(before))
  })

  it('lar agenten forkorte teksten og lykkes på neste forsøk', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const nodeId = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      }),
    )

    const failure = await fails(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      blocks: paragraph('x'.repeat(40000)),
    })
    const rect = failure.details?.rect as Rect
    const overflow = failure.details?.overflow as number

    // The overflow and the rect together say how much to cut: the text needs
    // rect.height + overflow, and it has rect.height.
    const keep = Math.floor(40000 * (rect.height / (rect.height + overflow)) * 0.8)
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      blocks: paragraph('x'.repeat(keep)),
    })
  })

  it('sier hvor stor subsonen er når innhold ikke får plass i den ved splitting', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const inspection = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    const nodeId = firstZone(inspection)
    const parentRect = inspection.zones.find((zone) => zone.nodeId === nodeId)?.rect as Rect

    await fillToCapacity(context, { presentationId: deck.presentationId, slideId, nodeId }, paragraph)

    // The content is measured against the child it would move into, so the rect
    // reported has to be that child's — the parent is bigger, and an agent told
    // the parent's size would shorten by too little and fail again.
    const failure = await fails(context, 'split_zone', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      axis: 'x',
      weights: [1, 1],
      contentFallback: 'delete',
    })
    expect(failure.code).toBe('CONTENT_DOES_NOT_FIT')
    expect((failure.details?.rect as Rect).width).toBeLessThan(parentRect.width)
  })

  it('avviser en overskrift som ikke får plass på én linje', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const before = await stored(context, deck.presentationId)

    const failure = await fails(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId,
      spans: [{ text: 'En overskrift som er altfor lang til å få plass '.repeat(20) }],
    })
    expect(failure.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(failure.details).toMatchObject({ slideId, subject: 'slide-title' })

    const after = await stored(context, deck.presentationId)
    expect(presentationRevision(after)).toBe(presentationRevision(before))
  })
})

/* ------------------------------------------------------------------ *
 * Citations
 * ------------------------------------------------------------------ */

describe('citations kan ikke omgå fit-guarden', () => {
  it('måler citation-pillen som en del av innholdet', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const nodeId = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      }),
    )
    const { reference } = await ok<{ reference: { id: string } }>(context, 'add_reference', {
      presentationId: deck.presentationId,
      title: 'Kilde',
    })

    const capacity = await fillToCapacity(context, { presentationId: deck.presentationId, slideId, nodeId }, (text) =>
      paragraph(text),
    )

    // The same text, plus a citation. The pill is not free, so this must not fit.
    const failure = await fails(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      blocks: [
        {
          type: 'paragraph',
          spans: [{ text: 'x'.repeat(capacity) }, { citation: [reference.id] }],
        },
      ],
    })
    expect(failure.code).toBe('CONTENT_DOES_NOT_FIT')
  })

  it('avviser en omrokering som gjør en citation bredere på en helt annen slide', async () => {
    const context = freshContext()
    const deck = await newDeck(context, { firstSlideHasTitle: false })
    const cited = deck.slides[0].slideId

    const references: string[] = []
    for (let i = 0; i < 10; i += 1) {
      const { reference } = await ok<{ reference: { id: string } }>(context, 'add_reference', {
        presentationId: deck.presentationId,
        title: `Kilde ${i}`,
      })
      references.push(reference.id)
    }

    // A second slide that cites the other nine, so moving the first slide past
    // it turns `1` into `10` — wider, on a slide nobody touched.
    const other = await ok<SlidePlacement>(context, 'add_slide', {
      presentationId: deck.presentationId,
      hasTitle: false,
    })
    const otherNode = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: other.slideId,
      }),
    )
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: other.slideId,
      nodeId: otherNode,
      blocks: [
        { type: 'paragraph', spans: references.slice(1).map((id) => ({ citation: [id] })) },
      ],
    })

    const citedNode = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: cited,
      }),
    )
    // Thirty separate pills, so one digit becoming two is a real difference.
    // Separated by text on purpose: citations standing next to each other are
    // merged into one, exactly as they are in the editor.
    await fillToCapacity(
      context,
      { presentationId: deck.presentationId, slideId: cited, nodeId: citedNode },
      (text) => pillParagraph(references[0], text),
    )
    const before = await stored(context, deck.presentationId)

    const failure = await fails(context, 'move_slide', {
      presentationId: deck.presentationId,
      slideId: cited,
      toIndex: 1,
    })
    expect(failure.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(failure.details).toMatchObject({ slideId: cited, nodeId: citedNode })

    const after = await stored(context, deck.presentationId)
    expect(after.slides.map((slide) => slide.id)).toEqual(before.slides.map((slide) => slide.id))
  })

  it('avviser at en tittel med citation fjernes når det gjør en annen slide for trang', async () => {
    // A title may cite, and a citation is a reference's *first occurrence*. Take
    // the title away and every reference numbered after it moves up — on slides
    // nobody touched. The removal frees room on this slide and can still hide
    // text on another, which is why it is gated like every other citation edit
    // rather than waved through as a removal. See `commands/fitGuard.ts`.
    const context = freshContext()
    const deck = await newDeck(context)
    const titled = deck.slides[0].slideId

    const references: string[] = []
    for (let i = 0; i < 10; i += 1) {
      const { reference } = await ok<{ reference: { id: string } }>(context, 'add_reference', {
        presentationId: deck.presentationId,
        title: `Kilde ${i}`,
      })
      references.push(reference.id)
    }

    // Slide 1's *title* is the first occurrence of reference 0, so it is `1`.
    await ok(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId: titled,
      spans: [{ text: 'Med kilde' }, { citation: [references[0]] }],
    })

    // Slide 2 cites the other nine, which are therefore 2..10.
    const middle = await ok<SlidePlacement>(context, 'add_slide', {
      presentationId: deck.presentationId,
      hasTitle: false,
    })
    const middleNode = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: middle.slideId,
      }),
    )
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: middle.slideId,
      nodeId: middleNode,
      blocks: [
        { type: 'paragraph', spans: references.slice(1).map((id) => ({ citation: [id] })) },
      ],
    })

    // Slide 3 is full of pills that all read `1`. Drop the title and reference 0
    // is first cited *here* instead — number 10, two digits, thirty times.
    const last = await ok<SlidePlacement>(context, 'add_slide', {
      presentationId: deck.presentationId,
      hasTitle: false,
    })
    const lastNode = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: last.slideId,
      }),
    )
    await fillToCapacity(
      context,
      { presentationId: deck.presentationId, slideId: last.slideId, nodeId: lastNode },
      (text) => pillParagraph(references[0], text),
    )

    const before = await stored(context, deck.presentationId)
    const failure = await fails(context, 'set_slide_has_title', {
      presentationId: deck.presentationId,
      slideId: titled,
      hasTitle: false,
      force: true,
    })
    expect(failure.code).toBe('CONTENT_DOES_NOT_FIT')
    // The slide that suffers is not the slide that changed.
    expect(failure.details).toMatchObject({ slideId: last.slideId, nodeId: lastNode })
    expect((await stored(context, deck.presentationId)).slides[0].title).not.toBeNull()

    // And the repair is the ordinary one: shorten the slide that no longer has
    // room, then the title can go. The numbering really does move — which is
    // what made the refusal above a real one and not an accident of the setup.
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: last.slideId,
      nodeId: lastNode,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Kort' }, { citation: [references[0]] }] }],
    })
    await ok(context, 'set_slide_has_title', {
      presentationId: deck.presentationId,
      slideId: titled,
      hasTitle: false,
      force: true,
    })

    const after = await stored(context, deck.presentationId)
    expect(after.slides[0].title).toBeNull()
    expect(citationNumber(before, references[0])).toBe(1)
    expect(citationNumber(after, references[0])).toBe(10)
  })

  it('avviser en citation som peker på en referanse som ikke finnes', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const nodeId = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      }),
    )

    const failure = await fails(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Påstand' }, { citation: ['r_finnes_ikke'] }] }],
    })
    expect(failure.code).toBe('REFERENCE_NOT_FOUND')
    expect(failure.details).toMatchObject({ referenceIds: ['r_finnes_ikke'] })
  })

  it('fjerner citationene sammen med referansen, og sier hvor mange', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const nodeId = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      }),
    )
    const { reference } = await ok<{ reference: { id: string } }>(context, 'add_reference', {
      presentationId: deck.presentationId,
      title: 'Kilde',
      authors: 'Hansen',
    })

    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      blocks: [
        { type: 'paragraph', spans: [{ text: 'Første' }, { citation: [reference.id] }] },
        { type: 'paragraph', spans: [{ text: 'Andre' }, { citation: [reference.id] }] },
      ],
    })

    await ok(context, 'update_reference', {
      presentationId: deck.presentationId,
      referenceId: reference.id,
      title: 'Kilde, revidert',
      authors: 'Hansen',
    })

    const removal = await ok<{ removedCitations: number }>(context, 'delete_reference', {
      presentationId: deck.presentationId,
      referenceId: reference.id,
    })
    expect(removal.removedCitations).toBe(2)

    const after = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    expect(after.zones[0].referenceIds).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

describe('ugyldige og utdaterte id-er', () => {
  it('svarer maskinlesbart på en presentasjon, slide eller sone som ikke finnes', async () => {
    const context = freshContext()
    const deck = await newDeck(context)

    expect((await fails(context, 'get_presentation', { presentationId: 'p_nope' })).code).toBe(
      'PRESENTATION_NOT_FOUND',
    )
    expect(
      (
        await fails(context, 'inspect_slide', {
          presentationId: deck.presentationId,
          slideId: 's_nope',
        })
      ).code,
    ).toBe('SLIDE_NOT_FOUND')

    const failure = await fails(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: deck.slides[0].slideId,
      nodeId: 'n_nope',
      blocks: paragraph('Hei'),
    })
    expect(failure.code).toBe('NODE_NOT_FOUND')
    expect(failure.details).toMatchObject({ slideId: deck.slides[0].slideId, nodeId: 'n_nope' })
  })

  it('sier fra når en sone-id fortsatt finnes, men ikke lenger er en bladsone', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const root = (
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      })
    ).rootNodeId

    await ok(context, 'split_zone', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: root,
      axis: 'x',
      weights: [1, 1],
    })

    // The agent's id from before the split is still a real node — it is the
    // split itself now — so this is not "not found", and saying so is what lets
    // the agent pick a child instead of re-reading everything.
    const failure = await fails(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: root,
      blocks: paragraph('Hei'),
    })
    expect(failure.code).toBe('NODE_NOT_LEAF')
  })

  it('avviser et ukjent operasjonsnavn og inndata som ikke matcher skjemaet', async () => {
    const context = freshContext()
    expect((await fails(context, 'set_zone_markdown', {})).code).toBe('UNKNOWN_OPERATION')

    const invalid = await fails(context, 'set_zone_text', {
      presentationId: 'p1',
      slideId: 's1',
      nodeId: 'n1',
      blocks: [{ type: 'markdown', text: '# nei' }],
    })
    expect(invalid.code).toBe('INVALID_INPUT')
  })
})

/* ------------------------------------------------------------------ *
 * Concurrency
 * ------------------------------------------------------------------ */

describe('samtidighet', () => {
  it('gir samme revisjon fra get_presentation og inspect_slide', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const inspection = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slides[0].slideId,
    })
    const view = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    expect(inspection.revision).toBe(view.revision)
  })

  it('godtar en mutasjon som oppgir revisjonen den leste', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const added = await ok<SlidePlacement & { revision: string }>(context, 'add_slide', {
      presentationId: deck.presentationId,
      expectedRevision: deck.revision,
    })
    // The answer carries the revision the write produced, so a chain of
    // mutations never needs a read in between — and it is the same value the
    // store hands back on the next read.
    expect(added.revision).not.toBe(deck.revision)
    expect(
      (
        await ok<PresentationView>(context, 'get_presentation', {
          presentationId: deck.presentationId,
        })
      ).revision,
    ).toBe(added.revision)
    await ok(context, 'add_slide', {
      presentationId: deck.presentationId,
      expectedRevision: added.revision,
    })
  })

  it('lar en stale write aldri overskrive en nyere versjon', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId

    // Somebody else writes after this agent read.
    await ok(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId,
      spans: [{ text: 'Skrevet av noen andre' }],
    })
    const newer = await stored(context, deck.presentationId)

    const failure = await fails(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId,
      expectedRevision: deck.revision,
      spans: [{ text: 'Skrevet av en agent med gammel informasjon' }],
    })
    expect(failure.code).toBe('CONFLICT')
    expect(failure.details).toMatchObject({ expectedRevision: deck.revision })

    // The newer version is untouched, byte for byte.
    const after = await stored(context, deck.presentationId)
    expect(presentationRevision(after)).toBe(presentationRevision(newer))

    // Reading again is the way forward, and it works.
    const fresh = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    await ok(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId,
      expectedRevision: fresh.revision,
      spans: [{ text: 'Nå med fersk informasjon' }],
    })
  })

  it('lar to samtidige mutasjoner ikke overskrive hverandre', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId

    // Both start from the same reading and neither is awaited before the other
    // begins, so both pass their own precondition. The write itself is what has
    // to keep the second one from landing on top of the first.
    const [first, second] = await Promise.all([
      call(context, 'set_slide_title', {
        presentationId: deck.presentationId,
        slideId,
        expectedRevision: deck.revision,
        spans: [{ text: 'Første' }],
      }),
      call(context, 'set_slide_title', {
        presentationId: deck.presentationId,
        slideId,
        expectedRevision: deck.revision,
        spans: [{ text: 'Andre' }],
      }),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    const rejected = first.ok ? second : first
    expect(expectErr(rejected).code).toBe('CONFLICT')

    // And what is stored is the one that won, whole.
    const view = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    expect(['Første', 'Andre']).toContain(view.slides[0].title)
  })

  it('avviser en stale asset-registrering før noe er lagret', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    await ok(context, 'add_slide', { presentationId: deck.presentationId })

    const failure = await fails(context, 'create_svg_asset', {
      presentationId: deck.presentationId,
      expectedRevision: deck.revision,
      name: 'figur',
      svgMarkup: '<svg viewBox="0 0 10 5"><rect width="10" height="5"/></svg>',
    })
    expect(failure.code).toBe('CONFLICT')
    expect((await stored(context, deck.presentationId)).assets).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ *
 * Atomicity
 * ------------------------------------------------------------------ */

describe('atomisitet', () => {
  it('lagrer ingenting når et senere steg i en sammensatt operasjon feiler', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const nodeId = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      }),
    )
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      blocks: paragraph('Tekst som skal overleve'),
    })
    const before = await stored(context, deck.presentationId)

    // The conversion to a titled card would succeed on its own; the card title
    // does not fit. Both are one operation, so neither happens.
    const failure = await fails(context, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      kind: 'titled-card',
      title: [{ text: 'En korttittel som er altfor lang for tittellinjen '.repeat(6) }],
    })
    expect(failure.code).toBe('CONTENT_DOES_NOT_FIT')

    const after = await stored(context, deck.presentationId)
    expect(presentationRevision(after)).toBe(presentationRevision(before))
    const root = after.slides[0].root
    expect(root.kind === 'leaf' && root.content?.kind).toBe('container')
  })

  it('gjør hele konverteringen når alle stegene går igjennom', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const nodeId = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      }),
    )
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      blocks: paragraph('Tekst som skal overleve'),
    })

    const card = await ok<{ subfieldIds: string[] }>(context, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      kind: 'titled-card',
      title: [{ text: 'Oppsummering' }],
      color: '#204060',
      subfieldCount: 2,
    })
    expect(card.subfieldIds).toHaveLength(2)

    const after = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    const zone = after.zones[0]
    expect(zone.contentKind).toBe('titled-card')
    expect(zone.cardTitle).toEqual([{ text: 'Oppsummering' }])
    // Converting never loses text.
    expect(zone.subfields?.[0].blocks).toEqual(paragraph('Tekst som skal overleve'))

    await ok(context, 'set_vertical_alignment', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      subfieldId: card.subfieldIds[1],
      align: 'bottom',
    })
    const aligned = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    expect(aligned.zones[0].subfields?.[1].verticalAlign).toBe('bottom')
  })
})

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

describe('justering av overskrifter', () => {
  it('beholder justeringen når bare teksten endres', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId

    await ok(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId,
      spans: [{ text: 'Midtstilt' }],
      align: 'center',
    })
    expect(
      (
        await ok<SlideInspection>(context, 'inspect_slide', {
          presentationId: deck.presentationId,
          slideId,
        })
      ).titleAlign,
    ).toBe('center')

    // Rewriting the words is not a request to un-centre the line.
    await ok(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId,
      spans: [{ text: 'Fortsatt midtstilt' }],
    })
    const after = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    expect(after.title).toBe('Fortsatt midtstilt')
    expect(after.titleAlign).toBe('center')

    // And it can still be changed on purpose.
    await ok(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId,
      spans: [{ text: 'Venstrestilt igjen' }],
      align: 'left',
    })
    expect(
      (
        await ok<SlideInspection>(context, 'inspect_slide', {
          presentationId: deck.presentationId,
          slideId,
        })
      ).titleAlign,
    ).toBe('left')
  })

  it('gjør det samme for korttittelen', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const nodeId = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      }),
    )

    await ok(context, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      kind: 'titled-card',
      title: [{ text: 'Midtstilt' }],
      titleAlign: 'center',
    })
    await ok(context, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      kind: 'titled-card',
      title: [{ text: 'Ny tekst' }],
    })

    const after = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    expect(after.zones[0].cardTitle).toEqual([{ text: 'Ny tekst' }])
    expect(after.zones[0].cardTitleAlign).toBe('center')
  })
})

describe('validering', () => {
  it('sier at en presentasjon bygget gjennom Agent Core er gyldig', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const nodeId = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      }),
    )
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      blocks: paragraph('Innhold som får plass'),
    })

    const slide = await ok<ValidationReport>(context, 'validate_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    expect(slide).toMatchObject({ valid: true, issues: [] })

    const whole = await ok<ValidationReport>(context, 'validate_presentation', {
      presentationId: deck.presentationId,
    })
    expect(whole).toMatchObject({ valid: true, issues: [] })
  })

  it('rapporterer manglende fil og ugyldig referanse, og reparerer ingenting', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId

    // Written past the commands on purpose: this is the state validation exists
    // to find — a document that got into a shape no command would have allowed.
    const broken = await stored(context, deck.presentationId)
    broken.slides[0].root = {
      id: broken.slides[0].root.id,
      kind: 'leaf',
      content: {
        id: 'c_broken',
        kind: 'container',
        payload: { type: 'asset', assetId: 'a_finnes_ikke', fit: 'contain' },
      },
    }
    broken.slides[0].title = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'citation', attrs: { referenceIds: ['r_borte'] } }] },
      ],
    }
    await context.repository.savePresentation(broken)
    const beforeRevision = presentationRevision(await stored(context, deck.presentationId))

    const report = await ok<ValidationReport>(context, 'validate_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    expect(report.valid).toBe(false)
    expect(report.issues.map((issue) => issue.code).sort()).toEqual([
      'ASSET_NOT_FOUND',
      'REFERENCE_NOT_FOUND',
    ])
    expect(report.issues.find((issue) => issue.code === 'ASSET_NOT_FOUND')?.details).toMatchObject({
      assetId: 'a_finnes_ikke',
    })

    // Read-only means read-only.
    expect(presentationRevision(await stored(context, deck.presentationId))).toBe(beforeRevision)
  })

  it('rapporterer innhold som ikke får plass, uten å skrive noe', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId

    const overfull = await stored(context, deck.presentationId)
    const created = createPresentation({ title: 'kilde' })
    expect(created.slides).toHaveLength(1)
    overfull.slides[0].root = {
      id: overfull.slides[0].root.id,
      kind: 'leaf',
      content: {
        id: 'c_overfull',
        kind: 'container',
        payload: {
          type: 'fields',
          body: {
            axis: 'y',
            weights: [1],
            subfields: [
              {
                id: 'f_overfull',
                doc: {
                  type: 'doc',
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(50000) }] },
                  ],
                },
              },
            ],
          },
        },
      },
    }
    await context.repository.savePresentation(overfull)

    const report = await ok<ValidationReport>(context, 'validate_presentation', {
      presentationId: deck.presentationId,
    })
    expect(report.valid).toBe(false)
    const fit = report.issues.find((issue) => issue.code === 'CONTENT_DOES_NOT_FIT')
    expect(fit).toMatchObject({ slideId })
    expect(fit?.details?.overflow).toBeGreaterThan(0)
  })
})

describe('forsiden', () => {
  it('finnes fra første øyeblikk, med dekkets eget navn', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    // Ikke en slide, og telles ikke som en: `slideCount` er fortsatt den ene
    // tomme sliden `create_presentation` lager.
    expect(deck.cover).toMatchObject({ title: 'Agentdekk', subtitle: '' })
    expect(deck.slideCount).toBe(1)
  })

  it('avviser et navn som er for langt for forsiden, og lagrer ingenting', async () => {
    const context = freshContext()
    const before = await context.repository.listPresentations()
    const error = await fails(context, 'create_presentation', {
      title: 'Et navn som er altfor langt '.repeat(6),
    })
    expect(error.code).toBe('CONTENT_DOES_NOT_FIT')
    // Sjekken skjer før lagringen, så det ligger ingen halvferdig presentasjon
    // igjen med en forside ingen kan lese.
    expect(await context.repository.listPresentations()).toHaveLength(before.length)
  })

  it('setter tittel og undertittel i ett steg', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const cover = await ok<CoverView>(context, 'set_cover', {
      presentationId: deck.presentationId,
      title: 'Andre kvartal',
      subtitle: 'Tall og tiltak',
    })
    expect(cover).toMatchObject({ title: 'Andre kvartal', subtitle: 'Tall og tiltak' })

    const reread = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    expect(reread.cover.title).toBe('Andre kvartal')
  })

  it('lagrer ingen av linjene når den andre ikke får plass', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const error = await fails(context, 'set_cover', {
      presentationId: deck.presentationId,
      title: 'Kort nok',
      subtitle: 'Undertittel som er altfor lang '.repeat(6),
    })
    expect(error.code).toBe('CONTENT_DOES_NOT_FIT')

    // Atomisk: tittelen som *ville* fått plass ble aldri skrevet.
    const after = await stored(context, deck.presentationId)
    expect(docToPlainText(after.cover.title).trim()).toBe('Agentdekk')
  })

  it('gir overskrifter uten egen farge forsidens farge, og lar de valgte være', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const cover = await ok<CoverView>(context, 'set_cover_color', {
      presentationId: deck.presentationId,
      color: '#A64D79',
    })
    expect(cover.pillColor).toBe('#a64d79')

    // Fargen bor ett sted. Ingenting er skrevet inn i noen slide, og det er
    // nettopp dét som gjør at en senere endring når fram til dem alle.
    const after = await stored(context, deck.presentationId)
    expect(after.cover.pillColor).toBe('#a64d79')
    expect(JSON.stringify(after.slides)).not.toContain('a64d79')

    expect((await fails(context, 'set_cover_color', {
      presentationId: deck.presentationId,
      color: 'blå',
    })).code).toBe('INVALID_ARGUMENT')
  })
})


/* ------------------------------------------------------------------ *
 * Editor actions an agent used to be unable to reach
 * ------------------------------------------------------------------ */

describe('tittelsonen på en slide', () => {
  it('kan slås av og på etter at sliden er laget', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId

    const removed = await ok<{ hasTitle: boolean }>(context, 'set_slide_has_title', {
      presentationId: deck.presentationId,
      slideId,
      hasTitle: false,
    })
    expect(removed.hasTitle).toBe(false)
    expect((await stored(context, deck.presentationId)).slides[0].title).toBeNull()

    // And back: the zone returns empty, which is what `set_slide_title` writes into.
    await ok(context, 'set_slide_has_title', {
      presentationId: deck.presentationId,
      slideId,
      hasTitle: true,
    })
    const inspected = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    expect(inspected.hasTitle).toBe(true)
  })

  it('gir sonen dens høyde tilbake til innholdet', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const withTitle = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })

    await ok(context, 'set_slide_has_title', {
      presentationId: deck.presentationId,
      slideId,
      hasTitle: false,
    })
    const without = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    // The geometry an agent plans against moves with it, so this is a
    // composition choice and not a cosmetic one.
    expect(without.zones[0].rect.height).toBeGreaterThan(withTitle.zones[0].rect.height)
  })

  it('kaster ikke en overskrift med tekst uten at det er bedt om', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    await ok(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId,
      spans: [{ text: 'Noe som står der' }],
    })

    const refused = await fails(context, 'set_slide_has_title', {
      presentationId: deck.presentationId,
      slideId,
      hasTitle: false,
    })
    expect(refused.code).toBe('INVALID_ARGUMENT')
    expect((await stored(context, deck.presentationId)).slides[0].title).not.toBeNull()

    // `force` is the confirmation the editor asks a person for.
    await ok(context, 'set_slide_has_title', {
      presentationId: deck.presentationId,
      slideId,
      hasTitle: false,
      force: true,
    })
    expect((await stored(context, deck.presentationId)).slides[0].title).toBeNull()
  })

  it('sier fra når sonen allerede er slik den bes om å bli', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const refused = await fails(context, 'set_slide_has_title', {
      presentationId: deck.presentationId,
      slideId: deck.slides[0].slideId,
      hasTitle: true,
    })
    expect(refused.code).toBe('TITLE_ALREADY_PRESENT')
  })
})

describe('navnet presentasjonen har i biblioteket', () => {
  it('kan endres uten at forsiden endres', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    await ok(context, 'set_presentation_title', {
      presentationId: deck.presentationId,
      title: 'Nytt navn',
    })

    const after = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    expect(after.title).toBe('Nytt navn')
    // The two started out the same and are two decisions from then on.
    expect(after.cover.title).toBe('Agentdekk')
    expect((await context.repository.listPresentations())[0].title).toBe('Nytt navn')
  })

  it('avviser et tomt navn, og en utdatert revisjon', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    expect(
      (await fails(context, 'set_presentation_title', {
        presentationId: deck.presentationId,
        title: '   ',
      })).code,
    ).toBe('INVALID_INPUT')

    await ok(context, 'set_presentation_title', {
      presentationId: deck.presentationId,
      title: 'Først',
    })
    expect(
      (await fails(context, 'set_presentation_title', {
        presentationId: deck.presentationId,
        expectedRevision: deck.revision,
        title: 'Etterpå',
      })).code,
    ).toBe('CONFLICT')
  })
})

/* ------------------------------------------------------------------ *
 * Sandkassen
 * ------------------------------------------------------------------ */

describe('sandkassen', () => {
  it('leser, plasserer, dupliserer og sletter sandkasseelementer', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideA = deck.slides[0].slideId
    const rootA = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: slideA,
      }),
    )

    // 1. Bygg innhold på en slide.
    const blocks = paragraph('Innhold som midlertidig mister sonen sin')
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: slideA,
      nodeId: rootA,
      blocks,
    })

    // 2. En strukturendring sender innholdet til sandkassen — disposisjonen er
    // «sandbox» som standard, og svaret bærer id-en direkte.
    const cleared = await ok<ZoneChange>(context, 'clear_zone', {
      presentationId: deck.presentationId,
      slideId: slideA,
      nodeId: rootA,
    })
    expect(cleared.movedToSandbox).toBe(1)
    expect(cleared.sandboxItemIds).toHaveLength(1)
    const itemId = cleared.sandboxItemIds[0]

    // 3. Les sandkassen og finn elementet igjen, i samme tekstformat som
    // inspect_slide bruker.
    const listed = await ok<{ items: SandboxItemView[] }>(context, 'list_sandbox_items', {
      presentationId: deck.presentationId,
    })
    expect(listed.items).toHaveLength(1)
    const item = listed.items.find((entry) => entry.itemId === itemId)
    expect(item?.subfields[0].blocks).toEqual(blocks)
    expect(item?.contentKind).toBe('container')

    // I mellomtiden er slide A's sone tom.
    const emptied = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: slideA,
    })
    expect(emptied.zones.find((zone) => zone.nodeId === rootA)?.empty).toBe(true)

    // 4. Plasser elementet i en tom sone på en annen slide.
    const slideB = (
      await ok<SlidePlacement>(context, 'add_slide', { presentationId: deck.presentationId })
    ).slideId
    const rootB = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: slideB,
      }),
    )
    const placed = await ok<SandboxPlacement>(context, 'place_sandbox_item', {
      presentationId: deck.presentationId,
      itemId,
      slideId: slideB,
      nodeId: rootB,
    })
    expect(placed).toMatchObject({
      itemId,
      slideId: slideB,
      nodeId: rootB,
      displacedSandboxItemId: null,
    })

    // 5. Borte fra sandkassen, og korrekt tilbake på sliden.
    expect(
      (
        await ok<{ items: SandboxItemView[] }>(context, 'list_sandbox_items', {
          presentationId: deck.presentationId,
        })
      ).items,
    ).toHaveLength(0)
    expect(
      (
        await ok<PresentationView>(context, 'get_presentation', {
          presentationId: deck.presentationId,
        })
      ).sandboxCount,
    ).toBe(0)
    const onSlideB = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: slideB,
    })
    expect(onSlideB.zones.find((zone) => zone.nodeId === rootB)?.subfields?.[0].blocks).toEqual(
      blocks,
    )

    // 6. Duplisering og sletting.
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: slideA,
      nodeId: rootA,
      blocks: paragraph('Nok et element'),
    })
    const clearedAgain = await ok<ZoneChange>(context, 'clear_zone', {
      presentationId: deck.presentationId,
      slideId: slideA,
      nodeId: rootA,
    })
    const secondItemId = clearedAgain.sandboxItemIds[0]

    const duplicated = await ok<{ itemId: string; newItemId: string }>(
      context,
      'duplicate_sandbox_item',
      { presentationId: deck.presentationId, itemId: secondItemId },
    )
    expect(duplicated.newItemId).not.toBe(secondItemId)

    const afterDuplicate = await ok<{ items: SandboxItemView[] }>(context, 'list_sandbox_items', {
      presentationId: deck.presentationId,
    })
    const original = afterDuplicate.items.find((entry) => entry.itemId === secondItemId)
    const copy = afterDuplicate.items.find((entry) => entry.itemId === duplicated.newItemId)
    // Samme tekst, i to elementer med hver sin item-id.
    expect(original?.subfields[0].blocks).toEqual(copy?.subfields[0].blocks)
    expect(original?.itemId).not.toBe(copy?.itemId)

    const deletedFirst = await ok<{ sandboxCount: number }>(context, 'delete_sandbox_item', {
      presentationId: deck.presentationId,
      itemId: secondItemId,
    })
    expect(deletedFirst.sandboxCount).toBe(1)
    const deletedSecond = await ok<{ sandboxCount: number }>(context, 'delete_sandbox_item', {
      presentationId: deck.presentationId,
      itemId: duplicated.newItemId,
    })
    expect(deletedSecond.sandboxCount).toBe(0)
  })

  it('avviser en utdatert revisjon og en ukjent item-id, uten å skrive noe', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideId = deck.slides[0].slideId
    const nodeId = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      }),
    )
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      blocks: paragraph('Skal parkeres'),
    })
    const cleared = await ok<ZoneChange>(context, 'clear_zone', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
    })
    const itemId = cleared.sandboxItemIds[0]

    // 7. En utdatert expectedRevision.
    const staleFailure = await fails(context, 'place_sandbox_item', {
      presentationId: deck.presentationId,
      expectedRevision: deck.revision,
      itemId,
      slideId,
      nodeId,
    })
    expect(staleFailure.code).toBe('CONFLICT')

    // 8. En itemId som ikke finnes, for alle tre mutasjonene.
    expect(
      (
        await fails(context, 'place_sandbox_item', {
          presentationId: deck.presentationId,
          itemId: 'sb_finnes_ikke',
          slideId,
          nodeId,
        })
      ).code,
    ).toBe('SANDBOX_ITEM_NOT_FOUND')
    expect(
      (
        await fails(context, 'duplicate_sandbox_item', {
          presentationId: deck.presentationId,
          itemId: 'sb_finnes_ikke',
        })
      ).code,
    ).toBe('SANDBOX_ITEM_NOT_FOUND')
    expect(
      (
        await fails(context, 'delete_sandbox_item', {
          presentationId: deck.presentationId,
          itemId: 'sb_finnes_ikke',
        })
      ).code,
    ).toBe('SANDBOX_ITEM_NOT_FOUND')

    // Ingen av de avviste kallene skrev noe: elementet ligger fortsatt der.
    expect((await stored(context, deck.presentationId)).sandbox).toHaveLength(1)
  })

  it('avviser et element som ikke får plass i målsonen, uten noen delvis mutasjon', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const slideA = deck.slides[0].slideId
    const rootA = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: slideA,
      }),
    )
    await fillToCapacity(
      context,
      { presentationId: deck.presentationId, slideId: slideA, nodeId: rootA },
      paragraph,
    )
    const cleared = await ok<ZoneChange>(context, 'clear_zone', {
      presentationId: deck.presentationId,
      slideId: slideA,
      nodeId: rootA,
    })
    const itemId = cleared.sandboxItemIds[0]

    const slideB = (
      await ok<SlidePlacement>(context, 'add_slide', {
        presentationId: deck.presentationId,
        hasTitle: false,
      })
    ).slideId
    const rootB = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: slideB,
      }),
    )
    // En kvart så bred sone som den innholdet ble skrevet for — det er ikke
    // nok plass til den samme teksten.
    const split = await ok<ZoneChange & { childNodeIds: string[] }>(context, 'split_zone', {
      presentationId: deck.presentationId,
      slideId: slideB,
      nodeId: rootB,
      axis: 'x',
      weights: [1, 1, 1, 1],
    })
    const smallZone = split.childNodeIds[0]
    const before = await stored(context, deck.presentationId)

    // 9. Avvist uten delvis mutasjon.
    const failure = await fails(context, 'place_sandbox_item', {
      presentationId: deck.presentationId,
      itemId,
      slideId: slideB,
      nodeId: smallZone,
    })
    expect(failure.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(failure.details).toMatchObject({ slideId: slideB, nodeId: smallZone })
    expect(failure.details?.overflow).toBeGreaterThan(0)
    expect(failure.details?.rect).toMatchObject({ width: expect.any(Number) })

    const after = await stored(context, deck.presentationId)
    expect(presentationRevision(after)).toBe(presentationRevision(before))
    expect(after.sandbox.map((entry) => entry.id)).toEqual([itemId])
    const afterInspection = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: slideB,
    })
    expect(afterInspection.zones.find((zone) => zone.nodeId === smallZone)?.empty).toBe(true)
  })

  it('må gjennom den globale fit-guarden når tilbakeplassering renummererer citations andre steder', async () => {
    const context = freshContext()
    const deck = await newDeck(context, { firstSlideHasTitle: false })
    const slide0 = deck.slides[0].slideId
    const node0 = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: slide0,
      }),
    )

    const references: string[] = []
    for (let i = 0; i < 10; i += 1) {
      const { reference } = await ok<{ reference: { id: string } }>(context, 'add_reference', {
        presentationId: deck.presentationId,
        title: `Kilde ${i}`,
      })
      references.push(reference.id)
    }

    // Ni citations bygges på den første sliden — tidligst i dekket — og
    // flyttes rett i sandkassen igjen, så de foreløpig ikke er nummerert.
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: slide0,
      nodeId: node0,
      blocks: [
        { type: 'paragraph', spans: references.slice(1).map((id) => ({ citation: [id] })) },
      ],
    })
    const cleared = await ok<ZoneChange>(context, 'clear_zone', {
      presentationId: deck.presentationId,
      slideId: slide0,
      nodeId: node0,
    })
    const itemId = cleared.sandboxItemIds[0]

    // En ny, senere slide med 30 pills som alle siterer references[0] — i dag
    // dekkets eneste citation, så den blir «1», og pillene er akkurat trange
    // nok til det.
    const pillsSlide = await ok<SlidePlacement>(context, 'add_slide', {
      presentationId: deck.presentationId,
      hasTitle: false,
    })
    const pillsNode = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: pillsSlide.slideId,
      }),
    )
    await fillToCapacity(
      context,
      { presentationId: deck.presentationId, slideId: pillsSlide.slideId, nodeId: pillsNode },
      (text) => pillParagraph(references[0], text),
    )
    const before = await stored(context, deck.presentationId)

    // 10. Tilbakeplassering på slide 0 — tidligere i dekket enn pill-sliden —
    // gjør de ni referansene til de ni første forekomstene, og references[0]
    // hopper fra nummer 1 til nummer 10: for bredt for de 30 pillene, selv om
    // ingen av dem endret et eneste tegn.
    const failure = await fails(context, 'place_sandbox_item', {
      presentationId: deck.presentationId,
      itemId,
      slideId: slide0,
      nodeId: node0,
    })
    expect(failure.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(failure.details).toMatchObject({ slideId: pillsSlide.slideId, nodeId: pillsNode })

    const after = await stored(context, deck.presentationId)
    expect(presentationRevision(after)).toBe(presentationRevision(before))
    expect(after.sandbox.map((entry) => entry.id)).toEqual([itemId])

    // Reparasjonen er den vanlige: kort ned pill-sliden, så går plasseringen
    // gjennom, og nummereringen har virkelig flyttet seg.
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: pillsSlide.slideId,
      nodeId: pillsNode,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Kort' }, { citation: [references[0]] }] }],
    })
    await ok(context, 'place_sandbox_item', {
      presentationId: deck.presentationId,
      itemId,
      slideId: slide0,
      nodeId: node0,
    })

    const finalDoc = await stored(context, deck.presentationId)
    expect(citationNumber(finalDoc, references[0])).toBe(10)
    expect(citationNumber(finalDoc, references[1])).toBe(1)
    expect(finalDoc.sandbox).toHaveLength(0)
  })
})


/* ------------------------------------------------------------------ *
 * Moving content between zones
 * ------------------------------------------------------------------ */

/**
 * The same content, in a different zone.
 *
 * Before `move_zone_content` an agent that wanted content one zone to the left
 * had to clear the zone and build it again, which is not the same operation
 * even when the result looks identical: the content id, the subfield ids, the
 * citations and the asset reference are all new, so every id the agent was
 * holding — and every id it had just told itself to write into next — points at
 * something that no longer exists. A move keeps the object, so the ids survive,
 * and that is what these tests are about. Everything else — the fit gate, the
 * citation renumbering, atomicity, `expectedRevision` — is `moveZoneContent`'s
 * own, unchanged, and asserted here only to prove the agent layer did not step
 * around it.
 */
describe('flytting av innhold mellom soner', () => {
  /** A slide split in two, with the ids of both halves. */
  async function twoZones(
    context: AgentContext,
    presentationId: string,
    slideId: string,
  ): Promise<[string, string]> {
    const root = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', { presentationId, slideId }),
    )
    const split = await ok<ZoneChange & { childNodeIds: string[] }>(context, 'split_zone', {
      presentationId,
      slideId,
      nodeId: root,
      axis: 'x',
      weights: [1, 1],
    })
    return [split.childNodeIds[0], split.childNodeIds[1]]
  }

  /** The content object a leaf holds in the stored document, id and all. */
  function storedContent(
    presentation: Presentation,
    slideId: string,
    nodeId: string,
  ): ZoneContent | null {
    const slide = presentation.slides.find((entry) => entry.id === slideId)
    const leaf = slide ? findLeaf(slide.root, nodeId) : null
    return leaf?.content ?? null
  }

  function zoneOf(inspection: SlideInspection, nodeId: string): ZoneInspection {
    const zone = inspection.zones.find((entry) => entry.nodeId === nodeId)
    if (!zone) throw new Error(`Sonen ${nodeId} finnes ikke på sliden.`)
    return zone
  }

  it('flytter et helt kort innenfor én slide, og lar id-ene følge med', async () => {
    const context = freshContext()
    const deck = await newDeck(context, { firstSlideHasTitle: false })
    const slideId = deck.slides[0].slideId
    const [left, right] = await twoZones(context, deck.presentationId, slideId)

    const { reference } = await ok<{ reference: { id: string } }>(context, 'add_reference', {
      presentationId: deck.presentationId,
      title: 'Kilden kortet siterer',
    })

    // 5. Et kort med tittel, to tekstfelt, tekst og en citation — alt det en
    // agent ellers ville måttet bygge opp igjen på nytt.
    const card = await ok<{ subfieldIds: string[] }>(context, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: left,
      kind: 'titled-card',
      title: [{ text: 'Funn' }],
      subfieldCount: 2,
    })
    const [firstField, secondField] = card.subfieldIds
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: left,
      subfieldId: firstField,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Første felt' }, { citation: [reference.id] }] }],
    })
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: left,
      subfieldId: secondField,
      blocks: paragraph('Andre felt'),
    })
    const contentBefore = storedContent(await stored(context, deck.presentationId), slideId, left)

    // 1. Flyttingen selv. `toSlideId` er utelatt, som betyr «samme slide».
    const moved = await ok<Mutated<ZoneContentMove>>(context, 'move_zone_content', {
      presentationId: deck.presentationId,
      fromSlideId: slideId,
      fromNodeId: left,
      toNodeId: right,
    })
    expect(moved).toMatchObject({
      presentationId: deck.presentationId,
      fromSlideId: slideId,
      fromNodeId: left,
      toSlideId: slideId,
      toNodeId: right,
    })

    // 4. Svaret bærer målsonens identitet og de samme subfelt-id-ene, så en
    // agent kan fortsette uten en ekstra inspect_slide.
    expect(moved.subfieldIds).toEqual([firstField, secondField])

    // Og ingenting mer enn id-er. `presentations:read` og `presentations:write`
    // er uavhengige på et token, og en flytting til den sonen innholdet
    // allerede står i er en lovlig no-op – et svar som beskrev innholdet ville
    // gjort denne operasjonen til et inspect_slide uten lesescope.
    expect(Object.keys(moved).sort()).toEqual([
      'fromNodeId',
      'fromSlideId',
      'presentationId',
      'revision',
      'subfieldIds',
      'toNodeId',
      'toSlideId',
    ])
    expect(JSON.stringify(moved)).not.toContain('Første felt')
    expect(JSON.stringify(moved)).not.toContain('Funn')
    expect(JSON.stringify(moved)).not.toContain(reference.id)

    // 3. Borte fra kilden, på plass i målet — og det samme innholdsobjektet,
    // ikke en rekonstruksjon som ser likt ut. Sammenlignet felt for felt fordi
    // dokumentet har vært innom lagringen: id-ene er det som skiller en
    // flytting fra en gjenoppbygging, og de er med i sammenligningen.
    const after = await stored(context, deck.presentationId)
    expect(storedContent(after, slideId, left)).toBeNull()
    expect(storedContent(after, slideId, right)).toEqual(contentBefore)
    expect(storedContent(after, slideId, right)?.id).toBe(contentBefore?.id)

    const inspected = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    expect(zoneOf(inspected, left).empty).toBe(true)
    expect(zoneOf(inspected, right)).toMatchObject({
      empty: false,
      contentKind: 'titled-card',
      referenceIds: [reference.id],
    })
    expect(zoneOf(inspected, right).subfields?.map((field) => field.subfieldId)).toEqual([
      firstField,
      secondField,
    ])
    expect(zoneOf(inspected, right).subfields?.[0].blocks).toEqual([
      { type: 'paragraph', spans: [{ text: 'Første felt' }, { citation: [reference.id] }] },
    ])
  })

  it('flytter innhold mellom to forskjellige slides, med filreferansen intakt', async () => {
    const context = freshContext()
    const deck = await newDeck(context, { firstSlideHasTitle: false })
    const source = deck.slides[0].slideId
    const sourceNode = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: source,
      }),
    )
    const { assetId } = await ok<{ assetId: string }>(context, 'create_svg_asset', {
      presentationId: deck.presentationId,
      name: 'figur',
      svgMarkup: '<svg viewBox="0 0 10 5"><rect width="10" height="5"/></svg>',
    })
    await ok(context, 'set_zone_asset', {
      presentationId: deck.presentationId,
      slideId: source,
      nodeId: sourceNode,
      assetId,
    })
    const contentBefore = storedContent(
      await stored(context, deck.presentationId),
      source,
      sourceNode,
    )

    const target = (
      await ok<SlidePlacement>(context, 'add_slide', {
        presentationId: deck.presentationId,
        hasTitle: false,
      })
    ).slideId
    const targetNode = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: target,
      }),
    )

    // 2. Over en slidegrense, med begge sider navngitt eksplisitt.
    const moved = await ok<ZoneContentMove>(context, 'move_zone_content', {
      presentationId: deck.presentationId,
      fromSlideId: source,
      fromNodeId: sourceNode,
      toSlideId: target,
      toNodeId: targetNode,
    })
    expect(moved).toMatchObject({ toSlideId: target, toNodeId: targetNode })
    // En sone som viser en fil har ingen tekstfelt, og svaret later ikke som noe
    // annet — filens id hører hjemme i en lesing, ikke i kvitteringen.
    expect(moved.subfieldIds).toEqual([])
    expect(JSON.stringify(moved)).not.toContain(assetId)
    // Filen er ikke lastet opp på nytt, og sonen peker på den samme filen.
    expect(
      (await ok<PresentationView>(context, 'get_presentation', {
        presentationId: deck.presentationId,
      })).assetCount,
    ).toBe(1)

    const after = await stored(context, deck.presentationId)
    expect(storedContent(after, source, sourceNode)).toBeNull()
    expect(storedContent(after, target, targetNode)).toEqual(contentBefore)
    expect(storedContent(after, target, targetNode)?.id).toBe(contentBefore?.id)
    const arrived = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: target,
    })
    expect(zoneOf(arrived, targetNode)).toMatchObject({
      contentKind: 'container',
      payload: 'asset',
      assetIds: [assetId],
    })
  })

  it('lar agenten redigere videre gjennom de samme subfelt-id-ene etter flyttingen', async () => {
    const context = freshContext()
    const deck = await newDeck(context, { firstSlideHasTitle: false })
    const source = deck.slides[0].slideId
    const sourceNode = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: source,
      }),
    )
    const card = await ok<{ subfieldIds: string[] }>(context, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId: source,
      nodeId: sourceNode,
      kind: 'untitled-card',
      subfieldCount: 2,
    })
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: source,
      nodeId: sourceNode,
      subfieldId: card.subfieldIds[1],
      blocks: paragraph('Skrevet før flyttingen'),
    })

    const target = (
      await ok<SlidePlacement>(context, 'add_slide', {
        presentationId: deck.presentationId,
        hasTitle: false,
      })
    ).slideId
    const targetNode = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: target,
      }),
    )
    const moved = await ok<Mutated<ZoneContentMove>>(context, 'move_zone_content', {
      presentationId: deck.presentationId,
      fromSlideId: source,
      fromNodeId: sourceNode,
      toNodeId: targetNode,
      toSlideId: target,
    })

    // 13. Den sammenhengende arbeidsflyten: agenten skriver videre inn i det
    // samme subfeltet, på den nye adressen, uten å lese sliden på nytt.
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      expectedRevision: moved.revision,
      slideId: target,
      nodeId: targetNode,
      subfieldId: card.subfieldIds[0],
      blocks: paragraph('Skrevet etter flyttingen'),
    })
    await ok(context, 'adjust_subfields', {
      presentationId: deck.presentationId,
      slideId: target,
      nodeId: targetNode,
      axis: 'x',
      weights: [2, 1],
    })

    const inspected = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: target,
    })
    const zone = zoneOf(inspected, targetNode)
    expect(zone.subfieldAxis).toBe('x')
    expect(zone.subfieldWeights).toEqual([2, 1])
    expect(zone.subfields?.map((field) => field.subfieldId)).toEqual(card.subfieldIds)
    expect(zone.subfields?.[0].blocks).toEqual(paragraph('Skrevet etter flyttingen'))
    expect(zone.subfields?.[1].blocks).toEqual(paragraph('Skrevet før flyttingen'))
  })

  it('avviser en opptatt målsone, en tom kilde og soner som ikke er blad, uten å endre noe', async () => {
    const context = freshContext()
    const deck = await newDeck(context, { firstSlideHasTitle: false })
    const slideId = deck.slides[0].slideId
    const rootNodeId = (
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      })
    ).rootNodeId
    const [left, right] = await twoZones(context, deck.presentationId, slideId)
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: left,
      blocks: paragraph('Venstre'),
    })
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: right,
      blocks: paragraph('Høyre'),
    })
    const move = (extra: Record<string, unknown>): Record<string, unknown> => ({
      presentationId: deck.presentationId,
      fromSlideId: slideId,
      ...extra,
    })

    // 6. Målsonen har innhold, og begge sonene står som de sto etterpå.
    const filled = await stored(context, deck.presentationId)
    const occupied = await fails(context, 'move_zone_content', move({ fromNodeId: left, toNodeId: right }))
    expect(occupied.code).toBe('TARGET_OCCUPIED')
    expect(occupied.details).toMatchObject({ slideId, nodeId: right })
    expect(await stored(context, deck.presentationId)).toEqual(filled)

    // 7. Kilden har ikke noe å flytte. Tømmingen er den siste tillatte
    // skrivingen i testen; alt etter den skal la dokumentet stå.
    const emptied = await ok<ZoneChange>(context, 'clear_zone', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: right,
    })
    expect(emptied.movedToSandbox).toBe(1)
    const before = await stored(context, deck.presentationId)
    const empty = await fails(context, 'move_zone_content', move({ fromNodeId: right, toNodeId: left }))
    expect(empty.code).toBe('TARGET_EMPTY')
    expect(empty.details).toMatchObject({ slideId, nodeId: right })

    // 8. Hver av de fire måtene en sone-id kan være ubrukelig på, med den siden
    // den gjelder navngitt: en delt sone er ikke et blad, en id som ikke finnes
    // er noe annet enn en som gjør det.
    const notLeafSource = await fails(
      context,
      'move_zone_content',
      move({ fromNodeId: rootNodeId, toNodeId: left }),
    )
    expect(notLeafSource.code).toBe('NODE_NOT_LEAF')
    expect(notLeafSource.details).toMatchObject({ slideId, nodeId: rootNodeId })

    const notLeafTarget = await fails(
      context,
      'move_zone_content',
      move({ fromNodeId: left, toNodeId: rootNodeId }),
    )
    expect(notLeafTarget.code).toBe('NODE_NOT_LEAF')
    expect(notLeafTarget.details).toMatchObject({ slideId, nodeId: rootNodeId })

    expect(
      (await fails(context, 'move_zone_content', move({ fromNodeId: 'n_nei', toNodeId: right })))
        .code,
    ).toBe('NODE_NOT_FOUND')
    expect(
      (await fails(context, 'move_zone_content', move({ fromNodeId: left, toNodeId: 'n_nei' })))
        .code,
    ).toBe('NODE_NOT_FOUND')
    expect(
      (
        await fails(
          context,
          'move_zone_content',
          move({ fromNodeId: left, toSlideId: 's_nei', toNodeId: right }),
        )
      ).code,
    ).toBe('SLIDE_NOT_FOUND')

    // Ingen av avvisningene skrev noe.
    expect(await stored(context, deck.presentationId)).toEqual(before)
  })

  it('avviser innhold som ikke får plass i målsonen, og lar dokumentet stå urørt', async () => {
    const context = freshContext()
    const deck = await newDeck(context, { firstSlideHasTitle: false })
    const wide = deck.slides[0].slideId
    const wideNode = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: wide,
      }),
    )
    await fillToCapacity(
      context,
      { presentationId: deck.presentationId, slideId: wide, nodeId: wideNode },
      paragraph,
    )

    const narrowSlide = (
      await ok<SlidePlacement>(context, 'add_slide', {
        presentationId: deck.presentationId,
        hasTitle: false,
      })
    ).slideId
    const narrowRoot = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: narrowSlide,
      }),
    )
    const split = await ok<ZoneChange & { childNodeIds: string[] }>(context, 'split_zone', {
      presentationId: deck.presentationId,
      slideId: narrowSlide,
      nodeId: narrowRoot,
      axis: 'x',
      weights: [1, 1, 1, 1],
    })
    const narrow = split.childNodeIds[0]
    const before = await stored(context, deck.presentationId)

    // 9. Fit-avvisningen beskriver målsonen: riktig slide, riktig sone, og
    // rektangelet den faktisk har, ikke kildens.
    const failure = await fails(context, 'move_zone_content', {
      presentationId: deck.presentationId,
      fromSlideId: wide,
      fromNodeId: wideNode,
      toSlideId: narrowSlide,
      toNodeId: narrow,
    })
    expect(failure.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(failure.details).toMatchObject({ slideId: narrowSlide, nodeId: narrow, subject: 'zone-content' })
    expect(failure.details?.overflow).toBeGreaterThan(0)
    const rect = failure.details?.rect as Rect
    const narrowZone = (
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: narrowSlide,
      })
    ).zones.find((zone) => zone.nodeId === narrow)
    expect(rect).toEqual(narrowZone?.rect)

    // Bit for bit det samme dokumentet: teksten står der den sto.
    expect(await stored(context, deck.presentationId)).toEqual(before)
  })

  it('må gjennom den globale fit-guarden når flyttingen renummererer citations andre steder', async () => {
    const context = freshContext()
    const deck = await newDeck(context, { firstSlideHasTitle: false })
    const first = deck.slides[0].slideId
    const firstNode = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: first,
      }),
    )

    const references: string[] = []
    for (let i = 0; i < 10; i += 1) {
      const { reference } = await ok<{ reference: { id: string } }>(context, 'add_reference', {
        presentationId: deck.presentationId,
        title: `Kilde ${i}`,
      })
      references.push(reference.id)
    }

    // Dekket er: en tom slide, så en slide med pills, så en slide med ni
    // citations. Rekkefølgen er hele poenget — nummereringen følger første
    // forekomst gjennom dekket.
    const pillsSlide = (
      await ok<SlidePlacement>(context, 'add_slide', {
        presentationId: deck.presentationId,
        hasTitle: false,
      })
    ).slideId
    const pillsNode = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: pillsSlide,
      }),
    )
    const lastSlide = (
      await ok<SlidePlacement>(context, 'add_slide', {
        presentationId: deck.presentationId,
        hasTitle: false,
      })
    ).slideId
    const lastNode = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: lastSlide,
      }),
    )
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: lastSlide,
      nodeId: lastNode,
      blocks: [
        { type: 'paragraph', spans: references.slice(1).map((id) => ({ citation: [id] })) },
      ],
    })

    // Pill-sliden ligger foran, så references[0] er «1», og de 30 pillene
    // fylles til akkurat det ett siffer bærer.
    const pills = 30
    await fillToCapacity(
      context,
      { presentationId: deck.presentationId, slideId: pillsSlide, nodeId: pillsNode },
      (text) => [
        {
          type: 'paragraph',
          spans: Array.from({ length: pills }, () => [
            { text: 'x'.repeat(Math.max(1, Math.ceil(text.length / pills))) },
            { citation: [references[0]] },
          ]).flat(),
        },
      ],
    )
    const before = await stored(context, deck.presentationId)
    expect(citationNumber(before, references[0])).toBe(1)

    // 10. Å flytte de ni citationene til dekkets første slide gjør dem til de
    // ni første forekomstene, og references[0] hopper fra 1 til 10 — for bredt
    // for pill-sliden, som ingen rørte.
    const failure = await fails(context, 'move_zone_content', {
      presentationId: deck.presentationId,
      fromSlideId: lastSlide,
      fromNodeId: lastNode,
      toSlideId: first,
      toNodeId: firstNode,
    })
    expect(failure.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(failure.details).toMatchObject({ slideId: pillsSlide, nodeId: pillsNode })
    expect(await stored(context, deck.presentationId)).toEqual(before)

    // Reparasjonen er den vanlige: kort ned pill-sliden, og flyttingen går
    // gjennom — med nummereringen virkelig flyttet.
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId: pillsSlide,
      nodeId: pillsNode,
      blocks: [{ type: 'paragraph', spans: [{ text: 'Kort' }, { citation: [references[0]] }] }],
    })
    await ok(context, 'move_zone_content', {
      presentationId: deck.presentationId,
      fromSlideId: lastSlide,
      fromNodeId: lastNode,
      toSlideId: first,
      toNodeId: firstNode,
    })
    const finalDoc = await stored(context, deck.presentationId)
    expect(citationNumber(finalDoc, references[0])).toBe(10)
    expect(citationNumber(finalDoc, references[1])).toBe(1)
  })

  it('avviser en utdatert expectedRevision med CONFLICT, uten å flytte noe', async () => {
    const context = freshContext()
    const deck = await newDeck(context, { firstSlideHasTitle: false })
    const slideId = deck.slides[0].slideId
    const [left, right] = await twoZones(context, deck.presentationId, slideId)
    await ok(context, 'set_zone_text', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: left,
      blocks: paragraph('Står stille'),
    })
    const before = await stored(context, deck.presentationId)

    // 11. Revisjonen fra da dekket ble opprettet er utdatert nå.
    const stale = await fails(context, 'move_zone_content', {
      presentationId: deck.presentationId,
      expectedRevision: deck.revision,
      fromSlideId: slideId,
      fromNodeId: left,
      toNodeId: right,
    })
    expect(stale.code).toBe('CONFLICT')
    expect(await stored(context, deck.presentationId)).toEqual(before)

    // Med den ferske revisjonen går den samme flyttingen gjennom.
    await ok<ZoneContentMove>(context, 'move_zone_content', {
      presentationId: deck.presentationId,
      expectedRevision: presentationRevision(before),
      fromSlideId: slideId,
      fromNodeId: left,
      toNodeId: right,
    })
    const after = await stored(context, deck.presentationId)
    expect(storedContent(after, slideId, right)).not.toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * Subfield layout
 * ------------------------------------------------------------------ */

/**
 * Two text columns *inside* one card, and a figure that gets two thirds of it.
 *
 * The zone tree divides a slide; the subfield layout divides one card. They are
 * different compositions — two zones have a card each and a gap between them,
 * two subfields share one card and one background — and until `adjust_subfields`
 * an agent could only reach the first. Everything here goes through the same
 * `setBodyLayout` the inspector's buttons call, so a layout the editor refuses
 * is a layout the agent is refused too, and the other way round.
 */
describe('subfeltlayout inne i ett kort', () => {
  /** A deck whose only zone holds a card with `count` subfields. */
  async function cardDeck(
    context: AgentContext,
    count = 2,
  ): Promise<{ presentationId: string; slideId: string; nodeId: string; subfieldIds: string[] }> {
    const deck = await newDeck(context, { firstSlideHasTitle: false })
    const slideId = deck.slides[0].slideId
    const inspection = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    const nodeId = firstZone(inspection)
    const card = await ok<{ subfieldIds: string[] }>(context, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      kind: 'untitled-card',
      subfieldCount: count,
    })
    return { presentationId: deck.presentationId, slideId, nodeId, subfieldIds: card.subfieldIds }
  }

  /** The zone as `inspect_slide` sees it, which is the agent's only view of it. */
  async function zoneView(
    context: AgentContext,
    target: { presentationId: string; slideId: string; nodeId: string },
  ): Promise<SlideInspection['zones'][number]> {
    const inspection = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: target.presentationId,
      slideId: target.slideId,
    })
    const zone = inspection.zones.find((candidate) => candidate.nodeId === target.nodeId)
    if (!zone) throw new Error('Fant ikke sonen i inspeksjonen.')
    return zone
  }

  it('bytter et kort med to subfelt mellom stående og liggende retning', async () => {
    const context = freshContext()
    const card = await cardDeck(context)

    // The default is stacked, which is what makes the flip worth having.
    expect((await zoneView(context, card)).subfieldAxis).toBe('y')

    const sideways = await ok<SubfieldLayout>(context, 'adjust_subfields', {
      presentationId: card.presentationId,
      slideId: card.slideId,
      nodeId: card.nodeId,
      axis: 'x',
    })
    expect(sideways.axis).toBe('x')
    expect(sideways.subfieldIds).toEqual(card.subfieldIds)
    expect((await zoneView(context, card)).subfieldAxis).toBe('x')

    const stacked = await ok<SubfieldLayout>(context, 'adjust_subfields', {
      presentationId: card.presentationId,
      slideId: card.slideId,
      nodeId: card.nodeId,
      axis: 'y',
    })
    expect(stacked.axis).toBe('y')
    // Flipping back and forth is not a way to lose the text fields.
    expect(stacked.subfieldIds).toEqual(card.subfieldIds)
  })

  it('lar forholdstallene faktisk flytte plassen, ikke bare tallene', async () => {
    const context = freshContext()
    const card = await cardDeck(context)
    await ok(context, 'adjust_subfields', {
      presentationId: card.presentationId,
      slideId: card.slideId,
      nodeId: card.nodeId,
      axis: 'x',
      weights: [1, 1],
    })

    // Fill the left column to the brim at an even split. What "full" means is
    // whatever the fit checker says, so it is bisected rather than computed.
    const evenCapacity = await fillToCapacity(
      context,
      { presentationId: card.presentationId, slideId: card.slideId, nodeId: card.nodeId },
      paragraph,
    )

    // Three quarters of the card instead of half: strictly more room, so the
    // same text still fits — and measurably more of it fits afterwards.
    await ok(context, 'adjust_subfields', {
      presentationId: card.presentationId,
      slideId: card.slideId,
      nodeId: card.nodeId,
      weights: [3, 1],
    })
    const wideCapacity = await fillToCapacity(
      context,
      { presentationId: card.presentationId, slideId: card.slideId, nodeId: card.nodeId },
      paragraph,
    )
    expect(wideCapacity).toBeGreaterThan(evenCapacity)

    // And the other direction is refused rather than silently clipping: the
    // text that filled three quarters cannot fit in one.
    const squeezed = await fails(context, 'adjust_subfields', {
      presentationId: card.presentationId,
      slideId: card.slideId,
      nodeId: card.nodeId,
      weights: [1, 3],
    })
    expect(squeezed.code).toBe('CONTENT_DOES_NOT_FIT')
  })

  it('rapporterer retning og forholdstall i inspect_slide, og de overlever en ny lesing', async () => {
    const context = freshContext()
    const card = await cardDeck(context, 3)
    await ok(context, 'adjust_subfields', {
      presentationId: card.presentationId,
      slideId: card.slideId,
      nodeId: card.nodeId,
      axis: 'x',
      weights: [3, 2, 1],
    })

    const zone = await zoneView(context, card)
    expect(zone.subfieldAxis).toBe('x')
    expect(zone.subfieldWeights).toEqual([3, 2, 1])
    expect(zone.subfields?.map((field) => field.subfieldId)).toEqual(card.subfieldIds)

    // Not just in the answer: in the document, read back from the store the way
    // a later session would read it.
    const document = await stored(context, card.presentationId)
    const content = document.slides[0].root
    if (content.kind !== 'leaf' || content.content?.kind !== 'untitled-card') {
      throw new Error('Forventet et kort i hovedsonen.')
    }
    expect(content.content.body.axis).toBe('x')
    expect(content.content.body.weights).toEqual([3, 2, 1])
  })

  it('endrer antall, retning og forholdstall i ett kall, målt én gang', async () => {
    const context = freshContext()
    const card = await cardDeck(context, 1)

    const layout = await ok<SubfieldLayout>(context, 'adjust_subfields', {
      presentationId: card.presentationId,
      slideId: card.slideId,
      nodeId: card.nodeId,
      subfieldCount: 3,
      axis: 'x',
      weights: [2, 1, 1],
    })
    expect(layout.subfieldIds).toHaveLength(3)
    expect(layout.axis).toBe('x')
    expect(layout.weights).toEqual([2, 1, 1])
    // The field that was already there keeps its id, so text written into it
    // before the change is still addressable after it.
    expect(layout.subfieldIds[0]).toBe(card.subfieldIds[0])
  })

  it('avviser ugyldige forholdstall og feil antall av dem', async () => {
    const context = freshContext()
    const card = await cardDeck(context)
    const target = {
      presentationId: card.presentationId,
      slideId: card.slideId,
      nodeId: card.nodeId,
    }

    // Zero, negative and non-finite never reach a command: the schema publishes
    // "positive, finite" and rejects them as INVALID_INPUT.
    for (const weights of [[1, 0], [1, -2]]) {
      expect((await fails(context, 'adjust_subfields', { ...target, weights })).code).toBe(
        'INVALID_INPUT',
      )
    }

    // The wrong *number* of them is a domain question — how many subfields the
    // call ends with — so it comes back with the domain's own code.
    const tooFew = await fails(context, 'adjust_subfields', { ...target, weights: [1] })
    expect(tooFew.code).toBe('INVALID_WEIGHTS')
    expect(tooFew.details).toMatchObject({ expected: 2, received: 1 })

    const tooMany = await fails(context, 'adjust_subfields', { ...target, weights: [1, 1, 1] })
    expect(tooMany.code).toBe('INVALID_WEIGHTS')

    // Counted against the state the call *ends* in, not the one it starts in.
    expect(
      (await fails(context, 'adjust_subfields', { ...target, subfieldCount: 3, weights: [1, 1] }))
        .code,
    ).toBe('INVALID_WEIGHTS')
    await ok(context, 'adjust_subfields', { ...target, subfieldCount: 3, weights: [1, 1, 1] })
  })

  it('avviser vekter som hver for seg er endelige, men som ikke er det til sammen', async () => {
    // The schema can only say "positive and finite" about one number at a time.
    // Whether they add up is a property of the array, and it is the property
    // the geometry actually needs: every share is a division by the total, so a
    // total of Infinity makes every rectangle NaN — which fails every
    // comparison, so the fit guard reads it as "nothing overflowed" and stores
    // a layout that has no geometry at all.
    const context = freshContext()
    const card = await cardDeck(context)
    const target = {
      presentationId: card.presentationId,
      slideId: card.slideId,
      nodeId: card.nodeId,
    }

    const before = await stored(context, card.presentationId)
    const refused = await fails(context, 'adjust_subfields', {
      ...target,
      weights: [1e308, 1e308],
    })
    expect(refused.code).toBe('INVALID_WEIGHTS')
    expect(await stored(context, card.presentationId)).toEqual(before)

    // The same rule one level up, where the sum divides the slide itself.
    const split = await fails(context, 'split_zone', {
      ...target,
      axis: 'x',
      weights: [Number.MAX_VALUE, Number.MAX_VALUE],
    })
    expect(split.code).toBe('INVALID_WEIGHTS')
    expect(await stored(context, card.presentationId)).toEqual(before)

    // Large is still allowed — it is the sum that has to land somewhere — and
    // what comes back has real numbers in it.
    await ok(context, 'adjust_subfields', { ...target, axis: 'x', weights: [1e307, 1e307] })
    const zone = await zoneView(context, card)
    for (const value of [zone.rect.x, zone.rect.y, zone.rect.width, zone.rect.height]) {
      expect(Number.isFinite(value)).toBe(true)
    }
    expect(zone.fits).toBe(true)
  })

  it('krever at kallet ber om noe, og at sonen har subfelt å ordne', async () => {
    const context = freshContext()
    const card = await cardDeck(context)
    const target = {
      presentationId: card.presentationId,
      slideId: card.slideId,
      nodeId: card.nodeId,
    }
    expect((await fails(context, 'adjust_subfields', target)).code).toBe('INVALID_ARGUMENT')

    const deck = await newDeck(context, { firstSlideHasTitle: false })
    const emptySlide = deck.slides[0].slideId
    const emptyZone = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId: emptySlide,
      }),
    )
    expect(
      (
        await fails(context, 'adjust_subfields', {
          presentationId: deck.presentationId,
          slideId: emptySlide,
          nodeId: emptyZone,
          axis: 'x',
        })
      ).code,
    ).toBe('TARGET_EMPTY')
  })

  it('avviser en utdatert revisjon, og skriver ingenting', async () => {
    const context = freshContext()
    const card = await cardDeck(context)
    const before = await ok<SlideInspection>(context, 'inspect_slide', {
      presentationId: card.presentationId,
      slideId: card.slideId,
    })

    // Somebody else writes in between.
    await ok(context, 'set_presentation_title', {
      presentationId: card.presentationId,
      title: 'Endret av en annen',
    })

    const document = await stored(context, card.presentationId)
    const conflict = await fails(context, 'adjust_subfields', {
      presentationId: card.presentationId,
      expectedRevision: before.revision,
      slideId: card.slideId,
      nodeId: card.nodeId,
      axis: 'x',
      weights: [3, 1],
    })
    expect(conflict.code).toBe('CONFLICT')
    expect(await stored(context, card.presentationId)).toEqual(document)
  })

  it('avviser hele endringen atomisk når innholdet ikke får plass etterpå', async () => {
    const context = freshContext()
    const card = await cardDeck(context)
    await ok(context, 'adjust_subfields', {
      presentationId: card.presentationId,
      slideId: card.slideId,
      nodeId: card.nodeId,
      axis: 'x',
      weights: [3, 1],
    })
    await fillToCapacity(
      context,
      { presentationId: card.presentationId, slideId: card.slideId, nodeId: card.nodeId },
      paragraph,
    )

    const before = await stored(context, card.presentationId)
    // Axis and weights in the same call. The weights alone would be fine; the
    // pair is not — and neither half is stored.
    const refused = await fails(context, 'adjust_subfields', {
      presentationId: card.presentationId,
      slideId: card.slideId,
      nodeId: card.nodeId,
      axis: 'y',
      weights: [1, 1],
    })
    expect(refused.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(refused.details).toMatchObject({ slideId: card.slideId, nodeId: card.nodeId })
    expect(refused.details?.rect).toBeDefined()
    expect(await stored(context, card.presentationId)).toEqual(before)
  })

  it('går den hele veien: to kolonner med ulik vekt, fylt og validert', async () => {
    const context = freshContext()
    const deck = await newDeck(context, { title: 'To kolonner', firstSlideHasTitle: true })
    const slideId = deck.slides[0].slideId

    await ok(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      slideId,
      spans: [{ text: 'Figur og forklaring' }],
    })
    const nodeId = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      }),
    )

    // One card, not two zones with a gap between them: the whole point of the
    // subfield layout is a composition the zone tree cannot express.
    await ok(context, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      kind: 'titled-card',
      title: [{ text: 'To spalter' }],
      color: '#33475b',
    })
    const layout = await ok<SubfieldLayout>(context, 'adjust_subfields', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      subfieldCount: 2,
      axis: 'x',
      weights: [2, 1],
    })
    expect(layout.subfieldIds).toHaveLength(2)

    for (const [index, subfieldId] of layout.subfieldIds.entries()) {
      await ok(context, 'set_zone_text', {
        presentationId: deck.presentationId,
        slideId,
        nodeId,
        subfieldId,
        blocks: paragraph(index === 0 ? 'Den brede spalten bærer hovedteksten.' : 'Den smale.'),
      })
    }

    const zone = await zoneView(context, { presentationId: deck.presentationId, slideId, nodeId })
    expect(zone.contentKind).toBe('titled-card')
    expect(zone.subfieldAxis).toBe('x')
    expect(zone.subfieldWeights).toEqual([2, 1])
    expect(zone.subfields?.map((field) => field.blocks)).toEqual([
      paragraph('Den brede spalten bærer hovedteksten.'),
      paragraph('Den smale.'),
    ])
    expect(zone.fits).toBe(true)

    const report = await ok<ValidationReport>(context, 'validate_presentation', {
      presentationId: deck.presentationId,
    })
    expect(report.valid).toBe(true)
    expect(report.issues).toEqual([])
  })
})

describe('fargen på et kort med tittel', () => {
  it('kan nullstilles til forsidens farge gjennom set_zone_card', async () => {
    const context = freshContext()
    const deck = await newDeck(context, { title: 'Kortfarge' })
    const slideId = deck.slides[0].slideId
    const nodeId = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      }),
    )

    await ok(context, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      kind: 'titled-card',
      title: [{ text: 'Tittel' }],
      color: '#204060',
    })

    const withColor = await stored(context, deck.presentationId)
    const coloured = findLeaf(withColor.slides[0].root, nodeId)
    if (coloured?.content?.kind !== 'titled-card') throw new Error('expected titled-card')
    expect(coloured.content.headerColor).toBe('#204060')

    await ok(context, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      kind: 'titled-card',
      color: null,
    })

    const reset = await stored(context, deck.presentationId)
    const inherited = findLeaf(reset.slides[0].root, nodeId)
    if (inherited?.content?.kind !== 'titled-card') throw new Error('expected titled-card')
    expect(inherited.content.headerColor).toBeNull()
  })

  it('avvises for et kort uten tittel, som ikke har noen arvet farge', async () => {
    const context = freshContext()
    const deck = await newDeck(context, { title: 'Kortfarge' })
    const slideId = deck.slides[0].slideId
    const nodeId = firstZone(
      await ok<SlideInspection>(context, 'inspect_slide', {
        presentationId: deck.presentationId,
        slideId,
      }),
    )

    await ok(context, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      kind: 'untitled-card',
    })

    const error = await fails(context, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId,
      nodeId,
      kind: 'untitled-card',
      color: null,
    })
    expect(error.code).toBe('INVALID_CONTENT')
  })
})
