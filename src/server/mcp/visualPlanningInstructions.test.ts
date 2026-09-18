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
    expect(MCP_INSTRUCTIONS).toMatch(
      /navngitte personer, virkelige steder, bygninger, gjenstander eller historiske scener/i,
    )
    expect(MCP_INSTRUCTIONS).toMatch(/velg medietype ut fra hva publikum trenger å se/i)
  })

  it('does not let an easy SVG replace a useful concrete image', () => {
    expect(MCP_INSTRUCTIONS).toMatch(/et diagram er ikke en erstatning for et konkret motiv/i)
    expect(MCP_INSTRUCTIONS).toMatch(
      /skal ikke erstatte rasterbildet bare fordi SVG kan produseres direkte/i,
    )
    expect(MCP_INSTRUCTIONS).toMatch(/hjemmelaget erstatning eller et abstrakt diagram/i)
  })

  it('waits for final QA, then makes the brief the observable next action', () => {
    expect(MCP_INSTRUCTIONS).toMatch(/Rasterflyten er fast, ikke en fallback/i)
    expect(MCP_INSTRUCTIONS).toMatch(/med bilder.*bruk bilder.*bilder i hvert steg/i)
    expect(MCP_INSTRUCTIONS).toMatch(/ikke gi briefen videre ennå/i)
    expect(MCP_INSTRUCTIONS).toMatch(
      /innholdsendringer, citations, validering\/reparasjoner og visuell QA.*bildesonene er stabile/i,
    )
    expect(MCP_INSTRUCTIONS).toMatch(/les bildeplanen på nytt fra den endelige presentasjonstilstanden/i)
    // The deliverable is a text handed to the user, and handing it over is an
    // observable act — not «the plan is in the tool response».
    expect(MCP_INSTRUCTIONS).toMatch(/Gi brukeren `brief` ordrett/i)
    expect(MCP_INSTRUCTIONS).toMatch(/én sammenhengende tekst hun kan kopiere/i)
    expect(MCP_INSTRUCTIONS).toMatch(
      /At planen finnes i verktøyresponsen er ikke en overlevering/i,
    )
    expect(MCP_INSTRUCTIONS).toMatch(/leveransen er først gjort når briefen faktisk står i svaret/i)
  })

  it('makes it one image task producing N files, never N tasks with work between them', () => {
    /*
     * The distinction the whole flow turns on. The loop this replaces — fetch a
     * job, generate, report, fetch the next — is precisely «N tasks with other
     * work between them», and a host client's image tool did not survive it.
     */
    expect(MCP_INSTRUCTIONS).toMatch(
      /Hele bildeserien bestilles én gang, som N separate filer/i,
    )
    expect(MCP_INSTRUCTIONS).toMatch(
      /én bildeoppgave som produserer N separate bilder er det som fungerer/i,
    )
    expect(MCP_INSTRUCTIONS).toMatch(
      /N bildeoppgaver med annet arbeid mellom seg ikke gjør det/i,
    )
    expect(MCP_INSTRUCTIONS).toMatch(/Du genererer ingen bilder selv/i)
    expect(MCP_INSTRUCTIONS).toMatch(/kaller ingen bildegenerator/i)
  })

  it('leaves no trace of the per-picture loop on the surface an agent reads', () => {
    // A surface that still names a job queue, a binding check, a manifest or a
    // digest is a surface that invites an agent back into the loop.
    expect(MCP_INSTRUCTIONS).not.toMatch(/get_next_image_job|verify_image_handoff/)
    expect(MCP_INSTRUCTIONS).not.toMatch(/imagePlanItemId|contentHash|slaids-bilder\.json/)
    expect(MCP_INSTRUCTIONS).not.toMatch(/koblingskontroll/i)
    expect(MCP_INSTRUCTIONS).not.toMatch(/bildejobb/i)
    expect(MCP_INSTRUCTIONS).not.toMatch(/ett kall per planlagt bilde|én jobb om gangen/i)
    expect(MCP_INSTRUCTIONS).not.toMatch(/awaiting-generation|awaiting-deposit|all-reported/)
    expect(MCP_INSTRUCTIONS).not.toMatch(/SHA-256|avtrykk/i)
  })

  it('says how the files get into the deck, and whose step that is', () => {
    expect(MCP_INSTRUCTIONS).toMatch(/bildedeponeringen/i)
    expect(MCP_INSTRUCTIONS).toMatch(/`1`, `2`, `3`/)
    expect(MCP_INSTRUCTIONS).toMatch(/ordner hun bildene selv i deponeringsdialogen/i)
    expect(MCP_INSTRUCTIONS).toMatch(/venter aldri på deponeringen/i)
    expect(MCP_INSTRUCTIONS).toMatch(/Slaids ser aldri bildene/i)
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
     * simply ended one step before the pictures were ordered.
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
    })

    it('gjør dekkets egen status til stoppkriteriet', () => {
      // The decision is a field, not an impression: an agent that only reads
      // structure sees `complete: false`.
      expect(MCP_INSTRUCTIONS).toMatch(
        /`complete` svarer for \*\*dokumentet\*\* – at bildene faktisk ligger i dekket/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(/bare sann av at brukeren deponerer filene/i)
      expect(MCP_INSTRUCTIONS).toMatch(/`workflow\.nextAction`/)
      expect(MCP_INSTRUCTIONS).toMatch(/`workflow\.remainingSteps`/)
      expect(MCP_INSTRUCTIONS).toMatch(
        /avslutt først når du har gjort det `remainingSteps` krever av deg/i,
      )
      /*
       * And never «stop when the list is empty»: it does not go empty from
       * anything the agent does — handing the brief over is not a change to the
       * document — so that rule would be a rule to wait for the user's deposit,
       * which is the architecture boundary this whole flow is about.
       */
      expect(MCP_INSTRUCTIONS).not.toMatch(/Avslutt først når `workflow\.remainingSteps` er tom/i)
      expect(MCP_INSTRUCTIONS).toMatch(/den blir ikke tom av noe du gjør/i)
    })

    it('navngir hva stadiene krever, og hvilket som er reparasjon', () => {
      expect(MCP_INSTRUCTIONS).toMatch(/`plan-needs-repair`/)
      expect(MCP_INSTRUCTIONS).toMatch(/`plan-outdated`/)
      expect(MCP_INSTRUCTIONS).toMatch(/`awaiting-images`/)
      // A planned zone that already has a file is a plan to rewrite, because
      // the brief orders the whole plan.
      expect(MCP_INSTRUCTIONS).toMatch(/bare de sonene som fortsatt venter/i)
      expect(MCP_INSTRUCTIONS).toMatch(/bestiller briefen bilder dekket allerede har/i)
    })

    it('lister fullføringskriteriene, alle sammen', () => {
      for (const criterion of IMAGE_WORKFLOW_COMPLETION_CRITERIA) {
        expect(MCP_INSTRUCTIONS).toContain(criterion)
      }
    })

    it('forbyr avslutningene arbeidsflyten faktisk endte med', () => {
      for (const closing of IMAGE_WORKFLOW_FORBIDDEN_CLOSINGS) {
        expect(MCP_INSTRUCTIONS).toContain(closing)
      }
      // And a block has to be nameable, so «blocked» cannot be a feeling.
      expect(MCP_INSTRUCTIONS).toMatch(/navngi blokkeringen konkret/i)
    })

    it('sier aldri at bildene er laget, generert eller kontrollert', () => {
      // Slaids never sees a picture and stores no claim that one exists, so an
      // instruction that let an agent say otherwise would be the one thing the
      // whole model is built to prevent.
      expect(MCP_INSTRUCTIONS).toMatch(
        /si at briefen er klar, aldri at bildene er laget eller kontrollert/i,
      )
      expect(MCP_INSTRUCTIONS).toMatch(/Slaids ser aldri et generert bilde/i)
      expect(MCP_INSTRUCTIONS).toMatch(/lagrer ingen påstand om at ett finnes/i)
    })

    it('slutter aldri med at en tom kontrolliste er ferdig arbeid', () => {
      expect(MCP_INSTRUCTIONS).not.toMatch(/er listen tom, er bildeplanen ferdig/i)
      expect(SELF_CHECK_STOP).toMatch(/du har gjort det `workflow\.remainingSteps` krever av deg/i)
      expect(SELF_CHECK_STOP).toMatch(/`awaiting-images`/)
      expect(SELF_CHECK_STOP).not.toMatch(/`complete` sier at agenten er ferdig/i)
    })
  })
})
