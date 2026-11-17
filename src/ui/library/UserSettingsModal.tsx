import { useState } from 'react'
import type { UserSettings } from '../../domain/userSettings'
import { repository } from '../../persistence/activeRepository'
import { loadUserSettings, saveUserSettings, useUserSettings } from '../../state/userSettings'
import { Modal } from '../components/Modal'

export function UserSettingsModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const stored = useUserSettings()
  const { ownerId, status } = stored
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  /*
   * Valget som lagres nå. Kontrollene viser det med en gang: storen får den nye
   * verdien først når lagringen er ferdig, og fram til da ville en avkrysning
   * hoppet tilbake – klikket så ut til å bli oversett så lenge lagringen varte.
   * Feiler lagringen, viser kontrollene igjen det som faktisk er lagret.
   */
  const [pending, setPending] = useState<Partial<UserSettings>>({})
  const { citationStyle, includeReferencesInProgress, fewerDialogs } = { ...stored, ...pending }

  async function changeSettings(patch: Partial<UserSettings>): Promise<void> {
    setSaving(true)
    setSaveError(false)
    setPending(patch)
    try {
      await saveUserSettings(repository, patch)
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
      setPending({})
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Brukerinnstillinger"
      description="Gjelder alle presentasjonene dine."
      testId="user-settings-modal"
      width={480}
      footer={
        <button type="button" className="btn" onClick={() => onOpenChange(false)}>
          Lukk
        </button>
      }
    >
      {status === 'error' ? (
        <>
          <p role="alert">Kunne ikke hente brukerinnstillingene.</p>
          <button type="button" className="btn" onClick={() => void loadUserSettings(repository, ownerId)}>
            Prøv igjen
          </button>
        </>
      ) : (
        <>
          <label className="user-settings-option">
            <input
              type="checkbox"
              checked={includeReferencesInProgress}
              disabled={status !== 'ready' || saving}
              onChange={(event) =>
                void changeSettings({ includeReferencesInProgress: event.currentTarget.checked })
              }
            />
            Tell med referanseslides i fremdriftslinjen
          </label>
          <label className="field">
            <span className="field__label">Henvisninger på slides</span>
            <select
              className="select"
              value={citationStyle}
              disabled={status !== 'ready' || saving}
              onChange={(event) => void changeSettings({
                citationStyle: event.currentTarget.value === 'author-year' ? 'author-year' : 'numbered',
              })}
            >
              <option value="numbered">Nummerert</option>
              <option value="author-year">Forfatter, år</option>
            </select>
          </label>
          <label className="user-settings-option">
            <input
              type="checkbox"
              checked={fewerDialogs}
              disabled={status !== 'ready' || saving}
              onChange={(event) => void changeSettings({ fewerDialogs: event.currentTarget.checked })}
            />
            Færre popuper
          </label>
          <p className="hint">
            Hopp over bekreftelser for angrebare handlinger. Nye slides får overskrift, og «Del sone»
            deler sonen i to like deler. Avansert deling er tilgjengelig i sonemenyen.
          </p>
        </>
      )}
      {saveError && <p role="alert">Kunne ikke lagre innstillingen. Prøv igjen.</p>}
    </Modal>
  )
}
