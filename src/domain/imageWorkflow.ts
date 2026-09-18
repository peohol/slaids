/**
 * Where the deck's raster flow stands, and therefore whether it is finished.
 *
 * `imagePlan.ts` says what to make. `imageGeneration.ts` says whether a file is
 * the file that was made for a planned picture. `imageDeposit.ts` takes the
 * finished files back. This module answers the one question that spans all
 * three and that none of them can answer alone: **is there anything left to
 * do?**
 *
 * It exists because of a failure every prose rule in the flow already forbade
 * and that happened anyway: the plan was written, the answer came back full of
 * instructions about generating the pictures, and the agent stopped there and
 * told the user the presentation was ready. Nothing in that answer *said* the
 * work was unfinished — an empty `issues` list reads as a finishing line, and a
 * paragraph of instructions is something an agent has read rather than
 * something it is visibly in the middle of. A further rule would not have
 * helped; the rules were there. What was missing was a fact.
 *
 * ## What the deck can see, and what it cannot
 *
 * The one thing this must not do is answer that question with the wrong fact.
 * **Slaids never sees a generated file.** The pictures are made in the host
 * client, and without a file bridge they reach the deck through the *user's*
 * deposit in a browser. So «this zone holds a file» is a fact about the
 * deposit, not about generation — and an earlier version of this used it as
 * both, which made the finishing line unreachable in exactly the flow it was
 * written for: every picture generated and verified, every zone still empty,
 * and a status telling the agent to generate them all again.
 *
 * So generation is answered by the only thing that can answer it — the bindings
 * the generating agent wrote down, checked against the plan by
 * `checkGeneratedImages`. Those bindings are *stored on the document*
 * (`Presentation.generatedImages`), and that is what makes this a stable truth
 * rather than one call's opinion: a status that only `verify_image_handoff`
 * could report would flip back to «generate eight pictures» on the very next
 * read of an unchanged deck.
 *
 * The stored bindings also expire by themselves, which is the property that
 * makes them safe. An entry's `imagePlanItemId` is derived from the whole order
 * — zone, number, motif, shared context, measured shape — so rewriting any of
 * that gives the entry a new id and the old records stop matching. A picture
 * made for an order the deck no longer has cannot report itself as done.
 */

import {
  checkGeneratedImages,
  imageBindingCheck,
  plannedGeneratedImages,
  staleGeneratedImages,
} from './imageGeneration'
import {
  checkImagePlan,
  composeImageGenerationPrompt,
  crossImageReferences,
  imageZoneKey,
  resolveImagePlan,
  type ImagePlanIssue,
} from './imagePlan'
import type { Presentation } from './types'

/**
 * The raster flow's position, in the deck's own terms.
 *
 * Two are finished outright: `no-planned-images` because there is nothing to
 * make, and `generation-verified` because everything planned was made *and* is
 * in the deck. `awaiting-deposit` is the one that is finished *conditionally* —
 * everything planned was made, and whether anything is left for the agent
 * depends on something the deck cannot see: whether this conversation still
 * holds the files. The others are stages an agent must never end a turn in.
 *
 * `generation-unverified` is the one that is about *evidence* rather than about
 * work. Every planned entry has a binding and not one of them carries a digest
 * of the bytes a generation response returned — which is a delivery nobody can
 * tell apart from ids, numbers and file names copied straight out of the plan.
 * An agent holds all of those before it generates anything, so a state that
 * called this finished would let the whole flow be satisfied without one image
 * call. It is therefore never `complete`, and the way out is the digest rather
 * than another picture.
 */
export type ImageWorkflowStage =
  | 'no-planned-images'
  | 'plan-needs-repair'
  | 'awaiting-generation'
  | 'generation-unverified'
  | 'generation-verified'
  | 'awaiting-deposit'
  | 'plan-outdated'

/** How far the deck's raster flow has got, derived rather than remembered. */
export interface ImageWorkflowStatus {
  stage: ImageWorkflowStage
  /**
   * Whether the plan the deck carries now is covered by a current, verified
   * generation.
   *
   * A statement about the *document*, and only that. False means the task is
   * not finished, no matter how complete the slides look — see
   * `completionCriteria` — and it is never a statement about the deposit: the
   * files reaching Slaids is the user's step, and waiting for it is never the
   * agent's work.
   *
   * True is not by itself a licence to stop, and that asymmetry is the point.
   * The bindings are stored on the document and the pictures are not, so a
   * verified deck says the files were made *once*, by whoever held that
   * conversation. A later session can open the same deck, read the same true
   * fact, and have no access to a single one of those files — and it owes the
   * pictures again. What is left for the agent is therefore `remainingSteps`,
   * which is empty only when nothing is owed by anybody.
   */
  complete: boolean
  plannedImageCount: number
  /**
   * Planned entries whose zone holds a file.
   *
   * A fact about the deposit. It says Slaids *has* a file for that zone — never
   * that the file was generated for the order the entry carries now.
   */
  depositedImageCount: number
  /**
   * Planned entries whose zone is still empty.
   *
   * What Slaids is missing, which is not the same as what is left to generate:
   * a picture can be made, bound and verified while its zone waits for the user
   * to deposit the file.
   *
   * In `awaiting-generation` it is also the number of generation calls owed,
   * and that is true by construction rather than by coincidence: a plan with
   * any entry already filled is `plan-outdated` instead, so the two can never
   * be different numbers in the stage that asks for pictures. That mattered —
   * `checkGeneratedImages` expects one record per *planned* entry, so a status
   * that asked for two pictures out of a three-entry plan sent the agent
   * straight into `MISSING_ITEM`.
   */
  awaitingFileCount: number
  /** What happens next, named as an action rather than as a state. */
  nextAction: string
  /**
   * What the agent still owes, in order. Empty means nothing is left for it.
   *
   * This is the field a stop decides on, because it is the only one that can
   * carry a condition. In `awaiting-deposit` the deck cannot know which of two
   * situations the reader is in — holding the files it generated, or opening a
   * verified deck in a later conversation without them — so both steps are
   * named, each with the condition that selects it. An empty list there would
   * have said «nothing to do» to the half of the readers who owe eight
   * pictures.
   *
   * Which is why the stop is «you did the step that applies to you», never «the
   * list went empty». In `awaiting-deposit` it does not go empty from anything
   * the agent does: handing the files over is not a change to the document, and
   * the deck only moves on when the *user* deposits them. A rule that waited for
   * the list to empty would be a rule to wait for a browser action the agent
   * cannot perform — the failure this whole status exists to prevent, arrived at
   * from the other side.
   */
  remainingSteps: readonly string[]
  /** Everything that has to be true before the task may be called finished. */
  completionCriteria: readonly string[]
  /** Endings that are wrong while `complete` is false. Empty when it is true. */
  forbiddenClosings: readonly string[]
}

/*
 * What no stage here asserts, stated once so nothing downstream reads more into
 * one than it says.
 *
 * **Slaids never sees a picture.** It knows which orders were placed, which
 * bindings a generating agent wrote down and checked, and whether a zone holds
 * *a* file. It cannot know that the file in a zone is the file a binding
 * describes: the reference lives in the document and the bytes live in the
 * store, and `assetHash.ts` is explicit that a recorded content hash is
 * advisory and never load-bearing — which is why deduplication decides on the
 * stored bytes rather than on the hash.
 *
 * So `generation-verified` means the generation was checked and nothing the
 * deck can see is outstanding. It does not mean each zone holds its own
 * verified file, and it never could: a picture swapped by hand afterwards is
 * indistinguishable from the one that was deposited. The one place identity is
 * genuinely proved is the deposit dialog, which compares the manifest's digest
 * against the bytes of the file it was handed before inserting anything — and
 * that proof is about the delivery it performed, not a property the document
 * carries afterwards.
 *
 * This matters for what an agent is told: «looked at the pictures» is always
 * still the agent's job, and every terminal stage says so.
 */

/**
 * What finishing means for a deck that plans pictures.
 *
 * Exported because the same lines are the agent's standing instruction and this
 * deck's own status, and two copies of a definition of done is how a delivery
 * comes to satisfy one of them.
 *
 * The last two are the ones that cost something to get right: the proof that
 * the pictures exist is the binding check, and the deposit is explicitly *not*
 * part of it. Without that, «all pictures generated» has no observable form,
 * and an agent either stops too early or waits for a browser action it cannot
 * perform.
 *
 * What is deliberately *not* a criterion is the composed brief. It was one —
 * «den ferske sluttbriefen er skrevet ut i samtalen» — and that made printing
 * the whole picture plan a condition of finishing, which is the same as making
 * it mandatory to show a generator that the task is nine pictures. Finishing is
 * measured on the files and their bindings instead: one file per entry, in the
 * format that entry asks for, bound to the entry it was made from.
 */
export const IMAGE_WORKFLOW_COMPLETION_CRITERIA: readonly string[] = [
  'Presentasjonen er opprettet eller oppdatert.',
  'Slidestruktur og innhold er på plass.',
  'Bildeplanen er skrevet, og kontrollene i `issues` er tomme.',
  'Alle planlagte bilder er generert i samme samtale, ett av gangen: like mange separate bildefiler som planen har oppføringer, én fil per `imagePlanItemId`.',
  'Hver fil har det aspect ratio oppføringen den ble generert fra oppgir.',
  'Hver fil er knyttet til den `imagePlanItemId` den ble generert fra, med avtrykket (SHA-256) av bytene bildegenereringen returnerte, og koblingskontrollen svarer `ok` med `check: "file-checked"` for alle planlagte oppføringer. Det er den kontrollen som avgjør at bildegenereringen er ferdig, og svaret blir stående på dekket. En kobling uten avtrykk teller ikke: id, nummer, sone og filnavn står alle i bildeplanen fra før, så de kan skrives av uten at noe bilde er laget.',
  'Å legge bildene inn i Slaids kreves ikke for at genereringsoppgaven er ferdig: uten en filbro tilbake til Slaids er deponeringen brukerens steg i nettleseren. Fylte bildesoner er derfor aldri stoppkriteriet.',
]

/**
 * The endings that were the failure, said as the failure rather than as style
 * advice.
 *
 * Each of the first three is a true sentence about a deck whose pictures have
 * not been made, which is exactly why it was reached for: an agent describing
 * what it has done is not obviously stopping early. The last two close the ways
 * out that remain — asking the user to say «go», and mistaking an empty zone
 * for a missing picture and generating it a second time.
 */
export const IMAGE_WORKFLOW_FORBIDDEN_CLOSINGS: readonly string[] = [
  'Ikke avslutt med «Presentasjonen er opprettet» når bildene fortsatt skal genereres i denne samtalen.',
  'Ikke avslutt med «Bildene er ikke satt inn ennå». Det er en beskrivelse av arbeid som gjenstår, og arbeidet er ditt.',
  'Ikke avslutt med «Bildeplanen er klar». Planen er et mellomsteg; neste steg er bildegenereringen.',
  'Ikke be om en ny brukerbeskjed for å starte bildegenereringen. Eneste gyldige stopp er at brukeren uttrykkelig har bedt om å stoppe før bildene genereres, eller en konkret teknisk blokkering du navngir.',
  'Ikke omtal en leveranse uten avtrykk som kontrollert eller verifisert, og ikke meld genereringen ferdig på den. Uten `contentHash` er koblingen bare metadata om et filnavn – og id, nummer, sone og filnavn kan alle skrives av bildeplanen uten at noe bilde er laget. Si at leveransen er uverifisert, eller regn ut avtrykkene og kjør kontrollen på nytt.',
  'Ikke generer et bilde om igjen fordi bildesonen ennå er tom i Slaids, så lenge du selv har filen: er koblingen alt kontrollert, er bildet laget, og det som gjenstår er deponeringen. Er bildet laget i en tidligere samtale og filen ikke er tilgjengelig for deg, er det motsatte riktig – si det, og lag bildet på nytt for den samme oppføringen.',
]

/**
 * The generation half of what is left: one picture, then the same again.
 *
 * Deliberately without a count, and deliberately without the brief. The first
 * step used to be «hent den ferske sluttbriefen, og skriv den ut i samtalen»,
 * followed by «generer de 9 bildene» — two sentences that between them put the
 * whole picture plan into the conversation before the first call, which is how
 * a generator comes to be working on a set. There is nothing here to print and
 * nothing to add up: each round names the one entry that is next, and the deck
 * still carries the numbers as `plannedImageCount` for the reader that needs
 * them.
 *
 * The wording is «ennå ikke har en kontrollert kobling» rather than «tom sone»
 * because both stages that reach these steps have to be covered by it: a zone
 * that never got a file, and a zone still holding the picture from an order
 * that has since been rewritten. The binding check expects one record per
 * planned entry in either case.
 */
const GENERATION_STEPS: readonly string[] = [
  'Hent neste bildejobb fra Slaids. Svaret er én jobb: én ferdig `prompt` og koblingsdataene for akkurat den oppføringen, uten de andre oppføringene, uten samlet brief og uten noe antall.',
  'Kall bildegeneratoren nøyaktig én gang, med bare den `prompt`-teksten.',
  'Regn ut SHA-256 av bytene som kom tilbake, med en gang, og kjør koblingskontrollen for denne ene oppføringen med avtrykket. Uten avtrykk er koblingen bare metadata om et filnavn, og genereringen blir aldri verifisert.',
  'Hent så neste jobb, og gjenta. Slaids gir ingen jobb når alle oppføringene har sin egen kontrollerte kobling – det er slutten på løkken, ikke et tall du trenger å holde styr på. Ikke skriv ut samlet brief, andre bildeoppføringer eller en opptelling i samtalen; se `generation.isolation`.',
  'Når siste jobb er kontrollert, svarer kontrollen `ok` med `check: "file-checked"` og manifestet følger med. Da er genereringsoppgaven ferdig: lever bildene med manifestet, og å legge dem inn i Slaids er brukerens steg med mindre klienten har en filbro.',
]

/**
 * What is left once the pictures have been made and checked, which is a
 * question the deck cannot finish answering.
 *
 * The check is stored on the document; the files are not. So a verified deck
 * with empty zones means one of two things, and they need opposite work: the
 * conversation that made the pictures still holds them and has only to hand
 * them over, or a later one opened the deck, reads the same verification, and
 * has nothing to hand over at all. Slaids cannot tell those apart — the host's
 * file state is not a property of the document — so both are named with the
 * condition that selects them, rather than one being guessed at.
 *
 * Saying neither was the failure this replaces: an empty step list in a stage
 * whose own action says «generate them again» told the second reader that its
 * work was done.
 *
 * The regeneration branch names no count either, for the same reason the
 * generation steps do not: it is the same one-entry-at-a-time work, and a
 * number in it is a number to repeat to a generator.
 */
/**
 * What is left when every picture is claimed and none of it can be checked.
 *
 * Two branches again, and for the same reason `DEPOSIT_STEPS` has two: the
 * condition that selects one is something only the reader can see — whether it
 * can reach the bytes of what its image tool produced. What is *not* a branch
 * is generating the pictures again: the missing thing is the digest, not the
 * picture, and an agent that re-generated to satisfy a check would be doing the
 * duplicate work the rest of this module exists to prevent.
 */
const UNVERIFIED_STEPS: readonly string[] = [
  'Har du bytene til bildefilene: regn ut SHA-256 av hver av dem og kjør koblingskontrollen på nytt med avtrykkene. Det er den ene veien til en verifisert generering, og den krever ingen nye bilder.',
  'Har du dem ikke – vertsklienten gir deg ikke tilgang til bytene fra sitt eget bildeverktøy – si uttrykkelig til brukeren at leveransen er uverifisert: metadataene kan stemme samtidig som filene er forvekslet. Lever filene med manifestet, og si at bildene må ses gjennom manuelt.',
  'Uansett hvilken av de to: ikke omtal leveransen som kontrollert, og ikke generer bildene om igjen for å få en kontroll – det som mangler er avtrykket, ikke bildet.',
]

const DEPOSIT_STEPS: readonly string[] = [
  'Har du bildefilene fra genereringen: lever dem med manifestet, og si hva brukeren skal gjøre for å legge dem inn.',
  'Har du dem ikke – kontrollen er lagret på dekket, men filene fulgte ikke med inn i denne samtalen – er den lagrede kontrollen ingen leveranse du kan gjøre: si det, og generer oppføringene i `images` på nytt, én av gangen og hver for seg, mot `generation.perImageSteps`. Kjør koblingskontrollen igjen etterpå.',
  'Uansett hvilken av de to: si hva som gjenstår og hvem som gjør det, i stedet for å melde presentasjonen ferdig.',
]

/**
 * The one sentence a deck needs when it is waiting for pictures the deposit is
 * not open for.
 *
 * Writing the image plan is what reconciles a deck — `syncImagePlaceholders`
 * stamps the numbers and reopens the deposit — and `setImagePlan` and
 * `setImageContext` both run it. Everything else that can re-identify an order
 * does not: a moved slide changes an entry's number, a re-split zone changes
 * its measured shape, and either leaves a deck that needs pictures with a
 * deposit that closed after the last round.
 *
 * Rather than have every structural command remember to reconcile — the rule
 * `syncImagePlaceholders` exists to avoid — the status says it where it
 * matters. Empty the rest of the time, so it never appears on a deck that has
 * nothing to receive.
 */
function depositNote(presentation: Presentation): string {
  const status = presentation.imageDeposit?.status
  if (status === 'pending') return ''
  /* Abandoned is somebody's answer, not a state of the deck, so it never
     reopens — and telling an agent to rewrite the plan until it does would be
     an instruction the system refuses to carry out. The way in is the ordinary
     one, a zone at a time. */
  if (status === 'abandoned') {
    return ' Bildedeponeringen er forlatt for dette dekket og åpner ikke igjen, uansett hvor mange ganger bildeplanen skrives. Bildene settes inn én sone om gangen i stedet – si det til brukeren i stedet for å vise til deponeringen.'
  }
  return ' Skriv bildeplanen på nytt før filene leveres, slik at Slaids åpner bildedeponeringen for dem – uten den har brukeren ingen steg å legge dem inn i.'
}

/**
 * How far the deck's stored bindings account for the plan it carries now.
 *
 *  - `none` — the plan is not covered: entries are missing a binding, or the
 *    bindings contradict the plan.
 *  - `unverified` — every entry has a binding, and at least one carries no
 *    digest of the bytes its generation response returned. Consistent metadata
 *    about files nobody can point at.
 *  - `verified` — every entry has a binding and every binding carries its
 *    digest.
 *
 * The records are kept only while they resolve (see `setImagePlan`), and the
 * check is asked against the *current* plan every time rather than trusted as a
 * flag — so a rewritten motif or shared context invalidates the answer without
 * anything having to remember to clear it.
 *
 * The digest is what makes this a fact about *files* rather than a claim. Every
 * other field in a binding — the id, the number, the zone, the file name — is
 * something the plan already told the agent, so a set of bindings without
 * digests is exactly as cheap to produce by copying the plan as by generating
 * the pictures. That is not a hypothetical shortcut: it is the cheapest path
 * through this flow, and it used to end in `complete: true`.
 */
export type ImageGenerationCoverage = 'none' | 'unverified' | 'verified'

export function imageGenerationCoverage(presentation: Presentation): ImageGenerationCoverage {
  /*
   * Only the records that answer for the plan the deck holds now. A record left
   * over from a rewritten order is not a flaw in this delivery — it is its own
   * finding (`staleGeneratedImages`, reported as `plan-outdated`), and folding
   * it in here would let one stale picture elsewhere in the deck make a
   * correctly delivered plan look unverified.
   */
  const records = plannedGeneratedImages(presentation)
  if (records.length === 0) return 'none'
  if (checkGeneratedImages(presentation, records).length > 0) return 'none'
  return imageBindingCheck(records) === 'file-checked' ? 'verified' : 'unverified'
}

/**
 * Whether the plan is covered by bindings that reach the files themselves.
 *
 * The one question a finished generation turns on, and it is deliberately
 * stricter than «the bindings add up»: see `imageGenerationCoverage`.
 */
export function imageGenerationIsVerified(presentation: Presentation): boolean {
  return imageGenerationCoverage(presentation) === 'verified'
}

/**
 * The deck's raster flow, as a state rather than as a recollection.
 *
 * Total: every deck has one, including a deck that plans no pictures, because
 * «nothing to do here» is an answer an agent needs as much as a count of four.
 *
 * The order of the branches is the design. The plan's own checks come first, so
 * a deck with picture zones waiting and no plan at all — which plans zero
 * pictures — cannot report the cheapest mistake available as a delivery. The
 * bindings come before the deposit, because they are the only thing that speaks
 * to generation. And a plan with files already in some of its zones is neither:
 * it is a plan that no longer describes what it claims to, and the way out is
 * to rewrite it, not to generate against a set two of Slaids' own answers
 * disagree about.
 */
export function composeImageWorkflowStatus(presentation: Presentation): ImageWorkflowStatus {
  const images = resolveImagePlan(presentation)
  const deposited = images.filter((image) => image.filled).length
  const counts = {
    plannedImageCount: images.length,
    depositedImageCount: deposited,
    awaitingFileCount: images.length - deposited,
  }
  const status = (
    stage: ImageWorkflowStage,
    complete: boolean,
    nextAction: string,
    remainingSteps: readonly string[] = [],
  ): ImageWorkflowStatus => ({
    stage,
    complete,
    ...counts,
    nextAction,
    remainingSteps,
    completionCriteria: IMAGE_WORKFLOW_COMPLETION_CRITERIA,
    forbiddenClosings: complete ? [] : IMAGE_WORKFLOW_FORBIDDEN_CLOSINGS,
  })

  if (checkImagePlan(presentation).length > 0) {
    return status(
      'plan-needs-repair',
      false,
      'Rett først det `issues` peker på, og skriv bildeplanen på nytt – tomme kontroller er en del av stoppkriteriet. Fortsett deretter i samme samtale med bildegenereringen.',
      [
        'Rett det `issues` peker på, og skriv bildeplanen på nytt.',
        ...(counts.awaitingFileCount > 0 ? GENERATION_STEPS : []),
      ],
    )
  }

  /*
   * A picture in the deck that was made for an order the deck has since
   * rewritten, split by whether anything is being done about it.
   *
   * *Superseded* means its zone is planned again: a replacement is on order, so
   * the question is only whether that replacement has been made and delivered.
   * *Unaddressed* means nothing is: the picture is simply wrong for the deck it
   * is in, and no amount of generating elsewhere fixes it.
   *
   * The split is what keeps two different failures from sharing an answer. An
   * unaddressed one must stop the flow — and must survive an emptied plan, or
   * «rewrite the plan with only the zones that still wait» becomes a way to
   * delete the evidence. A superseded one must not stop it, because the agent
   * is already doing the only thing that helps; it just must not be mistaken
   * for a delivered picture, which is exactly what it was when the replacement
   * records overwrote it.
   */
  const plannedZones = new Set(
    images.map((image) => imageZoneKey(image.plan.slideId, image.plan.nodeId)),
  )
  const stale = staleGeneratedImages(presentation)
  const superseded = stale.filter((record) =>
    plannedZones.has(imageZoneKey(record.slideId, record.nodeId)),
  )
  const unaddressed = stale.filter(
    (record) => !plannedZones.has(imageZoneKey(record.slideId, record.nodeId)),
  )
  const coverage = imageGenerationCoverage(presentation)
  const verified = coverage === 'verified'

  if (unaddressed.length > 0) {
    const numbers = unaddressed.map((record) => record.number).join(', ')
    return status(
      'plan-outdated',
      false,
      `${unaddressed.length === 1 ? 'Ett bilde' : `${unaddressed.length} bilder`} i dekket ble laget for en bestilling som siden er endret – bilde ${numbers} – og ingenting er bestilt i stedet. Motivet eller den felles bildekonteksten er skrevet om etter at filen kom, så filen i sonen svarer ikke på bestillingen som står nå. Det er ikke rettet ved å tømme bildeplanen: legg de sonene inn i bildeplanen igjen, generer bildene enkeltvis, og kjør koblingskontrollen. Skal et av de gamle bildene likevel stå, må det være brukerens valg – si hva som ikke stemmer, i stedet for å melde dekket ferdig.`,
      [
        'Legg de berørte bildesonene inn i bildeplanen igjen, med bestillingen som gjelder nå.',
        'Generer de bildene enkeltvis, og kjør koblingskontrollen på hele den nye planen.',
        'Kan et gammelt bilde bli stående, er det brukerens avgjørelse – legg den frem, ikke avgjør den selv.',
      ],
    )
  }

  if (superseded.length > 0 && !verified) {
    /*
     * The whole current plan, never just the superseded part. The two groups —
     * zones showing a previous picture, and zones with no picture at all — are
     * disjoint slices of the same plan, and `checkGeneratedImages` expects one
     * record per *planned* entry regardless of which slice a zone is in. A
     * count that added up to less than the plan would send the agent into
     * `MISSING_ITEM` on the rest, which is the contradiction this flow keeps
     * having to be saved from.
     */
    return status(
      'plan-outdated',
      false,
      `${superseded.length} av bildesonene holder fortsatt bildet fra den forrige bestillingen, og erstatningene er ikke laget ennå. Generer oppføringene i planen én av gangen, hver for seg fra sin egen \`prompt\`, og kjør koblingskontrollen på hele planen etterpå – kontrollen venter én fil per planlagt oppføring, også for sonene som allerede har et bilde. Først når de nye filene er lagt inn i sonene, er bildene i dekket de som er bestilt.${depositNote(presentation)}`,
      GENERATION_STEPS,
    )
  }

  if (images.length === 0) {
    return status(
      'no-planned-images',
      true,
      'Dekket planlegger ingen rasterbilder, så rasterflyten har ingenting utestående. Forutsetter bestillingen bilder, er det bildeplanen som mangler – ikke bildegenereringen.',
    )
  }

  if (verified) {
    /*
     * Delivered means two things, and a filled zone only answers one of them.
     * A zone whose picture is still the superseded one *has* a file, so the
     * count says nothing is missing — and the replacement it is waiting for has
     * been made and checked. Both are true, and «the pictures are in the deck»
     * is not.
     */
    const outstanding = counts.awaitingFileCount + superseded.length
    if (outstanding === 0) {
      return status(
        'generation-verified',
        true,
        `Alle ${images.length} planlagte bilder er generert og kontrollert mot sin egen oppføring, og hver bildesone har fått en fil uten at noe i dekket motsier bestillingen. Rasterflyten er ferdig. Slaids ser aldri selve bildet, så dette er så langt dekket kan svare: se gjennom bildene i tillegg.`,
      )
    }
    /*
     * Verified, and the files are not in the deck. Complete, because generating
     * them was the agent's work and it is done — but the stage says what is
     * pending, and the action has to work for a session that does not hold the
     * files.
     *
     * That last part is the failure this wording answers. The check is stored,
     * so it outlives the conversation that ran it: a later session can open
     * this deck, read «done», and have no access to the pictures a previous
     * chat produced. A record is proof that files were made once; it is not
     * proof that anybody can still deliver them. So making them again is
     * explicitly allowed here, and reporting the deck as finished while its
     * picture zones are empty — or still showing the previous picture — is
     * explicitly not.
     */
    return status(
      'awaiting-deposit',
      true,
      `Alle ${images.length} planlagte bilder er generert og kontrollert mot sin egen oppføring, så genereringsoppgaven er gjort. Filene ligger ikke i dekket: ${
        superseded.length > 0
          ? `${superseded.length} bildesoner viser fortsatt bildet fra den forrige bestillingen${
              counts.awaitingFileCount > 0 ? `, og ${counts.awaitingFileCount} står tomme` : ''
            }`
          : `${counts.awaitingFileCount} bildesoner står tomme`
      }, og å legge dem inn er brukerens steg. Har du filene, lever dem med manifestet og si hva brukeren skal gjøre. Er dette en senere samtale og filene ikke er tilgjengelige for deg, si det – da er den lagrede kontrollen ingen leveranse du kan gjøre, og det riktige er å generere bildene på nytt for de samme oppføringene og kontrollere koblingen igjen. \`complete\` svarer for dokumentet, ikke for deg: \`remainingSteps\` sier hvilket av de to som gjelder her. Meld aldri dekket ferdig til brukeren uten å si at bildene ikke er på plass.${depositNote(
        presentation,
      )}`,
      DEPOSIT_STEPS,
    )
  }

  if (coverage === 'unverified') {
    /*
     * Every entry is claimed and not one claim reaches a file. Deliberately
     * before the filled-zone branch below: that one says «rewrite the plan with
     * the zones that still wait», which is the wrong answer to a deck whose
     * pictures were made and whose bindings are merely unprovable.
     */
    return status(
      'generation-unverified',
      false,
      `Alle ${images.length} planlagte oppføringer har en kobling, og ingen av dem bærer avtrykket (SHA-256) av bytene bildegenereringen returnerte. Da kan Slaids ikke skille en ekte leveranse fra id-er, numre og filnavn som er skrevet av bildeplanen – alt det sto i planen før bildene ble laget – så genereringen er ikke verifisert. Har du bytene, regn ut avtrykkene og kjør koblingskontrollen på nytt; da er den verifisert uten at noe bilde lages om. Har du dem ikke, si uttrykkelig at leveransen er uverifisert og må ses gjennom manuelt. \`remainingSteps\` sier hvilken av de to som gjelder her. Ikke omtal dette som kontrollert.${depositNote(
        presentation,
      )}`,
      UNVERIFIED_STEPS,
    )
  }

  if (deposited > 0) {
    return status(
      'plan-outdated',
      false,
      `${deposited} av ${images.length} planlagte bildesoner har alt en fil, uten at noen kontrollert kobling gjør rede for dem. Planen beskriver dermed ikke lenger det den påstår. Skriv bildeplanen på nytt med bare de sonene som fortsatt venter på et bilde, og generer deretter dem. En fil i en sone er ikke bevis for at den ble laget for bestillingen som står nå.`,
      [
        'Skriv bildeplanen på nytt med bare de bildesonene som fortsatt venter på en fil.',
        'Generer deretter de oppføringene, enkeltvis, og kjør koblingskontrollen på hele den nye planen.',
      ],
    )
  }

  return status(
    'awaiting-generation',
    false,
    'Bildeplanen er et mellomsteg, ikke leveransen. Fortsett i samme samtale: generer neste planlagte bilde direkte fra `imageContext` og den aktuelle bildeoppføringen – ett kall med bare den oppføringens ferdige `prompt` – og gjenta for én oppføring av gangen til alle har sin egen fil. Ikke skriv ut samlet brief eller andre bildeoppføringer i samtalen. Genereringsoppgaven er ferdig når koblingskontrollen svarer `ok` for alle planlagte oppføringer, ikke når bildesonene er fylt.',
    GENERATION_STEPS,
  )
}

/* ------------------------------------------------------------------ *
 * One job at a time
 * ------------------------------------------------------------------ */

/**
 * One picture to generate now, and nothing about any other.
 *
 * The status above answers «is anything left». This answers «what is the next
 * thing», and it is a separate answer for a structural reason rather than a
 * tidiness one: the plan is the set, and every response that carries the plan
 * carries the set with it. An agent that reads a plan of nine entries — nine
 * motifs, nine finished prompts, a count — has the set in front of it when it
 * makes the first image call, however carefully it was told not to repeat any
 * of that out loud. What reaches a generator is then a matter of discipline,
 * and discipline is what had already been tried.
 *
 * So the generation step gets a surface of its own that can only say one thing.
 * The fields here are the whole of it: the prompt for this one picture, the
 * format its zone was measured at, and the bookkeeping the binding check will
 * ask for afterwards. No sibling entry, no motif but its own, no brief, no
 * total — the next job is fetched *after* this one is generated and bound, so
 * «how many are there» never has to be answered at all.
 *
 * `number` and `fileName` are here because the deposit protocol is numbered:
 * the file has to be called what its entry says, or the numbered files cannot
 * find their zones. That is the one place an ordinal is unavoidable, and it is
 * the file's name rather than a position in a set.
 */
export interface ImageGenerationJob {
  /** What the finished file is bound to. Copied into the binding check, never into the prompt. */
  imagePlanItemId: string
  /** The entry's own number, which is what its file is called. */
  number: number
  /** `<number>.<filendelse>`: the name the file must carry. */
  fileName: string
  slideId: string
  nodeId: string
  /**
   * The format, for a host whose image tool takes it as a parameter.
   *
   * The prompt states it too. Both, because a ratio a generator is handed as a
   * parameter is obeyed more reliably than one it reads — and one entry's own
   * measurement is never a format shared with another picture.
   */
  aspectRatio: string
  /** The whole instruction for this one picture. See `composeImageGenerationPrompt`. */
  prompt: string
}

/**
 * Why there is no job, when there is none.
 *
 *  - `job` — there is one, and it is the only thing to do next.
 *  - `no-plan` — the deck plans no pictures.
 *  - `plan-needs-repair` — the plan has findings, and generating from a plan
 *    that does not describe the deck is how a picture gets made for a zone that
 *    has moved. It also covers the one finding that must never reach a
 *    generator: a text that refers to the other pictures.
 *  - `all-generated` — every entry has its own checked binding. The loop ends
 *    here, without anybody having been told how long it was.
 */
export type ImageJobStatus = 'job' | 'no-plan' | 'plan-needs-repair' | 'all-generated'

/** The next job, or what stands in its way. */
export interface NextImageJob {
  status: ImageJobStatus
  job: ImageGenerationJob | null
  /** What to do with this answer, in one sentence. */
  instruction: string
  /** What to fix, when the plan is what stops a job. Empty otherwise. */
  issues: readonly ImagePlanIssue[]
}

/**
 * The next picture to generate, or the reason there is none.
 *
 * «Next» is the first planned entry, in deck order, that no stored binding
 * accounts for — so the queue is derived from the document rather than kept
 * anywhere, and an interrupted conversation picks it up where the deck left it
 * rather than where a lost counter said.
 *
 * The plan's own checks come first, exactly as in `composeImageWorkflowStatus`,
 * and the prompt is checked once more before it is handed out: a text that
 * refers to the other pictures is the one plan finding that would otherwise
 * *travel*, and `CROSS_IMAGE_REFERENCE` on the entry is the same question asked
 * of the same patterns one step earlier. Two asks rather than one, because this
 * is the last point where the text is still Slaids'.
 */
export function nextImageJob(presentation: Presentation): NextImageJob {
  const none = (
    status: ImageJobStatus,
    instruction: string,
    issues: readonly ImagePlanIssue[] = [],
  ): NextImageJob => ({ status, job: null, instruction, issues })

  const issues = checkImagePlan(presentation)
  if (issues.length > 0) {
    return none(
      'plan-needs-repair',
      'Bildeplanen har funn, og det genereres ingenting fra en plan som ikke beskriver dekket. Rett det `issues` peker på, skriv bildeplanen på nytt, og hent jobben igjen.',
      issues,
    )
  }

  const images = resolveImagePlan(presentation)
  if (images.length === 0) {
    return none(
      'no-plan',
      'Dekket planlegger ingen rasterbilder, så det finnes ingen bildejobb. Forutsetter bestillingen bilder, er det bildeplanen som mangler.',
    )
  }

  const bound = new Set(
    plannedGeneratedImages(presentation).map((record) => record.imagePlanItemId),
  )
  const next = images.find((image) => !bound.has(image.id))
  if (!next) {
    return none(
      'all-generated',
      'Hver planlagt oppføring har sin egen kobling, så det er ingen bildejobb igjen. Er koblingene kontrollert med avtrykk, er genereringsoppgaven ferdig; `workflow` på de andre svarene sier hva som eventuelt gjenstår.',
    )
  }

  /*
   * A planned zone that already holds a file nothing accounts for is the one
   * case where the next entry is not a job. The deck cannot say where that
   * picture came from — a manual upload, an older order, a person — so
   * generating against the plan would put a second picture where one already
   * is. `composeImageWorkflowStatus` calls it `plan-outdated` and asks for the
   * plan to be rewritten with the zones that still wait; this has to agree with
   * it, or the two surfaces would give opposite answers about the same deck.
   *
   * A zone whose *previous* picture is accounted for by a stale record is the
   * opposite case: the replacement is on order, and generating it is exactly
   * what is owed.
   */
  const superseded = new Set(
    staleGeneratedImages(presentation).map((record) =>
      imageZoneKey(record.slideId, record.nodeId),
    ),
  )
  if (next.filled && !superseded.has(imageZoneKey(next.plan.slideId, next.plan.nodeId))) {
    return none(
      'plan-needs-repair',
      'Den neste planlagte bildesonen holder allerede en fil, og ingen kontrollert kobling gjør rede for den. Planen beskriver da ikke lenger det den påstår, og et nytt bilde ville kommet i tillegg til det som står der. Skriv bildeplanen på nytt med bare de bildesonene som fortsatt venter på en fil, og hent jobben igjen.',
    )
  }

  const prompt = composeImageGenerationPrompt(next, presentation.imageContext ?? '')
  const referenced = crossImageReferences(prompt)
  if (referenced.length > 0) {
    /* Unreachable while `checkImagePlan` asks the same patterns of the same
       texts — and kept anyway, because this is the last place the prompt is
       Slaids' own, and a leak that got here would go straight to a generator. */
    return none(
      'plan-needs-repair',
      `Prompten for denne oppføringen viser til andre bilder (${referenced
        .map((phrase) => `«${phrase}»`)
        .join(', ')}), og da blir den ikke sendt. Skriv om motivet, komposisjonen, kravene eller den felles bildekonteksten slik at teksten står alene, og hent jobben igjen.`,
    )
  }

  return {
    status: 'job',
    job: {
      imagePlanItemId: next.id,
      number: next.number,
      fileName: `${next.fileNameStem}.<filendelse>`,
      slideId: next.plan.slideId,
      nodeId: next.plan.nodeId,
      aspectRatio: next.aspectRatio,
      prompt,
    },
    instruction:
      'Dette er én bildegenereringsoppgave. Kall bildegeneratoren nøyaktig én gang med `prompt` ordrett – ikke legg til id, nummer, filnavn, slide eller noe om andre bilder. Regn ut SHA-256 av bytene som kommer tilbake med en gang, gi filen navnet `fileName` oppgir, og kjør koblingskontrollen for denne oppføringen med `imagePlanItemId`, `number`, `slideId`, `nodeId`, filnavnet og avtrykket. Hent deretter neste jobb.',
    issues: [],
  }
}
