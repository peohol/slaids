/**
 * Last opp en fil og bruk den som logo i presentasjonen som er åpen (§ 15.2).
 *
 * Opplastingen tar tid, og mens den pågår kan personen gå til en annen
 * presentasjon. Filen lagres under presentasjonen som var åpen da opplastingen
 * startet, så logoen settes bare hvis den samme presentasjonen fortsatt er
 * åpen etterpå. Ellers – og når kommandoen avvises – slettes filen igjen, så
 * ingenting blir liggende uten at noe peker på det. En fil presentasjonen
 * allerede hadde (`reused`), slettes aldri: den kan stå på en slide.
 *
 * Avhengighetene kan byttes ut, så regelen kan testes uten lager og editor.
 */

import { registerAsset, setThemeLogo } from '../../domain/commands'
import { HUMAN_EDIT } from '../../domain/commands/manualLayout'
import { describeError } from '../../domain/result'
import { describeSanitizing, discardUploadedAssets, storeUploadedFile } from '../../state/assetUpload'
import { useEditorStore } from '../../state/store'
import { notify } from '../../state/toast'

export interface LogoUploadDependencies {
  store: Pick<typeof useEditorStore, 'getState'>
  storeFile: typeof storeUploadedFile
  discard: typeof discardUploadedAssets
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
  const { store, storeFile, discard } = dependencies
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

  const { ref, reused, report } = stored.value
  const written = reused ? [] : [ref.id]
  const state = store.getState()
  if (state.presentation?.id !== target.id) {
    await discard(written)
    notify.warning('En annen presentasjon ble åpnet før logoen var lastet opp, så den ble ikke satt.')
    return 'moved-on'
  }

  const sanitized = describeSanitizing(report)
  if (sanitized) notify.warning(sanitized)
  // Filen og logoen i ett steg, så én angring tar begge.
  const placed = state.run('theme-logo', (current) => {
    const registered = registerAsset(current, ref)
    return registered.ok ? setThemeLogo(registered.value, ref.id, HUMAN_EDIT) : registered
  })
  if (placed) return 'set'
  // `run` har allerede sagt hvorfor; filen ingenting peker på, tas tilbake.
  await discard(written)
  return 'refused'
}
