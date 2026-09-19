/**
 * Where the picture work stands, and the failures that answer went through.
 *
 * The first failure was a turn that ended: an agent wrote a plan for eight
 * pictures, read an answer whose `issues` list was empty, and told the user the
 * presentation was created. Every rule about generating pictures was in that
 * answer as prose. What was not in it was the one fact that mattered.
 *
 * The second was the fix growing a lifecycle it could not observe. A filled
 * picture zone is the user's deposit, never the agent's generation — so the
 * status learned to read stored *bindings* an agent wrote down about pictures
 * Slaids never saw, and those bindings were exactly as cheap to produce by
 * copying the plan as by making the pictures. They are gone. The only thing
 * this module reports on now is what the deck can see: a plan, and whether the
 * zones it names hold files.
 */

import { describe, expect, it } from 'vitest'
import { registerAsset } from './commands/assets'
import { setContentKind, setImageAsset } from './commands/content'
import { completeImageDeposit } from './commands/imageDeposit'
import { setImagePlan } from './commands/imagePlan'
import { setImageContext } from './commands/slides'
import { createImage } from './content'
import { createLeaf, createSplit } from './layout'
import { createPresentation } from './presentation'
import { titleDoc } from './richdoc'
import { depositSlots } from './imageDeposit'
import { checkImagePlan, resolveImagePlan, type PlannedImage } from './imagePlan'
import {
  composeImageWorkflowStatus,
  IMAGE_WORKFLOW_COMPLETION_CRITERIA,
  IMAGE_WORKFLOW_FORBIDDEN_CLOSINGS,
} from './imageWorkflow'
import { validatePresentation } from './schema'
import { contentAt, sectionAt } from './testDecks'
import type { Presentation } from './types'

const CONTEXT =
  'Fotorealistiske rekonstruksjoner, naturlig dagslys, dempet jordfargepalett, ingen tekst i bildene.'

/**
 * Motifs that differ from each other, because the checks say so.
 *
 * A plan of eight variations on one sentence is `NEAR_DUPLICATE` eight times
 * over, and these tests are about the stages *after* the plan is sound.
 */
const MOTIFS: readonly string[] = [
  'Australopithecus afarensis i helfigur på en savanne.',
  'Homo erectus som slakter et dyr ved en elvebredd.',
  'Et neandertalerbarn foran en hulemaling i fakkellys.',
  'Et steinredskap holdt frem mellom to fingre.',
  'En gravlegging med røde okerpigmenter.',
  'Et landskap med innlandsis og tundravegetasjon.',
  'To jegere som bærer et spyd over skulderen.',
  'En leirboplass med røyk mellom skinntelt.',
]

/** A deck of `count` slides, each one full-slide picture zone. */
function deckOfPictures(count: number): {
  deck: Presentation
  zones: { slideId: string; nodeId: string }[]
} {
  const base = createPresentation({ title: 'Menneskets evolusjon' })
  const template = contentAt(base, 1)
  const slides = Array.from({ length: count }, (_, index) => {
    const leaf = createLeaf(createImage())
    return {
      ...template,
      id: `bildeslide-${index + 1}`,
      title: titleDoc(`Bilde ${index + 1}`),
      root: leaf,
    }
  })
  return {
    deck: { ...base, imageContext: CONTEXT, slides: [sectionAt(base, 0), ...slides] },
    zones: slides.map((slide) => ({ slideId: slide.id, nodeId: slide.root.id })),
  }
}

function entry(slideId: string, nodeId: string, subject: string): PlannedImage {
  return {
    slideId,
    nodeId,
    subject,
    composition: 'Motivet sentrert, rolig bakgrunn.',
    requirements: '',
    avoid: '',
  }
}

function planned(deck: Presentation, entries: PlannedImage[]): Presentation {
  const written = setImagePlan(deck, entries)
  if (!written.ok) throw new Error(written.error.message)
  return written.value
}

/** `count` planned pictures, none of them made yet. */
function awaiting(count: number): Presentation {
  const { deck, zones } = deckOfPictures(count)
  return planned(
    deck,
    zones.map((zone, index) => entry(zone.slideId, zone.nodeId, MOTIFS[index])),
  )
}

/** The same deck with the file for one entry deposited into its zone. */
function withFile(deck: Presentation, index: number, prefix = 'a'): Presentation {
  const image = resolveImagePlan(deck)[index]
  const id = `${prefix}${index + 1}`
  const registered = registerAsset(deck, {
    id,
    name: `${image.fileNameStem}.png`,
    mimeType: 'image/png',
    byteSize: 10,
    width: 1600,
    height: 900,
    isVector: false,
  })
  if (!registered.ok) throw new Error(registered.error.message)
  const filled = setImageAsset(registered.value, {
    slideId: image.plan.slideId,
    nodeId: image.plan.nodeId,
    assetId: id,
  })
  if (!filled.ok) throw new Error(filled.error.message)
  return filled.value
}

/** Every planned picture deposited at once, the way the dialog does it. */
function deposited(deck: Presentation): Presentation {
  let current = deck
  const placements = depositSlots(deck).map((slot, index) => {
    const id = `dep${index + 1}`
    const registered = registerAsset(current, {
      id,
      name: `${slot.index}.png`,
      mimeType: 'image/png',
      byteSize: 10,
      width: 1600,
      height: 900,
      isVector: false,
    })
    if (!registered.ok) throw new Error(registered.error.message)
    current = registered.value
    return { index: slot.index, assetId: id }
  })
  const done = completeImageDeposit(current, placements)
  if (!done.ok) throw new Error(done.error.message)
  return done.value
}

describe('en fersk bildeplan er ikke ferdig arbeid', () => {
  it('sier det, med dekkets egne tall', () => {
    const status = composeImageWorkflowStatus(awaiting(8))
    expect(status.stage).toBe('awaiting-images')
    expect(status.complete).toBe(false)
    expect(status.plannedImageCount).toBe(8)
    expect(status.awaitingFileCount).toBe(8)
    expect(status.depositedImageCount).toBe(0)
  })

  it('navngir seriebriefen som neste handling, i samme arbeidsøkt', () => {
    const status = composeImageWorkflowStatus(awaiting(8))
    expect(status.nextAction).toMatch(/mellomsteg, ikke leveransen/i)
    expect(status.nextAction).toMatch(/seriebrief/i)
    expect(status.nextAction).toMatch(/ordrett/i)
    expect(status.nextAction).toMatch(/samme arbeidsøkt/i)
    expect(status.remainingSteps[0]).toMatch(/Hent den ferdige seriebriefen/i)
  })

  it('ber aldri agenten generere et bilde selv, eller hente én jobb om gangen', () => {
    /*
     * The loop this replaces, asserted as the absence it has to be. Its whole
     * shape — a job fetched from Slaids, a call, a binding reported back, the
     * next job — is what a host client's image tool did not survive, and an
     * instruction that still described any part of it would send an agent
     * straight back into it.
     */
    const status = composeImageWorkflowStatus(awaiting(8))
    const instructions = [status.nextAction, ...status.remainingSteps].join(' ')
    expect(instructions).not.toMatch(/bildejobb|get_next_image_job/i)
    expect(instructions).not.toMatch(/koblingskontroll|verify_image_handoff/i)
    expect(instructions).not.toMatch(/ett kall per|én jobb om gangen|enkeltvis/i)
    expect(instructions).not.toMatch(/manifest|sha-256|avtrykk/i)
    expect(instructions).not.toMatch(/generer .*bilde/i)
    // What it does say is that the brief goes to the user, whole.
    expect(instructions).toMatch(/Ikke del den opp/i)
    expect(instructions).toMatch(/bildedeponeringen/i)
  })

  it('sier at bildene lages utenfor Slaids og legges inn av brukeren', () => {
    const status = composeImageWorkflowStatus(awaiting(3))
    expect(status.nextAction).toMatch(/utenfor Slaids/i)
    expect(status.nextAction).toMatch(/brukerens steg/i)
    expect(status.nextAction).toMatch(/venter du aldri på/i)
  })

  it('gir de samme stoppkriteriene som agentinstruksen er bygget av', () => {
    const status = composeImageWorkflowStatus(awaiting(2))
    // One definition of done, read from one place: two copies is how a
    // delivery comes to satisfy one of them.
    expect(status.completionCriteria).toBe(IMAGE_WORKFLOW_COMPLETION_CRITERIA)
    expect(status.forbiddenClosings).toBe(IMAGE_WORKFLOW_FORBIDDEN_CLOSINGS)
    expect(status.forbiddenClosings.join(' ')).toMatch(/Bildeplanen er klar/)
    expect(status.forbiddenClosings.join(' ')).toMatch(/Ikke vent på at brukeren deponerer/)
  })

  it('åpner deponeringen samtidig, så brukeren har et sted å legge filene', () => {
    const deck = awaiting(3)
    expect(deck.imageDeposit).toEqual({ status: 'pending', expectedCount: 3 })
    expect(depositSlots(deck).map((slot) => slot.index)).toEqual([1, 2, 3])
  })
})

describe('et dekk uten planlagte bilder', () => {
  it('har ingenting utestående, og sier det som en ferdig tilstand', () => {
    // A deck with no reserved picture zones at all: one with empty zones and
    // no plan is a deck that forgot to write one, and `checkImagePlan` says so.
    const status = composeImageWorkflowStatus(createPresentation({ title: 'Uten bilder' }))
    expect(status.stage).toBe('no-planned-images')
    expect(status.complete).toBe(true)
    expect(status.remainingSteps).toEqual([])
    expect(status.forbiddenClosings).toEqual([])
    expect(status.nextAction).toMatch(/planlegger ingen rasterbilder/i)
  })
})

describe('en plan med funn', () => {
  it('ber om reparasjonen først, og briefen etterpå', () => {
    const deck = awaiting(2)
    const stripped = setImageContext(deck, null)
    expect(stripped.ok).toBe(true)
    if (!stripped.ok) return
    expect(checkImagePlan(stripped.value).length).toBeGreaterThan(0)

    const status = composeImageWorkflowStatus(stripped.value)
    expect(status.stage).toBe('plan-needs-repair')
    expect(status.complete).toBe(false)
    expect(status.remainingSteps[0]).toMatch(/Rett det `issues` peker på/i)
    // And the delivery is still owed after the repair, in the same session.
    expect(status.remainingSteps.join(' ')).toMatch(/seriebrief/i)
  })

  it('ber ikke om en brief for en plan som ikke venter på noe', () => {
    /*
     * A deck whose pictures are all in place and whose plan has a finding is a
     * repair, not a delivery: asking for the brief would be asking the user to
     * order pictures the deck already has.
     */
    const deck = deposited(awaiting(2))
    const broken = setImageContext(deck, null)
    expect(broken.ok).toBe(true)
    if (!broken.ok) return
    const status = composeImageWorkflowStatus(broken.value)
    expect(status.stage).toBe('plan-needs-repair')
    expect(status.awaitingFileCount).toBe(0)
    expect(status.remainingSteps).toHaveLength(1)
  })
})

describe('bildene er i dekket', () => {
  it('er den ene tilstanden som kan si ferdig, og den er brukerens deponering', () => {
    const deck = deposited(awaiting(3))
    const status = composeImageWorkflowStatus(deck)
    expect(status.stage).toBe('images-in-deck')
    expect(status.complete).toBe(true)
    expect(status.depositedImageCount).toBe(3)
    expect(status.awaitingFileCount).toBe(0)
    expect(status.remainingSteps).toEqual([])
    expect(status.forbiddenClosings).toEqual([])
    // The one caveat that survives: Slaids never saw the picture itself.
    expect(status.nextAction).toMatch(/ser aldri selve bildet/i)
  })

  it('kan ikke nås av noe et kall sier, bare av filer i sonene', () => {
    const deck = awaiting(3)
    // Nothing on the document claims a picture exists any more: the field that
    // used to carry an agent's own report is gone, and a stored document that
    // still has one is not a valid one.
    expect('generatedImages' in deck).toBe(false)
    expect(composeImageWorkflowStatus(deck).complete).toBe(false)
    expect(composeImageWorkflowStatus(deposited(deck)).complete).toBe(true)
  })

  it('validerer som en vanlig presentasjon i alle stadier', () => {
    for (const deck of [awaiting(2), withFile(awaiting(2), 0), deposited(awaiting(2))]) {
      const validated = validatePresentation(deck)
      expect(validated.ok, JSON.stringify(validated)).toBe(true)
    }
  })
})

describe('en plan som beskriver bilder dekket allerede har', () => {
  it('ber om at planen skrives om, i stedet for å bestille dem på nytt', () => {
    const deck = withFile(awaiting(3), 1)
    const status = composeImageWorkflowStatus(deck)
    expect(status.stage).toBe('plan-outdated')
    expect(status.complete).toBe(false)
    expect(status.depositedImageCount).toBe(1)
    expect(status.awaitingFileCount).toBe(2)
    expect(status.nextAction).toMatch(/har alt en fil/i)
    expect(status.remainingSteps[0]).toMatch(/Skriv bildeplanen på nytt/i)
  })

  it('er i orden igjen når planen bare holder sonene som venter', () => {
    const deck = withFile(awaiting(3), 1)
    const remaining = resolveImagePlan(deck).filter((image) => !image.filled)
    const rewritten = planned(
      deck,
      remaining.map((image) => entry(image.plan.slideId, image.plan.nodeId, image.plan.subject)),
    )
    const status = composeImageWorkflowStatus(rewritten)
    expect(status.stage).toBe('awaiting-images')
    expect(status.plannedImageCount).toBe(2)
    // And the deposit now expects two files, not three.
    expect(rewritten.imageDeposit?.expectedCount).toBe(2)
    expect(depositSlots(rewritten).map((slot) => slot.index)).toEqual([1, 2])
  })
})

describe('en sone som slutter å være en bildesone', () => {
  it('melder planen som ødelagt i stedet for å telle den ned', () => {
    const deck = awaiting(3)
    const image = resolveImagePlan(deck)[1]
    const converted = setContentKind(deck, {
      slideId: image.plan.slideId,
      nodeId: image.plan.nodeId,
      kind: 'untitled-card',
    })
    expect(converted.ok).toBe(true)
    if (!converted.ok) return
    const status = composeImageWorkflowStatus(converted.value)
    expect(status.stage).toBe('plan-needs-repair')
    expect(checkImagePlan(converted.value).map((issue) => issue.code)).toContain('ZONE_GONE')
  })
})

describe('deponeringen som er forlatt eller lukket', () => {
  it('sier hva brukeren skal gjøre i stedet, når den ikke åpner igjen', () => {
    const deck = awaiting(2)
    const abandoned: Presentation = {
      ...deck,
      imageDeposit: { status: 'abandoned', expectedCount: 2 },
    }
    const status = composeImageWorkflowStatus(abandoned)
    expect(status.stage).toBe('awaiting-images')
    expect(status.nextAction).toMatch(/forlatt for dette dekket/i)
    expect(status.nextAction).toMatch(/én sone om gangen/i)
  })

  it('ber om at planen skrives på nytt når deponeringen er lukket', () => {
    const deck = awaiting(2)
    const closed: Presentation = {
      ...deck,
      imageDeposit: { status: 'completed', expectedCount: 2 },
    }
    const status = composeImageWorkflowStatus(closed)
    expect(status.stage).toBe('awaiting-images')
    expect(status.nextAction).toMatch(/Skriv bildeplanen på nytt før briefen gis videre/i)
  })
})

describe('to bildesoner på samme slide', () => {
  it('nummereres i dekkets rekkefølge, og deponeringen følger den', () => {
    const base = createPresentation({ title: 'To bilder' })
    const template = contentAt(base, 1)
    const left = createLeaf(createImage())
    const right = createLeaf(createImage())
    const slide = { ...template, root: createSplit('x', [1, 1], [left, right]) }
    const deck: Presentation = {
      ...base,
      imageContext: CONTEXT,
      slides: [sectionAt(base, 0), slide],
    }
    const written = planned(deck, [
      entry(slide.id, left.id, MOTIFS[0]),
      entry(slide.id, right.id, MOTIFS[1]),
    ])
    expect(resolveImagePlan(written).map((image) => image.number)).toEqual([1, 2])
    expect(composeImageWorkflowStatus(written).plannedImageCount).toBe(2)
    expect(depositSlots(written).map((slot) => slot.nodeId)).toEqual([left.id, right.id])
  })
})
