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
  const { citationStyle, includeReferencesInProgress, ownerId, status } = useUserSettings()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)

  async function changeSettings(patch: Partial<UserSettings>): Promise<void> {
    setSaving(true)
    setSaveError(false)
    try {
      await saveUserSettings(repository, patch)
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
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
        </>
      )}
      {saveError && <p role="alert">Kunne ikke lagre innstillingen. Prøv igjen.</p>}
    </Modal>
  )
}
