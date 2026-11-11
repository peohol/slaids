/**
 * Last opp en fil og bruk den som logo i presentasjonen som er åpen (§ 15.2).
 *
 * Opplastingen tar tid, og personen kan gå til en annen presentasjon mens den
 * pågår. Logoen settes bare i presentasjonen filen ble lagret under, og en fil
 * som ikke blir brukt, tas tilbake (`placeStoredAsset`).
 *
 * Avhengighetene kan byttes ut, så regelen kan testes uten lager og editor.
 */

import { setThemeLogo } from '../../domain/commands'
import { HUMAN_EDIT } from '../../domain/commands/manualLayout'
import { describeError, err } from '../../domain/result'
import { describeSanitizing, discardUploadedAssets, storeUploadedFile } from '../../state/assetUpload'
import { useEditorStore } from '../../state/store'
import { notify } from '../../state/toast'
import { placeStoredAsset, type PlacementDependencies } from './placeStoredAsset'

export interface LogoUploadDependencies extends PlacementDependencies {
  storeFile: typeof storeUploadedFile
}

const DEFAULTS: LogoUploadDependencies = {
  store: useEditorStore,
  storeFile: storeUploadedFile,
  discard: discardUploadedAssets,
}

/** Hvordan det gikk: satt som logo, eller hvorfor ikke. */
export type LogoUploadOutcome = 'set' | 'refused' | 'moved-on' | 'failed'

export async function uploadThemeLogo(
  file: File,
  dependencies: LogoUploadDependencies = DEFAULTS,
): Promise<LogoUploadOutcome> {
  const { store, storeFile } = dependencies
  const target = store.getState().presentation
  if (!target) return 'moved-on'

  let stored: Awaited<ReturnType<typeof storeUploadedFile>>
  try {
    stored = await storeFile(target, file)
  } catch {
    notify.error('Logoen kunne ikke lastes opp. Sjekk nettverket og prøv igjen.')
    return 'failed'
  }
  if (!stored.ok) {
    notify.error(describeError(stored.error))
    return 'refused'
  }

  const outcome = await placeStoredAsset(
    dependencies,
    target.id,
    stored.value,
    'theme-logo',
    (current, ref) => (ref ? setThemeLogo(current, ref.id, HUMAN_EDIT) : err('ASSET_NOT_FOUND', 'Fant ikke filen.')),
    'En annen presentasjon ble åpnet før logoen var lastet opp, så den ble ikke satt.',
  )
  const sanitized = outcome === 'set' ? describeSanitizing(stored.value.report) : null
  if (sanitized) notify.warning(sanitized)
  return outcome
}
