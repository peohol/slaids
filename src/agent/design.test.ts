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
  NATIVE_COMPOSITION_RULE,
  REFERENCE_SYSTEM_RULE,
  REPEATED_FALLBACK_RULE,
  VECTOR_POLICY,
  VISUAL_QA_RULE,
} from './design'
import { PLANNED_IMAGE_FIELDS, REQUIRED_PLANNED_IMAGE_FIELDS } from '../domain/constants'
import {
  IMAGE_WORKFLOW_COMPLETION_CRITERIA,
  IMAGE_WORKFLOW_FORBIDDEN_CLOSINGS,
} from '../domain/imageWorkflow'
import { realImages } from '../domain/testImages'
import { describeOperations, runOperation } from './registry'
import { MCP_INSTRUCTIONS } from '../server/mcp/instructions'
import { mcpTools } from '../server/mcp/tools'
import type {
  ContentSlideInspection,
  ImageBriefView,
  PresentationView,
  ZoneInspection,
} from './operations/deck'
import type { ZoneChange } from './operations/layout'
import type { SlidePlacement } from './operations/slides'
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

const CONTEXT =
  'Fotorealistiske vitenskapelige rekonstruksjoner, naturlig dagslys, dempet jordfargepalett, ingen tekst eller rammer.'

/**
 * Eight motifs that are actually eight different pictures.
 *
 * The deck that produced the multi-picture failure had a plan this size, and a
 * test of it has to pass the deck's own checks: entries that merely count
 * upwards share every significant word and come back as `NEAR_DUPLICATE`, which
 * would make the test about the duplicate rule instead of about the count.
 */
const MOTIFS = [
  'Savannelandskap med spredte akasier i tidlig morgenlys.',
  'Fotavtrykk bevart i vulkansk aske, sett ovenfra.',
  'En håndkile av flint, holdt mellom to fingre.',
  'Leirbål omgitt av brente knokler og kullrester.',
  'Hulemaleri av okse på ujevn kalksteinsvegg.',
  'Spydspiss av bein, festet til et skaft med senetråd.',
  'Isbre som møter en gresslette under lav sol.',
  'Kranium i utstillingsmonter, belyst forfra.',
]

/** One plan entry, so the tests say what differs rather than repeating a shape. */
function planned(slideId: string, nodeId: string, subject: string) {
  return {
    slideId,
    nodeId,
    subject,
    composition: 'Motivet sentrert, rolig bakgrunn.',
    requirements: 'Anatomisk korrekte proporsjoner for arten.',
    avoid: 'Moderne klær, redskaper og bygninger.',
  }
}

/**
 * A deck with `count` picture slides, one reserved zone each, already planned.
 *
 * One slide per picture so the numbering is deck order and nothing about the
 * tree can make a second ordering plausible — and shared between the tests
 * about the count and the tests about the binding, because both are about the
 * same delivery and a second builder would let them drift apart.
 */
async function plannedPictureDeck(
  context: AgentContext,
  count: number,
): Promise<ImageBriefView> {
  const deck = await ok<PresentationView>(context, 'create_presentation', {
    title: 'Menneskets evolusjon',
  })
  const slideIds = [deck.slides[1].slideId]
  while (slideIds.length < count) {
    const added = await ok<SlidePlacement>(context, 'add_slide', {
      presentationId: deck.presentationId,
      title: `Bilde ${slideIds.length + 1}`,
    })
    slideIds.push(added.slideId)
  }

  const zoneIds: string[] = []
  for (const slideId of slideIds) {
    const inspected = await ok<ContentSlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId,
    })
    await ok(context, 'set_zone_card', {
      presentationId: deck.presentationId,
      slideId,
      nodeId: inspected.rootNodeId,
      kind: 'image',
    })
    zoneIds.push(inspected.rootNodeId)
  }
  await ok(context, 'set_image_context', {
    presentationId: deck.presentationId,
    context: CONTEXT,
  })

  return ok<ImageBriefView>(context, 'plan_deck_images', {
    presentationId: deck.presentationId,
    images: slideIds.map((slideId, index) => planned(slideId, zoneIds[index], MOTIFS[index])),
  })
}

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

/** A picture zone's caption as plain text, or `null` when it has none. */
function captionOf(zone: ZoneInspection): string | null {
  const spans = zone.image?.caption?.spans
  if (!spans) return null
  return spans.map((span) => ('text' in span ? span.text : '')).join('')
}

/**
 * A stand-in file, so the tests are about the zone rather than about pixels.
 *
 * Vector here only because a test needs bytes it can write down; the policy an
 * agent reads says a species reconstruction is a raster picture, and the path
 * these tests walk is the same one a raster file takes.
 */
const FILE = '<svg viewBox="0 0 120 60"><rect width="120" height="60" fill="#0af"/></svg>'

/** The weak form, built the way it was built: split, then write. */
async function writeSpeciesAsText(context: AgentContext, slide: Slide & { columnIds: string[] }) {
  for (const [index, species] of SPECIES.entries()) {
    await ok(context, 'set_zone_text', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: slide.columnIds[index],
      blocks: [
        { type: 'accent', spans: [{ text: species.name }] },
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
    // every zone ended up as, and whether any picture was planned at all. Both,
    // from the ordinary read calls.
    const leaves = (await zones(context, slide)).filter((zone) => zone.kind === 'leaf')
    expect(leaves.every((zone) => zone.contentKind === 'container')).toBe(true)

    const pictures = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: slide.presentationId,
    })
    expect(pictures.imageCount).toBe(0)
    expect(pictures.brief).toBeNull()
    expect(pictures.imageContext).toBeNull()
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

    // The reservation is a real picture zone waiting for its file — not a note
    // that draws nothing. That is what gives it a picture's minimum size.
    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: pictureZone,
      kind: 'image',
    })

    const reserved = zoneOf(await zones(context, slide), pictureZone)
    expect(reserved.contentKind).toBe('image')
    expect(reserved.image?.assetId).toBeNull()
    // Both picture kinds, because this zone is roomy enough for the framed one
    // too — which is the reservation a named member of a series needs.
    expect(reserved.reservedImageKinds).toEqual(['image', 'titled-image-card'])
  })

  it('stempler plassholderteksten i sonen når bildeplanen skrives', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)

    for (const nodeId of slide.columnIds.slice(0, 2)) {
      await ok(context, 'set_zone_card', {
        presentationId: slide.presentationId,
        slideId: slide.slideId,
        nodeId,
        kind: 'image',
      })
    }

    const brief = await ok<ImageBriefView>(context, 'plan_deck_images', {
      presentationId: slide.presentationId,
      images: [
        planned(slide.slideId, slide.columnIds[1], `Rekonstruksjon av ${SPECIES[1].name} i helfigur.`),
        planned(slide.slideId, slide.columnIds[0], `Rekonstruksjon av ${SPECIES[0].name} i helfigur.`),
      ],
    })

    // The numbering follows the deck, not the order the entries were sent in:
    // «bilde 1» has to be the first one you meet going through the slides, or
    // the placeholder on the slide and the brief mean different pictures.
    expect(brief.images.map((image) => image.nodeId)).toEqual([
      slide.columnIds[0],
      slide.columnIds[1],
    ])
    const all = await zones(context, slide)
    expect(captionOf(zoneOf(all, slide.columnIds[0]))).toBe('Sett inn bilde 1 her')
    expect(captionOf(zoneOf(all, slide.columnIds[1]))).toBe('Sett inn bilde 2 her')
  })

  it('tar bort plassholderen igjen når filen kommer', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)
    const column = slide.columnIds[0]

    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
      kind: 'image',
    })
    await ok(context, 'plan_deck_images', {
      presentationId: slide.presentationId,
      images: [planned(slide.slideId, column, 'Rekonstruksjon av Homo erectus i helfigur.')],
    })
    expect(captionOf(zoneOf(await zones(context, slide), column))).toBe('Sett inn bilde 1 her')

    const asset = await ok<{ assetId: string }>(context, 'create_svg_asset', {
      presentationId: slide.presentationId,
      name: 'rekonstruksjon',
      svgMarkup: '<svg viewBox="0 0 120 60"><rect width="120" height="60" fill="#0af"/></svg>',
    })
    await ok(context, 'set_zone_asset', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
      assetId: asset.assetId,
    })

    // The instruction has been carried out, so it stops being printed over the
    // finished deck.
    const zone = zoneOf(await zones(context, slide), column)
    expect(zone.image?.assetId).toBe(asset.assetId)
    expect(zone.image?.caption).toBeUndefined()
  })

  it('genererer én samlet brief med antall, format og motiv per bilde', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)

    for (const nodeId of slide.columnIds) {
      await ok(context, 'set_zone_card', {
        presentationId: slide.presentationId,
        slideId: slide.slideId,
        nodeId,
        kind: 'image',
      })
    }
    await ok(context, 'set_image_context', {
      presentationId: slide.presentationId,
      context: CONTEXT,
    })
    const brief = await ok<ImageBriefView>(context, 'plan_deck_images', {
      presentationId: slide.presentationId,
      images: SPECIES.map((species, index) =>
        planned(
          slide.slideId,
          slide.columnIds[index],
          `Vitenskapelig rekonstruksjon av ${species.name}: ${species.text}`,
        ),
      ),
    })

    expect(brief.imageCount).toBe(3)
    expect(brief.issues).toEqual([])
    // The brief is the deliverable, so it comes back with the plan that was
    // just written as well as with a later read of it.
    const asked = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    const text = asked.brief ?? ''
    expect(text).toBe(brief.brief)
    expect(text).toContain('Lag nøyaktig 3 separate bilder')
    expect(text).toContain(CONTEXT)
    for (const [index, species] of SPECIES.entries()) {
      expect(text).toContain(`BILDE ${index + 1} AV 3`)
      expect(text).toContain(species.name)
      // The shape is measured off the zone, never described: three columns of
      // one slide are the same rectangle, so all three say the same ratio.
      expect(text).toContain(`Aspect ratio: ${brief.images[index].aspectRatio}`)
    }
    // Three narrow columns are upright, which is precisely what a prose
    // description of «a reconstruction» would not have said.
    expect(new Set(brief.images.map((image) => image.orientation))).toEqual(new Set(['stående']))
  })

  it('melder fra når et motiv beskriver et annet format enn sonen faktisk har', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)
    const column = slide.columnIds[0]

    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
      kind: 'image',
    })
    await ok(context, 'set_image_context', {
      presentationId: slide.presentationId,
      context: CONTEXT,
    })
    const brief = await ok<ImageBriefView>(context, 'plan_deck_images', {
      presentationId: slide.presentationId,
      images: [
        {
          ...planned(slide.slideId, column, 'Bredt panorama over den øst-afrikanske riftdalen.'),
          composition: 'Liggende utsnitt, horisonten i nedre tredjedel.',
        },
      ],
    })

    // This is the regression: a wide prompt written for a near-upright zone.
    // The zone's own geometry is what the brief prints, so the two disagree —
    // and the check says so rather than leaving it to be discovered in the
    // generated picture.
    const mismatch = brief.issues.find((issue) => issue.code === 'ASPECT_MISMATCH')
    expect(mismatch?.message).toMatch(/liggende/i)
    expect(mismatch?.nodeId).toBe(column)
  })

  it.each(PLANNED_IMAGE_FIELDS)(
    'avviser et blankt «%s» på agentflaten nøyaktig når feltet er påkrevd',
    async (field) => {
      // The third boundary held to the same derived rule. `imagePlan.test.ts`
      // pins the domain command and the persisted schema; this is the one an
      // agent actually meets, and it has to refuse in the same round rather
      // than letting the call through to be refused a layer down.
      const context = freshContext()
      const slide = await slideWithThreeZones(context)
      await ok(context, 'set_zone_card', {
        presentationId: slide.presentationId,
        slideId: slide.slideId,
        nodeId: slide.columnIds[0],
        kind: 'image',
      })

      const images = [
        { ...planned(slide.slideId, slide.columnIds[0], 'Et motiv.'), [field]: '   ' },
      ]
      const result = await runOperation(context, 'plan_deck_images', {
        presentationId: slide.presentationId,
        images,
      })
      expect(result.ok, field).toBe(!REQUIRED_PLANNED_IMAGE_FIELDS.includes(field))
    },
  )

  it('tar imot dekkets felles bildekontekst selv om bare ett rasterbilde er planlagt', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)

    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: slide.columnIds[0],
      kind: 'image',
    })
    await ok(context, 'plan_deck_images', {
      presentationId: slide.presentationId,
      images: [planned(slide.slideId, slide.columnIds[0], 'Rekonstruksjon av Homo erectus, halvfigur.')],
    })
    await ok(context, 'set_image_context', {
      presentationId: slide.presentationId,
      context: CONTEXT,
    })

    // One planned picture is enough for the deck to have a premise, and the
    // context comes back beside the slides rather than from a second call.
    const deck = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: slide.presentationId,
    })
    expect(deck.imageContext).toBe(CONTEXT)
  })
})

describe('den navngitte serien der bildet bærer enheten', () => {
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

    // No generator: reserve the framed kind the series needs, so the zone that
    // waits is the zone the finished picture lands in — and put the motif in
    // the deck's plan rather than in the zone.
    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
      kind: 'titled-image-card',
      title: [{ text: SPECIES[0].label }],
    })
    await ok(context, 'set_image_context', {
      presentationId: slide.presentationId,
      context: CONTEXT,
    })
    const brief = await ok<ImageBriefView>(context, 'plan_deck_images', {
      presentationId: slide.presentationId,
      images: [
        planned(slide.slideId, column, `Vitenskapelig rekonstruksjon av ${SPECIES[0].name}, helfigur.`),
      ],
    })
    expect(brief.imageCount).toBe(1)
    expect(zoneOf(await zones(context, slide), column).reservedImageKinds).toContain(
      'titled-image-card',
    )

    // And the hand-over works: the file lands in the card that was already
    // waiting, the card title survives, and the placeholder goes away.
    const asset = await ok<{ assetId: string }>(context, 'create_svg_asset', {
      presentationId: slide.presentationId,
      name: 'afarensis',
      svgMarkup: FILE,
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
    expect(zone.image?.caption).toBeUndefined()
    expect(zone.cardTitle?.map((span) => ('text' in span ? span.text : ''))).toEqual([
      SPECIES[0].label,
    ])
    expect(zone.fits).toBe(true)
  })
})

describe('reservasjonen sier fra når den ikke lenger holder', () => {
  it('lar seg ikke krympe under bildets minstemål, slik et notat lot seg', async () => {
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
    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: stacked.childNodeIds[0],
      kind: 'image',
    })

    // This is the whole reason the reservation is a real picture zone. The note
    // it replaces drew nothing and had no minimum size, so a later re-weighting
    // shrank it below a picture's floor with nothing refusing — and the
    // reservation was silently broken. A waiting picture zone has a picture's
    // floor, so the same call is refused before anything is written.
    const refused = await fails(context, 'adjust_split', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
      weights: [1, 10],
    })
    expect(refused.code).toBe('ZONE_TOO_SMALL')
    expect(
      zoneOf(await zones(context, slide), stacked.childNodeIds[0]).reservedImageKinds,
    ).toContain('image')
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
      kind: 'image',
    })

    expect(zoneOf(await zones(context, slide), pictureZone).reservedImageKinds).toEqual(['image'])

    // And the list is the truth: the kind it left out really is refused.
    const refused = await fails(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: pictureZone,
      kind: 'titled-image-card',
    })
    expect(refused.code).toBe('ZONE_TOO_SMALL')
  })

  it('spør ikke om reservasjonen i en sone som allerede har fått filen sin', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)
    const column = slide.columnIds[0]

    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
      kind: 'image',
    })
    const asset = await ok<{ assetId: string }>(context, 'create_svg_asset', {
      presentationId: slide.presentationId,
      name: 'ferdig',
      svgMarkup: FILE,
    })
    await ok(context, 'set_zone_asset', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: column,
      assetId: asset.assetId,
    })

    // The question only exists while something is being waited for.
    expect(zoneOf(await zones(context, slide), column).reservedImageKinds).toBeUndefined()
  })

  it('melder fra om en bildesone som venter uten at noe i planen beskriver den', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)

    for (const nodeId of slide.columnIds.slice(0, 2)) {
      await ok(context, 'set_zone_card', {
        presentationId: slide.presentationId,
        slideId: slide.slideId,
        nodeId,
        kind: 'image',
      })
    }
    await ok(context, 'set_image_context', {
      presentationId: slide.presentationId,
      context: CONTEXT,
    })
    const brief = await ok<ImageBriefView>(context, 'plan_deck_images', {
      presentationId: slide.presentationId,
      images: [planned(slide.slideId, slide.columnIds[0], 'Rekonstruksjon av Homo erectus.')],
    })

    // «As many entries as placeholders» is the check that keeps a brief from
    // quietly being one picture short of the deck.
    const unplanned = brief.issues.find((issue) => issue.code === 'ZONE_NOT_PLANNED')
    expect(unplanned?.nodeId).toBe(slide.columnIds[1])
  })

  it('svarer med hele bestillingen som én tekst, ferdig til å gis videre', async () => {
    /*
     * The delivery, on the surface an agent actually reads. The plan operation
     * used to answer with a structured list and withhold the brief, because the
     * flow it served generated the pictures one at a time and had to keep the
     * set out of the conversation. That flow is gone — a host client's image
     * tool did not survive alternating between deck work and picture calls — so
     * the answer carries the one thing the agent is supposed to hand over.
     */
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)

    expect(brief.issues).toEqual([])
    expect(brief.brief).not.toBeNull()
    const text = brief.brief ?? ''
    expect(text.startsWith(`Lag nøyaktig ${MOTIFS.length} separate bilder`)).toBe(true)
    expect(text).toContain('FELLES BILDEKONTEKST')
    expect(text).toContain(CONTEXT)
    for (const motif of MOTIFS) expect(text).toContain(motif)
    expect(text.match(/^BILDE \d+ AV \d+$/gm)).toHaveLength(MOTIFS.length)
  })

  it('holder Slaids sin egen bokføring utenfor teksten brukeren får', async () => {
    // The brief is pasted into a conversation that makes pictures and nothing
    // else. Every line below is something that conversation cannot use, and
    // that tells it the task is administration rather than N pictures.
    const context = freshContext()
    const brief = await plannedPictureDeck(context, 3)
    const text = brief.brief ?? ''

    for (const image of brief.images) {
      expect(text).not.toContain(image.slideId)
      expect(text).not.toContain(image.nodeId)
      expect(text).not.toContain(image.slideLabel)
    }
    expect(text).not.toContain(brief.presentationId)
    expect(text).not.toMatch(/imgplan_|imagePlanItemId|bildeplan-id/i)
    expect(text).not.toMatch(/filnavn|<filendelse>/i)
    expect(text).not.toMatch(/manifest|sha-256|\bavtrykk\b/i)
    expect(text).not.toMatch(/slaids/i)
    expect(text).not.toMatch(/ett kall per|enkeltvis|neste jobb/i)
  })

  it('gir den samme teksten igjen når planen leses tilbake', async () => {
    // One composer, one plan: the brief is derived on every read rather than
    // stored, so a deck cannot hand out a text its plan no longer says.
    const context = freshContext()
    const written = await plannedPictureDeck(context, 3)
    const read = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: written.presentationId,
    })
    expect(read.brief).toBe(written.brief)
    // The read carries the entries' own texts; the write does not repeat them.
    expect(read.images[0].subject).toBe(MOTIFS[0])
    expect(written.images[0].subject).toBeUndefined()
  })

  it('tilbyr ingen bildejobber og ingen koblingskontroll å gå i løkke på', async () => {
    /*
     * The machinery this replaces, asserted as the absence it has to be. An
     * operation that hands out one picture at a time, or takes a report of a
     * generated file back, is an invitation into exactly the loop that did not
     * work — and a tool an agent can see is a tool an agent will call.
     */
    const names = describeOperations().map((operation) => operation.name)
    expect(names).not.toContain('get_next_image_job')
    expect(names).not.toContain('verify_image_handoff')
    expect(names).toContain('plan_deck_images')
    expect(names).toContain('get_image_brief')

    const surface = `${MCP_INSTRUCTIONS}\n${mcpTools()
      .map((tool) => `${tool.name}\n${tool.description}`)
      .join('\n')}`
    expect(surface).not.toMatch(/get_next_image_job|verify_image_handoff/)
    expect(surface).not.toMatch(/imagePlanItemId|slaids-bilder\.json/)
    expect(surface).not.toMatch(/koblingskontroll/i)
  })

  it('sier hvor mange filer deponeringen venter på, uten å be agenten telle dem opp', async () => {
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)
    // The deposit is opened by writing the plan: the agent switches nothing on,
    // and the count is the plan's own length.
    expect(brief.deposit).toEqual({ status: 'pending', expectedCount: MOTIFS.length })
    expect(brief.imageCount).toBe(MOTIFS.length)
  })

  it('avviser en bildeoppføring som peker på en tekstsone', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)

    // An entry for a zone that is not a picture is not a deck with a problem in
    // it — it is a call that meant a different zone, so nothing is written.
    const refused = await fails(context, 'plan_deck_images', {
      presentationId: slide.presentationId,
      images: [planned(slide.slideId, slide.columnIds[0], 'Rekonstruksjon av Homo erectus.')],
    })
    expect(refused.code).toBe('INVALID_CONTENT')
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
    expect(REPEATED_FALLBACK_RULE).toMatch(/én stor tekstsone med overskrift/i)
  })
})

/*
 * PR #72 produced a second, worse failure on the same subject: `p_ssk8ao0znyp`
 * came back with 19 slides and 18 SVG assets, where almost every content slide
 * was one large SVG drawing the heading, the cards, the body text and the
 * illustrations at once, the last slide was a hand-drawn bibliography instead
 * of a references page, and there were zero registered references despite
 * factual claims throughout. Every slide was structurally valid.
 *
 * These tests protect the corrected contract against exactly that shape:
 * native composition stays reachable and is the thing an agent is told to
 * build with before it draws anything, a diagrammatic SVG can still occupy
 * one zone without displacing its native siblings, and the reference system —
 * not an authored bibliography — is the reachable, working path for sources.
 */
describe('p_ssk8ao0znyp: native komposisjon, ikke SVG som slide-motor', () => {
  it('gir agenten native komposisjon-regelen før den har bygget noe', () => {
    expect(MCP_INSTRUCTIONS).toContain(NATIVE_COMPOSITION_RULE)
    expect(NATIVE_COMPOSITION_RULE).toMatch(/sonetre/i)
    expect(NATIVE_COMPOSITION_RULE).toMatch(/alternativ slide-motor/i)
  })

  it('forbyr på create_svg_asset-kontrakten nettopp det p_ssk8ao0znyp gjorde: hele slider, titler, kort og litteraturlister som SVG', () => {
    const svgTool = mcpTools().find((tool) => tool.name.endsWith('create_svg_asset'))
    for (const rule of VECTOR_POLICY) expect(svgTool?.description).toContain(rule)
    expect(VECTOR_POLICY.join(' ')).toMatch(/aldri erstatte selve sliden/i)
    expect(VECTOR_POLICY.join(' ')).toMatch(/litteraturlister/i)
  })

  it('lar en anatomislide holde en skjematisk SVG i én sone uten at søskensonene slutter å være native', async () => {
    const context = freshContext()
    const slide = await slideWithThreeZones(context)

    // Two zones stay ordinary titled cards — the anatomical description a
    // reader scans — and only the third gets a schematic figure. This is the
    // «anatomy» solution from the regression brief: several native cards, and
    // a diagrammatic SVG confined to the one zone that needs it.
    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: slide.columnIds[0],
      kind: 'titled-card',
      title: [{ text: 'Kraniekapasitet' }],
    })
    await ok(context, 'set_zone_text', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: slide.columnIds[0],
      blocks: [{ type: 'paragraph', spans: [{ text: 'Om lag 900 cm³ hos Homo erectus.' }] }],
    })

    const diagram = '<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20" fill="#888"/></svg>'
    const asset = await ok<{ assetId: string }>(context, 'create_svg_asset', {
      presentationId: slide.presentationId,
      name: 'kraniediagram',
      svgMarkup: diagram,
    })
    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: slide.columnIds[1],
      kind: 'image',
    })
    await ok(context, 'set_zone_asset', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: slide.columnIds[1],
      assetId: asset.assetId,
    })

    const all = await zones(context, slide)
    // The card with text is untouched by the SVG placed next to it — the
    // observed failure collapsed all three of these into one drawing.
    expect(zoneOf(all, slide.columnIds[0]).contentKind).toBe('titled-card')
    expect(zoneOf(all, slide.columnIds[1]).contentKind).toBe('image')
    expect(zoneOf(all, slide.columnIds[1]).image?.assetId).toBe(asset.assetId)
  })

  it('gjør referansesystemet, ikke en tegnet bibliografi, til veien for kilder', async () => {
    const context = freshContext()
    const deck = await ok<PresentationView>(context, 'create_presentation', {
      title: 'Menneskets evolusjon',
    })
    const slideId = deck.slides[1].slideId

    const added = await ok<{ reference: { id: string } }>(context, 'add_reference', {
      presentationId: deck.presentationId,
      expectedRevision: deck.revision,
      title: 'Lucy: The Beginnings of Humankind',
      authors: 'Johanson, D. & Edey, M.',
      year: '1981',
    })

    // The claim is cited from ordinary Slaids text — never authored as a
    // second, hand-drawn document the way the observed deck's last slide was.
    const titled = await ok<{ presentationId: string }>(context, 'set_slide_title', {
      presentationId: deck.presentationId,
      expectedRevision: (
        await ok<PresentationView>(context, 'get_presentation', {
          presentationId: deck.presentationId,
        })
      ).revision,
      slideId,
      spans: [{ text: 'Australopithecus afarensis ' }, { citation: [added.reference.id] }],
    })
    expect(titled.presentationId).toBe(deck.presentationId)

    const withReference = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    // The whole workflow the guide asks for is reachable and worked: a
    // registered reference, a citation pointing at it, and no SVG asset —
    // p_ssk8ao0znyp had 18 SVG assets and 0 registered references.
    expect(withReference.referenceCount).toBe(1)
    expect((await ok<{ assets: unknown[] }>(context, 'list_assets', {
      presentationId: deck.presentationId,
    })).assets).toHaveLength(0)

    // And the contract itself forbids the shortcut this deck took instead.
    expect(REFERENCE_SYSTEM_RULE).toMatch(/ikke opprett en egen slide bare for å ramse opp kilder/i)
    expect(REFERENCE_SYSTEM_RULE).toMatch(/aldri bakes inn som tekst i en SVG/i)
  })

  it('krever visuell inspeksjon av egenprodusert SVG, som en strukturelt gyldig SVG-tekstbeskjæring aldri ville blitt fanget uten', () => {
    // p_ssk8ao0znyp validated structurally end to end while SVG text was
    // clipped inside the asset. There is no fragile structural validator for
    // this — the contract has to say rendering and looking is required.
    expect(MCP_INSTRUCTIONS).toContain(VISUAL_QA_RULE)
    expect(VISUAL_QA_RULE).toMatch(/egenprodusert SVG/i)
    expect(VISUAL_QA_RULE).toMatch(/ikke tilstrekkelig/i)
  })
})

/* ------------------------------------------------------------------ *
 * The turn that ended one step too early
 * ------------------------------------------------------------------ */

describe('et illustrert foredrag er ikke ferdig når bildeplanen er skrevet', () => {
  /*
   * The scenario, as it happened: «lag et illustrert foredrag med bilder». The
   * agent created the deck, wrote the slides, wrote the image plan, and ended
   * the turn — «the presentation is created, the pictures are not inserted
   * yet». Every rule about generating the pictures was in the answer it had
   * just read, as prose to have read.
   *
   * What was missing was not a rule. It was a fact in the answer: that the work
   * was not over. So the plan operation reports where the raster flow stands.
   *
   * What that status may rest on is the whole difficulty. Slaids never sees a
   * generated file — the pictures are made in a conversation of their own, and
   * they arrive through the *user's* deposit in a browser — so the only thing
   * the deck can observe is a picture zone holding a file. It used to store what
   * an agent *said* it had generated, and a report written from the plan was as
   * cheap to produce as the pictures were expensive. That is gone.
   */

  /**
   * One entry's file, deposited into that entry's own zone.
   *
   * `bytes` so a *replacement* is a different file: two uploads of identical
   * bytes are deduplicated into the asset that is already there.
   */
  async function deposit(
    context: AgentContext,
    presentationId: string,
    image: ImageBriefView['images'][number],
    bytes: Uint8Array = realImages.png(),
  ): Promise<void> {
    const stored = await ok<{ assetId: string }>(context, 'upload_asset', {
      presentationId,
      name: `${image.number}.png`,
      content: { encoding: 'bytes', data: bytes },
    })
    await ok(context, 'set_zone_asset', {
      presentationId,
      slideId: image.slideId,
      nodeId: image.nodeId,
      assetId: stored.assetId,
      replace: true,
      replacedDisposition: 'delete',
    })
  }

  it('svarer at arbeidet ikke er ferdig, i det bildeplanen er skrevet', async () => {
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)

    // The plan itself is sound — this is not a repair case, and that is the
    // point: a sound plan was exactly what made stopping look like finishing.
    expect(brief.issues).toEqual([])
    expect(brief.workflow.stage).toBe('awaiting-images')
    expect(brief.workflow.complete).toBe(false)
    expect(brief.workflow.plannedImageCount).toBe(8)
    expect(brief.workflow.awaitingFileCount).toBe(8)
    expect(brief.workflow.depositedImageCount).toBe(0)
  })

  it('navngir seriebriefen som neste handling, i samme arbeidsøkt', async () => {
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)

    expect(brief.workflow.nextAction).toMatch(/mellomsteg, ikke leveransen/i)
    expect(brief.workflow.nextAction).toMatch(/samme arbeidsøkt/i)
    expect(brief.workflow.remainingSteps.join(' ')).toMatch(/Hent den ferdige seriebriefen/i)
    expect(brief.workflow.remainingSteps.join(' ')).toMatch(/ordrett/i)
    expect(brief.workflow.remainingSteps.join(' ')).toMatch(/bildedeponeringen/i)
  })

  it('forbyr avslutningene som beskriver arbeidet i stedet for å gjøre det', async () => {
    const context = freshContext()
    const brief = await plannedPictureDeck(context, 3)

    // One definition of done, read from the domain rather than restated here:
    // the standing instruction and this deck's own answer are the same list.
    expect(brief.workflow.completionCriteria).toEqual(IMAGE_WORKFLOW_COMPLETION_CRITERIA)
    expect(brief.workflow.forbiddenClosings).toEqual(IMAGE_WORKFLOW_FORBIDDEN_CLOSINGS)
    const forbidden = brief.workflow.forbiddenClosings.join(' ')
    expect(forbidden).toMatch(/Presentasjonen er opprettet/)
    expect(forbidden).toMatch(/Bildeplanen er klar/)
    expect(forbidden).toMatch(/Ikke vent på at brukeren deponerer/)
    expect(forbidden).toMatch(/Ikke påstå at bildene er laget/)
  })

  it('blir ikke ferdig av noe agenten kan si, bare av filer i sonene', async () => {
    /*
     * The claim the whole flow now rests on. There is nothing an agent can
     * write that turns the deck finished: the pictures are made elsewhere, and
     * the deposit is the only event the document can observe.
     */
    const context = freshContext()
    const brief = await plannedPictureDeck(context, 3)
    expect(brief.workflow.complete).toBe(false)

    for (const image of brief.images.slice(0, 2)) {
      await deposit(context, brief.presentationId, image)
    }
    const partial = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    // Some zones filled and some not is a plan that no longer describes what it
    // claims to: the brief would order a picture the deck already has.
    expect(partial.workflow.stage).toBe('plan-outdated')
    expect(partial.workflow.complete).toBe(false)
    expect(partial.workflow.depositedImageCount).toBe(2)

    await deposit(context, brief.presentationId, brief.images[2])
    const done = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    expect(done.workflow.stage).toBe('images-in-deck')
    expect(done.workflow.complete).toBe(true)
    expect(done.workflow.remainingSteps).toEqual([])
    expect(done.workflow.nextAction).toMatch(/ser aldri selve bildet/i)
  })

  it('gir samme svar når briefen leses på nytt', async () => {
    // The status is derived from the deck every time, so it cannot be a fact
    // about one call that the next read contradicts.
    const context = freshContext()
    const written = await plannedPictureDeck(context, 3)
    const read = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: written.presentationId,
    })
    expect(read.workflow).toEqual(written.workflow)
  })

  it('sender agenten gjennom reparasjonen uten å slippe den ut av flyten', async () => {
    // A plan the checks disagree with is still a plan that ends in pictures:
    // repair first, then the same delivery, never a hand-back.
    const context = freshContext()
    const slide = await slideWithThreeZones(context)
    for (const nodeId of slide.columnIds.slice(0, 2)) {
      await ok(context, 'set_zone_card', {
        presentationId: slide.presentationId,
        slideId: slide.slideId,
        nodeId,
        kind: 'image',
      })
    }
    await ok(context, 'set_image_context', {
      presentationId: slide.presentationId,
      context: CONTEXT,
    })
    const brief = await ok<ImageBriefView>(context, 'plan_deck_images', {
      presentationId: slide.presentationId,
      images: [planned(slide.slideId, slide.columnIds[0], MOTIFS[0])],
    })

    expect(brief.issues.length).toBeGreaterThan(0)
    expect(brief.workflow.stage).toBe('plan-needs-repair')
    expect(brief.workflow.complete).toBe(false)
    expect(brief.workflow.remainingSteps.join(' ')).toMatch(/skriv bildeplanen på nytt/i)
    expect(brief.workflow.remainingSteps.join(' ')).toMatch(/seriebrief/i)
  })

  it('kaller ikke reserverte bildesoner uten bildeplan for ferdig', async () => {
    // Reserve the zones and never describe them, and the deck plans zero
    // pictures. «Nothing to do» would read as a delivery, so the plan's own
    // checks gate every finished branch.
    const context = freshContext()
    const slide = await slideWithThreeZones(context)
    await ok(context, 'set_zone_card', {
      presentationId: slide.presentationId,
      slideId: slide.slideId,
      nodeId: slide.columnIds[0],
      kind: 'image',
    })

    const empty = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: slide.presentationId,
    })
    expect(empty.imageCount).toBe(0)
    expect(empty.issues.map((issue) => issue.code)).toContain('ZONE_NOT_PLANNED')
    expect(empty.workflow.stage).toBe('plan-needs-repair')
    expect(empty.workflow.complete).toBe(false)
  })

  it('har ingenting utestående før noe er reservert eller planlagt', async () => {
    const context = freshContext()
    const deck = await ok<PresentationView>(context, 'create_presentation', {
      title: 'Menneskets evolusjon',
    })
    const empty = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: deck.presentationId,
    })
    expect(empty.workflow.stage).toBe('no-planned-images')
    expect(empty.workflow.complete).toBe(true)
    expect(empty.brief).toBeNull()
  })
})
