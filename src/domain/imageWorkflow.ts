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
  plannedGeneratedImages,
  staleGeneratedImages,
} from './imageGeneration'
import { checkImagePlan, imageZoneKey, resolveImagePlan } from './imagePlan'
import type { Presentation } from './types'

/**
 * The raster flow's position, in the deck's own terms.
 *
 * Three are finished for the agent, for different reasons: `no-planned-images`
 * because there is nothing to make, `generation-verified` because everything
 * planned was made *and* is in the deck, and `awaiting-deposit` because
 * everything planned was made and the files have not arrived — which is the
 * user's step, not the agent's. The other three are stages an agent must never
 * end a turn in.
 */
export type ImageWorkflowStage =
  | 'no-planned-images'
  | 'plan-needs-repair'
  | 'awaiting-generation'
  | 'generation-verified'
  | 'awaiting-deposit'
  | 'plan-outdated'

/** How far the deck's raster flow has got, derived rather than remembered. */
export interface ImageWorkflowStatus {
  stage: ImageWorkflowStage
  /**
   * Whether the raster flow has anything left in it *for the agent*.
   *
   * The single field to branch on. False means the task is not finished, no
   * matter how complete the slides look — see `completionCriteria`. It is not a
   * statement about the deposit: the files reaching Slaids is the user's step,
   * and waiting for it is never the agent's work.
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
  /** The steps between here and a finished task, in order. Empty when complete. */
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
 */
export const IMAGE_WORKFLOW_COMPLETION_CRITERIA: readonly string[] = [
  'Presentasjonen er opprettet eller oppdatert.',
  'Slidestruktur og innhold er på plass.',
  'Bildeplanen er skrevet, og kontrollene i `issues` er tomme.',
  'Den ferske sluttbriefen er skrevet ut i samtalen.',
  'Alle planlagte bilder er generert i samme samtale, som like mange separate bildefiler.',
  'Hver fil er knyttet til den `imagePlanItemId` den ble generert fra, og koblingskontrollen svarer `ok` for alle planlagte oppføringer. Det er den kontrollen som avgjør at bildegenereringen er ferdig, og svaret blir stående på dekket.',
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
  'Ikke be om en ny brukerbeskjed for å starte bildegenereringen. Eneste gyldige stopp er at brukeren uttrykkelig har bedt om å stoppe etter briefen, eller en konkret teknisk blokkering du navngir.',
  'Ikke generer et bilde om igjen fordi bildesonen ennå er tom i Slaids, så lenge du selv har filen: er koblingen alt kontrollert, er bildet laget, og det som gjenstår er deponeringen. Er bildet laget i en tidligere samtale og filen ikke er tilgjengelig for deg, er det motsatte riktig – si det, og lag bildet på nytt for den samme oppføringen.',
]

/** The generation half of what is left, with this deck's own count in it. */
function generationSteps(awaiting: number): readonly string[] {
  return [
    'Hent den ferske sluttbriefen fra den endelige presentasjonstilstanden, og skriv den ut i samtalen.',
    `Generer de ${awaiting} bildene, enkeltvis: ett kall per oppføring i \`images\`, i stigende \`number\`, etter \`generation.perImageSteps\`.`,
    'Kjør koblingskontrollen på alle planlagte oppføringer, mot `generation.beforeDeposit`. Den er stoppkriteriet for bildegenereringen, og svaret blir stående på dekket.',
    'Svarer kontrollen `ok`, er genereringsoppgaven ferdig. Lever bildene med manifestet; å legge dem inn i Slaids er brukerens steg med mindre klienten har en filbro.',
  ]
}

/**
 * Whether the deck's stored bindings account for the plan it carries now.
 *
 * The records are kept only while they resolve (see `setImagePlan`), and the
 * check is asked against the *current* plan every time rather than trusted as a
 * flag — so a rewritten motif or shared context invalidates the answer without
 * anything having to remember to clear it.
 */
export function imageGenerationIsVerified(presentation: Presentation): boolean {
  /*
   * Only the records that answer for the plan the deck holds now. A record left
   * over from a rewritten order is not a flaw in this delivery — it is its own
   * finding (`staleGeneratedImages`, reported as `plan-outdated`), and folding
   * it in here would let one stale picture elsewhere in the deck make a
   * correctly delivered plan look unverified.
   */
  const records = plannedGeneratedImages(presentation)
  if (records.length === 0) return false
  return checkGeneratedImages(presentation, records).length === 0
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
    remainingSteps: complete ? [] : remainingSteps,
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
        ...(counts.awaitingFileCount > 0 ? generationSteps(counts.awaitingFileCount) : []),
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
  const verified = imageGenerationIsVerified(presentation)

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
    return status(
      'plan-outdated',
      false,
      `${superseded.length} av bildesonene holder fortsatt bildet fra den forrige bestillingen, og erstatningene er ikke laget ennå. Generer oppføringene i planen enkeltvis og kjør koblingskontrollen; først når de nye filene er lagt inn i sonene, er bildene i dekket de som er bestilt.`,
      generationSteps(Math.max(counts.awaitingFileCount, superseded.length)),
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
      }, og å legge dem inn er brukerens steg. Har du filene, lever dem med manifestet og si hva brukeren skal gjøre. Er dette en senere samtale og filene ikke er tilgjengelige for deg, si det – da er det riktig å generere bildene på nytt for de samme oppføringene og kontrollere koblingen igjen. Meld aldri dekket ferdig til brukeren uten å si at bildene ikke er på plass.`,
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
    `Bildeplanen er et mellomsteg, ikke leveransen. Fortsett i samme samtale: skriv ut den ferske sluttbriefen, og kall deretter bildegeneratoren ${counts.awaitingFileCount} ganger – én gang per oppføring i \`images\`, én oppføring ferdigstilt av gangen. Genereringsoppgaven er ferdig når koblingskontrollen svarer \`ok\` for alle planlagte oppføringer, ikke når bildesonene er fylt.`,
    generationSteps(counts.awaitingFileCount),
  )
}
