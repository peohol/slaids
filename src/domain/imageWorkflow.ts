/**
 * Where the deck's raster flow stands, and therefore whether it is finished.
 *
 * `imagePlan.ts` says what to make and composes the one text somebody makes it
 * from. `imageDeposit.ts` takes the finished files back. This module answers
 * the question neither of them can answer alone: **is there anything left to
 * do?**
 *
 * It exists because of a failure every prose rule in the flow already forbade
 * and that happened anyway: the plan was written, the answer came back full of
 * instructions about generating the pictures, and the agent stopped there and
 * told the user the presentation was ready. Nothing in that answer *said* the
 * work was unfinished — an empty `issues` list reads as a finishing line. A
 * further rule would not have helped; the rules were there. What was missing
 * was a fact.
 *
 * ## What the deck can see, and what it cannot
 *
 * **Slaids never sees a generated file, and it is never in the room when one is
 * made.** The pictures are produced in a conversation of their own — the user
 * pastes the brief there — and they reach the deck through the *user's* deposit
 * in a browser. So there is exactly one observable event in the whole flow: a
 * picture zone that holds a file.
 *
 * Everything this module reports is derived from that one fact and from the
 * plan, and nothing else is stored. That is the correction this carries: the
 * deck used to keep a record of what an agent *said* it had generated, and a
 * record written from the plan is as cheap to produce by copying it as by
 * making the pictures. Slaids no longer pretends to know a picture exists
 * before the file is in the deck.
 */

import { checkImagePlan, resolveImagePlan } from './imagePlan'
import type { Presentation } from './types'

/**
 * The raster flow's position, in the deck's own terms.
 *
 * Four, and only two of them are finished: `no-planned-images` because there is
 * nothing to make, and `images-in-deck` because every planned picture is in the
 * deck. They are the only two nobody can assert — a file in a zone got there
 * through the deposit.
 *
 * `awaiting-images` is the delivery stage, and it is `complete: false` while
 * the *agent* may well be finished: handing over the brief is the end of its
 * work, and the deposit is the user's. `remainingSteps` is what a stop decides
 * on, never `complete`.
 */
export type ImageWorkflowStage =
  | 'no-planned-images'
  | 'plan-needs-repair'
  | 'awaiting-images'
  | 'images-in-deck'
  | 'plan-outdated'

/** How far the deck's raster flow has got, derived rather than remembered. */
export interface ImageWorkflowStatus {
  stage: ImageWorkflowStage
  /**
   * Whether the pictures the deck plans are actually in it.
   *
   * A statement about the *document*, and only that. It is never a receipt for
   * the agent's work: an agent that has written a correct plan and handed the
   * brief over is done, on a deck that is not. **`remainingSteps` is what a
   * stop decides on.**
   */
  complete: boolean
  plannedImageCount: number
  /** Planned entries whose zone holds a file. A fact about the deposit. */
  depositedImageCount: number
  /** Planned entries whose zone is still empty: what the brief asks for. */
  awaitingFileCount: number
  /** What happens next, named as an action rather than as a state. */
  nextAction: string
  /** What the agent still owes, in order. Empty means nothing is left for it. */
  remainingSteps: readonly string[]
  /** Everything that has to be true before the task may be called finished. */
  completionCriteria: readonly string[]
  /** Endings that are wrong at *this* stage. Empty where nothing is outstanding. */
  forbiddenClosings: readonly string[]
}

/**
 * What finishing means for a deck that plans pictures.
 *
 * Exported because the same lines are the agent's standing instruction and this
 * deck's own status, and two copies of a definition of done is how a delivery
 * comes to satisfy one of them.
 *
 * The last two are the ones that cost something to get right, and they split a
 * question that used to be answered with one fact. Handing the brief over is
 * the end of the *agent's* work. It is not what makes the deck finished: the
 * pictures are made somewhere else and come in through the user's deposit.
 * Saying that plainly is what keeps the agent from stopping too early *and*
 * from waiting for a browser action it cannot perform.
 */
export const IMAGE_WORKFLOW_COMPLETION_CRITERIA: readonly string[] = [
  'Presentasjonen er opprettet eller oppdatert.',
  'Slidestruktur og innhold er på plass.',
  'Citations, validering/reparasjoner og visuell QA er ferdige, og bildesonene er stabile.',
  'Bildeplanen er skrevet fra den endelige presentasjonstilstanden, og kontrollene i `issues` er tomme.',
  'Den ferdige seriebriefen er hentet fra dekket og gitt til brukeren ordrett, som én sammenhengende tekst.',
  'Brukeren har fått vite at briefen limes inn i én samtale som fra det punktet bare lager bilder, at oppgaven gir nøyaktig like mange separate bildefiler som planen har oppføringer, og at filene legges inn i Slaids med bildedeponeringen.',
  'Bildene lages utenfor Slaids, og `complete` blir først true når filene faktisk ligger i bildesonene. Det er brukerens steg, og aldri noe du venter på.',
]

/**
 * The endings that were the failure, said as the failure rather than as style
 * advice.
 *
 * One list rather than two, and that is a consequence of what the deck can see.
 * There used to be a second list for «the delivery has been made», which needed
 * a stage that knew the files had been handed over — and Slaids cannot know
 * that: the pictures are made in another conversation entirely. So there is one
 * outstanding stage and one set of wrong endings for it.
 *
 * Each of the first two is a true sentence about a deck whose pictures have not
 * been made, which is exactly why it was reached for: an agent describing what
 * it has done is not obviously stopping early. The last two close the endings
 * that overstate what happened — a brief rewritten into a summary, and pictures
 * Slaids has never seen called finished.
 */
export const IMAGE_WORKFLOW_FORBIDDEN_CLOSINGS: readonly string[] = [
  'Ikke avslutt med «Presentasjonen er opprettet» når bildene fortsatt mangler og briefen ikke er gitt til brukeren.',
  'Ikke avslutt med «Bildeplanen er klar». Planen er et mellomsteg; leveransen er den ferdige seriebriefen.',
  'Ikke be om en ny brukerbeskjed for å skrive ut briefen. Den hører til den samme arbeidsøkten.',
  'Ikke meld presentasjonen ferdig uten å si at bildene ikke er på plass i dekket ennå, og hva brukeren skal gjøre for å legge dem inn.',
  'Ikke vent på at brukeren deponerer bildene. Deponeringen er brukerens steg i nettleseren, og den er aldri ditt arbeid.',
  'Ikke skriv briefen om til din egen oppsummering, og ikke del den opp i ett bilde om gangen. Den er én tekst som skal limes inn i én samtale.',
  'Ikke påstå at bildene er laget, generert eller kontrollert. Slaids ser dem aldri, og de finnes ikke før brukeren deponerer filene.',
]

/**
 * The delivery, in the order it happens.
 *
 * Three steps, and the middle one is the whole change: the brief goes to the
 * *user*, in one piece, because the conversation that built the deck is not the
 * conversation that makes the pictures. Alternating between deck work and
 * image generation was tried at some length, and a host client's image tool did
 * not survive the alternation — what does survive is one finished brief handed
 * to one conversation whose only job from that point is making N pictures.
 */
const DELIVERY_STEPS: readonly string[] = [
  'Hent den ferdige seriebriefen fra dekket. Den er sammensatt av Slaids: antallet, nummereringen, de målte aspect ratio-ene, den felles bildekonteksten og hvert motiv. Ikke skriv en egen.',
  'Gi brukeren briefen ordrett, som én sammenhengende tekst hun kan kopiere. Ikke del den opp, ikke forkort den, og ikke legg til din egen opptelling eller oppsummering av bildene.',
  'Si hva hun skal gjøre med den: lim den inn i én samtale – gjerne en ny – som fra det punktet bare er en bildegenereringsoppgave, lagre bildene som separate filer, og legg dem inn i Slaids med bildedeponeringen. Filnavnene `1`, `2`, `3` … gir rekkefølgen av seg selv; ellers ordner hun bildene selv i deponeringsdialogen.',
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
  return ' Skriv bildeplanen på nytt før briefen gis videre, slik at Slaids åpner bildedeponeringen for filene – uten den har brukeren ingen steg å legge dem inn i.'
}

/**
 * The deck's raster flow, as a state rather than as a recollection.
 *
 * Total: every deck has one, including a deck that plans no pictures, because
 * «nothing to do here» is an answer an agent needs as much as a count of four.
 *
 * The order of the branches is the design. The plan's own checks come first, so
 * a deck with picture zones waiting and no plan at all — which plans zero
 * pictures — cannot report the cheapest mistake available as a delivery. A plan
 * with files in some of its zones and not others comes next: it no longer
 * describes what it claims to, and the brief composed from it would order a
 * picture that is already in the deck.
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
      'Rett først det `issues` peker på, og skriv bildeplanen på nytt – tomme kontroller er en del av stoppkriteriet. Hent deretter den ferdige seriebriefen og gi den til brukeren i den samme arbeidsøkten.',
      [
        'Rett det `issues` peker på, og skriv bildeplanen på nytt.',
        ...(counts.awaitingFileCount > 0 ? DELIVERY_STEPS : []),
      ],
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

  if (deposited === images.length) {
    return status(
      'images-in-deck',
      true,
      `Alle ${images.length} planlagte bildesoner har fått en fil. Rasterflyten er ferdig. Slaids ser aldri selve bildet, så dette er så langt dekket kan svare: se gjennom bildene i tillegg.`,
      [],
      [],
    )
  }

  /*
   * Some zones have their picture and some do not, which is a plan that no
   * longer describes what it claims to.
   *
   * The brief is the whole plan, and the deposit expects one file per planned
   * zone — so a plan that keeps a finished zone in it orders a picture that is
   * already in the deck and asks the user for a file to overwrite it with. The
   * way out is to rewrite the plan with the zones that are actually waiting,
   * which is the same repair the deposit's own numbering needs.
   */
  if (deposited > 0) {
    return status(
      'plan-outdated',
      false,
      `${deposited} av ${images.length} planlagte bildesoner har alt en fil. Briefen bestiller hele planen, og deponeringen venter én fil per planlagt oppføring, så slik den står nå ber den om bilder dekket allerede har. Skriv bildeplanen på nytt med bare de bildesonene som fortsatt venter på en fil, og hent briefen etterpå.`,
      [
        'Skriv bildeplanen på nytt med bare de bildesonene som fortsatt venter på en fil.',
        ...DELIVERY_STEPS,
      ],
    )
  }

  return status(
    'awaiting-images',
    false,
    `Bildeplanen er i orden, og ${images.length === 1 ? 'det ene bildet' : `alle ${images.length} bildene`} mangler fortsatt. Bildeplanen er et mellomsteg, ikke leveransen: hent den ferdige seriebriefen og gi den til brukeren ordrett i denne samme arbeidsøkten, sammen med hva hun gjør med den. Bildene lages utenfor Slaids, og å legge dem inn er brukerens steg i nettleseren – det venter du aldri på.${depositNote(
      presentation,
    )}`,
    DELIVERY_STEPS,
  )
}
