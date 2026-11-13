/**
 * Å endre en egen temamal (§ 15.4) i temaeditoren.
 *
 * En mal endres der temaer endres: malen brukes på presentasjonen som er åpen,
 * personen endrer temaet med temaeditoren som ellers og ser det i
 * forhåndsvisningen, og «Lagre i malen» skriver det som står, over malen –
 * sammen med nytt navn og ny synlighet. «Avbryt» setter presentasjonens tema
 * tilbake slik det var før malen ble åpnet.
 *
 * Tilstanden står i temaeditoren selv, ikke i listen over maler, så knappene
 * kan stå i dialogens bunn (alltid synlige mens man blar) og dialogen kan
 * spørre før den lukkes midt i en endring.
 */

import { useCallback, useState } from 'react'
import type { ThemeTemplate, ThemeTemplateVisibility } from '../../domain/themeTemplate'
import { useEditorStore } from '../../state/store'
import { notify } from '../../state/toast'
import {
  applyThemeTemplateToOpenDeck,
  restoreTheme,
  themeRestorePoint,
  updateThemeTemplateFromDeck,
  type ThemeRestorePoint,
} from './themeTemplates'

export interface ThemeTemplateEditing {
  template: ThemeTemplate
  restore: ThemeRestorePoint
  name: string
  visibility: ThemeTemplateVisibility
}

export interface ThemeTemplateEdit {
  /** Malen som endres nå, med navnet og synligheten slik de står i skjemaet. */
  editing: ThemeTemplateEditing | null
  /** Sant mens endringen lagres. */
  pending: boolean
  /** Den sist lagrede malen, så listen kan hente seg inn og vise den. */
  saved: ThemeTemplate | null
  start: (template: ThemeTemplate) => Promise<void>
  change: (patch: Partial<Pick<ThemeTemplateEditing, 'name' | 'visibility'>>) => void
  cancel: () => void
  /** `true` når malen er lagret; ellers er den som før, og endringen pågår fortsatt. */
  save: () => Promise<boolean>
}

export function useThemeTemplateEdit(): ThemeTemplateEdit {
  const [editing, setEditing] = useState<ThemeTemplateEditing | null>(null)
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState<ThemeTemplate | null>(null)

  const start = useCallback(async (template: ThemeTemplate): Promise<void> => {
    const presentation = useEditorStore.getState().presentation
    if (!presentation || !template.own) return
    const restore = themeRestorePoint(presentation)
    if ((await applyThemeTemplateToOpenDeck(template)) !== 'set') return
    setEditing({ template, restore, name: template.name, visibility: template.visibility })
  }, [])

  const change = useCallback<ThemeTemplateEdit['change']>((patch) => {
    setEditing((current) => (current ? { ...current, ...patch } : current))
  }, [])

  const cancel = useCallback((): void => {
    if (editing) restoreTheme(editing.restore)
    setEditing(null)
  }, [editing])

  const save = useCallback(async (): Promise<boolean> => {
    const presentation = useEditorStore.getState().presentation
    if (!editing || pending) return false
    if (presentation?.id !== editing.restore.presentationId) {
      notify.warning('En annen presentasjon ble åpnet, så malen ble ikke endret.')
      setEditing(null)
      return false
    }
    setPending(true)
    try {
      const updated = await updateThemeTemplateFromDeck(editing.template, presentation, editing)
      notify.success(`Malen «${updated.name}» er oppdatert.`)
      setEditing(null)
      setSaved(updated)
      return true
    } catch (error) {
      notify.error(error instanceof Error && error.message ? error.message : 'Endringene kunne ikke lagres i malen.')
      return false
    } finally {
      setPending(false)
    }
  }, [editing, pending])

  return { editing, pending, saved, start, change, cancel, save }
}
