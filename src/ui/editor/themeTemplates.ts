/**
 * Temamaler i editoren og biblioteket (§ 15.4): lagre gjeldende tema som mal,
 * bruke en mal på presentasjonen som er åpen, starte en ny presentasjon i
 * standardmalen, og velge hvilken mal som er standard.
 *
 * Logoen i en mal kopieres inn i presentasjonens eget fillager gjennom den
 * samme døren som en opplastet fil (`storeUploadedFile`: `assetIngress`,
 * SVG-rensing og deduplisering), så presentasjonen virker videre selv om malen
 * slettes. Feiler noe etter at filen er kopiert, tas den tilbake.
 *
 * Avhengighetene kan byttes ut, så reglene kan testes uten lager og editor.
 */

import { applyThemeTemplate, registerAsset } from '../../domain/commands'
import { HUMAN_EDIT } from '../../domain/commands/manualLayout'
import { newThemeTemplateId } from '../../domain/ids'
import { describeError, err, ok, type Result } from '../../domain/result'
import {
  normalizeThemeTemplateName,
  themeTemplateContent,
  type ThemeTemplate,
  type ThemeTemplateVisibility,
} from '../../domain/themeTemplate'
import type { Presentation } from '../../domain/types'
import { repository, themeTemplates } from '../../persistence/activeRepository'
import { RepositoryError, type SlaidsRepository, type ThemeTemplateRepository } from '../../persistence/repository'
import {
  discardUploadedAssets,
  storeUploadedFile,
  type UploadedAsset,
} from '../../state/assetUpload'
import { clearDefaultTheme } from '../../state/defaultTheme'
import { useEditorStore } from '../../state/store'
import { notify } from '../../state/toast'
import { saveUserSettings, useUserSettings } from '../../state/userSettings'
import { placeStoredAsset, writtenAssetIds, type PlacementDependencies, type PlacementOutcome } from './placeStoredAsset'

export interface ThemeTemplateDependencies extends PlacementDependencies {
  templates: ThemeTemplateRepository
  library: Pick<SlaidsRepository, 'getAsset' | 'savePresentation' | 'getUserSettings'>
  storeFile: typeof storeUploadedFile
  chooseDefault: typeof chooseDefaultThemeTemplate
}

const DEFAULTS: ThemeTemplateDependencies = {
  store: useEditorStore,
  discard: discardUploadedAssets,
  templates: themeTemplates,
  library: repository,
  storeFile: storeUploadedFile,
  chooseDefault: chooseDefaultThemeTemplate,
}

/** Navnet på angresteget. Ett steg, så én angring tar tema, farger og logo. */
const APPLY_LABEL = 'theme-template'

/** En lagret mal, og om den også ble standard når det ble bedt om. */
export interface SavedThemeTemplate {
  template: ThemeTemplate
  /** `false` når malen ble lagret, men standardvalget ikke kunne lagres. */
  defaultChosen: boolean
}

/**
 * Lagre temaet, forsidens farger og logoen i `presentation` som en ny mal,
 * og eventuelt gjøre den til standard for nye presentasjoner. Logofilen
 * kopieres fra presentasjonen; malen får sin egen kopi.
 *
 * Kaster bare når malen ikke ble lagret. Feiler standardvalget etterpå, er
 * malen like fullt lagret – svaret sier det, så et nytt forsøk ikke lager en
 * mal til.
 */
export async function saveThemeAsTemplate(
  presentation: Presentation,
  input: { name: string; visibility: ThemeTemplateVisibility; asDefault?: boolean },
  dependencies: ThemeTemplateDependencies = DEFAULTS,
): Promise<SavedThemeTemplate> {
  const name = normalizeThemeTemplateName(input.name)
  if (!name) throw new RepositoryError('Malen må ha et navn.')
  const { content, logoAssetId } = themeTemplateContent(presentation)
  const logo = logoAssetId ? await dependencies.library.getAsset(logoAssetId) : null
  if (logoAssetId && !logo) throw new RepositoryError('Logofilen kunne ikke leses, så malen ble ikke lagret.')
  const now = new Date().toISOString()
  const template = { id: newThemeTemplateId(), name, visibility: input.visibility, content, createdAt: now, updatedAt: now }
  await dependencies.templates.createThemeTemplate(template, logo?.blob ?? null)
  const saved: ThemeTemplate = { ...template, own: true }
  if (!input.asDefault) return { template: saved, defaultChosen: false }
  try {
    await dependencies.chooseDefault(saved.id)
    return { template: saved, defaultChosen: true }
  } catch {
    return { template: saved, defaultChosen: false }
  }
}

/** Hvordan det gikk: brukt, eller hvorfor ikke. */
export type ThemeTemplateOutcome = PlacementOutcome | 'failed'

/** Bruk malen på presentasjonen som er åpen, som ett angrebart steg. */
export async function applyThemeTemplateToOpenDeck(
  template: ThemeTemplate,
  dependencies: ThemeTemplateDependencies = DEFAULTS,
): Promise<ThemeTemplateOutcome> {
  const target = dependencies.store.getState().presentation
  if (!target) return 'moved-on'

  let copied: Result<UploadedAsset | null>
  try {
    copied = await copyTemplateLogo(target, template, dependencies)
  } catch {
    notify.error('Malen kunne ikke brukes. Sjekk nettverket og prøv igjen.')
    return 'failed'
  }
  if (!copied.ok) {
    notify.error(describeError(copied.error))
    return 'refused'
  }
  return placeStoredAsset(
    dependencies,
    target.id,
    copied.value,
    APPLY_LABEL,
    (current, ref) => applyThemeTemplate(current, template.content, ref?.id ?? null, HUMAN_EDIT),
    'En annen presentasjon ble åpnet før malen var klar, så den ble ikke brukt.',
  )
}

/**
 * Gi en nettopp opprettet og lagret presentasjon malens tema, farger og logo,
 * og lagre den igjen. Logofilen lagres under presentasjonen, så den må finnes
 * i lageret først. Kaster når lageret ikke svarer; filen som ble kopiert, er
 * da tatt tilbake.
 */
export async function startInThemeTemplate(
  presentation: Presentation,
  template: ThemeTemplate,
  dependencies: ThemeTemplateDependencies = DEFAULTS,
): Promise<Result<Presentation>> {
  const copied = await copyTemplateLogo(presentation, template, dependencies)
  if (!copied.ok) return copied
  const stored = copied.value
  const written = writtenAssetIds(stored)
  const registered = stored ? registerAsset(presentation, stored.ref) : ok(presentation)
  const applied = registered.ok
    ? applyThemeTemplate(registered.value, template.content, stored?.ref.id ?? null, HUMAN_EDIT)
    : registered
  if (!applied.ok) {
    await dependencies.discard(written)
    return applied
  }
  try {
    await dependencies.library.savePresentation(applied.value)
  } catch (error) {
    await dependencies.discard(written)
    throw error
  }
  return applied
}

/**
 * Malen brukeren har valgt som standard for nye presentasjoner, eller `null`
 * når ingen er valgt, eller den valgte ikke finnes lenger.
 */
export async function defaultThemeTemplate(
  dependencies: Pick<ThemeTemplateDependencies, 'templates' | 'library'> = DEFAULTS,
): Promise<ThemeTemplate | null> {
  const state = useUserSettings.getState()
  const id =
    state.status === 'ready'
      ? state.defaultThemeTemplateId
      : (await dependencies.library.getUserSettings(state.ownerId)).defaultThemeTemplateId
  if (!id) return null
  const list = await dependencies.templates.listThemeTemplates()
  return list.find((template) => template.id === id) ?? null
}

/**
 * Velg malen nye presentasjoner starter i, eller `null` for ingen. Et
 * standardtema lagret i nettleseren fra før glemmes når en mal velges, så to
 * standarder aldri gjelder samtidig.
 */
export async function chooseDefaultThemeTemplate(id: string | null): Promise<void> {
  await saveUserSettings(repository, { defaultThemeTemplateId: id })
  if (id) clearDefaultTheme()
}

/** Kopier malens logo inn i presentasjonens fillager, eller `null` når malen ikke har logo. */
async function copyTemplateLogo(
  presentation: Presentation,
  template: ThemeTemplate,
  dependencies: Pick<ThemeTemplateDependencies, 'templates' | 'storeFile'>,
): Promise<Result<UploadedAsset | null>> {
  const logo = template.content.logo
  if (!logo) return ok(null)
  const blob = await dependencies.templates.getThemeTemplateLogo(template.id)
  if (!blob) return err('ASSET_NOT_FOUND', 'Logoen i malen finnes ikke lenger.')
  const file = new File([blob], logo.file.name || 'logo', { type: logo.file.mimeType })
  return dependencies.storeFile(presentation, file)
}
