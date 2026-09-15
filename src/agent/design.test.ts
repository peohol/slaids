/**
 * «Menneskets evolusjon», kept as a regression.
 *
 * `server/mcp/instructions.test.ts` checks that the design rules reach an
 * agent. This file checks the other thing a rule needs in order to be worth
 * stating: that the shape it asks for is actually reachable through the
 * operations, on the material that produced the failure, and that the shape it
 * warns against is visible in what an agent reads back.
 *
 * The deck that prompted it was about named hominin species. It came back as
 * slide after slide of one transparent container holding a heading and a
 * paragraph, with almost no pictures planned — every slide valid, none of them
 * framed, and nothing in the deck a reader could scan. Two mechanisms produced
 * that, and both are tested here rather than argued about:
 *
 *  - a zone that is written into becomes a container, so «split and write» is
 *    the cheapest route through the API and it never asks what the zone is;
 *  - a reservation for a picture has no minimum size, so planning a picture
 *    the agent cannot generate is easy to skip and easy to get wrong.
 *
 * The named species are also the case where the framing rule and the picture
 * rules meet: three species are both named peers and a subject where pictures
 * belong, so the peer a picture carries has to be reachable as a
 * `titled-image-card` and not only as a text card. That is tested here too —
 * with the file placed, and with the file still to be made.
 *
 * Nothing here judges a deck. The domain deliberately does not decide whether a
 * slide communicates, and a test that tried would be inventing a validator the
 * product does not have. What is asserted is weaker and more useful: the weak
 * form is readable as facts, the recommended form is legal, and the rules that
 * separate them are on the surface the agent reads.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { SlaidsDatabase } from '../persistence/db'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import {
  CARD_FRAMING_RULE,
  IMAGE_USAGE_RULE,
  IMPLICIT_CONTAINER_RULE,
  NAMED_UNITS,
  REPEATED_FALLBACK_RULE,
} from './design'
import { runOperation } from './registry'
import { MCP_INSTRUCTIONS } from '../server/mcp/instructions'
import { mcpTools } from '../server/mcp/tools'
import type { ContentSlideInspection, PresentationView, ZoneInspection } from './operations/deck'
import type { ZoneChange } from './operations/layout'
import type { AgentContext, AgentError, AgentResult } from './types'

/**
 * The three named, parallel units the observed deck buried in prose.
 *
 * `label` is what goes on a card title and `name` is the full binomial, because
 * a card title is one line that does not wrap: the full name of the first
 * species does not fit the width three peers get, and an agent that read that
 * refusal as «a card will not work here» would go straight back to a container.
 * That is the trap the tests below pin down.
 */
const SPECIES = [
  {
    name: 'Australopithecus afarensis',
    label: 'A. afarensis',
    text: 'Oppreist gange, hjerne på størrelse med sjimpansens.',
  },
  {
    name: 'Homo erectus',
    label: 'Homo erectus',
    text: 'Første art som spredte seg ut av Afrika.',
  },
  {
    name: 'Homo neanderthalensis',
    label: 'Neandertaler',
    text: 'Kraftig bygd, tilpasset kaldt klima i Europa.',
  },
]

const BRIEF =
  'Fotorealistiske vitenskapelige rekonstruksjoner, naturlig dagslys, dempet jordfargepalett, ingen tekst eller rammer.'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshContext(): AgentContext {
  counter += 1
  const database = new SlaidsDatabase(`slaids-design-${counter}`)
  databases.push(database)
  return { repository: new DexieSlaidsRepository(database) }
}

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

async function ok<T>(
  context: AgentContext,
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const result = (await runOperation(context, name, input)) as AgentResult<T>
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
  const result = await runOperation(context, name, input)
  if (result.ok) throw new Error('Forventet en feil')
  return result.error
}

interface Slide {
  presentationId: string
  slideId: string
  rootNodeId: string
}

async function slideWithThreeZones(
  context: AgentContext,
): Promise<Slide & { columnIds: string[] }> {
  const deck = await ok<PresentationView>(context, 'create_presentation', {
    title: 'Menneskets evolusjon',
  })
  const slideId = deck.slides[1].slideId
  const rootNodeId = (
    await ok<ContentSlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
  ).rootNodeId

  const split = await ok<ZoneChange & { childNodeIds: string[] }>(context, 'split_zone', {
    presentationId: deck.presentationId,
    slideId,
    nodeId: rootNodeId,
    axis: 'x',
    weights: [1, 1, 1],
  })
  return {
    presentationId: deck.presentationId,
    slideId,
    rootNodeId,
    columnIds: split.childNodeIds,
  }
}

async function zones(context: AgentContext, slide: Slide): Promise<ZoneInspection[]> {
  const inspected = await ok<ContentSlideInspection>(context, 'inspect_slide', {
    presentationId: slide.presentationId,
    slideId: slide.slideId,
  })
  return inspected.zones
}

function zoneOf(all: ZoneInspection[], nodeId: string): ZoneInspection {
  const zone = all.find((entry) => entry.nodeId === nodeId)
  if (!zone) throw new Error(`Fant ikke sonen ${nodeId}`)
  return zone
}

/** The weak form, built the way it was built: split, then write. */
async function writeSpeciesAsText(context: AgentContext, slide: Slide & { columnIds: string[] }) {
  for (const [index, species] of SPECIES.entries()) {
    await ok(context, 'set_zone_text', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: slide.columnIds[index],
      blocks: [
        { type: 'heading', spans: [{ text: species.name }] },
        { type: 'paragraph', spans: [{ text: species.text }] },
      ],
    })
  }
}

describe('mønsteret dekket falt tilbake til', () => {
  it('er det agenten får av å dele og skrive, uten å ha valgt noe', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)
    await writeSpeciesAsText(context, slide)

    // Three named species, three transparent containers — and not one call in
    // between where a content kind was chosen. This is the mechanism, not a
    // preference: it is what an empty zone becomes when text arrives.
    const leaves = (await zones(context, slide)).filter((zone) => zone.kind === 'leaf')
    expect(leaves.map((zone) => zone.contentKind)).toEqual([
      'container',
      'container',
      'container',
    ])
  })

  it('er lesbart som fakta, så selvsjekken faktisk kan gjøres', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)
    await writeSpeciesAsText(context, slide)

    // The self-check asks the agent to notice a pattern across its own deck.
    // That is only possible if the pattern is in what it reads back: the kind
    // every zone ended up as, whether any zone is reserved for a picture, and
    // whether the deck has a brief. All three, from the ordinary read calls.
    const deck = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: slide.presentationId,
    })
    const leaves = (await zones(context, slide)).filter((zone) => zone.kind === 'leaf')

    expect(leaves.every((zone) => zone.contentKind === 'container')).toBe(true)
    expect(leaves.some((zone) => zone.notePurpose === 'image-prompt')).toBe(false)
    expect(deck.imageBrief).toBeNull()
  })
})

describe('formen reglene ber om, på det samme stoffet', () => {
  it('lar hver art bli et titled-card med artsnavnet som korttittel', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)

    for (const [index, species] of SPECIES.entries()) {
      await ok(context, 'set_zone_card', {
        presentationId: slide.presentationId,
        slideId: slide.slideId,
        nodeId: slide.columnIds[index],
        kind: 'titled-card',
        title: [{ text: species.label }],
      })
      await ok(context, 'set_zone_text', {
        presentationId: slide.presentationId,
        slideId: slide.slideId,
        nodeId: slide.columnIds[index],
        blocks: [{ type: 'paragraph', spans: [{ text: `${species.name}. ${species.text}` }] }],
      })
    }

    // The recommended shape is not merely allowed — it fits, at the width three
    // peers actually get, with the species names in the titles.
    const all = await zones(context, slide)
    for (const [index, species] of SPECIES.entries()) {
      const zone = zoneOf(all, slide.columnIds[index])
      expect(zone.contentKind).toBe('titled-card')
      expect(zone.cardTitle?.map((span) => ('text' in span ? span.text : ''))).toEqual([
        species.label,
      ])
      expect(zone.fits).toBe(true)
    }
  })

  it('avviser en for lang korttittel, og regelen sier at svaret er å korte den ned', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)

    // A card title is one line and does not wrap, so the full binomial is
    // refused at the width three peers get. This is the moment the observed
    // deck would have been lost: the refusal reads like «a card does not work
    // here», and a container accepts any heading because a heading wraps.
    const refused = await fails(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: slide.columnIds[0],
      kind: 'titled-card',
      title: [{ text: SPECIES[0].name }],
    })
    expect(refused.code).toBe('CONTENT_DOES_NOT_FIT')

    // The shortened label is accepted, and the rule an agent has already read
    // says that this — not a container — is what a refused title asks for.
    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: slide.columnIds[0],
      kind: 'titled-card',
      title: [{ text: SPECIES[0].label }],
    })
    expect(zoneOf(await zones(context, slide), slide.columnIds[0]).contentKind).toBe('titled-card')
    expect(CARD_FRAMING_RULE).toMatch(/kort ned tittelen/i)
    expect(CARD_FRAMING_RULE).toMatch(/aldri en grunn til å droppe rammen/i)
  })

  it('reserverer en sone til en rekonstruksjon og bekrefter at reservasjonen holder', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)

    const column = slide.columnIds[0]
    const stacked = await ok<ZoneChange & { childNodeIds: string[] }>(context, 'split_zone', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
      axis: 'y',
      weights: [3, 2],
    })
    const pictureZone = stacked.childNodeIds[0]

    // Before the note: the zone advertises that a picture could live here.
    expect(zoneOf(await zones(context, slide), pictureZone).availableContentKinds).toContain(
      'image',
    )

    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: pictureZone,
      kind: 'note',
      notePurpose: 'image-prompt',
      noteText:
        'Vitenskapelig rekonstruksjon av Australopithecus afarensis i helfigur, oppreist gange tydelig, nøytral bakgrunn.',
    })

    // After the note: `availableContentKinds` can no longer answer — a note with
    // text in it offers nothing but `note` until the zone is cleared — so the
    // reservation would be unverifiable without this.
    const reserved = zoneOf(await zones(context, slide), pictureZone)
    expect(reserved.notePurpose).toBe('image-prompt')
    expect(reserved.availableContentKinds).toEqual(['note'])
    // Both picture kinds, because this zone is roomy enough for the framed one
    // too — which is the reservation a named member of a series needs.
    expect(reserved.reservedImageKinds).toEqual(['image', 'titled-image-card'])
  })

  it('tar imot dekkets felles bildebrief selv om bare ett rasterbilde er planlagt', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)

    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: slide.columnIds[0],
      kind: 'note',
      notePurpose: 'image-prompt',
      noteText: 'Rekonstruksjon av Homo erectus, halvfigur, sidelys.',
    })
    await ok(context, 'set_image_brief', { presentationId: slide.presentationId, brief: BRIEF })

    // One planned picture is enough for the deck to have a premise, and the
    // brief comes back beside the slides rather than from a second call.
    const deck = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: slide.presentationId,
    })
    expect(deck.imageBrief).toBe(BRIEF)
  })
})

describe('den navngitte serien der bildet bærer enheten', () => {
  /**
   * A stand-in file, so the test is about the zone rather than about pixels.
   *
   * Vector here only because a test needs bytes it can write down; the policy
   * an agent reads says a species reconstruction is a raster picture, and the
   * path this test walks is the same one a raster file takes.
   */
  const FILE = '<svg viewBox="0 0 120 60"><rect width="120" height="60" fill="#0af"/></svg>'

  it('lar de tre artene bli titled image cards med artsnavnet i tittelen', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)

    const asset = await ok<{ assetId: string }>(context, 'create_svg_asset', {
      presentationId: slide.presentationId,
      name: 'rekonstruksjon',
      svgMarkup: FILE,
    })

    for (const [index, species] of SPECIES.entries()) {
      // The frame first, with the name in it, and the file second: the card is
      // what makes the picture a named member of a series rather than three
      // unrelated pictures in a row.
      await ok(context, 'set_zone_card', {
        presentationId: slide.presentationId,
        slideId: slide.slideId,
        nodeId: slide.columnIds[index],
        kind: 'titled-image-card',
        title: [{ text: species.label }],
      })
      await ok(context, 'set_zone_asset', {
        presentationId: slide.presentationId,
        slideId: slide.slideId,
        nodeId: slide.columnIds[index],
        assetId: asset.assetId,
      })
    }

    const all = await zones(context, slide)
    for (const [index, species] of SPECIES.entries()) {
      const zone = zoneOf(all, slide.columnIds[index])
      // The file went into the panel the card was already waiting with, so the
      // title survived: placing a picture did not flatten the peer into a bare
      // image.
      expect(zone.contentKind).toBe('titled-image-card')
      expect(zone.image?.assetId).toBe(asset.assetId)
      expect(zone.cardTitle?.map((span) => ('text' in span ? span.text : ''))).toEqual([
        species.label,
      ])
      expect(zone.fits).toBe(true)
    }
  })

  it('planlegger den samme serien uten en bildegenerator, og gir sonen videre', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)
    const column = slide.columnIds[0]

    // No generator: reserve the zone with the prompt, and check that what is
    // reserved is the framed kind the series needs — not merely «a picture».
    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
      kind: 'note',
      notePurpose: 'image-prompt',
      noteText: `Vitenskapelig rekonstruksjon av ${SPECIES[0].name}, helfigur, nøytral bakgrunn.`,
    })
    await ok(context, 'set_image_brief', { presentationId: slide.presentationId, brief: BRIEF })

    expect(zoneOf(await zones(context, slide), column).reservedImageKinds).toContain(
      'titled-image-card',
    )

    // And the hand-over works: the prompt goes to the sandbox, the zone becomes
    // the card the reservation promised, and the file lands inside it.
    const asset = await ok<{ assetId: string }>(context, 'create_svg_asset', {
      presentationId: slide.presentationId,
      name: 'afarensis',
      svgMarkup: FILE,
    })
    await ok(context, 'clear_zone', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
    })
    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
      kind: 'titled-image-card',
      title: [{ text: SPECIES[0].label }],
    })
    await ok(context, 'set_zone_asset', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
      assetId: asset.assetId,
    })

    const zone = zoneOf(await zones(context, slide), column)
    expect(zone.contentKind).toBe('titled-image-card')
    expect(zone.image?.assetId).toBe(asset.assetId)
    expect(zone.fits).toBe(true)
  })
})

describe('reservasjonen sier fra når den ikke lenger holder', () => {
  it('svarer false når sonen er blitt for liten til et bilde', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)

    const column = slide.columnIds[0]
    const stacked = await ok<ZoneChange & { childNodeIds: string[] }>(context, 'split_zone', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
      axis: 'y',
      weights: [3, 2],
    })
    const pictureZone = stacked.childNodeIds[0]
    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: pictureZone,
      kind: 'note',
      notePurpose: 'image-prompt',
      noteText: 'Rekonstruksjon av Homo neanderthalensis, portrett.',
    })

    // A note has no minimum size, so nothing refuses this — which is exactly
    // why the reservation has to be able to say that it broke.
    await ok(context, 'adjust_split', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
      weights: [1, 10],
    })

    const reserved = zoneOf(await zones(context, slide), pictureZone)
    expect(reserved.notePurpose).toBe('image-prompt')
    expect(reserved.reservedImageKinds).toEqual([])
  })

  it('skiller den bare bildetypen fra den innrammede, som trenger mer plass', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)

    // Narrow enough that a picture still fits but a titled picture card does
    // not: the card's header needs a text zone's width above the picture. A
    // single yes-or-no would have called this reservation sound and left the
    // named peer to fail on the day its file arrived.
    const column = slide.columnIds[0]
    const narrow = await ok<ZoneChange & { childNodeIds: string[] }>(context, 'split_zone', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
      axis: 'x',
      weights: [1, 2],
    })
    const pictureZone = narrow.childNodeIds[0]
    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: pictureZone,
      kind: 'note',
      notePurpose: 'image-prompt',
      noteText: 'Utsnitt av hodeskalle, sett fra siden.',
    })

    const reserved = zoneOf(await zones(context, slide), pictureZone)
    expect(reserved.reservedImageKinds).toEqual(['image'])

    // And the list is the truth: the kind it left out really is refused.
    await ok(context, 'clear_zone', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: pictureZone,
    })
    const refused = await fails(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: pictureZone,
      kind: 'titled-image-card',
    })
    expect(refused.code).toBe('ZONE_TOO_SMALL')
    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: pictureZone,
      kind: 'image',
    })
  })

  it('spør ikke om bildet i et notat som ikke reserverer noe', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)

    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: slide.columnIds[0],
      kind: 'note',
      notePurpose: 'general',
      noteText: 'Sjekk dateringen mot nyere funn før framføring.',
    })

    const zone = zoneOf(await zones(context, slide), slide.columnIds[0])
    expect(zone.notePurpose).toBe('general')
    expect(zone.reservedImageKinds).toBeUndefined()
  })
})

describe('reglene som gjør den svake formen dyrere å velge', () => {
  it('svarer på alle tre feilene på flaten agenten faktisk leser', () => {
    const surface = `${MCP_INSTRUCTIONS}\n${mcpTools()
      .map((tool) => tool.description)
      .join('\n')}`

    // 1. The species should have been framed, and the rule names the units.
    expect(surface).toContain(CARD_FRAMING_RULE)
    expect(NAMED_UNITS).toContain('arter')

    // 2. The container they got instead is a default, and it is said to be one
    //    on the call that applies it — not only on the call an agent that took
    //    this route never makes.
    expect(surface).toContain(IMPLICIT_CONTAINER_RULE)
    const textTool = mcpTools().find((tool) => tool.name.endsWith('set_zone_text'))
    expect(textTool?.description).toContain(IMPLICIT_CONTAINER_RULE)

    // 3. The pictures were never planned, and the rule names both the subject
    //    and the pictures worth looking for.
    expect(surface).toContain(IMAGE_USAGE_RULE)
    expect(IMAGE_USAGE_RULE).toMatch(/dyr og arter/)
    expect(IMAGE_USAGE_RULE).toMatch(/rekonstruksjon av en art/)

    // And the self-check names the pattern as it actually appeared: a heading
    // and a paragraph, with no bullet list in sight.
    expect(REPEATED_FALLBACK_RULE).toMatch(/gjennomsiktig container med overskrift/i)
  })
})
