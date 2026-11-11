/**
 * Det en person gjør i editoren: aldri avvist fordi innholdet ikke får plass.
 *
 * Hver kommando kan måle om innholdet fortsatt får plass i normal størrelse
 * (`guardFit` og plasseringskontrollene), og gjør det når den får fit-sjekkene
 * (`StructuralOptions.fits` / `fitsTitle`). En agent får dem alltid
 * (`agent/presentation.ts`, `structuralOptions`), og det er regelen agenten
 * jobber under: en endring som gjør at tekst ikke lenger får plass i normal
 * størrelse, avvises. Slik kan ikke en agent fylle soner med tekst uten å se
 * hvordan det blir seende ut.
 *
 * En person som redigerer, ser resultatet mens det skjer, og skal aldri
 * nektes en endring fordi teksten blir for stor for plassen – enten det er et
 * sonedrag, et nytt tema (font, luft, skriftstørrelse), innhold plassert fra
 * sandkassen, en ny deling, en lengre tittel eller noe annet. Innhold som ikke
 * får plass i normal størrelse, tegnes mindre i stedet (`ui/slide/ZoneFitBox.tsx`
 * for soner, `ui/slide/titleFit.ts` for tittellinjer), og editoren merker hvert
 * felt som er forminsket. Ingenting skjules.
 *
 * Hva denne modulen er, nøyaktig:
 *
 *  - `HUMAN_EDIT`: valgene hver kommando en person utløser kjøres med – uten
 *    fit-sjekker. Alt annet gjelder fortsatt: den harde minstestørrelsen for
 *    hver innholdstype (`ZONE_TOO_SMALL` – der innholdet ikke kan tegnes i det
 *    hele tatt), kvantisering, trestruktur og luftregelen.
 *  - Tre geometrikommandoer for drag og størrelsesknapper, bygd felt for felt
 *    så ingen sjekk kan følge med: `setSplitWeightsByHand`,
 *    `rearrangeZonesByHand` og `setBodyWeightsByHand`.
 *  - **Aldri tilgjengelig for en agent.** Modulen eksporteres ikke fra
 *    kommandoindeksen, og `manualLayout.boundary.test.ts` feiler hvis noe
 *    utenfor appens grensesnitt importerer den. Det finnes ingen API-parameter
 *    som gjør det samme, og det skal aldri finnes en.
 */

import type { GeometryOptions } from '../geometry'
import type { Result } from '../result'
import type { LayoutNode, NodeId, Presentation } from '../types'
import { rearrangeZones } from './arrangement'
import { setBodyWeights } from './content'
import { setSplitWeights } from './layout'
import type { StructuralOptions, StructuralOutcome } from './types'

/**
 * Det en persons kommando i editoren kjøres med: ingen fit-sjekker, så tekst
 * som ikke lenger får plass i normal størrelse tegnes mindre i stedet for at
 * endringen avvises. Frosset, så ingen kan legge en sjekk inn i den ved et uhell.
 */
export const HUMAN_EDIT: Readonly<StructuralOptions> = Object.freeze({})

/** What a hand-made geometry change may say about how it is measured: only the geometry. */
export interface ManualLayoutOptions {
  geometry?: GeometryOptions
}

function geometryOnly(options: ManualLayoutOptions): ManualLayoutOptions {
  return options.geometry ? { geometry: options.geometry } : {}
}

/**
 * `setSplitWeights`, for a ratio a person dragged or stepped to. Refused for
 * everything the command refuses but content that no longer fits at normal
 * size.
 */
export function setSplitWeightsByHand(
  presentation: Presentation,
  input: { slideId: string; nodeId: NodeId; weights: number[] } & ManualLayoutOptions,
): Result<StructuralOutcome> {
  return setSplitWeights(presentation, {
    slideId: input.slideId,
    nodeId: input.nodeId,
    weights: input.weights,
    ...geometryOnly(input),
  })
}

/**
 * `rearrangeZones`, for a layout a person's drag stepped to — air added,
 * grown or used up. Refused for everything the command refuses but content
 * that no longer fits at normal size.
 */
export function rearrangeZonesByHand(
  presentation: Presentation,
  input: { slideId: string; nodeId: NodeId; layout: LayoutNode } & ManualLayoutOptions,
): Result<StructuralOutcome> {
  return rearrangeZones(presentation, {
    slideId: input.slideId,
    nodeId: input.nodeId,
    layout: input.layout,
    ...geometryOnly(input),
  })
}

/**
 * `setBodyWeights` for forholdstallene en person drar en delestrek til, eller
 * skriver inn, inni et kort eller en beholder. Avvises for alt kommandoen
 * avviser, bortsett fra tekst som ikke lenger får plass i normal størrelse –
 * den tegnes mindre (`ui/slide/ZoneFitBox.tsx`), slik den gjør når en sone
 * dras for liten.
 */
export function setBodyWeightsByHand(
  presentation: Presentation,
  input: { slideId: string; nodeId: NodeId; weights: number[] },
): Result<Presentation> {
  return setBodyWeights(presentation, {
    slideId: input.slideId,
    nodeId: input.nodeId,
    weights: input.weights,
  })
}
