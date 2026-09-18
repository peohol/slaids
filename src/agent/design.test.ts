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
  SELF_CHECK_STOP,
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
  GeneratedImagesView,
  ImageBriefView,
  ImageJobView,
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

/**
 * A later conversation over the same stored deck.
 *
 * The deck persists and the chat does not, so this is the reader the stored
 * verification is *not* about: a new session on the same database, holding none
 * of the picture files the previous one generated.
 */
function laterConversation(): AgentContext {
  const database = databases[databases.length - 1]
  if (!database) throw new Error('Forventet en database fra freshContext')
  return { repository: new DexieSlaidsRepository(database) }
}

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
    // The brief is the human half, and it is fetched deliberately: being in
    // the answer is being in the context the next image call is written from.
    const asked = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
      includeBrief: true,
    })
    const text = asked.brief ?? ''
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

  it('gir bildegenereringen én jobb om gangen, og aldri settet', async () => {
    /*
     * The finding this closes, on the surface it was made about. Composing the
     * prompt per entry was not enough: `plan_deck_images` and `get_image_brief`
     * still answered with every prompt, every motif, the whole brief and the
     * count, so an agent had the *set* in context when it wrote the first image
     * call — and a generator that has read a set composes a set.
     *
     * Asserted over the serialized answers rather than over one field: what
     * matters is everything a reader can see, not what it was told to repeat.
     */
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)
    const others = MOTIFS.slice(1)

    const job = await ok<ImageJobView>(context, 'get_next_image_job', {
      presentationId: brief.presentationId,
    })
    expect(job.status).toBe('job')
    expect(job.job?.prompt).toContain(MOTIFS[0])
    expect(job.job?.prompt).toContain(CONTEXT)

    const answer = JSON.stringify(job)
    for (const motif of others) expect(answer).not.toContain(motif)
    expect(answer).not.toMatch(/BILDE \d+ AV \d+/)
    expect(answer).not.toMatch(/separate bilder/i)
    expect(answer).not.toMatch(/\b8\b/)

    // The only identifier is the opaque one, and it is beside the prompt
    // rather than inside it: the check needs it afterwards, a generator must
    // never see it. No number, no file name, no zone — those are facts about a
    // set, and a host whose image tool reads the conversation would have them
    // in context while it generates.
    expect(job.job?.imagePlanItemId).toBe(brief.images[0].imagePlanItemId)
    expect(job.job?.prompt).not.toContain(brief.images[0].imagePlanItemId)
    expect(Object.keys(job.job ?? {}).sort()).toEqual(['aspectRatio', 'imagePlanItemId', 'prompt'])

    // The plan surfaces carry no prompt at all, so there is nothing there to
    // assemble a second, set-aware instruction from.
    expect(JSON.stringify(brief.images)).not.toContain('Lag ett bilde')
    expect(brief.brief).toBeNull()
  })

  it('lar ikke verktøybeskrivelsene love en annen jobb enn den som leveres', async () => {
    /*
     * The operation summary and the input-schema descriptions are text the
     * model reads as part of the tool surface — standing instructions, the same
     * way `IMAGE_JOB_RULE` is. When the job lost its number, file name and zone,
     * the summary kept listing them; when `bytesUnavailable` became a legal
     * answer, it kept asking for a digest unconditionally. Either one tells the
     * model to work against the mechanism every other test here locks, and it
     * names the three facts about a *set* this surface exists to withhold.
     *
     * Asserted against the delivered job rather than against a second copy of
     * the field list: what the description may name is what the job has.
     */
    const context = freshContext()
    const brief = await plannedPictureDeck(context, 3)
    const job = await ok<ImageJobView>(context, 'get_next_image_job', {
      presentationId: brief.presentationId,
    })
    if (!job.job) throw new Error('Forventet en jobb')

    const described = describeOperations()
    const summary =
      described.find((operation) => operation.name === 'get_next_image_job')?.summary ?? ''
    expect(summary).not.toBe('')
    for (const field of Object.keys(job.job)) expect(summary).toContain(`\`${field}\``)
    for (const field of ['number', 'fileName', 'slideId', 'nodeId']) {
      expect(job.job).not.toHaveProperty(field)
      expect(summary).not.toContain(`\`${field}\``)
    }
    // The digest is offered as an extra and never as a condition, because the
    // ordinary host cannot produce one — a summary that demanded it would send
    // an honest host into a job it can never leave.
    expect(summary).toMatch(/SHA-256/)
    expect(summary).toMatch(/ekstra kontroll, ikke et vilkår for å gå videre/i)
    expect(summary).not.toMatch(/bytesUnavailable/)

    /*
     * And the check's own field does not send the agent back to the plan for
     * the id it was just handed. Re-reading `images` between two generations to
     * find an id is exactly the step that puts the other motifs back in
     * context, one call before the next picture is made.
     */
    const handoff = described.find((operation) => operation.name === 'verify_image_handoff')
    const schema = JSON.stringify(handoff?.inputSchema ?? {})
    expect(schema).toContain('ordrett fra jobben som ga deg prompten')
    expect(schema).not.toMatch(/ordrett fra .images. i bildebriefen/)
  })

  it('navngir filen etter kontrollen, ikke i jobben', async () => {
    /*
     * The number is a fact about a set — «the third one» — and a host whose
     * image tool reads the conversation rather than an explicit prompt string
     * would have it in context while it generates. It is not needed to make a
     * picture, only to file one, so the job carries an opaque id and the check
     * answers with the name.
     */
    const context = freshContext()
    const brief = await plannedPictureDeck(context, 3)
    const job = await ok<ImageJobView>(context, 'get_next_image_job', {
      presentationId: brief.presentationId,
    })
    if (!job.job) throw new Error('Forventet en jobb')

    const checked = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: [
        {
          imagePlanItemId: job.job.imagePlanItemId,
          fileExtension: 'png',
          contentHash: '1'.repeat(64),
        },
      ],
    })
    expect(checked.ok).toBe(true)
    expect(checked.files).toEqual([{ imagePlanItemId: job.job.imagePlanItemId, fileName: '1.png' }])
    // And Slaids filled in what the job never said: the entry's own number and
    // zone, taken from the plan rather than from the caller.
    expect(checked.workflow.stage).toBe('awaiting-generation')

    // The next job is the next entry, so the binding was recorded in full.
    const second = await ok<ImageJobView>(context, 'get_next_image_job', {
      presentationId: brief.presentationId,
    })
    expect(second.job?.imagePlanItemId).toBe(brief.images[1].imagePlanItemId)
  })

  it('lar en kobling uten avtrykk tømme sin egen plass i køen', async () => {
    /*
     * The dead end this replaces, on the agent surface. A binding with no
     * digest used to be refused at the boundary, so the entry stayed in the
     * queue — and the ordinary host cannot read the bytes its own image tool
     * returned, which meant the only way past a picture it had really made was
     * to make it again.
     *
     * The binding is enough now, and nothing pretends it is more than it is:
     * `reporting` says self-reported, and the deck still finishes on the files.
     */
    const context = freshContext()
    const brief = await plannedPictureDeck(context, 3)
    const job = await ok<ImageJobView>(context, 'get_next_image_job', {
      presentationId: brief.presentationId,
    })
    if (!job.job) throw new Error('Forventet en jobb')

    const reported = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: [{ imagePlanItemId: job.job.imagePlanItemId, fileExtension: 'png' }],
    })
    expect(reported.ok).toBe(true)
    expect(reported.reporting).toBe('self-reported')
    expect(reported.reportingMeans).toMatch(/selvrapportert/i)
    expect(reported.reportingMeans).not.toMatch(/kontrollert mot bildefilene/i)

    // The queue moves exactly one step, on a binding with no digest in it.
    const next = await ok<ImageJobView>(context, 'get_next_image_job', {
      presentationId: brief.presentationId,
    })
    expect(next.status).toBe('job')
    expect(next.job?.imagePlanItemId).toBe(brief.images[1].imagePlanItemId)
  })

  it('gjør åtte planlagte bilder til åtte selvstendige genereringsjobber', async () => {
    // The observed failure: eight pictures were planned correctly, the answer
    // carried both halves of the plan, and the whole brief went to the image
    // generator as one job. One storyboard came back — eight motifs, one file,
    // nothing the deposit could place. What the answer has to say, before any
    // prose is read, is a number: eight entries, eight files.
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)

    expect(brief.issues).toEqual([])
    expect(brief.imageCount).toBe(8)
    // One job per entry, numbered 1‥8 in deck order: this is the list an agent
    // executes, one call at a time.
    expect(brief.images).toHaveLength(8)
    expect(brief.images.map((image) => image.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    for (const image of brief.images) {
      expect(image.aspectRatio).toMatch(/^\d+:\d+$/)
      // The write does not hand the motifs back: they were its own argument,
      // and a second copy is a second copy in the context the first image call
      // is written from. The read carries them, for a session that repairs.
      expect(image.subject).toBeUndefined()
    }
    const read = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    expect(read.images.map((image) => image.subject)).toEqual(MOTIFS)

    // And the count is stated separately from the prose, against the same plan
    // the brief is composed from, so «are we finished» is a comparison.
    expect(brief.generation?.expectedFileCount).toBe(brief.imageCount)
    expect(brief.generation?.rule).toMatch(/én selvstendig bildegenereringsoppgave/i)
    expect(brief.deposit).toEqual({ status: 'pending', expectedCount: 8 })

    // No prompt rides along with the plan: the instruction for one picture
    // comes one job at a time, from a surface that can only see one entry.
    for (const image of brief.images) {
      expect(image).not.toHaveProperty('prompt')
    }
    // And the whole-plan message is not in the answer at all unless a person
    // asked for it. Being in the response is being in the context the next
    // image call is written from.
    expect(brief.brief).toBeNull()
    expect(brief.generation?.briefRole).toMatch(/^Intern\./)

    const onRequest = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
      includeBrief: true,
    })
    expect(onRequest.brief).toContain('Lag nøyaktig 8 separate bilder')
    expect(onRequest.brief?.match(/^BILDE \d+ AV 8$/gm)).toHaveLength(8)
  })

  it('gir hver oppføring en stabil id, og et filnavn som kommer fra planen', async () => {
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)

    // The identity every generated file is bound to. Nine pictures generated in
    // a different order than they were planned is the failure this replaces,
    // and `number` alone could not have caught it.
    const ids = brief.images.map((image) => image.imagePlanItemId)
    expect(new Set(ids).size).toBe(brief.imageCount)
    for (const id of ids) expect(id).toMatch(/^imgplan_[0-9a-f]{16}$/)
    // The file name is the entry's own number, stated by the entry rather than
    // counted out while the files are being saved.
    expect(brief.images.map((image) => image.fileName)).toEqual(
      brief.images.map((image) => `${image.number}.<filendelse>`),
    )
    // And reading the same deck back gives the same ids.
    const again = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    expect(again.images.map((image) => image.imagePlanItemId)).toEqual(ids)
  })

  it('rapporterer selvrapportert når koblingene ikke bærer avtrykk', async () => {
    // The ordinary delivery: nothing contradicts itself, and nobody compared
    // the bindings to a single byte. `ok` and `reporting` answer different
    // questions, and an agent that read only `ok` would call this verified.
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)

    const reported = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: brief.images.map((image) => ({
        imagePlanItemId: image.imagePlanItemId,
        number: image.number,
        slideId: image.slideId,
        nodeId: image.nodeId,
        fileName: `${image.number}.png`,
      })),
    })

    expect(reported.ok).toBe(true)
    expect(reported.reporting).toBe('self-reported')
    expect(reported.reportingMeans).toMatch(/selvrapportert/i)
    // And it is not framed as a defect: this is what most hosts can deliver, so
    // «make the pictures again to get a check» would be the duplicate
    // generation the whole flow exists to prevent.
    expect(reported.reportingMeans).toMatch(/det vanlige/i)
    expect(reported.reportingMeans).toMatch(/ikke lag bildene om igjen/i)
    // The plan is covered, and the deck is still not finished: only the files
    // can do that.
    expect(reported.planCovered).toBe(true)
    expect(reported.workflow.stage).toBe('awaiting-deposit')
    expect(reported.workflow.complete).toBe(false)
  })

  it('rapporterer avtrykk bare når hver kobling bærer ett', async () => {
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)
    const digest = (seed: number): string => seed.toString(16).padStart(2, '0').repeat(32)

    const verified = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: brief.images.map((image, index) => ({
        imagePlanItemId: image.imagePlanItemId,
        number: image.number,
        slideId: image.slideId,
        nodeId: image.nodeId,
        fileName: `${image.number}.png`,
        contentHash: digest(index + 1),
      })),
    })

    expect(verified.reporting).toBe('hash-reported')
    // What it covers, and what it does not — stated by Slaids rather than left
    // to an agent to phrase.
    expect(verified.reportingMeans).toMatch(/aldri hva bildet viser/i)
    // And it does not overstate itself: the comparison happens in the browser,
    // so at this point the digest is a string the caller supplied.
    expect(verified.reportingMeans).toMatch(
      /Selve sammenligningen skjer der, ikke her: Slaids ser aldri filene dine/i,
    )
    // The digests ride along in the manifest, which is the only way they reach
    // the browser that can actually compare them.
    expect(JSON.parse(verified.manifest ?? '{}').images[0].contentHash).toBe(digest(1))

    // One missing out of eight is not «mostly hashed»: the deposit can only
    // compare the whole delivery or none of it, so the answer is the weaker
    // word. It is still a legal delivery, and still `ok`.
    const partial = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: brief.images.map((image, index) => ({
        imagePlanItemId: image.imagePlanItemId,
        number: image.number,
        slideId: image.slideId,
        nodeId: image.nodeId,
        fileName: `${image.number}.png`,
        ...(index === 3 ? {} : { contentHash: digest(index + 1) }),
      })),
    })
    expect(partial.ok).toBe(true)
    expect(partial.reporting).toBe('self-reported')
  })

  it('avviser et avtrykk som ikke er en SHA-256', async () => {
    const context = freshContext()
    const brief = await plannedPictureDeck(context, 1)
    const refused = await fails(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: [
        {
          imagePlanItemId: brief.images[0].imagePlanItemId,
          number: 1,
          slideId: brief.images[0].slideId,
          nodeId: brief.images[0].nodeId,
          fileName: '1.png',
          contentHash: 'ikke-en-hash',
        },
      ],
    })
    expect(refused.code).toBe('INVALID_INPUT')
  })

  it('godkjenner bilder som er generert i en annen rekkefølge enn planen', async () => {
    // The whole point: a generator that answered out of order is fine, as long
    // as every file went back to the entry it was generated from.
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)
    const scrambled = [2, 7, 0, 5, 1, 4, 3, 6].map((position) => brief.images[position])

    const verified = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: scrambled.map((image) => ({
        imagePlanItemId: image.imagePlanItemId,
        number: image.number,
        slideId: image.slideId,
        nodeId: image.nodeId,
        fileName: `${image.number}.png`,
        contentHash: image.number.toString(16).padStart(2, '0').repeat(32),
      })),
    })

    expect(verified.ok).toBe(true)
    expect(verified.issues).toEqual([])
    // A manifest only exists once the binding checks out: one produced beside a
    // conflict would be exactly the false reassurance this call removes.
    expect(verified.manifestFileName).toBe('slaids-bilder.json')
    expect(JSON.parse(verified.manifest ?? '{}')).toMatchObject({
      presentationId: brief.presentationId,
    })
  })

  it('stopper bilder som er nummerert etter genereringsrekkefølgen', async () => {
    // The observed failure, written out: the files were named `1`‥`8` by the
    // order they came back in. Every name is well-formed, the count is right,
    // and most pictures are for the wrong slide.
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)
    const arrival = [2, 7, 0, 5, 1, 4, 3, 6].map((position) => brief.images[position])

    const verified = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: arrival.map((image, index) => ({
        imagePlanItemId: image.imagePlanItemId,
        number: index + 1,
        contentHash: (index + 1).toString(16).padStart(2, '0').repeat(32),
        slideId: image.slideId,
        nodeId: image.nodeId,
        fileName: `${index + 1}.png`,
      })),
    })

    expect(verified.ok).toBe(false)
    expect(verified.issues.map((issue) => issue.code)).toContain('NUMBER_MISMATCH')
    expect(verified.manifest).toBeNull()
    // And the answer says what the bindings should have been, so a fix does not
    // need a second read.
    expect(verified.expected.map((item) => item.imagePlanItemId)).toEqual(
      brief.images.map((image) => image.imagePlanItemId),
    )
  })

  it('kaller ikke sju av åtte en ferdig leveranse', async () => {
    /*
     * A picture short is the normal state of the loop — the check runs after
     * each job — so it is not a refusal. What it must never be is a finished
     * delivery: no manifest, `planCovered` false, and the flow still asking
     * for pictures.
     */
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)

    const verified = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: brief.images.slice(0, 7).map((image) => ({
        imagePlanItemId: image.imagePlanItemId,
        number: image.number,
        slideId: image.slideId,
        nodeId: image.nodeId,
        fileName: `${image.number}.png`,
        contentHash: image.number.toString(16).padStart(2, '0').repeat(32),
      })),
    })

    expect(verified.ok).toBe(true)
    expect(verified.planCovered).toBe(false)
    expect(verified.manifest).toBeNull()
    expect(verified.workflow.stage).toBe('awaiting-generation')
    expect(verified.workflow.complete).toBe(false)

    // And the job that is left is the eighth, which is the only thing the
    // generation surface will say.
    const job = await ok<ImageJobView>(context, 'get_next_image_job', {
      presentationId: brief.presentationId,
    })
    expect(job.status).toBe('job')
    expect(job.job?.imagePlanItemId).toBe(brief.images[7].imagePlanItemId)
  })

  it('avviser en bildeplan-id som ikke har formen Slaids lager', async () => {
    // An argument error rather than a finding: an id an agent invented is a
    // call that means nothing, not a delivery with a problem in it.
    const context = freshContext()
    const brief = await plannedPictureDeck(context, 1)
    const refused = await fails(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: [
        {
          imagePlanItemId: 'bilde-1',
          number: 1,
          slideId: brief.images[0].slideId,
          nodeId: brief.images[0].nodeId,
          fileName: '1.png',
        },
      ],
    })
    expect(refused.code).toBe('INVALID_INPUT')
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
   * The lifecycle that reporting has to respect is the whole difficulty. Slaids
   * never sees a generated file — the pictures are made in the host client, and
   * without a file bridge they arrive through the *user's* deposit in a browser
   * — so a filled picture zone answers «has the file arrived», never «was the
   * picture made». Asserted below in both directions: verified generation with
   * every zone still empty is finished, and filled zones on their own are not.
   */

  /** What a host client holds after generating every planned picture. */
  function generated(brief: ImageBriefView) {
    return brief.images.map((image, index) => ({
      imagePlanItemId: image.imagePlanItemId,
      number: image.number,
      slideId: image.slideId,
      nodeId: image.nodeId,
      fileName: `${image.number}.png`,
      contentHash: (index + 1).toString(16).padStart(2, '0').repeat(32),
    }))
  }

  /**
   * One entry's file, deposited into that entry's own zone.
   *
   * `bytes` so a *replacement* is a different file: the deposit that matters in
   * the stale case puts a new picture where an old one is, and two uploads of
   * identical bytes are deduplicated into the asset that is already there.
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
    expect(brief.workflow.stage).toBe('awaiting-generation')
    expect(brief.workflow.complete).toBe(false)
    expect(brief.workflow.plannedImageCount).toBe(8)
    expect(brief.workflow.awaitingFileCount).toBe(8)
    expect(brief.workflow.depositedImageCount).toBe(0)
  })

  it('navngir bildegenereringen som neste handling, i samme samtale', async () => {
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)

    expect(brief.workflow.nextAction).toMatch(/mellomsteg, ikke leveransen/i)
    expect(brief.workflow.nextAction).toMatch(/samme samtale/i)
    // The next action is one picture, taken from the shared context and the
    // entry that is next — not «call the generator eight times», which is a
    // count for the agent to pass on to a generator.
    expect(brief.workflow.nextAction).toMatch(
      /generer neste planlagte bilde direkte fra `imageContext` og den aktuelle bildeoppføringen/i,
    )
    expect(brief.workflow.nextAction).toMatch(
      /Ikke skriv ut samlet brief eller andre bildeoppføringer i samtalen/i,
    )
    expect(brief.workflow.nextAction).not.toContain('8')
    expect(brief.workflow.awaitingFileCount).toBe(brief.generation?.expectedFileCount)
    // And the steps left point at the loop rather than restating it.
    expect(brief.workflow.remainingSteps.join(' ')).toMatch(/Hent neste bildejobb/i)
    expect(brief.workflow.remainingSteps.join(' ')).toMatch(/uten de andre oppføringene/i)
    expect(brief.workflow.remainingSteps.join(' ')).toMatch(/generation\.isolation/)
  })

  it('forbyr avslutningene som beskriver arbeidet i stedet for å gjøre det', async () => {
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)

    expect(brief.workflow.forbiddenClosings).toEqual(IMAGE_WORKFLOW_FORBIDDEN_CLOSINGS)
    expect(brief.workflow.completionCriteria).toEqual(IMAGE_WORKFLOW_COMPLETION_CRITERIA)
    const closings = brief.workflow.forbiddenClosings.join(' ')
    expect(closings).toContain('Presentasjonen er opprettet')
    expect(closings).toContain('Bildene er ikke satt inn ennå')
    expect(closings).toContain('Bildeplanen er klar')
  })

  it('lar agenten stoppe uten å kalle dekket ferdig', async () => {
    /*
     * The acceptance state of this whole change, checked against the stop rule
     * that governs it: the handoff is verified and nothing is deposited, so the
     * agent has nothing left — and the deck plainly does. `complete` may end the
     * agent's loop; it must not be read as «the presentation is finished».
     */
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)
    const verified = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: generated(brief),
    })

    expect(verified.workflow.stage).toBe('awaiting-deposit')
    // Not complete: the pictures are not in the deck, and a report cannot put
    // them there. The agent's own stop is `remainingSteps`.
    expect(verified.workflow.complete).toBe(false)
    expect(verified.workflow.awaitingFileCount).toBe(MOTIFS.length)
    // Every picture zone is still empty, and the action says whose step that is.
    expect(verified.workflow.nextAction).toMatch(/bildesoner står tomme/i)
    expect(verified.workflow.nextAction).toMatch(/brukerens steg/i)
    // The stop rule the agent reads alongside it does not turn that into
    // «finished», and it is keyed on what is left for the agent rather than on
    // `complete`, which answers for the document.
    expect(verified.workflow.remainingSteps.join(' ')).toMatch(
      /har du bildefilene fra genereringen/i,
    )
    expect(SELF_CHECK_STOP).toMatch(
      /du har gjort det `workflow\.remainingSteps` krever av deg, er \*\*ditt\*\* arbeid ferdig/i,
    )
    expect(SELF_CHECK_STOP).toMatch(/ikke `complete` alene/i)
    expect(SELF_CHECK_STOP).toMatch(
      /har du bildefilene fra genereringen.*ikke si at presentasjonen er ferdig/i,
    )
    /*
     * And it must say what `complete` is *about*, in the same terms the status
     * uses. It once said the deck was complete when the plan was covered by a
     * current generation check — a statement about something the agent supplies,
     * and the check is stored on the document while the files are not. A stop
     * rule keyed on that would let a deck with empty picture zones read as
     * finished, which is the one reading this whole status exists to refuse.
     */
    expect(SELF_CHECK_STOP).toMatch(/at bildene faktisk ligger i dekket/i)
    expect(SELF_CHECK_STOP).not.toMatch(/gyldig, gjeldende genereringskontroll/i)
    // The one delivery stage is named, and so is the pair that is genuinely
    // finished — a rule that named neither would leave the stop to a feeling.
    expect(SELF_CHECK_STOP).toMatch(/`no-planned-images` og `images-in-deck`/)
    expect(SELF_CHECK_STOP).toMatch(/I `awaiting-deposit` er den ikke tom/)
    // And the stage that existed only to hold a missing digest is gone.
    expect(SELF_CHECK_STOP).not.toMatch(/generation-unverified/)

    /*
     * And the ordinary case — this conversation has the files — must be able to
     * end here. Handing them over is not a change to the document, so nothing
     * the agent does empties this list: the deck moves on when the *user*
     * deposits the files. A stop rule that waited for an empty list would
     * therefore be a rule to wait for a browser action the agent cannot
     * perform, which is the boundary this whole status exists to hold.
     */
    expect(verified.workflow.remainingSteps).not.toEqual([])
    const afterHandoff = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    expect(afterHandoff.workflow.stage).toBe('awaiting-deposit')
    expect(afterHandoff.workflow.remainingSteps).toEqual(verified.workflow.remainingSteps)
    expect(SELF_CHECK_STOP).toMatch(
      /du velger den grenen som gjelder denne samtalen, utfører den, og avslutter når \*\*den\*\* er gjort/i,
    )
    expect(SELF_CHECK_STOP).toMatch(/ikke når listen blir tom/i)
    expect(SELF_CHECK_STOP).toMatch(/ikke vente på at brukeren deponerer dem/i)
    expect(SELF_CHECK_STOP).not.toMatch(/`workflow\.remainingSteps` er tom, er \*\*ditt\*\*/i)
  })

  it('gir samme svar når briefen leses på nytt', async () => {
    // An agent that re-reads the deck cannot get a friendlier answer: the
    // status is derived from the same deck by the same function.
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)
    const again = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    expect(again.workflow).toEqual(brief.workflow)
  })

  it('er ferdig når koblingskontrollen godkjenner settet, uten at noe er deponert', async () => {
    // The acceptance flow, end to end and without cheating: the pictures are
    // generated outside Slaids, the bindings are verified, and *no*
    // `set_zone_asset` is called. The generation task has to have a reachable
    // finishing line here — the deposit is the user's step, in a browser.
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)

    const verified = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: generated(brief),
    })

    expect(verified.ok).toBe(true)
    expect(verified.reporting).toBe('hash-reported')
    expect(verified.workflow.stage).toBe('awaiting-deposit')
    expect(verified.workflow.complete).toBe(false)
    // Slaids still has none of the files, and says so — it is just not the
    // stop criterion, and it is never called «generation calls remaining».
    expect(verified.workflow.awaitingFileCount).toBe(MOTIFS.length)
    expect(verified.workflow.depositedImageCount).toBe(0)
    expect(verified.workflow.nextAction).toMatch(/genereringsarbeidet ditt er gjort/i)
    expect(verified.workflow.nextAction).toMatch(/brukerens steg/i)
    // And it works for a session that does not hold the files: the deck keeps
    // the check, never the pictures, so a later conversation is told to say so
    // and make them again rather than to report a deck with empty zones done.
    expect(verified.workflow.nextAction).toMatch(/generere bildene på nytt/i)
    expect(verified.workflow.nextAction).toMatch(/aldri dekket ferdig til brukeren/i)
    // Nothing left to generate for *this* conversation, which holds the files:
    // the earlier model would have asked for eight more pictures here. What is
    // left is the handover, and the branch for a session that does not have
    // them — never an unconditional demand.
    expect(verified.workflow.remainingSteps.join(' ')).toMatch(
      /lever dem med manifestet/i,
    )
    expect(verified.workflow.remainingSteps.join(' ')).not.toMatch(
      /^Generer de \d+ bildene/im,
    )
    // The delivery stage names its own wrong endings: overstating what a
    // report proves, and calling the deck finished while its zones are empty.
    expect(verified.workflow.forbiddenClosings.join(' ')).toMatch(
      /Ikke si at bildene er kontrollert eller verifisert/i,
    )
    expect(verified.workflow.forbiddenClosings.join(' ')).not.toMatch(
      /Bildene er ikke satt inn ennå/i,
    )
  })

  it('lar ikke en lagret kontroll være en leveranse en senere samtale kan gjøre', async () => {
    /*
     * The two halves of this feature read together, by the reader they are both
     * about. `verify_image_handoff` writes its result to the deck, so the
     * answer survives the conversation — but the picture files were made in the
     * host client and do not. A later session therefore opens a deck that is
     * `awaiting-deposit` with `complete: true`, which is true of the document,
     * while it owes every picture and has nothing to hand over.
     *
     * Asserted apart, both halves passed. Together they used to say «your work
     * is done» and «generate them again» in the same answer, and an empty step
     * list settled it. What is left for the agent is now `remainingSteps`, with
     * the condition that selects each case — and the one it prescribes here is
     * performable, not advice.
     */
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)
    await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: generated(brief),
    })

    const later = laterConversation()
    const reopened = await ok<ImageBriefView>(later, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    expect(reopened.workflow.stage).toBe('awaiting-deposit')
    expect(reopened.workflow.complete).toBe(false)

    // The model-facing stop contract, run for this reader: work is owed, and
    // `complete` is not what decides it.
    expect(SELF_CHECK_STOP).toMatch(/Det er `remainingSteps` som avgjør det, ikke `complete` alene/i)
    expect(SELF_CHECK_STOP).not.toMatch(/Er stadiet `awaiting-deposit`, har du gjort ditt/i)
    expect(reopened.workflow.remainingSteps).not.toEqual([])
    const owed = reopened.workflow.remainingSteps.join(' ')
    expect(owed).toMatch(/har du dem ikke/i)
    expect(owed).toMatch(/generer oppføringene i `images` på nytt, én av gangen/i)
    expect(owed).toMatch(/meld koblingen igjen/i)

    // And doing it gets this conversation out: the same entries, generated
    // again, pass the check against the plan the deck still carries.
    const again = await ok<GeneratedImagesView>(later, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: generated(reopened),
    })
    expect(again.ok).toBe(true)
    expect(again.workflow.stage).toBe('awaiting-deposit')
  })

  it('er ikke ferdig før den siste jobben er kontrollert', async () => {
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)

    // One picture short: the loop's normal state, and never a delivery.
    const short = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: generated(brief).slice(0, -1),
    })
    expect(short.ok).toBe(true)
    expect(short.planCovered).toBe(false)
    expect(short.manifest).toBeNull()
    expect(short.workflow.stage).toBe('awaiting-generation')
    expect(short.workflow.complete).toBe(false)

    // The last one closes it, and the manifest is the whole set rather than
    // the binding that happened to be checked last.
    const last = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: generated(brief).slice(-1),
    })
    expect(last.planCovered).toBe(true)
    expect(last.manifest).toContain(brief.images[0].imagePlanItemId)
    expect(last.workflow.stage).toBe('awaiting-deposit')
    expect(last.workflow.complete).toBe(false)
  })

  it('holder seg ferdig når briefen leses etter en godkjent kontroll', async () => {
    // The regression: `verify_image_handoff` answered «done», and the very next
    // `get_image_brief` on the unchanged deck answered «generate eight
    // pictures» — the same duplicate generation, one call later. The check
    // writes its result to the deck, so every later read agrees with it.
    const context = freshContext()
    const brief = await plannedPictureDeck(context, MOTIFS.length)
    const verified = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: generated(brief),
    })
    expect(verified.workflow.stage).toBe('awaiting-deposit')

    const reread = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    expect(reread.workflow.stage).toBe('awaiting-deposit')
    expect(reread.workflow.complete).toBe(false)
    expect(reread.workflow.remainingSteps.join(' ')).not.toMatch(/^Generer de \d+ bildene/im)
    expect(reread.workflow.nextAction).not.toMatch(/kall deretter bildegeneratoren/i)
    // Nothing was deposited, and the deck says so without treating it as work.
    expect(reread.workflow.awaitingFileCount).toBe(MOTIFS.length)
    expect(reread.workflow.depositedImageCount).toBe(0)
  })

  it('ber om bildene på nytt hvis bestillingen skrives om etter kontrollen', async () => {
    // The stored answer is not a flag: it is the bindings, re-checked against
    // the plan the deck carries now. Rewriting the shared context changes every
    // order's identity, so the verification stops applying by itself.
    const context = freshContext()
    const brief = await plannedPictureDeck(context, 2)
    await ok(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: generated(brief),
    })
    await ok(context, 'set_image_context', {
      presentationId: brief.presentationId,
      context: 'Kullstifttegninger, høy kontrast, ingen farge, ingen tekst.',
    })

    const reread = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    expect(reread.images.map((image) => image.imagePlanItemId)).not.toEqual(
      brief.images.map((image) => image.imagePlanItemId),
    )
    expect(reread.workflow.stage).toBe('awaiting-generation')
    expect(reread.workflow.complete).toBe(false)
  })

  it('kan nå ferdig fra en delvis deponert plan uten å lage bildet om igjen', async () => {
    // Three planned, one file already in its zone. The old status said «call
    // the generator twice» while `images` still listed three and the binding
    // check expected three records — so an agent that followed it walked into
    // MISSING_ITEM. Now the plan is stale until it describes only what waits,
    // and the way out never regenerates the picture that is already there.
    const context = freshContext()
    const brief = await plannedPictureDeck(context, 3)
    await deposit(context, brief.presentationId, brief.images[0])

    const stale = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    expect(stale.workflow.stage).toBe('plan-outdated')
    expect(stale.workflow.complete).toBe(false)
    expect(stale.workflow.depositedImageCount).toBe(1)
    expect(stale.workflow.nextAction).toMatch(/skriv bildeplanen på nytt med bare de sonene/i)

    // Follow it: re-plan the two zones that still wait.
    const waiting = stale.images.filter((image) => !image.filled)
    expect(waiting).toHaveLength(2)
    const replanned = await ok<ImageBriefView>(context, 'plan_deck_images', {
      presentationId: brief.presentationId,
      images: waiting.map((image) =>
        planned(image.slideId, image.nodeId, MOTIFS[image.number - 1]),
      ),
    })
    expect(replanned.issues).toEqual([])
    expect(replanned.workflow.stage).toBe('awaiting-generation')
    // The number the status asks for is exactly the set the check expects.
    expect(replanned.workflow.awaitingFileCount).toBe(2)
    expect(replanned.images).toHaveLength(2)
    expect(replanned.generation?.expectedFileCount).toBe(2)

    const verified = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: generated(replanned),
    })
    expect(verified.ok).toBe(true)
    expect(verified.issues).toEqual([])
    expect(verified.workflow.stage).toBe('awaiting-deposit')
    expect(verified.workflow.complete).toBe(false)
  })

  it('lar ikke gamle filer i sonene gjøre en omskrevet bestilling ferdig', async () => {
    const context = freshContext()
    const brief = await plannedPictureDeck(context, 2)
    for (const image of brief.images) await deposit(context, brief.presentationId, image)

    // Every planned zone now holds a file, and nothing waits — but the plan
    // still describes those zones, so it is stale rather than delivered.
    const filled = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    expect(filled.workflow.awaitingFileCount).toBe(0)
    expect(filled.workflow.stage).toBe('plan-outdated')
    expect(filled.workflow.complete).toBe(false)

    // Rewrite the shared context and every order changes identity. The files in
    // the zones were made for orders the deck no longer has, and the binding
    // check — not the filled zones — is what says so.
    await ok(context, 'set_image_context', {
      presentationId: brief.presentationId,
      context: 'Kullstifttegninger, høy kontrast, ingen farge, ingen tekst.',
    })
    const rewritten = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    expect(rewritten.images.map((image) => image.imagePlanItemId)).not.toEqual(
      brief.images.map((image) => image.imagePlanItemId),
    )
    expect(rewritten.workflow.complete).toBe(false)

    const stale = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: generated(brief),
    })
    expect(stale.ok).toBe(false)
    expect(stale.issues.map((issue) => issue.code)).toContain('PLAN_CHANGED')
    expect(stale.workflow.complete).toBe(false)
  })

  it('kan ikke gjøres ferdig ved å tømme bildeplanen etter en endret bestilling', async () => {
    /*
     * The laundering path, through the real operations. Plan, verify, deposit,
     * rewrite the shared context — and then do exactly what the status names as
     * the repair. «Rewrite the plan with only the zones that still wait» is an
     * empty plan on a fully deposited deck, and emptying it used to delete the
     * bindings and report `complete: true` with pictures made for orders the
     * deck no longer had. The repair must not be the bug.
     */
    const context = freshContext()
    const brief = await plannedPictureDeck(context, 2)
    await ok(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: generated(brief),
    })
    for (const image of brief.images) await deposit(context, brief.presentationId, image)

    const delivered = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    expect(delivered.workflow.stage).toBe('images-in-deck')
    expect(delivered.workflow.complete).toBe(true)

    await ok(context, 'set_image_context', {
      presentationId: brief.presentationId,
      context: 'Kullstifttegninger, høy kontrast, ingen farge, ingen tekst.',
    })
    const changed = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    expect(changed.workflow.stage).toBe('plan-outdated')
    expect(changed.workflow.complete).toBe(false)
    expect(changed.workflow.nextAction).toMatch(/erstatningene er ikke laget ennå/i)

    // Follow the repair literally: empty the plan. The deck must not forget why
    // it was stale, and with nothing on order it says so plainly.
    const emptied = await ok<ImageBriefView>(context, 'plan_deck_images', {
      presentationId: brief.presentationId,
      images: [],
    })
    expect(emptied.imageCount).toBe(0)
    expect(emptied.workflow.stage).toBe('plan-outdated')
    expect(emptied.workflow.complete).toBe(false)
    expect(emptied.workflow.nextAction).toMatch(/ikke rettet ved å tømme bildeplanen/i)

    // The way out orders those pictures again and makes them — and making them
    // is still not the same as them being in the deck: the zones show the old
    // pictures until the new files are put in.
    const replanned = await ok<ImageBriefView>(context, 'plan_deck_images', {
      presentationId: brief.presentationId,
      images: changed.images.map((image) =>
        planned(image.slideId, image.nodeId, MOTIFS[image.number - 1]),
      ),
    })
    const remade = await ok<GeneratedImagesView>(context, 'verify_image_handoff', {
      presentationId: brief.presentationId,
      images: generated(replanned),
    })
    expect(remade.ok).toBe(true)
    expect(remade.workflow.stage).toBe('awaiting-deposit')
    expect(remade.workflow.nextAction).toMatch(/viser fortsatt bildet fra den forrige bestillingen/i)

    for (const image of replanned.images) {
      await deposit(context, brief.presentationId, image, realImages.jpeg())
    }
    const delivered2 = await ok<ImageBriefView>(context, 'get_image_brief', {
      presentationId: brief.presentationId,
    })
    expect(delivered2.workflow.stage).toBe('images-in-deck')
    expect(delivered2.workflow.complete).toBe(true)
  })

  it('beskriver `awaiting-deposit` i kontrakten koblingskontrollen selv bærer', async () => {
    // The tool summary is part of what the model reads before it calls. It said
    // a passing check lands on `images-in-deck` «also before the files are
    // in» — the opposite of what the stages now mean, and this PR is about not
    // giving an agent two definitions of the same thing.
    const verify = mcpTools().find((tool) => tool.name.endsWith('verify_image_handoff'))
    expect(verify).toBeDefined()
    expect(verify?.description).toMatch(
      /`workflow\.stage` blir `awaiting-deposit` når hele planen er dekket/i,
    )
    expect(verify?.description).toMatch(
      /`images-in-deck` først når filene er lagt inn i sonene/i,
    )
    expect(verify?.description).not.toMatch(/`images-in-deck` også før filene er lagt inn/i)
    // And what the check settles is what was *reported*: the files themselves
    // are only ever seen in the browser.
    expect(verify?.description).toMatch(
      /Begge er `complete: false` til filene er inne, for kontrollen svarer på hva du har meldt, ikke på at bildene finnes/i,
    )
    expect(verify?.description).toMatch(/`reporting` og `reportingMeans` sier hvor langt svaret rekker/i)
    // The digest is an extra check the ordinary host cannot produce, so the
    // description must not read as a demand for one.
    expect(verify?.description).toMatch(/ekstra kontroll deponeringen kan bruke/i)
    expect(verify?.description).not.toMatch(/bytesUnavailable/)
  })

  it('sender agenten gjennom reparasjonen uten å slippe den ut av flyten', async () => {
    // A plan the checks disagree with is still a plan that ends in pictures:
    // repair first, then the same generation, never a hand-back.
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
    expect(brief.workflow.remainingSteps.join(' ')).toMatch(/Hent neste bildejobb/i)
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
