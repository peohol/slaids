/**
 * Temamaler i editoren og biblioteket (§ 15.4): lagre gjeldende tema som mal,
 * endre en egen mal, bruke en mal på presentasjonen som er åpen, starte en ny
 * presentasjon i standardmalen, og velge hvilken mal som er standard.
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
  type ThemeTemplateContent,
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
/** Angresteget når temaet settes tilbake etter at en mal ikke ble endret likevel. */
const RESTORE_LABEL = 'theme-template-restore'

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
  const name = templateName(input.name)
  const { content, logo } = await readThemeSnapshot(presentation, dependencies)
  const now = new Date().toISOString()
  const template = { id: newThemeTemplateId(), name, visibility: input.visibility, content, createdAt: now, updatedAt: now }
  await dependencies.templates.createThemeTemplate(template, logo)
  const saved: ThemeTemplate = { ...template, own: true }
  if (!input.asDefault) return { template: saved, defaultChosen: false }
  try {
    await dependencies.chooseDefault(saved.id)
    return { template: saved, defaultChosen: true }
  } catch {
    return { template: saved, defaultChosen: false }
  }
}

/**
 * Erstatt innholdet i en egen mal med temaet, forsidens farger og logoen i
 * `presentation`, og gi den nytt navn og ny synlighet. Malen beholder id-en,
 * så den er fortsatt standard for den som har valgt den. Presentasjoner som
 * allerede har brukt malen, endres ikke: de har sin egen kopi.
 *
 * Kaster når malen ikke ble endret; da er den som før.
 */
export async function updateThemeTemplateFromDeck(
  template: ThemeTemplate,
  presentation: Presentation,
  input: { name: string; visibility: ThemeTemplateVisibility },
  dependencies: Pick<ThemeTemplateDependencies, 'templates' | 'library'> = DEFAULTS,
): Promise<ThemeTemplate> {
  if (!template.own) throw new RepositoryError('Bare den som laget malen, kan endre den.')
  const name = templateName(input.name)
  const { content, logo } = await readThemeSnapshot(presentation, dependencies)
  const changed = { id: template.id, name, visibility: input.visibility, content, updatedAt: new Date().toISOString() }
  await dependencies.templates.updateThemeTemplate(changed, logo)
  return { ...template, ...changed }
}

function templateName(input: string): string {
  const name = normalizeThemeTemplateName(input)
  if (!name) throw new RepositoryError('Malen må ha et navn.')
  return name
}

/** Øyeblikksbildet av temaet i `presentation`, med bytene i logofilen når den har en. */
async function readThemeSnapshot(
  presentation: Presentation,
  dependencies: Pick<ThemeTemplateDependencies, 'library'>,
): Promise<{ content: ThemeTemplateContent; logo: Blob | null }> {
  const { content, logoAssetId } = themeTemplateContent(presentation)
  if (!logoAssetId) return { content, logo: null }
  const logo = await dependencies.library.getAsset(logoAssetId)
  if (!logo) throw new RepositoryError('Logofilen kunne ikke leses, så malen ble ikke lagret.')
  return { content, logo: logo.blob }
}

/**
 * Temaet en presentasjon hadde før en mal ble endret i den, så «Avbryt» kan
 * sette det tilbake. Logofilen er presentasjonens egen og blir liggende i
 * fillageret mens malen endres, så den kan pekes på igjen.
 */
export interface ThemeRestorePoint {
  presentationId: string
  content: ThemeTemplateContent
  logoAssetId: string | null
}

export function themeRestorePoint(presentation: Presentation): ThemeRestorePoint {
  return { presentationId: presentation.id, ...themeTemplateContent(presentation) }
}

/**
 * Sett temaet, forsidens farger og logoen tilbake slik de var, som ett
 * angrebart steg. Gjør ingenting når en annen presentasjon er åpnet.
 */
export function restoreTheme(
  point: ThemeRestorePoint,
  dependencies: Pick<ThemeTemplateDependencies, 'store'> = DEFAULTS,
): boolean {
  const state = dependencies.store.getState()
  if (state.presentation?.id !== point.presentationId) return false
  return state.run(RESTORE_LABEL, (current) =>
    applyThemeTemplate(current, point.content, point.logoAssetId, HUMAN_EDIT),
  )
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
