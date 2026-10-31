/**
 * The `Del` control.
 *
 * One switch and, while it is on, one way to copy the link. Everything it shows
 * is passed in from what the server confirmed — it never flips on
 * optimistically, because a switch that says "shared" for a publication that
 * failed is worse than a switch that is slow.
 *
 * In local mode there is no public backend to publish to, so the toggle is
 * present but disabled and says why. Hiding it would leave the reader guessing
 * whether Slaids can share at all.
 */

import { useEffect, useRef, useState } from 'react'
import type { SharingStatus } from '../../state/sharing'
import { notify } from '../../state/toast'
import { COPIED_FEEDBACK_MS, copyToClipboard } from '../components/clipboard'
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'
import { unavailable } from '../components/unavailable'

export interface ShareToggleProps {
  status: SharingStatus
  shared: boolean
  busy: boolean
  error: string | null
  /** The live link, or `null` when there is nothing to hand out. */
  link: string | null
  onToggle: () => void
}

export function ShareToggle({ status, shared, busy, error, link, onToggle }: ShareToggleProps) {
  const [copied, setCopied] = useState(false)
  /**
   * The link a copy failed for.
   *
   * Kept as the link rather than a boolean so it is derived, not synchronised:
   * a new token makes the old fallback irrelevant the moment it renders, with
   * no effect needed to clear it.
   */
  const [copyFailedFor, setCopyFailedFor] = useState<string | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const manualField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
  }, [])

  const showManualLink = Boolean(shared && link && copyFailedFor === link)

  // Ready to press Ctrl+C the moment it appears, which is the whole point of it.
  useEffect(() => {
    if (!showManualLink) return
    manualField.current?.focus()
    manualField.current?.select()
  }, [showManualLink])

  const unsupported = status === 'unsupported'
  // Until the stored state has been read there is nothing true to show, so the
  // switch is off and inert rather than claiming either answer.
  const settled = status === 'ready'
  const disabled = unsupported || busy || !settled

  const label = unsupported
    ? 'Deling krever Supabase'
    : busy
      ? shared
        ? 'Slår av delingen …'
        : 'Publiserer …'
      : status === 'loading'
        ? 'Leser delingsstatus …'
        : status === 'error'
          ? (error ?? 'Kunne ikke lese delingsstatusen.')
          : shared
            ? 'Delt: alle med lenken kan se presentasjonen. Klikk for å slå av.'
            : 'Del presentasjonen med en hemmelig lenke'

  const state = unsupported ? 'unsupported' : busy ? 'busy' : shared ? 'on' : 'off'

  return (
    <div className="toolbar__group share-toggle" data-testid="share-toggle">
      {/* Unavailable rather than disabled, so the reason it cannot be pressed
          is reached from the keyboard as well as the mouse. */}
      <Tooltip label={label}>
        <button
          type="button"
          className={shared ? 'btn btn--sm btn--active' : 'btn btn--sm'}
          onClick={onToggle}
          {...unavailable(disabled)}
          aria-pressed={shared}
          aria-busy={busy}
          data-testid="toggle-share"
          data-state={state}
        >
          <Icon name="share" size={15} /> Del
          <span className="share-toggle__state">{busy ? '…' : shared ? 'på' : 'av'}</span>
        </button>
      </Tooltip>

      {shared && link && (
        <Tooltip label={link}>
          <button
            type="button"
            className="btn btn--sm share-toggle__copy"
            aria-label={copied ? 'Lenken er kopiert' : 'Kopier lenke'}
            data-testid="copy-share-link"
            onClick={() => {
              void copyToClipboard(link).then((ok) => {
                if (!ok) {
                  // Not "copy it from the address bar": the address bar holds
                  // the editor's URL, not the share link. The link itself is
                  // put on screen instead, selected and ready to copy by hand.
                  setCopyFailedFor(link)
                  notify.error(
                    'Kunne ikke kopiere automatisk. Lenken står nå i feltet ved siden av – merk den og kopier.',
                  )
                  return
                }
                setCopyFailedFor(null)
                setCopied(true)
                if (copiedTimer.current) clearTimeout(copiedTimer.current)
                copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
              })
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={15} />
            {/* In a narrow toolbar the words give way to the icon, as every
                menu name there does; the name stays on the button. */}
            <span className="toolbar__label">{copied ? 'Kopiert' : 'Kopier lenke'}</span>
          </button>
        </Tooltip>
      )}

      {showManualLink && link && (
        <input
          ref={manualField}
          type="text"
          className="input share-toggle__manual"
          data-testid="share-link-manual"
          readOnly
          value={link}
          aria-label="Delingslenke – merk og kopier"
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </div>
  )
}
