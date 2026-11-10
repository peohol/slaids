/**
 * The one way a zone may become smaller than its content needs: by hand.
 *
 * Every layout command refuses a change that leaves content showing less of
 * itself than it did (`guardFit`). That is the rule an agent works under, and
 * it stays the rule: an agent asked to shrink a zone past the size its text
 * fits in at normal type is refused, whatever it calls. A person dragging a
 * zone is doing something else — arranging a slide by eye — and for that the
 * same rule is a wall in the middle of the gesture. So a person's resize may
 * go below the content's **soft** minimum, where the text fits at normal size,
 * down to its **hard** minimum, where the kind of content can still be drawn
 * at all (see `domain/softSize.ts`). In between, the renderer draws the
 * content smaller rather than hiding any of it, and the editor marks the zone.
 *
 * What this module is, exactly:
 *
 *  - The **same** commands an agent's call runs — `setSplitWeights` and
 *    `rearrangeZones` — with the same quantisation, the same tree validation,
 *    the same hard minimum per zone (`ZONE_TOO_SMALL`), the same air rule
 *    (`NEGATIVE_SPACE_CANNOT_MERGE`). The one thing left out is the content
 *    checker, which is how a command is told not to run the fit regression
 *    (`StructuralOptions`). Nothing in those commands was loosened to make this
 *    possible.
 *  - Narrow by construction. The inputs are built field by field rather than
 *    spread, so no checker, flag or option can ride along, and only geometry
 *    commands are here: nothing that places, converts or edits content.
 *  - Én temakommando, av samme grunn: hvordan et kort med tittel tegnes og
 *    om bokser kaster skygge (`setCardLookByHand`). En skygge er bare maling
 *    og skjuler ingenting; et tittelutseende kan gi innholdet mindre plass, og
 *    en person som bytter utseende velger et uttrykk, så det som ikke lenger
 *    får plass i normal størrelse tegnes mindre i stedet for at byttet
 *    avvises. Agentens `set_theme` måler fortsatt dekket og avviser.
 *  - Delingen inni et kort eller en beholder (`setBodyWeightsByHand`): en
 *    delestrek en person drar, er det samme som en sonegrense en person drar,
 *    bare ett nivå lenger inn.
 *  - **Never reachable from an agent.** It is not re-exported from the command
 *    index, and `manualLayout.boundary.test.ts` fails if anything outside the
 *    editor UI imports it. There is no API parameter that does what this does,
 *    and there must never be one.
 */

import type { GeometryOptions } from '../geometry'
import type { Result } from '../result'
import type { LayoutNode, NodeId, Presentation, PresentationTheme } from '../types'
import { rearrangeZones } from './arrangement'
import { setBodyWeights } from './content'
import { setSplitWeights } from './layout'
import { setTheme } from './slides'
import type { StructuralOutcome } from './types'

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

/**
 * `setTheme` for de to utseendevalgene en person tar i temadialogen. Bare de
 * to feltene sendes videre, og ingen fit-sjekk: geometrien kontrolleres
 * fortsatt (`findGeometryRegression`), og den kan ingen av valgene feile,
 * fordi hvor lite et kort kan være ikke avhenger av dem
 * (`ThemeMetrics.cardBodyOffset`).
 */
export function setCardLookByHand(
  presentation: Presentation,
  input: Partial<Pick<PresentationTheme, 'boxShadows' | 'titledCardStyle'>>,
): Result<Presentation> {
  return setTheme(presentation, {
    ...(input.boxShadows === undefined ? {} : { boxShadows: input.boxShadows }),
    ...(input.titledCardStyle === undefined ? {} : { titledCardStyle: input.titledCardStyle }),
  })
}
