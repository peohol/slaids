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
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'

/** How long the copy button says it worked. Long enough to read, short enough to forget. */
const COPIED_FEEDBACK_MS = 1800

export interface ShareToggleProps {
  status: SharingStatus
  shared: boolean
  busy: boolean
  error: string | null
  /** The live link, or `null` when there is nothing to hand out. */
  link: string | null
  onToggle: () => void
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Denied or unavailable; the fallback below still works in most browsers.
  }
  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    return copied
  } catch {
    return false
  }
}

export function ShareToggle({ status, shared, busy, error, link, onToggle }: ShareToggleProps) {
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
  }, [])

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
      <Tooltip label={label}>
        <button
          type="button"
          className={shared ? 'btn btn--sm btn--active' : 'btn btn--sm'}
          onClick={onToggle}
          disabled={disabled}
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
            className="btn btn--sm"
            data-testid="copy-share-link"
            onClick={() => {
              void copyToClipboard(link).then((ok) => {
                if (!ok) {
                  notify.error('Kunne ikke kopiere lenken. Kopier den fra adressefeltet i stedet.')
                  return
                }
                setCopied(true)
                if (copiedTimer.current) clearTimeout(copiedTimer.current)
                copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
              })
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={15} />{' '}
            {copied ? 'Kopiert' : 'Kopier lenke'}
          </button>
        </Tooltip>
      )}
    </div>
  )
}
