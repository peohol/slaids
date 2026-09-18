import { describe, expect, it } from 'vitest'
import { SELF_CHECK_STOP } from '../../agent/design'
import {
  IMAGE_WORKFLOW_COMPLETION_CRITERIA,
  IMAGE_WORKFLOW_FORBIDDEN_CLOSINGS,
} from '../../domain/imageWorkflow'
import { MCP_INSTRUCTIONS } from './instructions'

describe('visual media planning instructions', () => {
  it('requires a deck-level visual pass before assets are produced', () => {
    expect(MCP_INSTRUCTIONS).toMatch(/på dekknivå før du produserer visuelle filer/i)
    expect(MCP_INSTRUCTIONS).toMatch(/før du lager den første visuelle filen/i)
    expect(MCP_INSTRUCTIONS).toMatch(/navngitte personer, virkelige steder, bygninger, gjenstander eller historiske scener/i)
    expect(MCP_INSTRUCTIONS).toMatch(/velg medietype ut fra hva publikum trenger å se/i)
  })

  it('does not let an easy SVG replace a useful concrete image', () => {
    expect(MCP_INSTRUCTIONS).toMatch(/et diagram er ikke en erstatning for et konkret motiv/i)
    expect(MCP_INSTRUCTIONS).toMatch(/skal ikke erstatte rasterbildet bare fordi SVG kan produseres direkte/i)
    expect(MCP_INSTRUCTIONS).toMatch(/hjemmelaget erstatning eller et abstrakt diagram/i)
  })

  it('waits for final QA, then makes host generation an observable next action', () => {
    expect(MCP_INSTRUCTIONS).toMatch(/Rasterflyten er fast, ikke en fallback/i)
    expect(MCP_INSTRUCTIONS).toMatch(/med bilder.*bruk bilder.*bilder i hvert steg/i)
    expect(MCP_INSTRUCTIONS).toMatch(/ikke start ekstern rastergenerering ennå/i)
    expect(MCP_INSTRUCTIONS).toMatch(/innholdsendringer, citations, validering\/reparasjoner og visuell QA.*bildesonene er stabile/i)
    expect(MCP_INSTRUCTIONS).toMatch(/les bildeplanen på nytt fra den endelige presentasjonstilstanden/i)
    // The printed brief is not the first step any more — the first picture is.
    expect(MCP_INSTRUCTIONS).toMatch(/kall vertsklientens bildegenereringsverktøy umiddelbart/i)
    expect(MCP_INSTRUCTIONS).toMatch(/start bildegenereringen umiddelbart med det første planlagte bildet/i)
    expect(MCP_INSTRUCTIONS).toMatch(/ett kall per planlagt bilde/i)
    expect(MCP_INSTRUCTIONS).toMatch(/bare den ene oppføringens ferdige `prompt`/i)
    expect(MCP_INSTRUCTIONS).toMatch(/At planen finnes i verktøyresponsen er ikke en overlevering/i)
    expect(MCP_INSTRUCTIONS).toMatch(/først startet når bildegenereringsverktøyet faktisk er kalt/i)
    expect(MCP_INSTRUCTIONS).toMatch(/bildeplanen etter handoff.*les bildeplanen på nytt.*generer de bildene på nytt/i)
    expect(MCP_INSTRUCTIONS).toMatch(/filbro.*bildedeponeringen/i)
    expect(MCP_INSTRUCTIONS).not.toMatch(/Mangler du en rastergenerator|har du ingen[^.]*bildegenerator/i)
    // And the retired first step is asserted gone, not left to review: it is
    // what made the task a multi-picture task before the first call.
    expect(MCP_INSTRUCTIONS).not.toMatch(/skriv den returnerte briefen ut i samme samtale/i)
    expect(MCP_INSTRUCTIONS).not.toMatch(/skriv denne ferske briefen ut i samme samtale/i)
    expect(MCP_INSTRUCTIONS).not.toMatch(/ny fersk sluttbrief/i)
  })

  it('never asks for the whole plan to be written out in the conversation', () => {
    /*
     * Test 1, on the surface an agent reads before its first call. Every
     * sentence that mentions the brief has to be denying it: the brief exists,
     * an author copies it out of the editor, and a client without direct
     * handoff still delivers it — but nothing here may instruct an agent to
     * print it, because a conversation holding «lag nøyaktig 9 separate
     * bilder» has already told the generator what the task is.
     *
     * Stated as a property rather than as a banned phrase, so a reworded
     * instruction to print the brief fails here too.
     */
    const asking = MCP_INSTRUCTIONS.split(/(?<=[.:;])\s+|\n/).filter((sentence) =>
      /\bbrief/i.test(sentence),
    )
    expect(asking.length).toBeGreaterThan(0)
    for (const sentence of asking) {
      if (!/skriv|utskrift|print/i.test(sentence)) continue
      expect(sentence, `«${sentence}» ber om at briefen skrives ut`).toMatch(
        /\b(ikke|aldri)\b/i,
      )
    }
    // And what replaces it is named, including the field that says why.
    expect(MCP_INSTRUCTIONS).toMatch(
      /ikke skriv ut den samlede briefen, ikke oppsummer bildeplanen og ikke si i samtalen hvor mange bilder som skal lages/i,
    )
    expect(MCP_INSTRUCTIONS).toMatch(/`generation\.isolation`/)
  })

  it('hands the generator one job at a time, never the plan as one job', () => {
    /*
     * The regression, and then the finding that followed it. Eight planned
     * pictures, one composed brief, and a host client that sent the brief on as
     * a single image-generation job: one storyboard came back. Composing a
     * prompt per entry fixed the prompt and left the exposure — every answer
     * still carried the whole plan — so the generation step now reads one job
     * at a time and the instructions have to say that.
     */
    expect(MCP_INSTRUCTIONS).toMatch(/hent den ene bildejobben som står for tur/i)
    expect(MCP_INSTRUCTIONS).toMatch(/Slaids gir deg én jobb om gangen/i)
    expect(MCP_INSTRUCTIONS).toMatch(
      /uten de andre oppføringene, uten noe antall og uten nummer, filnavn eller sone/i,
    )
    // Both tool shapes, because the one this feature was built for derives the
    // image instruction from the conversation rather than taking a prompt.
    expect(MCP_INSTRUCTIONS).toMatch(/tar verktøyet en prompt som parameter, sendes den ordrett/i)
    expect(MCP_INSTRUCTIONS).toMatch(
      /utleder verktøyet den fra samtalen i stedet, skriver du `prompt` ordrett som din egen melding rett før kallet/i,
    )
    expect(MCP_INSTRUCTIONS).toMatch(
      /Kan du ikke begrense hva bildeverktøyet ser, si det til brukeren/i,
    )
    expect(MCP_INSTRUCTIONS).toMatch(/ikke hent flere jobber på forskudd/i)
    expect(MCP_INSTRUCTIONS).toMatch(
      /ikke les bildeplanen på nytt for å få tak i de andre motivene underveis/i,
    )
    expect(MCP_INSTRUCTIONS).toMatch(/alle disse kallene er gjort og antallet ferdige bildefiler er kontrollert/i)
    // The binding is checked per picture, and the digest is what makes the
    // check mean anything: everything else in it was in the plan already.
    expect(MCP_INSTRUCTIONS).toMatch(/for hver oppføring så snart bildet er laget/i)
    expect(MCP_INSTRUCTIONS).toMatch(/Avtrykket er ikke valgfritt/i)
    expect(MCP_INSTRUCTIONS).toMatch(/`generation-unverified`/)
    expect(MCP_INSTRUCTIONS).toMatch(/koblingen mellom hver fil og bildeplanoppføringen/i)
    // And the retired instruction — hand the brief over as the generation
    // prompt — is asserted gone rather than left to review.
    expect(MCP_INSTRUCTIONS).not.toMatch(/briefen som bildegenereringsinstruks/i)
    expect(MCP_INSTRUCTIONS).not.toMatch(/med briefen som instruks/i)
    expect(MCP_INSTRUCTIONS).not.toMatch(/bildegenereringsverktøyet med briefen/i)
  })

  it('forces explicit reassessment of a visually concrete deck with zero raster images', () => {
    expect(MCP_INSTRUCTIONS).toMatch(/0 planlagte rasterbilder/i)
    expect(MCP_INSTRUCTIONS).toMatch(/SVG var enklere å lage/i)
    expect(MCP_INSTRUCTIONS).toMatch(/felles bildekontekst uten noen planlagte rasterbilder/i)
  })

  describe('bildeplanen er et mellomsteg, ikke leveransen', () => {
    /*
     * The regression, in the plainest form it took: the user asked for an
     * illustrated talk, the agent built the deck, wrote the image plan, and
     * closed the turn with «the presentation is created, the pictures are not
     * inserted yet». Nothing was invalid and nothing was skipped — the turn
     * simply ended one step before the pictures existed.
     *
     * Everything asserted here is a sentence that makes that ending visible as
     * the failure it is, rather than as a status report.
     */

    it('sier at bildeplanen aldri er et sluttpunkt', () => {
      expect(MCP_INSTRUCTIONS).toMatch(/Bildeplanen er et mellomsteg, ikke leveransen/i)
      expect(MCP_INSTRUCTIONS).toMatch(/Bildeplanen er aldri et sluttpunkt/i)
      expect(MCP_INSTRUCTIONS).toMatch(/uten å vente på en ny brukerbeskjed/i)
      // And «same conversation» does not contradict finishing the deck first:
      // the wait is for the deck to settle, never for another user turn.
      expect(MCP_INSTRUCTIONS).toMatch(
        /«I samme samtale» betyr ikke før resten av presentasjonsarbeidet er ferdig/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(/samme sammenhengende arbeidsøkten – ikke i en ny/i)
    })

    it('gjør dekkets egen status til stoppkriteriet', () => {
      // The decision is a field, not an impression: an agent that only reads
      // structure sees `complete: false`.
      expect(MCP_INSTRUCTIONS).toMatch(
        /`complete` svarer for dokumentet – at bildene faktisk ligger i dekket – ikke for deg/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(/bare deponeringen kan gjøre den true/i)
      expect(MCP_INSTRUCTIONS).toMatch(/`workflow\.nextAction`/)
      expect(MCP_INSTRUCTIONS).toMatch(/`workflow\.remainingSteps`/)
      expect(MCP_INSTRUCTIONS).toMatch(
        /avslutt først når du har gjort det `remainingSteps` krever av deg/i,
      )
      /*
       * And never «stop when the list is empty». In `awaiting-deposit` it does
       * not go empty from anything the agent does — handing the files over is
       * not a change to the document — so that rule would be a rule to wait for
       * the user's deposit, which is the architecture boundary this whole flow
       * is about.
       */
      expect(MCP_INSTRUCTIONS).not.toMatch(
        /Avslutt først når `workflow\.remainingSteps` er tom/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(/listen blir ikke tom av det du gjør/i)
    })

    it('gjør koblingskontrollen, ikke fylte bildesoner, til genereringens stoppkriterium', () => {
      // The lifecycle the first version of this got wrong: Slaids never sees a
      // generated file, so a filled zone answers «has the file arrived», never
      // «was the picture made». An agent told to wait for filled zones waits
      // for a browser action it cannot perform — and regenerates.
      expect(MCP_INSTRUCTIONS).toMatch(
        /Kontrollen er stoppkriteriet for \*ditt\* genereringsarbeid: er hele planen dekket og svaret `ok` med `check: "file-checked"`, er den delen gjort/i,
      )
      // And what it is not: a report cannot finish the deck, because Slaids
      // has no file to compare it against.
      expect(MCP_INSTRUCTIONS).toMatch(
        /en kobling du melder er en påstand Slaids ikke kan sammenligne med noen fil/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(/`workflow\.stage` blir `awaiting-deposit`/i)
      // And the answer is a fact about the deck, not about one response: the
      // regression was `verify_image_handoff` saying «done» and the very next
      // read asking for every picture again.
      expect(MCP_INSTRUCTIONS).toMatch(/også ved senere lesninger, fordi svaret lagres på dekket/i)
      expect(MCP_INSTRUCTIONS).toMatch(/faller kontrollen bort av seg selv/i)
      // The check is stored and the files are not, so a later session that does
      // not hold them must be able to act rather than report a deck with empty
      // picture zones as finished.
      expect(MCP_INSTRUCTIONS).toMatch(
        /Filene lagres ikke: åpner du et `awaiting-deposit`-dekk uten å ha dem/i,
      )
      /*
       * What is left is not one sentence. `awaiting-deposit` covers a deck with
       * empty zones *and* a deck whose zones still show the previous pictures,
       * and `generation-verified` has no empty zone at all — so a rule that
       * always said «the picture zones are empty» would have the agent tell the
       * user something untrue in two of the states this PR just made
       * load-bearing.
       */
      expect(MCP_INSTRUCTIONS).toMatch(
        /Meld aldri et dekk ferdig uten å si hva som faktisk gjenstår/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(
        /andre viser fortsatt bildet fra forrige bestilling/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(
        /I `generation-verified` er ingen sone tom, og da skal du ikke påstå at noen er det/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(/Gjenta dekkets egen tilstand, ikke en fast setning/i)
      // The unconditional version is asserted gone.
      expect(MCP_INSTRUCTIONS).not.toMatch(
        /Meld aldri et dekk ferdig uten å si at bildesonene står tomme/i,
      )
      // And the retired definition is asserted gone rather than left to review:
      // the rule and the stages must not give the model two answers to «what
      // does a passing check leave me in».
      expect(MCP_INSTRUCTIONS).toMatch(
        /stadiet er `awaiting-deposit` så lenge bildene ikke er på plass i sonene/i,
      )
      expect(MCP_INSTRUCTIONS).not.toMatch(
        /sier `generation-verified` også ved senere lesninger/i,
      )
      expect(MCP_INSTRUCTIONS).not.toMatch(/`generation-verified` også før filene er lagt inn/i)
      expect(MCP_INSTRUCTIONS).toMatch(/tomme bildesoner er aldri stoppkriteriet/i)
      expect(MCP_INSTRUCTIONS).toMatch(
        /skal ikke genereres om igjen fordi sonen står tom/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(/brukerens steg i nettleseren med mindre klienten har en\s+filbro/i)
      // And the rule itself says the count is what Slaids is missing, never a
      // debt of pictures the agent still owes.
      expect(MCP_INSTRUCTIONS).toMatch(
        /`awaitingFileCount` er hva Slaids mangler, aldri hvor mange bilder du skylder/i,
      )
      expect(MCP_INSTRUCTIONS).not.toMatch(/pendingImageCount/)
    })

    it('navngir den obligatoriske rekkefølgen etter planen', () => {
      expect(MCP_INSTRUCTIONS).toMatch(/start bildegenereringen umiddelbart med det første planlagte bildet/i)
      expect(MCP_INSTRUCTIONS).toMatch(/ett kall per bildeoppføring med bare den oppføringens ferdige `prompt`/i)
      expect(MCP_INSTRUCTIONS).toMatch(/fortsett med én oppføring av gangen/i)
      expect(MCP_INSTRUCTIONS).toMatch(
        /Ikke skriv ut samlet brief, en oversikt over bildeplanen eller hvor mange bilder som skal lages/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(/hver generering skal se ut som en selvstendig oppgave/i)
      expect(MCP_INSTRUCTIONS).toMatch(/Slå aldri flere planlagte bilder sammen til ett bilde/i)
      expect(MCP_INSTRUCTIONS).toMatch(/rekkefølgen bildene returneres i er irrelevant/i)
      expect(MCP_INSTRUCTIONS).toMatch(/kobles til riktig oppføring før det neste genereres/i)
      // The sequence used to open with the brief, which put the whole plan in
      // the conversation before the first call.
      expect(MCP_INSTRUCTIONS).not.toMatch(/skriv ut den ferdige bildebriefen i samtalen/i)
    })

    it('lister fullføringskriteriene, alle seks', () => {
      for (const criterion of IMAGE_WORKFLOW_COMPLETION_CRITERIA) {
        expect(MCP_INSTRUCTIONS).toContain(criterion)
      }
    })

    it('forbyr de tre avslutningene arbeidsflyten faktisk endte med', () => {
      for (const closing of IMAGE_WORKFLOW_FORBIDDEN_CLOSINGS) {
        expect(MCP_INSTRUCTIONS).toContain(closing)
      }
      // And the only two legitimate stops are named, so «blocked» cannot be a
      // feeling: the user said stop, or there is a failure to point at.
      expect(MCP_INSTRUCTIONS).toMatch(/navngi blokkeringen konkret/i)
      expect(MCP_INSTRUCTIONS).toMatch(
        /brukeren uttrykkelig har bedt deg stoppe før bildene genereres/i,
      )
    })

    it('skiller de to `plan-outdated`-tilfellene, som krever motsatt handling', () => {
      /*
       * The rule used to say one thing about a planned zone that already has a
       * picture: rewrite the plan without it. That is right for a file nothing
       * accounts for, and exactly wrong for one the deck knows was made for an
       * order it has since rewritten — there the zone stays in the plan and the
       * replacement gets made. A rule that gave only the first answer could
       * send an agent to empty the plan at the very moment it should generate.
       */
      expect(MCP_INSTRUCTIONS).toMatch(/sier `workflow` `plan-outdated`/i)
      expect(MCP_INSTRUCTIONS).toMatch(/to tilfeller som krever motsatt handling/i)
      // Superseded: keep the zone, generate the replacement — and the whole
      // plan, because the check expects one file per planned entry.
      expect(MCP_INSTRUCTIONS).toMatch(/koblingskontrollen svarer `PLAN_CHANGED`/i)
      expect(MCP_INSTRUCTIONS).toMatch(/skal sonen bli stående i planen og erstatningen genereres/i)
      expect(MCP_INSTRUCTIONS).toMatch(/også for soner som alt har et bilde/i)
      // Unknown provenance: rewrite the plan with only what still waits.
      expect(MCP_INSTRUCTIONS).toMatch(/ingen kobling som gjør rede for filen, er proveniensen ukjent/i)
      expect(MCP_INSTRUCTIONS).toMatch(/bare sonene som fortsatt venter/i)
      // And the deck decides which, not the agent's guess.
      expect(MCP_INSTRUCTIONS).toMatch(/Følg `nextAction`, ikke gjetningen/i)
      // The one-answer version is asserted gone.
      expect(MCP_INSTRUCTIONS).not.toMatch(
        /Bildeplanen skal beskrive nøyaktig de bildesonene som venter på en fil/i,
      )
    })

    it('utløses av planlagte bildesoner, ikke bare av ordet «bilder»', () => {
      // The earlier wording made the mandate conditional on how the user had
      // phrased the order, which is the one input an agent can talk itself out
      // of. Planned picture zones are the trigger.
      expect(MCP_INSTRUCTIONS).toMatch(/Har dekket planlagte rasterbilder, skal de genereres/i)
      expect(MCP_INSTRUCTIONS).toMatch(/planlagte bildesoner er i seg selv nok/i)
      expect(MCP_INSTRUCTIONS).toMatch(/den skal vente, ikke utgå/i)
    })

    it('lar ikke `complete` alene avslutte arbeidet', () => {
      /*
       * `complete` answers for the document — the plan is covered by a current,
       * verified generation — and the bindings are stored while the files are
       * not. So the same true field is read by two readers who owe opposite
       * work: the conversation that holds the pictures, and a later one that
       * opens the deck with none of them. A stop rule keyed on `complete`
       * alone told the second one it was finished, in the same instructions
       * that tell it to generate the pictures again.
       */
      expect(MCP_INSTRUCTIONS).toMatch(
        /du har gjort det `workflow\.remainingSteps` krever av deg, er \*\*ditt\*\* arbeid ferdig/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(
        /Det er `remainingSteps` som avgjør det, ikke `complete` alene/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(/`complete` er en påstand om dokumentet/i)
      // Both readers are named, each with the condition that selects them.
      expect(MCP_INSTRUCTIONS).toMatch(
        /har du bildefilene fra genereringen.*skal du ikke si at presentasjonen er ferdig/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(
        /Har du dem ikke.*da gjenstår det agentarbeid, og du genererer de samme oppføringene på nytt/i,
      )
      // The two translations that read `complete` as a finishing line are gone.
      expect(MCP_INSTRUCTIONS).not.toMatch(
        /rasterflyten er gjennomført – `workflow\.complete` er true – er presentasjonen ferdig/i,
      )
      expect(MCP_INSTRUCTIONS).not.toMatch(
        /`workflow\.complete` er true, er \*\*ditt\*\* arbeid ferdig/i,
      )
      expect(MCP_INSTRUCTIONS).not.toMatch(
        /avslutt først når `workflow\.complete` er true/i,
      )
    })

    it('henger genereringssekvensen på stadiet som krever den, ikke på `complete: false`', () => {
      /*
       * The enumeration — print the brief, start generating, one call per entry
       * — belongs to a deck that owes pictures *now*. Two earlier versions
       * attached it to the wrong thing. A sentence about the empty list placed
       * just before it turned «Da gjør du dette i tur» into «when nothing is
       * left, generate», the opposite of the two stages where the list is
       * empty. Keying it on `complete: false` was wrong the other way:
       * `plan-needs-repair` and both `plan-outdated` variants are also
       * `complete: false`, and there the plan has to be repaired or rewritten
       * before a brief means anything — a deck with plan issues would have been
       * generated from an invalid plan.
       */
      expect(MCP_INSTRUCTIONS).toMatch(
        /Hva som skal gjøres nå, sier alltid `nextAction` og `remainingSteps`/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(
        /`complete: false` i seg selv er ikke et signal om å generere/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(
        /stadiet kan være `plan-needs-repair` eller `plan-outdated`, og da skal planen repareres eller skrives om \*\*før\*\* noe genereres/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(
        /Krever statusen generering – `awaiting-generation`, eller superseded-varianten av `plan-outdated`.*gjør du dette i tur: start bildegenereringen umiddelbart med det første planlagte bildet/i,
      )
      /*
       * And the rule's own opening must not say the opposite either. «Så snart
       * dekket har planlagte rasterbilder, er neste steg bildegenereringen» is
       * false in exactly the two stages this test is about: a deck can have
       * planned pictures *and* be `plan-needs-repair`, or `plan-outdated` with
       * unknown provenance, where the plan has to be put right first.
       */
      expect(MCP_INSTRUCTIONS).toMatch(
        /hva som er neste handling, sier alltid `workflow\.nextAction` og `workflow\.stage`/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(
        /Er stadiet `plan-needs-repair` eller `plan-outdated`, skal planen først bringes i orden/i,
      )
      expect(MCP_INSTRUCTIONS).not.toMatch(
        /så snart dekket har planlagte rasterbilder, er neste steg bildegenereringen/i,
      )
      // Both retired attachments are asserted gone.
      expect(MCP_INSTRUCTIONS).not.toMatch(
        /er den tom, gjenstår det ingenting for deg\. Da gjør du dette i tur/i,
      )
      expect(MCP_INSTRUCTIONS).not.toMatch(
        /Er `complete` false, gjør du dette i tur/i,
      )
    })

    it('slutter aldri med at en tom kontrolliste er ferdig arbeid', () => {
      expect(MCP_INSTRUCTIONS).not.toMatch(/er listen tom, er bildeplanen ferdig/i)
      expect(SELF_CHECK_STOP).toMatch(
        /du har gjort det `workflow\.remainingSteps` krever av deg/i,
      )
      expect(SELF_CHECK_STOP).not.toMatch(/`workflow\.remainingSteps` er tom, er \*\*ditt\*\*/i)
      expect(SELF_CHECK_STOP).not.toMatch(/overleveringer i rasterflyten er startet/i)
      expect(SELF_CHECK_STOP).not.toMatch(/er true – er presentasjonen ferdig/i)
      expect(SELF_CHECK_STOP).not.toMatch(/`complete` sier at agenten er ferdig/i)
    })
  })
})
