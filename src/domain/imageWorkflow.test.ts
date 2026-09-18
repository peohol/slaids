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
import {
  composeImageWorkflowStatus,
  imageGenerationCoverage,
  imageGenerationIsReported,
  nextImageJob,
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

/**
 * The same bindings with nothing that reaches a file.
 *
 * Every field in one of these was in the plan before any picture was made — the
 * id, the number, the zone, the file name — so this is exactly what an agent
 * can produce *without calling an image generator at all*. It is the shortcut
 * the coverage rules exist to refuse.
 */
function claims(deck: Presentation): GeneratedImageRecord[] {
  return records(deck).map(({ contentHash: _unproven, ...record }) => record)
}

/**
 * The same bindings from a host that says it cannot reach the bytes.
 *
 * Not proof either — it is a declaration that no proof is coming — and that is
 * what it buys: the entry stops being offered as a job, and the delivery stands
 * as unverified for good.
 */
function declared(deck: Presentation): GeneratedImageRecord[] {
  return claims(deck).map((record) => ({ ...record, bytesUnavailable: true as const }))
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
    expect(status.nextAction).toMatch(
      /generer neste planlagte bilde direkte fra `imageContext` og den aktuelle bildeoppføringen/i,
    )
    expect(status.nextAction).toMatch(/bare den oppføringens ferdige `prompt`/i)
    expect(status.remainingSteps[0]).toMatch(/Hent neste bildejobb/i)
  })

  it('ber ikke agenten skrive ut den samlede briefen i samtalen', () => {
    /*
     * Test 1 of the isolation work, and the root cause it closes. The first
     * step used to be «hent den ferske sluttbriefen, og skriv den ut i
     * samtalen», with «generer de 8 bildene» after it — so before the first
     * generation call the conversation held a message that counted eight
     * pictures and listed every motif. A generator reading that is composing a
     * set, whatever the individual prompts then say.
     *
     * Asserted over a multi-picture deck, because that is the only case where
     * the leak exists.
     */
    const status = composeImageWorkflowStatus(awaiting(8))
    const instructions = [status.nextAction, ...status.remainingSteps].join(' ')
    // Stated as a property rather than as a banned word: the brief may be
    // named, and every sentence that names it has to be denying it.
    const aboutTheBrief = instructions
      .split(/(?<=[.:])\s+/)
      .filter((sentence) => /brief/i.test(sentence))
    expect(aboutTheBrief.length).toBeGreaterThan(0)
    for (const sentence of aboutTheBrief) {
      expect(sentence, `«${sentence}» ber om briefen`).toMatch(/\b(ikke|aldri|uten)\b/i)
    }
    expect(instructions).not.toMatch(/sluttbrief/i)
    // And nothing counts the pictures at the agent either. The deck plans
    // eight; the instruction never says so, and never says how many are left.
    expect(instructions).not.toMatch(/\b8\b/)
    expect(instructions).not.toMatch(/\d+\s+(planlagte\s+)?bilder\b/i)
    expect(instructions).not.toMatch(/bilde \d+ av \d+/i)
    // What it does say is that the conversation stays quiet about the rest.
    expect(instructions).toMatch(
      /Ikke skriv ut samlet brief, andre bildeoppføringer eller en opptelling i samtalen/i,
    )
    expect(instructions).toMatch(/Ikke skriv ut samlet brief eller andre bildeoppføringer i samtalen/i)
    // The plan's own numbers are still there — as fields, which nothing reads
    // aloud.
    expect(status.plannedImageCount).toBe(8)
    expect(status.awaitingFileCount).toBe(8)
  })

  it('forbyr nettopp de avslutningene som beskriver halvferdig arbeid', () => {
    const closings = composeImageWorkflowStatus(awaiting(3)).forbiddenClosings.join(' ')
    expect(closings).toContain('Presentasjonen er opprettet')
    expect(closings).toContain('Bildene er ikke satt inn ennå')
    expect(closings).toContain('Bildeplanen er klar')
    expect(closings).toMatch(/ny brukerbeskjed/i)
    expect(closings).toMatch(/Ikke generer et bilde om igjen fordi bildesonen ennå er tom/i)
  })

  it('skiller agentens arbeid fra dekkets fullføring', () => {
    // What finishing is measured on. One separate file per entry, reported with
    // the `imagePlanItemId` it was made from and its digest, in the format that
    // entry asks for — and the document is complete when the pictures are in
    // it, which is the one thing nobody can assert.
    const criteria = composeImageWorkflowStatus(awaiting(3)).completionCriteria.join(' ')
    expect(criteria).toMatch(/uten å vente på en ny brukerbeskjed, ett av gangen/i)
    expect(criteria).toMatch(/like mange separate bildefiler som planen har oppføringer/i)
    expect(criteria).toMatch(/én fil per `imagePlanItemId`/i)
    expect(criteria).toMatch(/aspect ratio oppføringen den ble generert fra oppgir/i)
    expect(criteria).toMatch(/meldt med den `imagePlanItemId` den ble generert fra/i)
    // The contradiction the review found: the queue lives in the document, so
    // «same conversation» cannot be a completion criterion.
    expect(criteria).not.toMatch(/i samme samtale/i)
    expect(criteria).toMatch(/køen ligger i dokumentet, ikke i samtalen/i)
    // And the trust anchor is named: a binding is a claim until the browser
    // compares it, so `complete` waits for the pictures.
    expect(criteria).toMatch(/Koblingen er en påstand til den er kontrollert mot filene selv/i)
    expect(criteria).toMatch(/`complete` blir først true når bildene faktisk ligger i dekket/i)
    expect(criteria).toMatch(/koblingskontrollen svarer `ok`/i)
    expect(criteria).toMatch(/Å legge bildene inn er derfor brukerens steg, og aldri noe du venter på/i)
    // And printing the brief is not a criterion any more. It was one, which
    // made showing a generator the whole plan a condition of finishing.
    expect(criteria).not.toMatch(/brief/i)
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
    // Not complete: the pictures are not in the deck, and nothing the agent
    // reports can put them there. Its own work is `remainingSteps`.
    expect(status.complete).toBe(false)
    expect(status.awaitingFileCount).toBe(3)
    expect(status.depositedImageCount).toBe(0)
    // The endings that are wrong here are the delivery ones, not the
    // generation ones: «arbeidet er ditt» about inserting pictures is false.
    expect(status.forbiddenClosings.join(' ')).toMatch(
      /Ikke si at bildene er kontrollert eller verifisert/i,
    )
    expect(status.forbiddenClosings.join(' ')).toMatch(/Ikke vent på at brukeren deponerer/i)
    expect(status.nextAction).toMatch(/genereringsarbeidet ditt er gjort/i)
    expect(status.nextAction).toMatch(/brukerens steg/i)
    // And what that is worth is said in the same breath: the digests are
    // compared in the browser, not here.
    expect(status.nextAction).toMatch(/koblingen er din påstand til den er sammenlignet i nettleseren/i)
    // Complete, and not empty-handed: `complete` answers for the document, and
    // what is left for the *agent* depends on something the deck cannot see —
    // whether this conversation still holds the files. Both cases are named
    // with the condition that selects them.
    expect(status.remainingSteps).not.toEqual([])
    expect(status.remainingSteps.join(' ')).toMatch(/har du bildefilene fra genereringen/i)
    expect(status.remainingSteps.join(' ')).toMatch(/har du dem ikke/i)
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
    expect(second.complete).toBe(false)
    // Regeneration is named, but only as the branch for a reader who does not
    // have the files — never as this stage's own demand.
    expect(second.remainingSteps.join(' ')).not.toMatch(/^Generer de \d+ bildene/im)
    expect(second.nextAction).toMatch(/genereringsarbeidet ditt er gjort/i)
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

  it('gjør ikke en lagret kontroll til en leveranse en senere samtale kan gjøre', () => {
    /*
     * The two halves of this feature, read together by the reader they are
     * both about. The bindings are stored on the document; the pictures were
     * made in a host conversation and are not. So a deck reopened later is
     * `awaiting-deposit` with `complete: true` — a true statement about the
     * document — while the reader holding it owes three pictures and has
     * nothing to hand over.
     *
     * Tested apart, each half passed: one asserted that a verified deck stops
     * asking for pictures, the other that its action tells a session without
     * the files to make them again. Together they said «you are done» and
     * «generate them again» in the same answer, and the empty step list
     * decided it. So the steps carry both cases with the condition that
     * selects them, and neither reader is told the other one's answer.
     */
    const reopened = validatePresentation(JSON.parse(JSON.stringify(verified(awaiting(3)))))
    expect(reopened.issues).toEqual([])
    const stored = reopened.value
    if (!stored) throw new Error('Forventet et gyldig dokument')

    const status = composeImageWorkflowStatus(stored)
    expect(status.stage).toBe('awaiting-deposit')
    expect(status.complete).toBe(false)
    // What is left is not nothing, and it is not unconditional either.
    expect(status.remainingSteps).toHaveLength(3)
    const [holding, without] = status.remainingSteps
    expect(holding).toMatch(/har du bildefilene fra genereringen/i)
    expect(holding).toMatch(/lever dem med manifestet/i)
    expect(without).toMatch(/har du dem ikke/i)
    expect(without).toMatch(/ingen leveranse du kan gjøre/i)
    expect(without).toMatch(/generer oppføringene i `images` på nytt, én av gangen/i)
    expect(without).toMatch(/kjør koblingskontrollen igjen/i)
    // The whole plan is what the check expects, and the plan's own field says
    // how big it is — the step does not count the pictures out loud, because
    // regenerating is the same one-at-a-time work as generating.
    expect(without).not.toMatch(/\b3\b/)
    expect(status.plannedImageCount).toBe(3)
    expect(status.nextAction).toMatch(/`remainingSteps` sier hvilket av de to som gjelder her/i)
  })

  it('lagrer ingenting når koblingen motsier planen', () => {
    // A binding that contradicts the plan must not be storable: the document's
    // copy is what later reads trust. One picture *short* is a different thing
    // — that is the loop, and the test below is about it.
    const deck = awaiting(3)
    const wrongZone = records(deck).map((record, index) =>
      index === 0 ? { ...record, nodeId: 'en-annen-sone' } : record,
    )
    const refused = recordGeneratedImages(deck, wrongZone)
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.error.code).toBe('INVALID_ARGUMENT')
    expect(deck.generatedImages).toBeUndefined()
    expect(composeImageWorkflowStatus(deck).stage).toBe('awaiting-generation')
  })

  it('tar imot koblingene én av gangen, uten å glemme de forrige', () => {
    /*
     * The storage half of the sequential flow. A picture is bound the moment it
     * is made, before the next one is generated — so a call that carries one
     * binding has to be accepted and merged, and the deck is what remembers how
     * far the loop has come. Requiring the whole set would mean nothing could
     * be recorded until everything was, and «which entry is next» would have
     * nothing to read.
     */
    let deck: Presentation = awaiting(3)
    const all = records(deck)
    for (const record of all) {
      const written = recordGeneratedImages(deck, [record])
      if (!written.ok) throw new Error(written.error.message)
      deck = written.value
    }
    expect(deck.generatedImages).toHaveLength(3)
    expect(imageGenerationIsReported(deck)).toBe(true)

    // And a partial set is not a finished one: two of three leaves the flow
    // where it was.
    let partial: Presentation = awaiting(3)
    const written = recordGeneratedImages(partial, records(partial).slice(0, 2))
    if (!written.ok) throw new Error(written.error.message)
    partial = written.value
    expect(partial.generatedImages).toHaveLength(2)
    expect(imageGenerationCoverage(partial)).toBe('none')
    expect(composeImageWorkflowStatus(partial).stage).toBe('awaiting-generation')
  })

  it('slutter å gjelde når bestillingen skrives om', () => {
    // An entry's id covers its whole order, so rewriting the shared context
    // gives every entry a new one. The stored bindings then point at pictures
    // the deck no longer orders, and nothing had to remember to clear them.
    const deck = verified(awaiting(3))
    expect(imageGenerationIsReported(deck)).toBe(true)

    const rewritten = setImageContext(deck, 'Kullstifttegninger, høy kontrast, ingen farge.')
    if (!rewritten.ok) throw new Error(rewritten.error.message)
    expect(imageGenerationIsReported(rewritten.value)).toBe(false)
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
    expect(imageGenerationIsReported(same)).toBe(true)

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
    expect(status.complete).toBe(false)
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
    expect(made.complete).toBe(false)
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
    expect(status.nextAction).toMatch(/generer neste planlagte bilde direkte/i)

    // And the count the status asks for is exactly the set the check expects.
    const delivered = records(replanned)
    expect(delivered).toHaveLength(status.awaitingFileCount)
    expect(checkGeneratedImages(replanned, delivered)).toEqual([])
    const done = composeImageWorkflowStatus(verified(replanned))
    expect(done.stage).toBe('awaiting-deposit')
    expect(done.complete).toBe(false)
  })
})

describe('det første steget er det stadiet faktisk krever', () => {
  /*
   * `complete: false` is three different jobs, and the model-facing rule used to
   * read it as one: «generate the pictures». It is also `plan-needs-repair` and
   * both `plan-outdated` variants, where generating first is the mistake — a
   * brief written from an invalid plan, or pictures made for a plan that still
   * has to be rewritten. So the first step of each unfinished stage is asserted
   * to be the work that stage actually needs, and the rule points at this list
   * rather than at the boolean.
   */
  it('reparerer planen før noe genereres', () => {
    let deck = awaiting(3)
    for (const index of [0, 1, 2]) deck = withFile(deck, index)
    const broken = setImageContext(deck, null)
    if (!broken.ok) throw new Error(broken.error.message)

    const status = composeImageWorkflowStatus(broken.value)
    expect(status.stage).toBe('plan-needs-repair')
    expect(status.complete).toBe(false)
    expect(status.remainingSteps[0]).toMatch(/Rett det `issues` peker på/i)
    expect(status.remainingSteps[0]).not.toMatch(/generer/i)
    expect(status.nextAction).toMatch(/Rett først det `issues` peker på/i)
  })

  it('skriver planen om før noe genereres når proveniensen er ukjent', () => {
    const deck = withFile(awaiting(3), 0)
    const status = composeImageWorkflowStatus(deck)
    expect(status.stage).toBe('plan-outdated')
    expect(status.complete).toBe(false)
    expect(status.remainingSteps[0]).toMatch(/Skriv bildeplanen på nytt/i)
    expect(status.remainingSteps[0]).not.toMatch(/generer/i)
  })

  it('går rett på det første bildet når planen faktisk venter på bilder', () => {
    const status = composeImageWorkflowStatus(awaiting(3))
    expect(status.stage).toBe('awaiting-generation')
    expect(status.complete).toBe(false)
    expect(status.remainingSteps[0]).toMatch(/Hent neste bildejobb/i)
    expect(status.remainingSteps[0]).toMatch(/uten de andre oppføringene/i)
    expect(status.remainingSteps[1]).toMatch(/nøyaktig én gang, med bare den `prompt`-teksten/i)
    expect(status.remainingSteps[2]).toMatch(/SHA-256/)
    expect(status.remainingSteps[3]).toMatch(/Hent så neste jobb/i)
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
    expect(imageGenerationIsReported(broken.value)).toBe(false)
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

    /*
     * Only the shared context changes — no re-plan, because the status does not
     * ask for one here: the superseded branch says to generate the entries the
     * plan already holds. That is the sequence an agent following `nextAction`
     * actually produces, and it is the one that used to leave a closed deposit
     * behind. `setImageContext` reconciles for exactly this reason.
     */
    const rewritten = setImageContext(deck, 'Kullstifttegninger, høy kontrast.')
    if (!rewritten.ok) throw new Error(rewritten.error.message)
    deck = rewritten.value
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

  it('ber om hele planen når noen soner venter og andre viser forrige bilde', () => {
    /*
     * The two groups are disjoint slices of one plan, and the check expects one
     * record per *planned* entry — so a status that asked only for the larger
     * slice would walk the agent into `MISSING_ITEM` on the rest. Three
     * entries: one zone never filled, two holding pictures from the previous
     * order.
     */
    let deck = verified(awaiting(3))
    for (const index of [0, 1]) deck = withFile(deck, index)
    const rewritten = setImageContext(deck, 'Kullstifttegninger, høy kontrast.')
    if (!rewritten.ok) throw new Error(rewritten.error.message)
    deck = rewritten.value

    const status = composeImageWorkflowStatus(deck)
    expect(status.stage).toBe('plan-outdated')
    expect(status.awaitingFileCount).toBe(1)
    expect(staleGeneratedImages(deck)).toHaveLength(2)
    // Not max(1, 2): the whole plan, one entry at a time — and «which
    // entries» is «those without a verified binding», which covers both the
    // empty zone and the two holding the previous pictures.
    expect(status.nextAction).toMatch(/Generer oppføringene i planen én av gangen/i)
    expect(status.nextAction).toMatch(/kontrollen venter én fil per planlagt oppføring/i)
    expect(status.remainingSteps.join(' ')).toMatch(/Hent neste bildejobb/i)

    // And the number it asks for is exactly the set the check accepts.
    const delivered = records(deck)
    expect(delivered).toHaveLength(3)
    expect(checkGeneratedImages(deck, delivered)).toEqual([])
    expect(composeImageWorkflowStatus(verified(deck)).stage).toBe('awaiting-deposit')
  })

  it('sier fra når bildene ikke har noe sted å bli levert', () => {
    // A re-split zone re-identifies its order without any plan write, so the
    // deposit from the last round is still closed. The status says what to do
    // about it instead of leaving the user with files and nowhere to put them.
    let deck = depositAll(verified(awaiting(2)), 'first-')
    expect(deck.imageDeposit?.status).toBe('completed')
    const stripped: Presentation = { ...deck, generatedImages: undefined }
    deck = { ...stripped, generatedImages: deck.generatedImages }

    const rewritten = setImageContext(deck, 'Kullstift, ingen farge.')
    if (!rewritten.ok) throw new Error(rewritten.error.message)
    // `setImageContext` reconciles, so this deck *does* reopen — the note is
    // for the paths that do not, and it is absent exactly when the deposit is
    // open.
    expect(rewritten.value.imageDeposit?.status).toBe('pending')
    expect(composeImageWorkflowStatus(rewritten.value).nextAction).not.toMatch(
      /Skriv bildeplanen på nytt før filene leveres/i,
    )

    const closed: Presentation = {
      ...rewritten.value,
      imageDeposit: { status: 'completed', expectedCount: 2 },
    }
    expect(composeImageWorkflowStatus(closed).nextAction).toMatch(
      /Skriv bildeplanen på nytt før filene leveres/i,
    )
  })

  it('åpner ikke en fullført deponering på nytt uten grunn', () => {
    // The promise the old rule protected, kept: a finished deck stays finished.
    let deck = depositAll(verified(awaiting(2)), 'first-')
    deck = planned(deck, [...(deck.imagePlan ?? [])])
    expect(deck.imageDeposit?.status).toBe('completed')
    expect(composeImageWorkflowStatus(deck).stage).toBe('generation-verified')
  })

  it('ber aldri en forlatt deponering om å åpne seg', () => {
    /*
     * `abandoned` never reopens — it is somebody's answer, not a state of the
     * deck. Telling an agent to rewrite the plan «so Slaids opens the deposit»
     * would therefore be an instruction the system refuses to carry out, and an
     * agent that followed it would loop. The way in is the ordinary one.
     */
    const deck = verified(awaiting(2))
    const abandoned: Presentation = {
      ...deck,
      imageDeposit: { status: 'abandoned', expectedCount: 2 },
    }
    const status = composeImageWorkflowStatus(abandoned)
    expect(status.stage).toBe('awaiting-deposit')
    expect(status.complete).toBe(false)
    expect(status.nextAction).toMatch(/Bildedeponeringen er forlatt for dette dekket/i)
    expect(status.nextAction).toMatch(/én sone om gangen/i)
    expect(status.nextAction).not.toMatch(/Skriv bildeplanen på nytt før filene leveres/i)
  })

  it('gir en gjennomførbar vei videre når en forlatt deponering får en ny bestilling', () => {
    let deck = verified(awaiting(2))
    for (const index of [0, 1]) deck = withFile(deck, index)
    deck = { ...deck, imageDeposit: { status: 'abandoned', expectedCount: 2 } }

    const rewritten = setImageContext(deck, 'Kullstift, ingen farge.')
    if (!rewritten.ok) throw new Error(rewritten.error.message)
    expect(rewritten.value.imageDeposit?.status).toBe('abandoned')
    expect(composeImageWorkflowStatus(rewritten.value).stage).toBe('plan-outdated')

    // Generate the replacements, and the action names something that can
    // actually be done rather than a deposit that is designed to stay shut.
    const remade = composeImageWorkflowStatus(verified(rewritten.value))
    expect(remade.stage).toBe('awaiting-deposit')
    expect(remade.complete).toBe(false)
    expect(remade.nextAction).toMatch(/én sone om gangen/i)
    expect(remade.nextAction).not.toMatch(/Skriv bildeplanen på nytt før filene leveres/i)
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

describe('hva statusen sier at det er igjen', () => {
  /*
   * «What is left» is not one sentence, and the standing rule used to make it
   * one: «never report a deck finished without saying the picture zones are
   * empty». That is true of one `awaiting-deposit` deck and false of two other
   * ordinary states — so an agent obeying both the rule and the status would
   * have told the user something untrue about the very distinction this flow
   * made load-bearing.
   */
  it('sier tomme soner når de er tomme', () => {
    const status = composeImageWorkflowStatus(verified(awaiting(3)))
    expect(status.stage).toBe('awaiting-deposit')
    expect(status.nextAction).toMatch(/3 bildesoner står tomme/i)
    expect(status.nextAction).not.toMatch(/viser fortsatt bildet fra den forrige bestillingen/i)
  })

  it('sier forrige bilde når det er det som står der', () => {
    let deck = verified(awaiting(2))
    for (const index of [0, 1]) deck = withFile(deck, index)
    const rewritten = setImageContext(deck, 'Kullstift, ingen farge.')
    if (!rewritten.ok) throw new Error(rewritten.error.message)

    const status = composeImageWorkflowStatus(verified(rewritten.value))
    expect(status.stage).toBe('awaiting-deposit')
    expect(status.nextAction).toMatch(/2 bildesoner viser fortsatt bildet fra den forrige bestillingen/i)
    // And it does not claim they are empty, because they are not.
    expect(status.nextAction).not.toMatch(/bildesoner står tomme/i)
  })

  it('påstår ikke at noe er tomt når alt er på plass', () => {
    let deck = verified(awaiting(2))
    for (const index of [0, 1]) deck = withFile(deck, index)
    const status = composeImageWorkflowStatus(deck)
    expect(status.stage).toBe('generation-verified')
    expect(status.nextAction).not.toMatch(/tom/i)
    expect(status.nextAction).toMatch(/hver bildesone har fått en fil/i)
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
    // Nothing forbids making them again: the delivery closings are about
    // overstating what a report proves, and the action says in words what a
    // session that does not hold the files should do.
    expect(status.forbiddenClosings.join(' ')).toMatch(/så lenge du selv har filen/i)
    expect(status.forbiddenClosings.join(' ')).toMatch(
      /Er filen laget i en tidligere samtale og ikke tilgjengelig for deg, er det motsatte riktig/i,
    )
    expect(status.nextAction).toMatch(/er dette en senere samtale og filene ikke er tilgjengelige/i)
    expect(status.nextAction).toMatch(/generere bildene på nytt/i)
    // And it may not be reported as a finished deck while the zones are empty.
    expect(status.nextAction).toMatch(/aldri dekket ferdig til brukeren uten å si at bildene ikke er på plass/i)
  })

  it('kan generere på nytt og bli verifisert igjen mot samme plan', () => {
    // The executable path, executed: the same orders, made again, checked again.
    const deck = verified(awaiting(2))
    const again = verified(deck)
    expect(imageGenerationIsReported(again)).toBe(true)
    expect(composeImageWorkflowStatus(again).stage).toBe('awaiting-deposit')
  })
})

/*
 * The generation surface, asked the only question that matters about it: what
 * can a reader see at the moment it writes an image call?
 *
 * The prompt being composed per entry was not enough, and that is the finding
 * this answers. Every response that carried the plan carried the *set* — nine
 * motifs, nine finished prompts, a count — so an agent had the whole thing in
 * context before the first call, and «do not repeat it» was left holding a
 * structural problem. A generator that has read a set composes a set.
 */
describe('én jobb om gangen', () => {
  it('gir én jobb, og ingenting om de andre', () => {
    const deck = awaiting(8)
    const next = nextImageJob(deck)
    expect(next.status).toBe('job')
    expect(next.job?.prompt).toContain(MOTIFS[0])

    /*
     * Asserted over the whole answer rather than over the prompt: the leak the
     * finding names is everything a reader can see, not only the text that
     * happens to be sent on. No other motif, no count, nothing from the brief.
     */
    const answer = JSON.stringify(next)
    for (const motif of MOTIFS.slice(1)) expect(answer).not.toContain(motif)
    expect(answer).not.toMatch(/BILDE \d+ AV \d+/)
    expect(answer).not.toMatch(/separate bilder/i)
    expect(answer).not.toMatch(/\b8\b/)
    // No ordinal survives at all: a number is a fact about a set, and the file
    // name is answered by the binding check afterwards instead.
    expect(next.job).not.toHaveProperty('number')
    expect(next.job).not.toHaveProperty('fileName')
    expect(next.job).not.toHaveProperty('slideId')
    expect(answer).not.toMatch(/\bbildeslide-\d/)
  })

  it('gir neste jobb først når den forrige er bundet', () => {
    // The queue is the document: the next job is the first planned entry no
    // stored binding accounts for, so an interrupted conversation picks up
    // where the deck is rather than where a lost counter said.
    let deck: Presentation = awaiting(3)
    const seen: string[] = []
    for (let round = 0; round < 3; round += 1) {
      const next = nextImageJob(deck)
      expect(next.status).toBe('job')
      if (!next.job) throw new Error('Forventet en jobb')
      seen.push(next.job.prompt)
      const record = records(deck).find(
        (candidate) => candidate.imagePlanItemId === next.job?.imagePlanItemId,
      )
      if (!record) throw new Error('Forventet en kobling for jobben')
      const written = recordGeneratedImages(deck, [record])
      if (!written.ok) throw new Error(written.error.message)
      deck = written.value
    }
    expect(seen.map((prompt) => MOTIFS.findIndex((motif) => prompt.includes(motif)))).toEqual([
      0, 1, 2,
    ])

    const done = nextImageJob(deck)
    expect(done.status).toBe('all-generated')
    expect(done.job).toBeNull()
    // The loop ends without anybody having been told how long it was.
    expect(JSON.stringify(done)).not.toMatch(/\b3\b/)
  })


  it('lar den ærlige verten uten tilgang til bytene komme videre', () => {
    /*
     * The dead end the rule above would otherwise create. A host whose image
     * tool gives it no bytes has made the picture and can never hash it, and
     * being offered the same job for ever is not an answer. So it can declare
     * that, per picture: the entry stops being offered, and the delivery is
     * marked for what it is rather than for what it is not.
     *
     * The declaration is not evidence — nothing at this boundary is — it is a
     * statement that no evidence is coming, which the deck then repeats instead
     * of calling the work checked.
     */
    const deck = awaiting(3)
    const written = recordGeneratedImages(deck, declared(deck))
    if (!written.ok) throw new Error(written.error.message)

    const done = nextImageJob(written.value)
    expect(done.status).toBe('all-generated')
    expect(imageGenerationCoverage(written.value)).toBe('claimed')
    const status = composeImageWorkflowStatus(written.value)
    expect(status.stage).toBe('generation-unverified')
    expect(status.complete).toBe(false)

    // One declared, the rest still owed: the queue moves exactly one step.
    const one = awaiting(3)
    const first = recordGeneratedImages(one, declared(one).slice(0, 1))
    if (!first.ok) throw new Error(first.error.message)
    const second = nextImageJob(first.value)
    expect(second.status).toBe('job')
    expect(second.job?.prompt).toContain(MOTIFS[1])
  })

  it('gir ingen jobb fra en plan som ikke beskriver dekket', () => {
    // A picture made from a plan with findings is a picture made for a zone
    // that has moved. The repair comes first, exactly as in the status.
    const deck = awaiting(3)
    const stripped = setImageContext(deck, null)
    if (!stripped.ok) throw new Error(stripped.error.message)
    const next = nextImageJob(stripped.value)
    expect(next.status).toBe('plan-needs-repair')
    expect(next.job).toBeNull()
    expect(next.issues.map((issue) => issue.code)).toContain('MISSING_CONTEXT')
  })

  it('gir ingen jobb for en sone som alt holder en fil ingen kobling forklarer', () => {
    // The two surfaces have to agree about the same deck: the status calls this
    // `plan-outdated` and asks for the plan to be rewritten with the zones that
    // still wait, so handing out a job would put a second picture where one
    // already is.
    const deck = withFile(awaiting(3), 0)
    expect(composeImageWorkflowStatus(deck).stage).toBe('plan-outdated')
    const next = nextImageJob(deck)
    expect(next.status).toBe('plan-needs-repair')
    expect(next.job).toBeNull()
    expect(next.instruction).toMatch(/bare de bildesonene som fortsatt venter/i)
  })

  it('gir jobben når sonen holder bildet fra en bestilling som er skrevet om', () => {
    // The opposite case, and it needs the opposite answer: the deck knows that
    // picture was made for an order it has since rewritten, so the replacement
    // is exactly what is owed.
    let deck = verified(awaiting(3))
    for (const index of [0, 1, 2]) deck = withFile(deck, index)
    const rewritten = setImageContext(deck, 'Kullstifttegninger, høy kontrast.')
    if (!rewritten.ok) throw new Error(rewritten.error.message)

    expect(composeImageWorkflowStatus(rewritten.value).stage).toBe('plan-outdated')
    const next = nextImageJob(rewritten.value)
    expect(next.status).toBe('job')
    expect(next.job?.prompt).toContain(MOTIFS[0])
  })

  it('lar ikke en kobling uten avtrykk spise opp jobben', () => {
    /*
     * The shortcut this closes, walked end to end: fetch a job, send its own id
     * straight back without a digest, fetch the next. Every field in that
     * binding was in the plan before any picture existed, so nothing in it is
     * evidence — and a queue that counted it as done could be emptied without
     * calling an image generator once, ending on the strongest word the flow
     * has: `all-generated`.
     *
     * Only a binding that carries a digest takes an entry out of the queue. The
     * claim is not thrown away — a host that cannot reach its own bytes has
     * made the pictures and must not be sent back to make them again — it just
     * never becomes «generated».
     */
    const start = awaiting(3)
    const first = nextImageJob(start)
    if (!first.job) throw new Error('Forventet en jobb')

    // Report that one job back without a digest — the whole shortcut in one
    // call — and the queue is exactly where it was.
    const claim = claims(start).find(
      (record) => record.imagePlanItemId === first.job?.imagePlanItemId,
    )
    if (!claim) throw new Error('Forventet en kobling for jobben')
    const claimed = recordGeneratedImages(start, [claim])
    if (!claimed.ok) throw new Error(claimed.error.message)
    expect(nextImageJob(claimed.value).job?.imagePlanItemId).toBe(first.job.imagePlanItemId)

    // The same for the rest: every entry claimed, and the loop has not ended.
    const written = recordGeneratedImages(start, claims(start))
    if (!written.ok) throw new Error(written.error.message)
    const deck: Presentation = written.value
    expect(deck.generatedImages).toHaveLength(3)
    const after = nextImageJob(deck)
    expect(after.status).toBe('unverified-claim')
    expect(after.status).not.toBe('all-generated')
    expect(after.job?.prompt).toContain(MOTIFS[0])
    // The three cases only the reader can tell apart, named rather than guessed.
    expect(after.instruction).toMatch(/laget du bildet og kan lese bytene/i)
    expect(after.instruction).toMatch(/får ikke tilgang til bytene/i)
    expect(after.instruction).toMatch(/Er bildet ikke laget/i)

    // A digest on one entry moves exactly that one out of the queue.
    const proven = recordGeneratedImages(deck, records(deck).slice(0, 1))
    if (!proven.ok) throw new Error(proven.error.message)
    const second = nextImageJob(proven.value)
    expect(second.status).toBe('unverified-claim')
    expect(second.job?.prompt).toContain(MOTIFS[1])

    // And the loop ends only when every entry carries one.
    const all = recordGeneratedImages(proven.value, records(proven.value))
    if (!all.ok) throw new Error(all.error.message)
    const done = nextImageJob(all.value)
    expect(done.status).toBe('all-generated')
    expect(done.instruction).toMatch(/kobling med avtrykk/i)
  })

  it('gir ingen jobb til et dekk som ikke planlegger bilder', () => {
    const next = nextImageJob(createPresentation({ title: 'Uten bilder' }))
    expect(next.status).toBe('no-plan')
    expect(next.job).toBeNull()
  })
})

/*
 * The other half of the same finding: the prompt is composed from texts a
 * person wrote, and those texts can say «samme utsnitt som forrige bilde» on
 * their own. Then the isolation is prose again — the agent is told not to write
 * such things, and the order it sends says one anyway.
 */
describe('en enkeltprompt som viser til de andre bildene', () => {
  it('stopper på den felles bildekonteksten', () => {
    const deck = awaiting(3)
    const leaky = setImageContext(
      deck,
      'Alle bildene skal ha samme stil: fotorealistisk, naturlig dagslys, dempet palett.',
    )
    if (!leaky.ok) throw new Error(leaky.error.message)

    const issues = checkImagePlan(leaky.value)
    expect(issues.map((issue) => issue.code)).toContain('CROSS_IMAGE_REFERENCE')
    expect(issues.find((issue) => issue.code === 'CROSS_IMAGE_REFERENCE')?.message).toMatch(
      /alle bildene/i,
    )
    // And nothing is handed out while it says that.
    const next = nextImageJob(leaky.value)
    expect(next.status).toBe('plan-needs-repair')
    expect(next.job).toBeNull()
  })

  it('stopper på et motiv som beskriver seg i forhold til de andre', () => {
    const { deck, zones } = deckOfPictures(3)
    const leaky = planned(deck, [
      entry(zones[0].slideId, zones[0].nodeId, MOTIFS[0]),
      {
        ...entry(zones[1].slideId, zones[1].nodeId, MOTIFS[1]),
        composition: 'Samme utsnitt som forrige bilde, men sett fra siden.',
      },
      entry(zones[2].slideId, zones[2].nodeId, MOTIFS[2]),
    ])
    const found = checkImagePlan(leaky).filter(
      (issue) => issue.code === 'CROSS_IMAGE_REFERENCE',
    )
    expect(found).toHaveLength(1)
    expect(found[0].number).toBe(2)
    expect(nextImageJob(leaky).status).toBe('plan-needs-repair')
  })

  it('lar et helt vanlig motiv stå i fred', () => {
    // The check has to be narrow enough to read: a plural style note names no
    // other picture, and flagging it would make the rule something authors
    // route around.
    const deck = awaiting(3)
    const ordinary = setImageContext(
      deck,
      'Fotorealistiske rekonstruksjoner, naturlig dagslys, ingen tekst i bildene.',
    )
    if (!ordinary.ok) throw new Error(ordinary.error.message)
    expect(
      checkImagePlan(ordinary.value).filter((issue) => issue.code === 'CROSS_IMAGE_REFERENCE'),
    ).toEqual([])
    expect(nextImageJob(ordinary.value).status).toBe('job')
  })
})

/*
 * The shortcut the coverage rules close.
 *
 * Everything in a binding but the digest was in the plan before any picture was
 * made: the id, the number, the zone, the file name. So an agent can produce a
 * complete, self-consistent set of bindings *without calling an image generator
 * at all* — and that used to answer `ok`, store, and read back as
 * `complete: true`.
 */
describe('en kobling uten avtrykk er ikke et bevis', () => {
  it('blir ikke verifisert av metadata som kan skrives av bildeplanen', () => {
    const deck = awaiting(3)
    const written = recordGeneratedImages(deck, claims(deck))
    if (!written.ok) throw new Error(written.error.message)

    // Stored — a host that cannot read its own bytes must not be asked to
    // generate everything again on the next read — and not proof.
    expect(written.value.generatedImages).toHaveLength(3)
    expect(imageGenerationCoverage(written.value)).toBe('claimed')
    // Reported — every entry is spoken for — and that is all it is.
    expect(imageGenerationIsReported(written.value)).toBe(true)

    const status = composeImageWorkflowStatus(written.value)
    expect(status.stage).toBe('generation-unverified')
    expect(status.complete).toBe(false)
    expect(status.nextAction).toMatch(/Uten avtrykket kan deponeringen aldri sammenligne filene/i)
    expect(status.nextAction).toMatch(/skrevet av bildeplanen/i)
    expect(status.nextAction).toMatch(/Ikke omtal dette som kontrollert/i)
    expect(status.forbiddenClosings.join(' ')).toMatch(
      /Ikke si at bildene er kontrollert eller verifisert/i,
    )
  })

  it('peker på avtrykket som veien ut, ikke på å lage bildene om igjen', () => {
    // The missing thing is the digest, not the picture. A stage that sent the
    // agent back to the generator would be the duplicate generation the rest
    // of this module exists to prevent.
    const deck = awaiting(3)
    const written = recordGeneratedImages(deck, claims(deck))
    if (!written.ok) throw new Error(written.error.message)
    const steps = composeImageWorkflowStatus(written.value).remainingSteps.join(' ')
    expect(steps).toMatch(/regn ut SHA-256/i)
    expect(steps).toMatch(/krever ingen nye bilder/i)
    expect(steps).toMatch(/uverifisert/i)
    expect(steps).toMatch(/ikke generer bildene om igjen/i)
  })

  it('blir verifisert når avtrykkene kommer, uten at noe bilde lages om', () => {
    // The way out, executed: the same entries, the same files, the digests
    // added. One call upgrades the bindings rather than adding a second set.
    const deck = awaiting(3)
    const claimed = recordGeneratedImages(deck, claims(deck))
    if (!claimed.ok) throw new Error(claimed.error.message)
    const proven = recordGeneratedImages(claimed.value, records(claimed.value))
    if (!proven.ok) throw new Error(proven.error.message)

    expect(proven.value.generatedImages).toHaveLength(3)
    expect(imageGenerationCoverage(proven.value)).toBe('checkable')
    const status = composeImageWorkflowStatus(proven.value)
    expect(status.stage).toBe('awaiting-deposit')
    // Still not complete: a digest the agent supplied is a claim, and the deck
    // is finished when the pictures are in it.
    expect(status.complete).toBe(false)
  })

  it('kan ikke nå `complete` på noe agenten skriver selv', () => {
    /*
     * The finding this closes, stated as the property that answers it: every
     * field in a binding is a string the caller supplied — the digest included,
     * since Slaids has no file to compare it against — so a syntactically
     * perfect delivery must not be able to reach a finished document. The one
     * thing that cannot be asserted is a picture in a zone, and that is what
     * `complete` now waits for.
     */
    const deck = awaiting(3)
    const fabricated = records(deck).map((record) => ({ ...record, contentHash: '0'.repeat(64) }))
    const written = recordGeneratedImages(deck, fabricated)
    if (!written.ok) throw new Error(written.error.message)

    expect(imageGenerationCoverage(written.value)).toBe('checkable')
    const claimed = composeImageWorkflowStatus(written.value)
    expect(claimed.stage).toBe('awaiting-deposit')
    expect(claimed.complete).toBe(false)

    // The deposit is the trust anchor: the pictures arrive, and only then does
    // the deck say it is finished.
    let deposited: Presentation = written.value
    for (const index of [0, 1, 2]) deposited = withFile(deposited, index)
    const done = composeImageWorkflowStatus(deposited)
    expect(done.stage).toBe('generation-verified')
    expect(done.complete).toBe(true)
  })

  it('krever avtrykket i fullføringskriteriene, ikke bare i prosaen', () => {
    const criteria = composeImageWorkflowStatus(awaiting(3)).completionCriteria.join(' ')
    expect(criteria).toMatch(/avtrykket \(SHA-256\)/i)
    expect(criteria).toMatch(/check: "file-checked"/i)
    expect(criteria).toMatch(/Slaids ser aldri bytene dine/i)
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
    expect(imageGenerationIsReported(deck)).toBe(false)
    expect(imageGenerationIsReported({ ...deck, generatedImages: [] })).toBe(false)
  })
})
