/**
 * Å dra en delestrek mellom to delfelt inni et kort eller en beholder.
 *
 * Det er grensedraget mellom to soner (`ratioDrag.ts`), ett nivå lenger inn,
 * og bare de delene av det som gir mening her: et delfelt kan ikke flyttes,
 * komprimeres eller få luft ved siden av seg – det deler bare kortets
 * innholdsflate med naboene sine. Så det som gjenbrukes er
 *
 *  - **grensedraget** (`draggedWeights`): de to feltene på hver side av streken
 *    bytter lengde, resten står stille;
 *  - **Shift** (`shiftedBoundaryWeights`): alt før streken er én blokk og alt
 *    etter en annen, og bare forholdet mellom blokkene endres;
 *  - **trinnene**: draget vises og lagres som hele forholdstall 1–10, valgt med
 *    de samme reglene og i samme rekkefølge som et sonedrag
 *    (`boundarySnapRules`, `shiftedBoundarySnapRules`, `snapCandidates`);
 *  - **den myke grensen**: magneten og valget av inngang i `softLimitDrag.ts`
 *    bruker scenen direkte, siden de bare regner på lengder.
 *
 * Lengdene er i delfeltenes egen layout, slik nettleseren har lagt dem ut –
 * også når sonen tegnes forminsket. Alt her er rene funksjoner av tilstanden
 * draget startet i, så et langt drag ikke samler opp avrundingsfeil, og så det
 * kan testes slik det utføres.
 */

import type { Axis } from '../../domain/types'
import {
  boundarySnapRules,
  draggedWeights,
  shiftedBoundarySnapRules,
  shiftedBoundaryWeights,
  snapCandidates,
} from './ratioDrag'

/** Et pågående drag av delestreken etter delfelt `boundary`. */
export interface SubfieldDrag {
  /** Delestreken etter delfeltet med denne indeksen. */
  boundary: number
  axis: Axis
  /** Forholdstallene slik de er lagret før draget. */
  weights: readonly number[]
  /** Hvert delfelts lengde langs aksen da draget startet. */
  lengths: readonly number[]
  /** Det korteste hvert delfelt kan dras til, i samme enhet som `lengths`. */
  floors: readonly number[]
}

/**
 * Start et drag. `floor` er gulvet for et delfelt (`minimumSubfieldLength`);
 * et felt som allerede er kortere enn det, får sin egen lengde som gulv, så
 * det aldri hopper opp i det øyeblikket draget begynner.
 */
export function startSubfieldDrag(input: {
  boundary: number
  axis: Axis
  weights: readonly number[]
  lengths: readonly number[]
  floor: number
}): SubfieldDrag | null {
  const { boundary, axis, weights, lengths, floor } = input
  if (lengths.length !== weights.length || boundary < 0 || boundary >= lengths.length - 1) return null
  if (!lengths.every((length) => Number.isFinite(length) && length > 0)) return null
  return {
    boundary,
    axis,
    weights: [...weights],
    lengths: [...lengths],
    floors: lengths.map((length) => Math.min(Math.max(0, floor), length)),
  }
}

/**
 * Lengdene når pekeren har gått `amount` langs aksen fra der draget startet,
 * eller `null` når ingen lovlig inndeling svarer til det. Med Shift skaleres
 * de to blokkene på hver side av streken mot hverandre.
 */
export function subfieldLengthsAt(drag: SubfieldDrag, amount: number, shift: boolean): number[] | null {
  return shift
    ? shiftedBoundaryWeights(drag.lengths, drag.boundary, amount, drag.floors)
    : draggedWeights(drag.lengths, drag.boundary, amount, drag.floors)
}

/**
 * De hele forholdstallene et slipp ved `released` kan lagre, nærmest først.
 *
 * Shift lover at begge blokkene beholder sine indre proporsjoner, og det kan
 * bare holdes når forholdstallene draget startet fra er hele tall. Et kort
 * med desimaler skrevet inn for hånd faller tilbake til det vanlige
 * grensedragets trinn i stedet for å gjøre streken død.
 */
export function subfieldSnapCandidates(
  drag: SubfieldDrag,
  released: readonly number[],
  shift: boolean,
): number[][] {
  const plain = (): number[][] => {
    const rules = boundarySnapRules(drag.weights, drag.boundary)
    return snapCandidates(rules.equalityKeys, released, rules.preference)
  }
  if (!shift) return plain()
  const rules = shiftedBoundarySnapRules(drag.weights, drag.boundary, released)
  const kept = snapCandidates(rules.equalityKeys, released, rules.preference)
  return kept.length > 0 ? kept : plain()
}

/** Om to sett forholdstall beskriver samme inndeling: `1 : 2` og `2 : 4` gjør det. */
export function sameProportions(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  const totalA = a.reduce((sum, weight) => sum + weight, 0)
  const totalB = b.reduce((sum, weight) => sum + weight, 0)
  return a.every((weight, index) => Math.abs(weight * totalB - b[index] * totalA) <= 1e-9 * totalA * totalB)
}

/** Lengdene `weights` gir delfeltene, i samme enhet og samme total som da draget startet. */
export function lengthsFor(drag: SubfieldDrag, weights: readonly number[]): number[] {
  const room = drag.lengths.reduce((sum, length) => sum + length, 0)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return weights.map((weight) => (room * weight) / total)
}

/** Hvor langt en lengde kan ligge under gulvet og fortsatt regnes som på det. */
const FLOOR_TOLERANCE = 1e-6

/**
 * Forholdstallene sliden skal vise mens pekeren står ved `released` – trinnet
 * slippet ville lagret – eller `null` når slippet ikke lagrer noe.
 *
 * Som for et sonedrag (`shownFor`) er det nærmeste trinnet `accepts` godtar,
 * altså den samme kommandoen slippet kjører. Et trinn som tar et delfelt under
 * gulvet sitt, hoppes over. Er det nærmeste trinnet inndelingen draget startet
 * fra, vises den, og slippet lagrer ingenting.
 */
export function shownSubfieldWeights(
  drag: SubfieldDrag,
  released: readonly number[],
  shift: boolean,
  accepts: (weights: number[]) => boolean,
): number[] | null {
  for (const weights of subfieldSnapCandidates(drag, released, shift)) {
    if (sameProportions(weights, drag.weights)) return null
    const lengths = lengthsFor(drag, weights)
    if (lengths.some((length, index) => length < drag.floors[index] - FLOOR_TOLERANCE)) continue
    if (accepts(weights)) return weights
  }
  return null
}
