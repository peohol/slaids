/**
 * Where the picture work stands, and the three ways that answer went wrong.
 *
 * The first failure was a turn that ended: an agent wrote a plan for eight
 * pictures, read an answer whose `issues` list was empty, and told the user the
 * presentation was created. Every rule about generating pictures was in that
 * answer as prose. What was not in it was the one fact that mattered.
 *
 * The second was the fix getting the *lifecycle* wrong. A filled picture zone
 * is the user's deposit, not the agent's generation, so a status built on
 * filled zones told an agent that had generated and verified every picture that
 * eight generation calls were still owed.
 *
 * The third was the fix being a fact about one call. `verify_image_handoff`
 * answered «done», and the next read of the unchanged deck answered «generate
 * eight pictures» — the same duplicate generation, one call later. So the
 * bindings are stored, and everything below asks the deck rather than a
 * response.
 */

import { describe, expect, it } from 'vitest'
import { registerAsset } from './commands/assets'
import { setContentKind, setImageAsset } from './commands/content'
import { recordGeneratedImages } from './commands/imageGeneration'
import { completeImageDeposit } from './commands/imageDeposit'
import { setImagePlan } from './commands/imagePlan'
import { setImageContext } from './commands/slides'
import { createImage } from './content'
import { createLeaf, createSplit } from './layout'
import { createPresentation } from './presentation'
import { titleDoc } from './richdoc'
import {
  checkGeneratedImages,
  staleGeneratedImages,
  type GeneratedImageRecord,
} from './imageGeneration'
import { depositSlots } from './imageDeposit'
import { checkImagePlan, resolveImagePlan, type PlannedImage } from './imagePlan'
import { composeImageWorkflowStatus, imageGenerationIsVerified } from './imageWorkflow'
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

/** What a host client holds after generating every planned picture. */
function records(deck: Presentation): GeneratedImageRecord[] {
  return resolveImagePlan(deck).map((image, index) => ({
    imagePlanItemId: image.id,
    number: image.number,
    slideId: image.plan.slideId,
    nodeId: image.plan.nodeId,
    fileName: `${image.fileNameStem}.png`,
    contentHash: (index + 1).toString(16).padStart(2, '0').repeat(32),
  }))
}

/** The deck as it is after a successful binding check. */
function verified(deck: Presentation): Presentation {
  const written = recordGeneratedImages(deck, records(deck))
  if (!written.ok) throw new Error(written.error.message)
  return written.value
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

describe('en fersk bildeplan er ikke ferdig arbeid', () => {
  it('sier det, med dekkets egne tall', () => {
    const status = composeImageWorkflowStatus(awaiting(8))
    expect(status.stage).toBe('awaiting-generation')
    expect(status.complete).toBe(false)
    expect(status.plannedImageCount).toBe(8)
    expect(status.awaitingFileCount).toBe(8)
    expect(status.depositedImageCount).toBe(0)
  })

  it('navngir bildegenereringen som neste handling', () => {
    const status = composeImageWorkflowStatus(awaiting(8))
    expect(status.nextAction).toMatch(/mellomsteg/i)
    expect(status.nextAction).toMatch(/samme samtale/i)
    expect(status.nextAction).toContain('8 ganger')
    expect(status.remainingSteps.join(' ')).toMatch(/skriv den ut i samtalen/i)
    expect(status.remainingSteps.join(' ')).toContain('de 8 bildene')
  })

  it('forbyr nettopp de avslutningene som beskriver halvferdig arbeid', () => {
    const closings = composeImageWorkflowStatus(awaiting(3)).forbiddenClosings.join(' ')
    expect(closings).toContain('Presentasjonen er opprettet')
    expect(closings).toContain('Bildene er ikke satt inn ennå')
    expect(closings).toContain('Bildeplanen er klar')
    expect(closings).toMatch(/ny brukerbeskjed/i)
    expect(closings).toMatch(/Ikke generer et bilde om igjen fordi bildesonen ennå er tom/i)
  })

  it('krever bildene generert og koblingen kontrollert, men ikke deponert', () => {
    const criteria = composeImageWorkflowStatus(awaiting(3)).completionCriteria.join(' ')
    expect(criteria).toMatch(/skrevet ut i samtalen/i)
    expect(criteria).toMatch(/generert i samme samtale/i)
    expect(criteria).toMatch(/koblingskontrollen svarer `ok`/i)
    expect(criteria).toMatch(/Fylte bildesoner er derfor aldri stoppkriteriet/i)
  })
})

describe('genereringen er kontrollert, ikke observert', () => {
  it('er ferdig når koblingene er kontrollert, uten at noe er deponert', () => {
    // The flow this whole feature is for: the pictures are made in the host
    // client and verified, and the files reach Slaids later through the user's
    // deposit. Every zone is still empty here, and the generation task is done.
    const deck = verified(awaiting(3))
    const status = composeImageWorkflowStatus(deck)
    expect(status.stage).toBe('awaiting-deposit')
    expect(status.complete).toBe(true)
    expect(status.awaitingFileCount).toBe(3)
    expect(status.depositedImageCount).toBe(0)
    expect(status.remainingSteps).toEqual([])
    expect(status.forbiddenClosings).toEqual([])
    expect(status.nextAction).toMatch(/genereringsoppgaven er gjort/i)
    expect(status.nextAction).toMatch(/brukerens steg/i)
  })

  it('blir stående på dekket, så en ny lesing ikke ber om bildene på nytt', () => {
    // The regression: `verify_image_handoff` answered «done» and the next read
    // of the same deck answered «generate three pictures». The status is a fact
    // about the document, so reading it twice cannot say two things.
    const deck = verified(awaiting(3))
    const first = composeImageWorkflowStatus(deck)
    const second = composeImageWorkflowStatus(deck)
    expect(second).toEqual(first)
    expect(second.stage).toBe('awaiting-deposit')
    expect(second.complete).toBe(true)
    expect(second.remainingSteps.join(' ')).not.toMatch(/generer/i)
    // And it survives the trip through storage, because it is stored: the
    // bindings are validated by the same schema the manifest file is read
    // through, so a stored one and a delivered one cannot be different shapes.
    const reopened = validatePresentation(JSON.parse(JSON.stringify(deck)))
    expect(reopened.issues).toEqual([])
    const stored = reopened.value
    if (!stored) throw new Error('Forventet et gyldig dokument')
    expect(stored.generatedImages).toEqual(deck.generatedImages)
    expect(composeImageWorkflowStatus(stored)).toEqual(first)
  })

  it('lagrer ingenting når koblingen ikke holder', () => {
    // One picture short is not «mostly verified», and an unverified set must
    // not be storable: the document's copy is what later reads trust.
    const deck = awaiting(3)
    const refused = recordGeneratedImages(deck, records(deck).slice(0, -1))
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.error.code).toBe('INVALID_ARGUMENT')
    expect(deck.generatedImages).toBeUndefined()
    expect(composeImageWorkflowStatus(deck).stage).toBe('awaiting-generation')
  })

  it('slutter å gjelde når bestillingen skrives om', () => {
    // An entry's id covers its whole order, so rewriting the shared context
    // gives every entry a new one. The stored bindings then point at pictures
    // the deck no longer orders, and nothing had to remember to clear them.
    const deck = verified(awaiting(3))
    expect(imageGenerationIsVerified(deck)).toBe(true)

    const rewritten = setImageContext(deck, 'Kullstifttegninger, høy kontrast, ingen farge.')
    if (!rewritten.ok) throw new Error(rewritten.error.message)
    expect(imageGenerationIsVerified(rewritten.value)).toBe(false)
    expect(
      checkGeneratedImages(rewritten.value, rewritten.value.generatedImages ?? []).map(
        (issue) => issue.code,
      ),
    ).toContain('PLAN_CHANGED')

    const status = composeImageWorkflowStatus(rewritten.value)
    expect(status.stage).toBe('awaiting-generation')
    expect(status.complete).toBe(false)
  })

  it('rydder bort koblinger en ny plan ikke har bruk for', () => {
    const deck = verified(awaiting(3))
    expect(deck.generatedImages).toHaveLength(3)

    // Re-writing the same plan changes no id, so the bindings stand.
    const same = planned(deck, [...(deck.imagePlan ?? [])])
    expect(same.generatedImages).toHaveLength(3)
    expect(imageGenerationIsVerified(same)).toBe(true)

    // Dropping the plan drops them: they described orders that no longer exist.
    const cleared = planned(deck, [])
    expect(cleared.generatedImages).toBeUndefined()
  })
})

describe('en plan som ikke lenger beskriver det den påstår', () => {
  it('er ikke et sted å generere fra når noen soner alt har fil', () => {
    // The contradiction this closes: `awaitingFileCount` said «two pictures»
    // while `images` still listed three, and `checkGeneratedImages` expects one
    // record per *planned* entry — so an agent that followed the count walked
    // straight into MISSING_ITEM on the third.
    const deck = withFile(awaiting(3), 0)
    const status = composeImageWorkflowStatus(deck)
    expect(status.stage).toBe('plan-outdated')
    expect(status.complete).toBe(false)
    expect(status.depositedImageCount).toBe(1)
    expect(status.awaitingFileCount).toBe(2)
    expect(status.nextAction).toMatch(/1 av 3/)
    expect(status.nextAction).toMatch(/skriv bildeplanen på nytt med bare de sonene/i)
    expect(status.remainingSteps.join(' ')).toMatch(/bare de bildesonene som fortsatt venter/i)
  })

  it('er ferdig når et kontrollert sett faktisk er lagt inn i dekket', () => {
    // The end of the happy path, and it must not nag: the plan still lists the
    // zones, each one has its file, and the bindings account for all of them
    // against the orders in force.
    let deck = verified(awaiting(3))
    for (const index of [0, 1, 2]) deck = withFile(deck, index)
    const status = composeImageWorkflowStatus(deck)
    expect(status.stage).toBe('generation-verified')
    expect(status.complete).toBe(true)
    expect(status.awaitingFileCount).toBe(0)
    expect(status.depositedImageCount).toBe(3)
    expect(status.remainingSteps).toEqual([])
  })

  it('kaller ikke en erstatning deponert fordi den gamle filen fyller sonen', () => {
    /*
     * The narrow case, without the detour through an emptied plan: the pictures
     * are made again for a rewritten order, the check passes, and the zones
     * still hold the *previous* pictures. Every planned zone has a file, so the
     * count says nothing is missing — and it is wrong. Replacing the records
     * with the new delivery is what used to lose that, and it made the status
     * report the replacements as «lagt inn i dekket».
     */
    let deck = verified(awaiting(2))
    for (const index of [0, 1]) deck = withFile(deck, index)
    expect(composeImageWorkflowStatus(deck).stage).toBe('generation-verified')

    const rewritten = setImageContext(deck, 'Kullstifttegninger, høy kontrast.')
    if (!rewritten.ok) throw new Error(rewritten.error.message)
    // Same zones, new orders: the replacements are made and checked.
    let remade = verified(rewritten.value)

    const status = composeImageWorkflowStatus(remade)
    expect(status.stage).toBe('awaiting-deposit')
    expect(status.complete).toBe(true)
    // Nothing is *missing* from the deck, and the pictures are still not right.
    expect(status.awaitingFileCount).toBe(0)
    expect(status.nextAction).toMatch(/2 bildesoner viser fortsatt bildet fra den forrige bestillingen/i)
    expect(staleGeneratedImages(remade)).toHaveLength(2)

    // The deck can only call it done once the new files are actually in.
    for (const index of [0, 1]) remade = withFile(remade, index, 'ny')
    expect(staleGeneratedImages(remade)).toEqual([])
    expect(composeImageWorkflowStatus(remade).stage).toBe('generation-verified')
  })

  it('kan ikke gjøres ferdig ved å tømme bildeplanen når bestillingen er endret', () => {
    /*
     * The laundering path, end to end: plan, generate, verify, deposit, rewrite
     * the shared context — and then follow the repair the status used to name.
     * «Rewrite the plan with only the zones that still wait» is an empty plan on
     * a fully deposited deck, the empty plan deleted the bindings, and the deck
     * reported `complete: true` with pictures made for orders it no longer had.
     * The evidence has to survive the rewrite, or the repair is the bug.
     */
    let deck = verified(awaiting(3))
    for (const index of [0, 1, 2]) deck = withFile(deck, index)
    expect(composeImageWorkflowStatus(deck).complete).toBe(true)

    const rewritten = setImageContext(deck, 'Kullstifttegninger, høy kontrast, ingen farge.')
    if (!rewritten.ok) throw new Error(rewritten.error.message)
    // The plan still lists those zones, so a replacement is on order and the
    // status says to make it.
    const changed = composeImageWorkflowStatus(rewritten.value)
    expect(changed.stage).toBe('plan-outdated')
    expect(changed.complete).toBe(false)
    expect(changed.nextAction).toMatch(/erstatningene er ikke laget ennå/i)

    // Emptying the plan keeps the bindings, because their pictures are still in
    // the deck — so the deck cannot forget why it was stale. Now nothing is on
    // order for those zones, and the status says that plainly.
    const emptied = planned(rewritten.value, [])
    expect(emptied.generatedImages).toHaveLength(3)
    expect(staleGeneratedImages(emptied)).toHaveLength(3)
    const laundered = composeImageWorkflowStatus(emptied)
    expect(laundered.stage).toBe('plan-outdated')
    expect(laundered.complete).toBe(false)
    expect(laundered.nextAction).toMatch(/ikke rettet ved å tømme bildeplanen/i)
    expect(laundered.nextAction).toMatch(/ingenting er bestilt i stedet/i)

    // The way out is to order those pictures again and make them — but making
    // them is not the same as them being in the deck. The zones still show the
    // previous pictures at this point, and the status must say so instead of
    // counting a filled zone as a delivered replacement.
    const zones = resolveImagePlan(deck).map((image) => image.plan)
    const replanned = planned(emptied, zones)
    let remade = verified(replanned)
    const made = composeImageWorkflowStatus(remade)
    expect(made.stage).toBe('awaiting-deposit')
    expect(made.complete).toBe(true)
    expect(made.nextAction).toMatch(/viser fortsatt bildet fra den forrige bestillingen/i)
    expect(staleGeneratedImages(remade)).toHaveLength(3)

    // Only once the new files actually replace the old ones is the deck done,
    // and putting a file in a zone is the moment the superseded binding stops
    // being about anything.
    for (const index of [0, 1, 2]) remade = withFile(remade, index, `b${index}`)
    expect(staleGeneratedImages(remade)).toEqual([])
    const done = composeImageWorkflowStatus(remade)
    expect(done.stage).toBe('generation-verified')
    expect(done.complete).toBe(true)
  })

  it('lar bildet forsvinne fra sonen gjøre koblingen irrelevant', () => {
    // The other honest way out: the picture is taken out of the zone, so there
    // is no longer anything in the deck for the binding to be wrong about.
    let deck = verified(awaiting(2))
    for (const index of [0, 1]) deck = withFile(deck, index)
    const rewritten = setImageContext(deck, 'Kullstift, ingen farge.')
    if (!rewritten.ok) throw new Error(rewritten.error.message)
    expect(staleGeneratedImages(rewritten.value)).toHaveLength(2)

    const first = resolveImagePlan(deck)[0].plan
    const cleared = setContentKind(rewritten.value, {
      slideId: first.slideId,
      nodeId: first.nodeId,
      kind: 'untitled-card',
    })
    if (!cleared.ok) throw new Error(cleared.error.message)
    // One zone no longer holds a picture, so its binding says nothing — and the
    // plan rewrite is what drops it.
    expect(staleGeneratedImages(cleared.value)).toHaveLength(1)
    expect(planned(cleared.value, []).generatedImages).toHaveLength(1)
  })

  it('lar ikke en fil i sonen gjøre en ny bestilling ferdig', () => {
    // Every planned zone holds a file and nothing waits — but a file in a zone
    // is not provenance, and no checked binding accounts for these.
    let deck = awaiting(3)
    for (const index of [0, 1, 2]) deck = withFile(deck, index)
    const status = composeImageWorkflowStatus(deck)
    expect(status.stage).toBe('plan-outdated')
    expect(status.complete).toBe(false)
    expect(status.awaitingFileCount).toBe(0)
    expect(status.depositedImageCount).toBe(3)
    expect(status.nextAction).toMatch(/ikke bevis for at den ble laget for bestillingen som står nå/i)
  })

  it('når ferdig ved å rydde planen, uten å generere noe på nytt', () => {
    // The whole point of `plan-outdated` being a *step*: there is a way out of
    // it that does not make a single picture again.
    let deck = awaiting(3)
    for (const index of [0, 1, 2]) deck = withFile(deck, index)
    const cleaned = planned(deck, [])
    const status = composeImageWorkflowStatus(cleaned)
    expect(status.stage).toBe('no-planned-images')
    expect(status.complete).toBe(true)
    expect(status.remainingSteps).toEqual([])
  })

  it('går videre til generering for bare de sonene som faktisk venter', () => {
    // Three planned, one already deposited: rewrite the plan with the two that
    // wait, generate those two, and the check agrees about the set.
    const deck = withFile(awaiting(3), 0)
    const waiting = resolveImagePlan(deck).filter((image) => !image.filled)
    expect(waiting).toHaveLength(2)

    const replanned = planned(
      deck,
      waiting.map((image) => image.plan),
    )
    expect(checkImagePlan(replanned)).toEqual([])
    const status = composeImageWorkflowStatus(replanned)
    expect(status.stage).toBe('awaiting-generation')
    expect(status.plannedImageCount).toBe(2)
    expect(status.awaitingFileCount).toBe(2)
    expect(status.nextAction).toContain('2 ganger')

    // And the count the status asks for is exactly the set the check expects.
    const delivered = records(replanned)
    expect(delivered).toHaveLength(status.awaitingFileCount)
    expect(checkGeneratedImages(replanned, delivered)).toEqual([])
    const done = composeImageWorkflowStatus(verified(replanned))
    expect(done.stage).toBe('awaiting-deposit')
    expect(done.complete).toBe(true)
  })
})

describe('planens egne kontroller gjelder foran alle ferdig-grener', () => {
  it('kaller ikke en reservert bildesone uten bildeplan for ferdig', () => {
    // The cheapest mistake available — reserve the zones, never describe them —
    // plans zero pictures. Reported as «nothing to do», it would read as a
    // delivery.
    const leaves = [createLeaf(createImage()), createLeaf(createImage())]
    const base = createPresentation({ title: 'Menneskets evolusjon' })
    const deck: Presentation = {
      ...base,
      slides: [
        sectionAt(base, 0),
        { ...contentAt(base, 1), root: createSplit('x', [1, 1], leaves) },
      ],
    }
    expect(resolveImagePlan(deck)).toHaveLength(0)
    expect(checkImagePlan(deck).map((issue) => issue.code)).toContain('ZONE_NOT_PLANNED')

    const status = composeImageWorkflowStatus(deck)
    expect(status.stage).toBe('plan-needs-repair')
    expect(status.complete).toBe(false)
    expect(status.plannedImageCount).toBe(0)
  })

  it('kaller ikke et dekk med planfeil ferdig selv om hver sone har fil', () => {
    let deck = awaiting(3)
    for (const index of [0, 1, 2]) deck = withFile(deck, index)
    const broken = setImageContext(deck, null)
    if (!broken.ok) throw new Error(broken.error.message)
    expect(checkImagePlan(broken.value).map((issue) => issue.code)).toContain('MISSING_CONTEXT')

    const status = composeImageWorkflowStatus(broken.value)
    expect(status.stage).toBe('plan-needs-repair')
    expect(status.complete).toBe(false)
  })

  it('kaller ikke en kontrollert leveranse ferdig hvis planen er brutt etterpå', () => {
    const deck = verified(awaiting(3))
    const broken = setImageContext(deck, null)
    if (!broken.ok) throw new Error(broken.error.message)
    // The context is part of every order, so the bindings expire with it — and
    // the plan checks would have stopped this anyway. Both, on purpose.
    expect(imageGenerationIsVerified(broken.value)).toBe(false)
    expect(composeImageWorkflowStatus(broken.value).stage).toBe('plan-needs-repair')
  })

  it('sender agenten gjennom reparasjonen, ikke ut av flyten', () => {
    const { deck, zones } = deckOfPictures(2)
    const partial = planned(deck, [entry(zones[0].slideId, zones[0].nodeId, MOTIFS[0])])
    expect(checkImagePlan(partial).length).toBeGreaterThan(0)

    const status = composeImageWorkflowStatus(partial)
    expect(status.stage).toBe('plan-needs-repair')
    expect(status.nextAction).toMatch(/issues/)
    expect(status.nextAction).toMatch(/fortsett deretter i samme samtale/i)
    expect(status.remainingSteps.join(' ')).toMatch(/skriv bildeplanen på nytt/i)
  })
})

describe('erstatninger gjennom den virkelige deponeringen', () => {
  /*
   * The lifecycle this PR describes has to be reachable through the mechanism a
   * person actually uses, not only through `setImageAsset` in a test. It was
   * not: `completeImageDeposit` closes the deposit for good, and
   * `openImageDeposit` refused to reopen one — so a finished deck whose motifs
   * were rewritten asked for new pictures that no deposit would ever take.
   */

  /** Every numbered slot filled in one go, the way the deposit dialog does it. */
  function depositAll(deck: Presentation, prefix: string): Presentation {
    const slots = depositSlots(deck)
    expect(slots.length).toBeGreaterThan(0)
    let current = deck
    const placements = slots.map((slot) => {
      const id = `${prefix}${slot.index}`
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

  it('kan ta imot erstatninger etter at første deponering er fullført', () => {
    let deck = verified(awaiting(2))
    expect(deck.imageDeposit?.status).toBe('pending')

    deck = depositAll(deck, 'first-')
    expect(deck.imageDeposit?.status).toBe('completed')
    expect(composeImageWorkflowStatus(deck).stage).toBe('generation-verified')

    // The order changes, and the same zones are planned again.
    const rewritten = setImageContext(deck, 'Kullstifttegninger, høy kontrast.')
    if (!rewritten.ok) throw new Error(rewritten.error.message)
    deck = planned(rewritten.value, [...(rewritten.value.imagePlan ?? [])])
    expect(composeImageWorkflowStatus(deck).stage).toBe('plan-outdated')
    // A finished deposit that is asked for new pictures opens again — without
    // this the workflow asks for replacements nothing can receive.
    expect(deck.imageDeposit?.status).toBe('pending')
    expect(depositSlots(deck)).toHaveLength(2)

    deck = verified(deck)
    expect(composeImageWorkflowStatus(deck).stage).toBe('awaiting-deposit')

    deck = depositAll(deck, 'second-')
    expect(deck.imageDeposit?.status).toBe('completed')
    const done = composeImageWorkflowStatus(deck)
    expect(done.stage).toBe('generation-verified')
    expect(done.complete).toBe(true)
  })

  it('åpner ikke en fullført deponering på nytt uten grunn', () => {
    // The promise the old rule protected, kept: a finished deck stays finished.
    let deck = depositAll(verified(awaiting(2)), 'first-')
    deck = planned(deck, [...(deck.imagePlan ?? [])])
    expect(deck.imageDeposit?.status).toBe('completed')
    expect(composeImageWorkflowStatus(deck).stage).toBe('generation-verified')
  })

  it('lar en forlatt deponering være forlatt', () => {
    // Somebody said no to the automatic flow, and a rewritten order does not
    // overrule that: the pictures go in by hand.
    const deck = verified(awaiting(2))
    const abandoned: Presentation = {
      ...deck,
      imageDeposit: { status: 'abandoned', expectedCount: 2 },
    }
    const rewritten = setImageContext(abandoned, 'Kullstift, ingen farge.')
    if (!rewritten.ok) throw new Error(rewritten.error.message)
    const replanned = planned(rewritten.value, [...(rewritten.value.imagePlan ?? [])])
    expect(replanned.imageDeposit?.status).toBe('abandoned')
  })
})

describe('det dekket ikke kan vite om en fil', () => {
  /*
   * Stated as a test because it is a limit, not an oversight, and because a
   * reader who finds `generation-verified` on a deck whose picture was swapped
   * by hand should find the reason here rather than conclude the check is
   * broken.
   *
   * Slaids never sees a picture. A recorded content hash is advisory by
   * construction — `assetHash.ts` says so, and deduplication decides on the
   * stored bytes for exactly that reason — so nothing in the document can prove
   * that the file in a zone is the file a binding describes. The one place
   * identity *is* proved is the deposit dialog, which compares the manifest's
   * digest against the bytes it was handed before inserting anything; that is a
   * property of the delivery it performed, not of the document afterwards.
   */
  it('påstår ikke at filen i sonen er den kontrollerte filen', () => {
    let deck = verified(awaiting(2))
    for (const index of [0, 1]) deck = withFile(deck, index, 'unrelated')

    const status = composeImageWorkflowStatus(deck)
    expect(status.stage).toBe('generation-verified')
    // What it says is what it can say: the generation was checked, every zone
    // has a file, and looking at the pictures is still the agent's job.
    expect(status.nextAction).toMatch(/Slaids ser aldri selve bildet/i)
    expect(status.nextAction).toMatch(/se gjennom bildene i tillegg/i)
    expect(status.nextAction).not.toMatch(/lagt inn i dekket/i)
  })
})

describe('et verifisert dekk som åpnes i en ny samtale', () => {
  /*
   * The stored check outlives the conversation that ran it, and the files do
   * not: Slaids keeps the bindings, never the pictures. So a later session can
   * open a verified, undeposited deck with no access to what an earlier chat
   * produced — and a status that said «finished, hand over the files» while
   * forbidding regeneration would leave that session with nothing it could do.
   */
  it('har en gjennomførbar neste handling, og forbyr ikke å lage bildene på nytt', () => {
    const deck = verified(awaiting(3))
    const reopened = validatePresentation(JSON.parse(JSON.stringify(deck)))
    expect(reopened.issues).toEqual([])
    const stored = reopened.value
    if (!stored) throw new Error('Forventet et gyldig dokument')

    const status = composeImageWorkflowStatus(stored)
    expect(status.stage).toBe('awaiting-deposit')
    expect(status.awaitingFileCount).toBe(3)
    // Nothing forbids making them again — `forbiddenClosings` is empty here,
    // and the action says so in words for the session that does not hold them.
    expect(status.forbiddenClosings).toEqual([])
    expect(status.nextAction).toMatch(/er dette en senere samtale og filene ikke er tilgjengelige/i)
    expect(status.nextAction).toMatch(/generere bildene på nytt/i)
    // And it may not be reported as a finished deck while the zones are empty.
    expect(status.nextAction).toMatch(/aldri dekket ferdig til brukeren uten å si at bildene ikke er på plass/i)
  })

  it('kan generere på nytt og bli verifisert igjen mot samme plan', () => {
    // The executable path, executed: the same orders, made again, checked again.
    const deck = verified(awaiting(2))
    const again = verified(deck)
    expect(imageGenerationIsVerified(again)).toBe(true)
    expect(composeImageWorkflowStatus(again).stage).toBe('awaiting-deposit')
  })
})

describe('et dekk uten planlagte bilder', () => {
  it('har ingenting utestående', () => {
    const status = composeImageWorkflowStatus(createPresentation({ title: 'Uten bilder' }))
    expect(status.stage).toBe('no-planned-images')
    expect(status.complete).toBe(true)
    expect(status.plannedImageCount).toBe(0)
    expect(status.forbiddenClosings).toEqual([])
  })

  it('blir ikke ferdig av lagrede koblinger alene', () => {
    // A record set with no plan to check against must never verify itself.
    const deck = createPresentation({ title: 'Uten bilder' })
    expect(imageGenerationIsVerified(deck)).toBe(false)
    expect(imageGenerationIsVerified({ ...deck, generatedImages: [] })).toBe(false)
  })
})
