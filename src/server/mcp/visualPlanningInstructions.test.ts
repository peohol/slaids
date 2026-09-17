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
    expect(MCP_INSTRUCTIONS).toMatch(/hent den genererte bildebriefen på nytt fra den endelige presentasjonstilstanden/i)
    expect(MCP_INSTRUCTIONS).toMatch(/skriv den returnerte briefen ut i samme samtale/i)
    expect(MCP_INSTRUCTIONS).toMatch(/kall deretter umiddelbart.*bildegenereringsverktøyet/i)
    expect(MCP_INSTRUCTIONS).toMatch(/ett kall per planlagt bilde/i)
    expect(MCP_INSTRUCTIONS).toMatch(/briefen finnes i verktøyresponsen er ikke en overlevering/i)
    expect(MCP_INSTRUCTIONS).toMatch(/først startet når bildegenereringsverktøyet faktisk er kalt/i)
    expect(MCP_INSTRUCTIONS).toMatch(/bildeplanen etter handoff.*ny fersk sluttbrief.*på nytt/i)
    expect(MCP_INSTRUCTIONS).toMatch(/filbro.*bildedeponeringen/i)
    expect(MCP_INSTRUCTIONS).not.toMatch(/Mangler du en rastergenerator|har du ingen[^.]*bildegenerator/i)
  })

  it('hands the generator one planned picture at a time, never the whole brief as one job', () => {
    // The regression: eight planned pictures, one composed brief, and a host
    // client that sent the brief on as a single image-generation job. One
    // storyboard came back. The instructions must not read as advice to do
    // that — the brief is printed in the conversation, and the generation runs
    // per entry.
    expect(MCP_INSTRUCTIONS).toMatch(/ett kall per oppføring i `images`/i)
    expect(MCP_INSTRUCTIONS).toMatch(/generation\.expectedFileCount.*før bildene deponeres/i)
    expect(MCP_INSTRUCTIONS).toMatch(/alle disse kallene er gjort og antallet ferdige bildefiler er kontrollert/i)
    // One entry finished at a time, and the count is not the only thing
    // checked: the second failure was nine correct pictures named in the order
    // they came back, which a count cannot see.
    expect(MCP_INSTRUCTIONS).toMatch(/én oppføring ferdigstilt av gangen/i)
    expect(MCP_INSTRUCTIONS).toMatch(/hver fil er knyttet til den `imagePlanItemId` den ble generert fra/i)
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
      expect(MCP_INSTRUCTIONS).toMatch(/Er `workflow\.complete` false, er det ikke ferdig/i)
      expect(MCP_INSTRUCTIONS).toMatch(/`workflow\.nextAction`/)
      expect(MCP_INSTRUCTIONS).toMatch(/`workflow\.remainingSteps`/)
      expect(MCP_INSTRUCTIONS).toMatch(/avslutt først når `workflow\.complete` er true/i)
    })

    it('gjør koblingskontrollen, ikke fylte bildesoner, til genereringens stoppkriterium', () => {
      // The lifecycle the first version of this got wrong: Slaids never sees a
      // generated file, so a filled zone answers «has the file arrived», never
      // «was the picture made». An agent told to wait for filled zones waits
      // for a browser action it cannot perform — and regenerates.
      expect(MCP_INSTRUCTIONS).toMatch(
        /Den er stoppkriteriet for bildegenereringen: svarer den `ok`, er genereringsoppgaven ferdig/i,
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
      expect(MCP_INSTRUCTIONS).toMatch(/skriv ut den ferdige bildebriefen i samtalen/i)
      expect(MCP_INSTRUCTIONS).toMatch(/start bildegenereringen umiddelbart/i)
      expect(MCP_INSTRUCTIONS).toMatch(/ett kall per bildeoppføring/i)
      expect(MCP_INSTRUCTIONS).toMatch(/Slå aldri flere planlagte bilder sammen til ett bilde/i)
      expect(MCP_INSTRUCTIONS).toMatch(/rekkefølgen bildene returneres i er irrelevant/i)
      expect(MCP_INSTRUCTIONS).toMatch(/kobles til riktig oppføring før det neste genereres/i)
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
      expect(MCP_INSTRUCTIONS).toMatch(/brukeren uttrykkelig har bedt deg stoppe etter briefen/i)
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

    it('skiller agentens arbeid fra at dekket er ferdig', () => {
      /*
       * `complete: true` means the *agent* has nothing left, and the acceptance
       * state of this whole PR — handoff verified, nothing deposited — is
       * `awaiting-deposit` with `complete: true` and every picture zone still
       * empty. A stop rule that translated any `complete: true` into «the
       * presentation is finished» would therefore contradict, in the same
       * instructions, the rule that says never to report a deck finished
       * without saying what is missing.
       */
      expect(MCP_INSTRUCTIONS).toMatch(/`workflow\.complete` er true, er \*\*ditt\*\* arbeid ferdig/i)
      expect(MCP_INSTRUCTIONS).toMatch(
        /`complete` sier at agenten er ferdig, ikke at dekket er det/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(
        /faller bare sammen i `no-planned-images` og `generation-verified`/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(
        /Er stadiet `awaiting-deposit`.*skal du ikke si at presentasjonen er ferdig/i,
      )
      // The unconditional translation is asserted gone.
      expect(MCP_INSTRUCTIONS).not.toMatch(
        /rasterflyten er gjennomført – `workflow\.complete` er true – er presentasjonen ferdig/i,
      )
    })

    it('slutter aldri med at en tom kontrolliste er ferdig arbeid', () => {
      expect(MCP_INSTRUCTIONS).not.toMatch(/er listen tom, er bildeplanen ferdig/i)
      expect(SELF_CHECK_STOP).toMatch(/`workflow\.complete` er true/i)
      expect(SELF_CHECK_STOP).not.toMatch(/overleveringer i rasterflyten er startet/i)
      expect(SELF_CHECK_STOP).not.toMatch(/er true – er presentasjonen ferdig/i)
    })
  })
})
