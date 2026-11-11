/**
 * Ta i bruk en fil som er lagret under den åpne presentasjonen – eller ta den
 * tilbake når det ikke går.
 *
 * Å lagre en fil tar tid, og mens det pågår kan personen gå til en annen
 * presentasjon. Filen ble lagret under presentasjonen som var åpen da arbeidet
 * startet, så den tas bare i bruk hvis den samme presentasjonen fortsatt er
 * åpen. Ellers – og når kommandoen avvises – slettes filen igjen, så ingenting
 * blir liggende uten at noe peker på det. En fil presentasjonen allerede hadde
 * (`reused`), slettes aldri: den kan stå på en slide.
 *
 * Filen registreres og kommandoen kjøres i ett steg, så én angring tar begge.
 * Brukes av logoopplastingen og av temamalene.
 */

import { registerAsset } from '../../domain/commands'
import type { Result } from '../../domain/result'
import type { AssetRef, Presentation } from '../../domain/types'
import type { UploadedAsset, discardUploadedAssets } from '../../state/assetUpload'
import type { useEditorStore } from '../../state/store'
import { notify } from '../../state/toast'

export interface PlacementDependencies {
  store: Pick<typeof useEditorStore, 'getState'>
  discard: typeof discardUploadedAssets
}

export type PlacementOutcome = 'set' | 'refused' | 'moved-on'

/** Id-ene til filene som ble skrevet nå, og som derfor kan tas tilbake. */
export function writtenAssetIds(stored: UploadedAsset | null): string[] {
  return stored && !stored.reused ? [stored.ref.id] : []
}

export async function placeStoredAsset(
  dependencies: PlacementDependencies,
  targetId: string,
  stored: UploadedAsset | null,
  label: string,
  command: (presentation: Presentation, ref: AssetRef | null) => Result<Presentation>,
  movedOnMessage: string,
): Promise<PlacementOutcome> {
  const { store, discard } = dependencies
  const written = writtenAssetIds(stored)
  const state = store.getState()
  if (state.presentation?.id !== targetId) {
    await discard(written)
    notify.warning(movedOnMessage)
    return 'moved-on'
  }
  const placed = state.run(label, (current) => {
    if (!stored) return command(current, null)
    const registered = registerAsset(current, stored.ref)
    return registered.ok ? command(registered.value, stored.ref) : registered
  })
  if (placed) return 'set'
  // `run` har allerede sagt hvorfor; filen ingenting peker på, tas tilbake.
  await discard(written)
  return 'refused'
}
