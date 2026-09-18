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
 * Two are finished for the *document*: `no-planned-images` because there is
 * nothing to make, and `generation-verified` because every planned picture is
 * in the deck. Those are the only two that are `complete`, and the reason is
 * that they are the only two nobody can assert: a file in a zone got there
 * through the deposit.
 *
 * `awaiting-deposit` and `generation-unverified` are the delivery stages. Both
 * are `complete: false` while the agent may well be finished — what decides
 * that is `remainingSteps`, which names the branch that applies. They differ in
 * what the delivery will allow later: with digests the deposit can compare each
 * file against the bytes its generation response is said to have returned;
 * without them it can compare nothing, and the delivery is a claim with no
 * future check in it.
 *
 * The rest are stages an agent must never end a turn in.
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
   * Whether the pictures the deck plans are actually in it.
   *
   * A statement about the *document*, and only that — and deliberately about
   * the one thing nobody can assert into existence. Everything an agent reports
   * about a generated picture is a string it supplied: the plan entry's id, the
   * number, the zone and the file name were in the plan before any picture
   * existed, and the digest is 64 characters Slaids has nothing to compare
   * against. A delivery is therefore a claim until the files reach the deck,
   * where the deposit compares each one against the digest its manifest carries
   * before inserting anything.
   *
   * So `complete` is never a report of the agent's work, and `false` does not
   * mean the agent owes something. **`remainingSteps` is what a stop decides
   * on**: in the delivery stages it names two branches, the agent performs the
   * one that applies, and its work is done while the deck is not. That
   * separation is what keeps «the pictures are in the deck» from being
   * something a model can state about itself.
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
 * **No stage says a picture was generated.** Slaids is not in the room when one
 * is made: the bindings it stores are what an agent reported, and a binding can
 * be written from the plan alone. `generation-verified` is not an exception —
 * it says the planned zones hold files, which is a fact about the document that
 * the deposit put there, and the deposit checks digests when a manifest carries
 * them. What it never says is that the picture in the zone shows the motif that
 * was ordered.
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
  'Alle planlagte bilder er generert uten å vente på en ny brukerbeskjed, ett av gangen: like mange separate bildefiler som planen har oppføringer, én fil per `imagePlanItemId`. Blir samtalen avbrutt, fortsetter genereringen der dekket står – køen ligger i dokumentet, ikke i samtalen.',
  'Hver fil har det aspect ratio oppføringen den ble generert fra oppgir.',
  'Hver fil er meldt med den `imagePlanItemId` den ble generert fra og avtrykket (SHA-256) av bytene bildegenereringen returnerte, og koblingskontrollen svarer `ok` med `check: "file-checked"` for alle planlagte oppføringer. Det er så langt *ditt* arbeid rekker, og svaret blir stående på dekket.',
  'Koblingen er en påstand til den er kontrollert mot filene selv. Slaids ser aldri bytene dine: id, nummer, sone og filnavn sto i bildeplanen fra før, og avtrykket er en streng du oppgir. Den eneste sammenligningen med virkelige bytes skjer i nettleseren når brukeren deponerer filene, så `complete` blir først true når bildene faktisk ligger i dekket.',
  'Å legge bildene inn er derfor brukerens steg, og aldri noe du venter på: `remainingSteps` sier hva som gjenstår for deg, og er den gjort, er ditt arbeid ferdig selv om dekket ikke er det.',
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
 * The endings that are wrong once the pictures have been delivered.
 *
 * A separate list, because the generation one does not fit here and one of its
 * lines is false here: «bildene er ikke satt inn ennå — arbeidet er ditt» is
 * exactly backwards for a deck whose files are waiting for the user's deposit.
 * What is wrong at this end is overstating what the delivery proves, and
 * quietly calling the deck finished while its picture zones are empty.
 */
export const IMAGE_DELIVERY_FORBIDDEN_CLOSINGS: readonly string[] = [
  'Ikke si at bildene er kontrollert eller verifisert. Slaids har sammenlignet koblingene med bildeplanen, ikke med filene: avtrykket er en påstand du oppga, og det blir først sammenlignet med virkelige bytes i nettleseren når brukeren deponerer filene.',
  'Ikke meld presentasjonen ferdig uten å si at bildene ikke er på plass i dekket ennå, og hva brukeren skal gjøre for å legge dem inn.',
  'Ikke vent på at brukeren deponerer bildene. Deponeringen er brukerens steg i nettleseren, og den er aldri ditt arbeid.',
  'Ikke generer et bilde om igjen fordi bildesonen ennå er tom, så lenge du selv har filen. Er filen laget i en tidligere samtale og ikke tilgjengelig for deg, er det motsatte riktig – si det, og lag bildet på nytt for den samme oppføringen.',
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
  'Har du bytene til bildefilene: regn ut SHA-256 av hver av dem og kjør koblingskontrollen på nytt med avtrykkene. Det er den ene veien til en kontrollerbar leveranse, og den krever ingen nye bilder.',
  'Har du dem ikke – vertsklienten gir deg ikke tilgang til bytene fra sitt eget bildeverktøy – si uttrykkelig til brukeren at leveransen er uverifisert: metadataene kan stemme samtidig som filene er forvekslet. Lever filene med manifestet, og si at bildene må ses gjennom manuelt.',
  'Er bildene i virkeligheten ikke laget – koblingene er skrevet av bildeplanen – finnes det ingen leveranse her. Da er det å generere dem som gjenstår: hent neste bildejobb, som fortsatt tilbyr hver oppføring uten avtrykk.',
  'I de to første tilfellene: ikke generer bildene om igjen for å få en kontroll, og ikke omtal leveransen som kontrollert uansett hvilket av de tre som gjelder.',
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
 *  - `claimed` — every entry has a binding, and at least one carries no digest.
 *    Nothing about this delivery can ever be compared against a file.
 *  - `checkable` — every entry has a binding and every binding carries a
 *    digest, so the deposit *will* compare each file's own bytes against the
 *    digest its generation response is said to have returned.
 *
 * **Neither of the last two is proof, and the names are chosen so nothing
 * downstream can read one as proof.** Slaids never sees a generated file: at
 * the agent boundary a digest is a 64-character string the caller supplied, and
 * every other field in a binding — the id, the number, the zone, the file name
 * — was in the plan before any picture existed. So a complete, self-consistent,
 * digest-carrying set of bindings is exactly as cheap to produce by copying the
 * plan as by generating the pictures, and no check on this side can tell the
 * two apart. It used to end in `complete: true`; it no longer can. The one
 * thing that cannot be asserted into existence is a file in the deck, and that
 * is what completion now rests on.
 *
 * The records are kept only while they resolve (see `setImagePlan`), and the
 * check is asked against the *current* plan every time rather than trusted as a
 * flag — so a rewritten motif or shared context invalidates the answer without
 * anything having to remember to clear it.
 */
export type ImageGenerationCoverage = 'none' | 'claimed' | 'checkable'

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
  return imageBindingCheck(records) === 'file-checked' ? 'checkable' : 'claimed'
}

/**
 * Whether the agent has reported a binding for every planned picture.
 *
 * A statement about what was *claimed*, never about what was made — see
 * `imageGenerationCoverage`. Named so that no caller can mistake it for the
 * question it is not.
 */
export function imageGenerationIsReported(presentation: Presentation): boolean {
  return imageGenerationCoverage(presentation) !== 'none'
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
  /*
   * `forbiddenClosings` is the stage's own, not a function of `complete`.
   *
   * It used to be «empty when complete», which worked while `complete` meant
   * «the agent's generation is done». It does not any more: completion is now
   * the pictures being in the deck, so the stages where the agent has delivered
   * are `complete: false` too — and the generation list, which says «the work
   * is yours» about inserting pictures, is actively wrong there. The delivery
   * stages name their own endings instead.
   */
  const status = (
    stage: ImageWorkflowStage,
    complete: boolean,
    nextAction: string,
    remainingSteps: readonly string[] = [],
    forbiddenClosings: readonly string[] = IMAGE_WORKFLOW_FORBIDDEN_CLOSINGS,
  ): ImageWorkflowStatus => ({
    stage,
    complete,
    ...counts,
    nextAction,
    remainingSteps,
    completionCriteria: IMAGE_WORKFLOW_COMPLETION_CRITERIA,
    forbiddenClosings,
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
  const reported = coverage !== 'none'

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

  if (superseded.length > 0 && !reported) {
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
      [],
      [],
    )
  }

  if (reported) {
    /*
     * Every planned entry is spoken for. What that means depends on one thing
     * the deck *can* see — whether the pictures are in it.
     *
     * Delivered means two things, and a filled zone only answers one of them.
     * A zone whose picture is still the superseded one *has* a file, so the
     * count says nothing is missing — and the replacement it is waiting for has
     * been reported. Both are true, and «the pictures are in the deck» is not.
     */
    const outstanding = counts.awaitingFileCount + superseded.length
    if (outstanding === 0) {
      /*
       * The one state that may say finished, and the reason is that it rests on
       * something nobody could assert: a file in the deck. Every field in a
       * binding, the digest included, is a string the agent supplied — but the
       * bytes in a picture zone got there through the deposit, which compares
       * each file against the digest its manifest carries before inserting
       * anything. Completion is therefore a fact about the document rather than
       * a claim about work.
       */
      return status(
        'generation-verified',
        true,
        `Alle ${images.length} planlagte bilder er gjort rede for av en kobling, og hver bildesone har fått en fil uten at noe i dekket motsier bestillingen. Rasterflyten er ferdig. Slaids ser aldri selve bildet, så dette er så langt dekket kan svare: se gjennom bildene i tillegg.`,
        [],
        [],
      )
    }
    if (coverage === 'claimed') {
      /*
       * Reported, and nothing about the report can ever be compared against a
       * file. Deliberately before the filled-zone branch below: that one says
       * «rewrite the plan with the zones that still wait», which is the wrong
       * answer to a deck whose pictures were made and whose bindings merely
       * cannot be checked.
       */
      return status(
        'generation-unverified',
        false,
        `Alle ${images.length} planlagte oppføringer har en kobling, og ingen av dem bærer avtrykket (SHA-256) av bytene bildegenereringen returnerte. Uten avtrykket kan deponeringen aldri sammenligne filene med noe, og Slaids kan ikke skille en ekte leveranse fra id-er, numre og filnavn skrevet av bildeplanen – alt det sto i planen før bildene ble laget. Har du bytene, regn ut avtrykkene og kjør koblingskontrollen på nytt; det krever ingen nye bilder. Har du dem ikke, si uttrykkelig at leveransen er uverifisert og må ses gjennom manuelt. \`remainingSteps\` sier hvilken av de to som gjelder her. Ikke omtal dette som kontrollert.${depositNote(
          presentation,
        )}`,
        UNVERIFIED_STEPS,
        IMAGE_DELIVERY_FORBIDDEN_CLOSINGS,
      )
    }
    /*
     * Reported with digests, and the files are not in the deck. Not complete —
     * completion is the pictures being in the deck, and nothing the agent can
     * write moves that — but the generation work itself is what `remainingSteps`
     * decides, and it has to work for a session that does not hold the files.
     *
     * That last part is the failure this wording answers. The bindings are
     * stored, so they outlive the conversation that wrote them: a later session
     * can open this deck, read them, and have no access to the pictures a
     * previous chat produced. A record says files were reported once; it is not
     * proof that anybody can still deliver them. So making them again is
     * explicitly allowed here, and reporting the deck as finished while its
     * picture zones are empty — or still showing the previous picture — is
     * explicitly not.
     */
    return status(
      'awaiting-deposit',
      false,
      `Alle ${images.length} planlagte bilder er meldt generert med avtrykk, så genereringsarbeidet ditt er gjort. Dekket er ikke ferdig: ${
        superseded.length > 0
          ? `${superseded.length} bildesoner viser fortsatt bildet fra den forrige bestillingen${
              counts.awaitingFileCount > 0 ? `, og ${counts.awaitingFileCount} står tomme` : ''
            }`
          : `${counts.awaitingFileCount} bildesoner står tomme`
      }, og å legge filene inn er brukerens steg. Det er der avtrykkene faktisk kontrolleres – Slaids ser aldri bytene dine, så koblingen er din påstand til den er sammenlignet i nettleseren. Har du filene, lever dem med manifestet og si hva brukeren skal gjøre. Er dette en senere samtale og filene ikke er tilgjengelige for deg, si det – da er de lagrede koblingene ingen leveranse du kan gjøre, og det riktige er å generere bildene på nytt for de samme oppføringene og kontrollere koblingen igjen. \`complete\` svarer for dokumentet, ikke for deg: \`remainingSteps\` sier hvilket av de to som gjelder her. Meld aldri dekket ferdig til brukeren uten å si at bildene ikke er på plass.${depositNote(
        presentation,
      )}`,
      DEPOSIT_STEPS,
      IMAGE_DELIVERY_FORBIDDEN_CLOSINGS,
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
  /**
   * What the finished file is bound to: an opaque name for this one order.
   *
   * The only identifier in a job, and deliberately the only one. The entry's
   * number, its file name and its zone are all facts about a *set* — «the third
   * of them», «the one on that slide» — and a host whose image tool reads the
   * conversation rather than an explicit prompt string would have them in
   * context at the moment it generates. An `imgplan_…` digest says nothing
   * about how many there are or where this one sits. The number comes back
   * from the binding check afterwards, as the name to save the file under.
   */
  imagePlanItemId: string
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
 *  - `unverified-claim` — this entry has a binding with no digest. Slaids has
 *    no signal that a picture was ever made for it: every field in that binding
 *    was in the plan beforehand. The job is handed out again with the three
 *    cases named, rather than being counted as done.
 *  - `all-generated` — every entry has a binding that carries a digest. The
 *    loop ends here, without anybody having been told how long it was.
 */
export type ImageJobStatus =
  | 'job'
  | 'unverified-claim'
  | 'no-plan'
  | 'plan-needs-repair'
  | 'all-generated'

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

  /*
   * An entry leaves the queue when the delivery has *answered* for it: with a
   * digest, or with the host's explicit declaration that it cannot reach the
   * bytes. A binding that does neither is a row an agent can write from the
   * plan alone — id, number, zone and file name were all in it before any
   * picture existed — and letting it consume a job meant the whole loop could
   * be walked without calling an image generator once.
   *
   * Neither answer is proof, and nothing here pretends otherwise. A digest is a
   * string the caller supplied; what makes it worth asking for is that the
   * deposit compares it against the file's own bytes and refuses the set when
   * it does not match, so a fabricated one buys a walk through the queue and a
   * delivery the browser will reject. A declaration buys nothing at all: it is
   * recorded as «never checkable», and it is the only way a host that cannot
   * hash its own output gets past a picture it really did make.
   */
  const records = plannedGeneratedImages(presentation)
  const answered = new Set(
    records
      .filter((record) => record.contentHash !== undefined || record.bytesUnavailable)
      .map((record) => record.imagePlanItemId),
  )
  const claimed = new Set(
    records
      .filter((record) => record.contentHash === undefined && !record.bytesUnavailable)
      .map((record) => record.imagePlanItemId),
  )
  const next = images.find((image) => !answered.has(image.id))
  if (!next) {
    return none(
      'all-generated',
      'Hver planlagt oppføring har en kobling med avtrykk, så det er ingen bildejobb igjen. Avtrykkene sammenlignes med filenes egne bytes når brukeren deponerer dem; `workflow` på de andre svarene sier hva som gjenstår.',
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

  const job: ImageGenerationJob = {
    imagePlanItemId: next.id,
    aspectRatio: next.aspectRatio,
    prompt,
  }

  if (claimed.has(next.id)) {
    /*
     * Reported without a digest, which is a row and not a picture. Handed out
     * again rather than skipped, because Slaids cannot tell the two honest
     * readers apart — the one that made the picture and cannot reach its bytes,
     * and the one that made nothing — so it names both cases and lets whoever
     * is here answer the one that is true.
     */
    return {
      status: 'unverified-claim',
      job,
      instruction:
        'Denne oppføringen har en kobling som verken bærer avtrykk eller sier at bytene er utilgjengelige, og da har Slaids ingen holdepunkt for at et bilde faktisk ble laget: id, nummer, sone og filnavn sto alle i bildeplanen fra før. Tre tilfeller, og du vet hvilket som gjelder: laget du bildet og kan lese bytene, regn ut SHA-256 og kjør koblingskontrollen på nytt – da er jobben gjort uten et nytt bilde. Laget du bildet og får ikke tilgang til bytene, kjør kontrollen på nytt med `bytesUnavailable` i stedet: oppføringen slutter å bli tilbudt, leveransen står som uverifisert, og brukeren bekrefter bildene manuelt i deponeringen. Er bildet ikke laget, er `prompt` her, og da er det nå det skal genereres.',
      issues: [],
    }
  }

  return {
    status: 'job',
    job,
    instruction:
      'Dette er én bildegenereringsoppgave. Kall bildegeneratoren nøyaktig én gang med `prompt` ordrett, og legg ingenting til den – heller ikke `imagePlanItemId`, som bare er din egen bokføring. Regn ut SHA-256 av bytene som kommer tilbake med en gang, og kjør koblingskontrollen for denne oppføringen med `imagePlanItemId`, filendelsen filen har og avtrykket. Kontrollen svarer med navnet filen skal lagres under. Hent deretter neste jobb.',
    issues: [],
  }
}
