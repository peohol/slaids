/**
 * The agent's half of the note workflow, end to end.
 *
 * Everything goes through `runOperation` against a real repository, for the
 * reasons `workflow.test.ts` gives: this is the door an agent actually enters.
 * What is checked here is the loop the workflow needs to be usable at all —
 *
 *     compose → reserve the zone → leave a prompt → come back and read it →
 *     refine it → hand the zone over to the picture
 *
 * — plus the two promises that make it safe: a note never reads as overflowing
 * content, and the deck's brief is one call away from every prompt written
 * against it.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { MAX_NOTE_CHARS, MAX_IMAGE_BRIEF_CHARS } from '../domain/constants'
import { SlaidsDatabase } from '../persistence/db'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import { IMAGE_BRIEF_RULE, IMAGE_NOTE_POLICY } from './design'
import { describeOperations, runOperation } from './registry'
import { MCP_INSTRUCTIONS } from '../server/mcp/instructions'
import type { ContentSlideInspection, PresentationView } from './operations/deck'
import type { SandboxItemView } from './operations/sandbox'
import type { ZoneChange } from './operations/layout'
import type { AgentContext, AgentError, AgentResult } from './types'

const BRIEF =
  'Fotorealistiske vitenskapelige rekonstruksjoner, naturlig dagslys, dempet jordfargepalett, ingen tekst eller rammer.'
const PROMPT =
  'Voksen neandertaler i et paleolittisk europeisk landskap. Halvfigur, motivet i venstre tredjedel, høyre tredjedel visuelt roligere.'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshContext(): AgentContext {
  counter += 1
  const database = new SlaidsDatabase(`slaids-note-${counter}`)
  databases.push(database)
  return { repository: new DexieSlaidsRepository(database) }
}

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

async function call<T>(
  context: AgentContext,
  name: string,
  input: Record<string, unknown> = {},
): Promise<AgentResult<T>> {
  return (await runOperation(context, name, input)) as AgentResult<T>
}

async function ok<T>(
  context: AgentContext,
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const result = await call<T>(context, name, input)
  if (!result.ok) {
    throw new Error(`Forventet suksess, fikk ${result.error.code}: ${result.error.message}`)
  }
  return result.value
}

async function fails(
  context: AgentContext,
  name: string,
  input: Record<string, unknown> = {},
): Promise<AgentError> {
  const result = await call(context, name, input)
  if (result.ok) throw new Error('Forventet en feil')
  return result.error
}

/** A deck with one content slide, and the ids of its single zone. */
async function deckWithZone(context: AgentContext): Promise<{
  presentationId: string
  slideId: string
  nodeId: string
}> {
  const deck = await ok<PresentationView>(context, 'create_presentation', { title: 'Evolusjon' })
  const slideId = deck.slides[1].slideId
  const inspected = await ok<ContentSlideInspection>(context, 'inspect_slide', {
    presentationId: deck.presentationId,
    slideId,
  })
  return { presentationId: deck.presentationId, slideId, nodeId: inspected.rootNodeId }
}

function zoneOf(inspected: ContentSlideInspection, nodeId: string) {
  const zone = inspected.zones.find((entry) => entry.nodeId === nodeId)
  if (!zone) throw new Error(`Fant ikke sonen ${nodeId}`)
  return zone
}

describe('agenten kan opprette, lese og endre et notat', () => {
  it('lager et notat i en sone og leser det tilbake med contentKind og tekst', async () => {
    const context = freshContext()
    const target = await deckWithZone(context)

    await ok(context, 'set_zone_card', {
      ...target,
      kind: 'note',
      noteText: PROMPT,
      notePurpose: 'image-prompt',
    })

    const zone = zoneOf(
      await ok<ContentSlideInspection>(context, 'inspect_slide', {
        presentationId: target.presentationId,
        slideId: target.slideId,
      }),
      target.nodeId,
    )
    expect(zone.contentKind).toBe('note')
    expect(zone.noteText).toBe(PROMPT)
    expect(zone.notePurpose).toBe('image-prompt')
    // A note draws nothing, so it can never be the thing that overflows.
    expect(zone.fits).toBe(true)
    expect(zone.overflow).toBe(0)
    // And nothing it holds is mistaken for a card's text or a picture's file.
    expect(zone.subfields).toEqual([])
    expect(zone.assetIds).toEqual([])
  })

  it('skiller et notat fra en tom sone og fra negativt rom', async () => {
    const context = freshContext()
    const target = await deckWithZone(context)
    const read = async () =>
      zoneOf(
        await ok<ContentSlideInspection>(context, 'inspect_slide', {
          presentationId: target.presentationId,
          slideId: target.slideId,
        }),
        target.nodeId,
      )

    // Three states, all of which draw nothing, and all of which a caller has to
    // be able to tell apart without looking at what is painted.
    expect(await read()).toMatchObject({ empty: true })
    expect((await read()).contentKind).toBeUndefined()

    await ok(context, 'set_zone_card', { ...target, kind: 'negative-space' })
    expect(await read()).toMatchObject({ empty: false, contentKind: 'negative-space' })
    expect((await read()).noteText).toBeUndefined()

    await ok(context, 'set_zone_card', { ...target, kind: 'note', noteText: PROMPT })
    expect(await read()).toMatchObject({ empty: false, contentKind: 'note', noteText: PROMPT })
  })

  it('oppdaterer teksten uten å miste formålet, og omvendt', async () => {
    const context = freshContext()
    const target = await deckWithZone(context)
    await ok(context, 'set_zone_card', {
      ...target,
      kind: 'note',
      noteText: PROMPT,
      notePurpose: 'image-prompt',
    })

    await ok(context, 'set_zone_card', { ...target, kind: 'note', noteText: 'Strammere utsnitt.' })
    let zone = zoneOf(
      await ok<ContentSlideInspection>(context, 'inspect_slide', {
        presentationId: target.presentationId,
        slideId: target.slideId,
      }),
      target.nodeId,
    )
    expect(zone).toMatchObject({ noteText: 'Strammere utsnitt.', notePurpose: 'image-prompt' })

    await ok(context, 'set_zone_card', { ...target, kind: 'note', notePurpose: 'general' })
    zone = zoneOf(
      await ok<ContentSlideInspection>(context, 'inspect_slide', {
        presentationId: target.presentationId,
        slideId: target.slideId,
      }),
      target.nodeId,
    )
    expect(zone).toMatchObject({ noteText: 'Strammere utsnitt.', notePurpose: 'general' })
  })

  it('tilbyr notat som innholdstype også i en sone som er for liten for alt annet', async () => {
    const context = freshContext()
    const target = await deckWithZone(context)
    const split = await ok<ZoneChange & { childNodeIds: string[] }>(context, 'split_zone', {
      presentationId: target.presentationId,
      slideId: target.slideId,
      nodeId: target.nodeId,
      axis: 'y',
      weights: [1, 10, 1],
    })
    const sliver = zoneOf(
      await ok<ContentSlideInspection>(context, 'inspect_slide', {
        presentationId: target.presentationId,
        slideId: target.slideId,
      }),
      split.childNodeIds[0],
    )
    expect(sliver.availableContentKinds).toContain('note')
  })

  it('avviser notatfelter på en annen innholdstype', async () => {
    const context = freshContext()
    const target = await deckWithZone(context)
    const refused = await fails(context, 'set_zone_card', {
      ...target,
      kind: 'container',
      noteText: PROMPT,
    })
    expect(refused.code).toBe('INVALID_ARGUMENT')
  })

  it('avviser farge og subfelter på et notat', async () => {
    const context = freshContext()
    const target = await deckWithZone(context)
    const refused = await fails(context, 'set_zone_card', {
      ...target,
      kind: 'note',
      subfieldCount: 2,
    })
    expect(refused.code).toBe('INVALID_ARGUMENT')
  })

  it('avviser en notattekst som er lengre enn grensen, uten å lagre noe', async () => {
    const context = freshContext()
    const target = await deckWithZone(context)
    await fails(context, 'set_zone_card', {
      ...target,
      kind: 'note',
      noteText: 'x'.repeat(MAX_NOTE_CHARS + 1),
    })
    const zone = zoneOf(
      await ok<ContentSlideInspection>(context, 'inspect_slide', {
        presentationId: target.presentationId,
        slideId: target.slideId,
      }),
      target.nodeId,
    )
    expect(zone.empty).toBe(true)
  })
})

describe('notatet gir sonen videre til bildet', () => {
  it('avviser en direkte konvertering og peker på sandkassen', async () => {
    const context = freshContext()
    const target = await deckWithZone(context)
    await ok(context, 'set_zone_card', { ...target, kind: 'note', noteText: PROMPT })
    const refused = await fails(context, 'set_zone_card', { ...target, kind: 'container' })
    expect(refused.code).toBe('INVALID_CONTENT')
    expect(refused.message).toContain('sandkassen')
  })

  it('lar sonen bli et bilde etter clear_zone, med sonetreet uendret', async () => {
    const context = freshContext()
    const target = await deckWithZone(context)
    await ok(context, 'set_zone_card', { ...target, kind: 'note', noteText: PROMPT, notePurpose: 'image-prompt' })

    const before = await ok<ContentSlideInspection>(context, 'inspect_slide', {
      presentationId: target.presentationId,
      slideId: target.slideId,
    })

    await ok(context, 'clear_zone', {
      presentationId: target.presentationId,
      slideId: target.slideId,
      nodeId: target.nodeId,
    })
    await ok(context, 'set_zone_card', { ...target, kind: 'container' })

    const after = await ok<ContentSlideInspection>(context, 'inspect_slide', {
      presentationId: target.presentationId,
      slideId: target.slideId,
    })
    // The composition is untouched: same zones, same rectangles.
    expect(after.zones.map((zone) => ({ nodeId: zone.nodeId, rect: zone.rect }))).toEqual(
      before.zones.map((zone) => ({ nodeId: zone.nodeId, rect: zone.rect })),
    )
    expect(zoneOf(after, target.nodeId).contentKind).toBe('container')

    // The prompt is not gone — it is parked, readable, and placeable again.
    const sandbox = await ok<{ items: SandboxItemView[] }>(context, 'list_sandbox_items', {
      presentationId: target.presentationId,
    })
    expect(sandbox.items).toHaveLength(1)
    expect(sandbox.items[0]).toMatchObject({
      contentKind: 'note',
      noteText: PROMPT,
      notePurpose: 'image-prompt',
    })
  })
})

describe('bildebriefen', () => {
  it('settes, leses tilbake med presentasjonen, og endres', async () => {
    const context = freshContext()
    const deck = await ok<PresentationView>(context, 'create_presentation', { title: 'Evolusjon' })
    expect(deck.imageBrief).toBeNull()

    const written = await ok<PresentationView>(context, 'set_image_brief', {
      presentationId: deck.presentationId,
      brief: BRIEF,
    })
    expect(written.imageBrief).toBe(BRIEF)

    const read = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    expect(read.imageBrief).toBe(BRIEF)

    const cleared = await ok<PresentationView>(context, 'set_image_brief', {
      presentationId: deck.presentationId,
      brief: null,
    })
    expect(cleared.imageBrief).toBeNull()
  })

  it('avvises når den er lengre enn grensen', async () => {
    const context = freshContext()
    const deck = await ok<PresentationView>(context, 'create_presentation', { title: 'x' })
    const refused = await fails(context, 'set_image_brief', {
      presentationId: deck.presentationId,
      brief: 'x'.repeat(MAX_IMAGE_BRIEF_CHARS + 1),
    })
    // Refused by the operation's own schema, before anything is loaded.
    expect(refused.code).toBe('INVALID_INPUT')
  })

  it('skriver mot den revisjonen kalleren leste', async () => {
    const context = freshContext()
    const deck = await ok<PresentationView>(context, 'create_presentation', { title: 'x' })
    await ok(context, 'set_presentation_title', {
      presentationId: deck.presentationId,
      expectedRevision: deck.revision,
      title: 'Noen andre skrev',
    })
    const conflict = await fails(context, 'set_image_brief', {
      presentationId: deck.presentationId,
      expectedRevision: deck.revision,
      brief: BRIEF,
    })
    expect(conflict.code).toBe('CONFLICT')
  })
})

describe('katalogen forklarer semantikken den krever', () => {
  /** Everything an agent reads about one operation: its summary and its schema. */
  function prose(name: string): string {
    const operation = describeOperations().find((entry) => entry.name === name)
    if (!operation) throw new Error(`Fant ingen operasjon som heter ${name}`)
    return `${operation.summary}\n${JSON.stringify(operation.inputSchema)}`
  }

  it('sier på set_zone_card hva et notat er, og hvordan det reserverer et bilde', () => {
    const card = prose('set_zone_card')
    // The two things a caller cannot guess from the enum member alone: it is
    // never presented, and the zone keeps the geometry for what comes next.
    expect(card).toMatch(/aldri vises for publikum/)
    expect(card).toMatch(/reservere geometrien/)
    // Asserted against the constant rather than against wording: the rules live
    // in `agent/design.ts` so each normative sentence has one home, and a rule
    // that is reworded there stays tested here — see `instructions.test.ts`.
    for (const rule of IMAGE_NOTE_POLICY) expect(card).toContain(rule)
  })

  it('sier på set_image_brief at briefen er uttrykket, aldri motivet', () => {
    const described = describeOperations().find((entry) => entry.name === 'set_image_brief')
    expect(described?.requiredScopes).toEqual(['presentations:write'])
    const brief = prose('set_image_brief')
    expect(brief).toMatch(/aldri for publikum/)
    expect(brief).toContain(IMAGE_BRIEF_RULE)
    expect(IMAGE_BRIEF_RULE).toMatch(/aldri hva et enkelt bilde skal vise/)
  })

  it('sier det bare ett sted: ingen av reglene står også i systeminstruksen', () => {
    // The contract `instructions.test.ts` states for the rules that came before
    // these, applied to the two this PR adds: detail rides on the tool that
    // applies it, and the instruction carries what changes the first call.
    for (const rule of [...IMAGE_NOTE_POLICY, IMAGE_BRIEF_RULE]) {
      expect(MCP_INSTRUCTIONS).not.toContain(rule)
    }
  })
})
