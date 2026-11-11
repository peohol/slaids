/**
 * Temamaler for agentene (§ 15.4): se hvilke maler brukeren har, og bruk én på
 * en presentasjon.
 *
 * Ingenting her er en ny regel. Malene er de samme som i temaeditoren, lest
 * fra det samme lageret (`ThemeTemplateRepository`); å bruke en mal er den
 * samme kommandoen editoren kjører (`applyThemeTemplate`); og logoen kopieres
 * inn gjennom den samme døren som `upload_asset` (`storeAsset`, med
 * `assetIngress`, SVG-rensing og deduplisering). Forskjellen fra editoren er
 * den samme som for alle andre temavalg: en agent måles strengt, så en mal som
 * ville skjult innhold, avvises med `CONTENT_DOES_NOT_FIT`.
 *
 * Å lage og slette maler er editorens sak. En mal er noe en person setter
 * sammen og gir et navn, og en delt mal ses av alle i Slaids; det er ikke noe en
 * agent skal gjøre på vegne av noen som ikke ser det skje.
 *
 * ### Rekkefølgen når malen har logo
 *
 * Tre trinn, og rekkefølgen er det som gjør det trygt uten en transaksjon over
 * to lagre:
 *
 *  1. **Prøv uten å skrive.** Malen brukes på presentasjonen slik den står, med
 *     logofilen registrert under en midlertidig id. Avvises den, er ingenting
 *     lagret – heller ikke filen.
 *  2. **Lagre filen** som `upload_asset` gjør. Hadde presentasjonen de samme
 *     bytene fra før, gjenbrukes den filen.
 *  3. **Bruk malen** med den lagrede filen, mot revisjonen fra trinn 2. Feiler
 *     dette likevel (noen andre skrev i mellomtiden), tas en ny fil tilbake – en
 *     fil presentasjonen hadde fra før, røres aldri.
 */

import { z } from 'zod'
import { applyThemeTemplate, registerAsset, removeAsset } from '../../domain/commands'
import { ok } from '../../domain/result'
import type {
  ThemeTemplate,
  ThemeTemplateLogoSettings,
  ThemeTemplateVisibility,
} from '../../domain/themeTemplate'
import type { Presentation } from '../../domain/types'
import type { ThemeTemplateRepository } from '../../persistence/repository'
import { blobToBytes } from '../../persistence/blob'
import { deleteAssetFile, storeAsset } from '../assetStore'
import { defineOperation, expectedRevisionSchema, presentationIdSchema } from '../operation'
import { mutatePresentation, storageFailure, structuralOptions } from '../presentation'
import { agentErr, agentOk, type AgentContext, type AgentResult } from '../types'
import { themeView, type ThemeView } from './theme'

/* ------------------------------------------------------------------ *
 * Malen, slik en agent leser den
 * ------------------------------------------------------------------ */

export interface ThemeTemplateView {
  id: string
  name: string
  /** private = bare eieren ser den, shared = alle aktive Slaids-brukere. */
  visibility: ThemeTemplateVisibility
  /** Om malen er brukerens egen. */
  own: boolean
  /**
   * Om malen er brukerens standard for nye presentasjoner. Editoren gir et nytt
   * dekk denne malen; `create_presentation` gjør det ikke av seg selv, så en
   * agent bruker den med `apply_theme_template` rett etterpå.
   */
  isDefault: boolean
  updatedAt: string
  /** Temainnstillingene, i samme form som `get_presentation` gir dem. */
  theme: Omit<ThemeView, 'logo'>
  /** Forsidens bakgrunns- og aksentfarge, som malen setter på første inndeling. */
  front: { backgroundColor: string; accentColor: string }
  /** Logoen malen har med seg, eller `null`. Den kopieres inn når malen brukes. */
  logo: {
    name: string
    mimeType: string
    width: number
    height: number
    aspect: number
    sections: ThemeTemplateLogoSettings['sections']
    slides: ThemeTemplateLogoSettings['slides']
  } | null
}

function templateView(template: ThemeTemplate, defaultId: string | null): ThemeTemplateView {
  const { content } = template
  // Ett sted som sier hvordan et tema leses. Uten slides har temaet ingen
  // logo å regne størrelser for, og logoen står for seg selv nedenfor.
  const { logo: _logo, ...theme } = themeView({ theme: content.theme, slides: [] })
  const logo = content.logo
  return {
    id: template.id,
    name: template.name,
    visibility: template.visibility,
    own: template.own,
    isDefault: template.id === defaultId,
    updatedAt: template.updatedAt,
    theme,
    front: { ...content.front },
    logo: logo
      ? {
          name: logo.file.name,
          mimeType: logo.file.mimeType,
          width: logo.file.width,
          height: logo.file.height,
          aspect: logo.settings.aspect,
          sections: { ...logo.settings.sections },
          slides: { ...logo.settings.slides },
        }
      : null,
  }
}

/** Lageret, eller grunnen til at det ikke finnes. */
function requireTemplates(context: AgentContext): ThemeTemplateRepository | null {
  return context.themeTemplates ?? null
}

const unavailable = <T,>(): AgentResult<T> =>
  agentErr(
    'THEME_TEMPLATES_UNAVAILABLE',
    'Denne Slaids-installasjonen har ingen temamaler å hente.',
  )

/* ------------------------------------------------------------------ *
 * list_theme_templates
 * ------------------------------------------------------------------ */

export const listThemeTemplatesOperation = defineOperation({
  name: 'list_theme_templates',
  summary:
    'Brukerens egne temamaler og alle delte temamaler i Slaids. En temamal er et lagret tema: fonter, luft, skriftstørrelse, skygger, kortutseende, forsidens bakgrunns- og aksentfarge og eventuelt en logo med plassering og størrelse. isDefault markerer brukerens standardmal for nye presentasjoner. Maler lages og slettes i temaeditoren; en agent bruker dem med apply_theme_template.',
  mutates: false,
  scopes: ['presentations:read'],
  input: z.strictObject({}),
  async run(context): Promise<AgentResult<{ templates: ThemeTemplateView[] }>> {
    const templates = requireTemplates(context)
    if (!templates) return unavailable()
    try {
      const [list, settings] = await Promise.all([
        templates.listThemeTemplates(),
        context.repository.getUserSettings(null),
      ])
      return agentOk({
        templates: list.map((template) => templateView(template, settings.defaultThemeTemplateId)),
      })
    } catch (error) {
      return storageFailure(error, 'Kunne ikke hente temamalene.', {})
    }
  },
})

/* ------------------------------------------------------------------ *
 * apply_theme_template
 * ------------------------------------------------------------------ */

interface AppliedTemplate {
  presentationId: string
  templateId: string
  theme: ThemeView
  revision: string
}

/** Id-en logofilen prøves under i trinn 1. Den lagres aldri. */
const PROBE_ASSET_ID = 'a_theme_template_probe'

export const applyThemeTemplateOperation = defineOperation({
  name: 'apply_theme_template',
  summary:
    'Bruk en temamal (fra list_theme_templates) på en presentasjon: alle temainnstillingene, forsidens bakgrunns- og aksentfarge og logoen settes i ett steg. Logoen kopieres inn i presentasjonens eget fillager, så presentasjonen virker videre om malen senere endres eller slettes. En mal uten logo fjerner logoen. Senere inndelinger beholder sine farger. Alt måles mot hele dekket, og en mal som ville skjult innhold eller gjort soner for små, avvises uten at noe lagres.',
  mutates: true,
  // Å bruke en mal med logo lagrer en fil, så det krever begge: det samme
  // `upload_asset` krever, og det samme `set_theme` krever.
  scopes: ['presentations:write', 'assets:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    templateId: z.string().min(1).describe('Id-en til malen, fra list_theme_templates.'),
  }),
  async run(context, input): Promise<AgentResult<AppliedTemplate>> {
    const templates = requireTemplates(context)
    if (!templates) return unavailable()

    let template: ThemeTemplate | undefined
    try {
      template = (await templates.listThemeTemplates()).find((entry) => entry.id === input.templateId)
    } catch (error) {
      return storageFailure(error, 'Kunne ikke hente temamalene.', { templateId: input.templateId })
    }
    if (!template) {
      return agentErr(
        'THEME_TEMPLATE_NOT_FOUND',
        'Fant ikke temamalen. Den kan være slettet, eller være en annens private mal.',
        { templateId: input.templateId },
      )
    }

    const { content } = template
    const options = structuralOptions(context)
    const apply = (logoAssetId: string | null) => (presentation: Presentation) => {
      const applied = applyThemeTemplate(presentation, content, logoAssetId, options)
      if (!applied.ok) return applied
      return ok({
        presentation: applied.value,
        value: { presentationId: presentation.id, templateId: template.id, theme: themeView(applied.value) },
      })
    }

    if (!content.logo) return mutatePresentation(context, input, apply(null))
    const logoFile = content.logo.file

    // 1. Prøv uten å skrive. Svaret er det samme dokumentet tilbake, og det
    // lagrer `mutatePresentation` aldri – men en avvisning får den samme
    // beskrivelsen (sone, rektangel) som om den var skrevet.
    const probe = await mutatePresentation(context, input, (presentation) => {
      const withFile = registerAsset(presentation, { ...logoFile, id: PROBE_ASSET_ID })
      if (!withFile.ok) return withFile
      const tried = apply(PROBE_ASSET_ID)(withFile.value)
      return tried.ok ? ok({ presentation, value: {} }) : tried
    })
    if (!probe.ok) return probe

    // 2. Lagre filen, gjennom den samme døren som upload_asset.
    let bytes: Uint8Array
    try {
      const blob = await templates.getThemeTemplateLogo(template.id)
      if (!blob) {
        return agentErr('ASSET_NOT_FOUND', 'Logoen i temamalen finnes ikke lenger.', {
          templateId: template.id,
        })
      }
      bytes = await blobToBytes(blob)
    } catch (error) {
      return storageFailure(error, 'Kunne ikke hente logoen i temamalen.', { templateId: template.id })
    }
    const stored = await storeAsset(context, {
      presentationId: input.presentationId,
      expectedRevision: probe.value.revision,
      name: logoFile.name,
      bytes,
    })
    if (!stored.ok) return stored

    // 3. Bruk malen med den lagrede filen.
    const applied = await mutatePresentation(
      context,
      { presentationId: input.presentationId, expectedRevision: stored.value.revision },
      apply(stored.value.assetId),
    )
    if (!applied.ok && !stored.value.deduplicated) await reclaim(context, input.presentationId, stored.value.assetId)
    return applied
  },
})

/**
 * Ta tilbake en fil som ble lagret for en mal som likevel ikke ble brukt.
 * Dokumentet først, så bytene – den samme rekkefølgen som `delete_asset`.
 * Gjør ingenting med en fil som er tatt i bruk i mellomtiden.
 */
async function reclaim(context: AgentContext, presentationId: string, assetId: string): Promise<void> {
  const removed = await mutatePresentation(context, { presentationId }, (presentation) => {
    const without = removeAsset(presentation, assetId)
    return without.ok ? ok({ presentation: without.value, value: {} }) : without
  })
  if (removed.ok) await deleteAssetFile(context, assetId)
}

export const themeTemplateOperations = [listThemeTemplatesOperation, applyThemeTemplateOperation]
