/**
 * Sharing a folder: a button under the folder's delete button, and a popover
 * with one switch and, while it is on, the link and a way to copy it.
 *
 * Like the editor's `Del`, it shows only what the server confirmed — the
 * switch never flips ahead of the publication — and in local mode it is
 * present but disabled, and says why.
 */

import * as Popover from '@radix-ui/react-popover'
import { useEffect, useRef, useState } from 'react'
import type { ShareState } from '../../persistence/repository'
import type { FolderSharingStatus } from '../../state/folderSharing'
import { folderShareLink } from '../../state/folderSharing'
import { notify } from '../../state/toast'
import { COPIED_FEEDBACK_MS, copyToClipboard } from '../components/clipboard'
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'

export interface FolderShareButtonProps {
  folderName: string
  status: FolderSharingStatus
  state: ShareState
  busy: boolean
  onSetShared: (shared: boolean) => void
}

export function FolderShareButton({ folderName, status, state, busy, onSetShared }: FolderShareButtonProps) {
  const link = folderShareLink(state)
  const [copiedLink, setCopiedLink] = useState<string | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const linkField = useRef<HTMLInputElement>(null)

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    [],
  )

  const unsupported = status === 'unsupported'
  // Only a state the server confirmed may be acted on: while it is unknown, a
  // shared folder would look like an unshared one, and switching it "on" would
  // rotate the token and kill the link that is already out.
  const disabled = status !== 'ready' || busy
  const shared = state.shared

  const hint = unsupported
    ? 'Deling krever Supabase.'
    : status === 'loading'
      ? 'Leser delingsstatus …'
      : status === 'error'
        ? 'Kunne ikke lese delingsstatusen.'
        : busy
          ? shared
            ? 'Slår av delingen …'
            : 'Publiserer presentasjonene i mappen …'
          : shared
            ? 'Alle med lenken kan se presentasjonene i mappen, bare i presentasjonsmodus. Ingen andre kan endre noe.'
            : 'Slå på for å få en hemmelig lenke til mappen. Bare du kan endre noe.'

  return (
    <Popover.Root>
      <Tooltip label={shared ? `Mappen ${folderName} er delt` : `Del mappen ${folderName}`}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={shared ? 'btn btn--ghost btn--icon btn--sm btn--active' : 'btn btn--ghost btn--icon btn--sm'}
            aria-label={`Del mappen ${folderName}`}
            data-testid="share-folder"
            data-state={shared ? 'on' : 'off'}
          >
            <Icon name="share" size={14} />
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          className="popover folder-share"
          side="right"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          data-testid="folder-share-popover"
        >
          <div className="folder-share__head">
            <span className="folder-share__title">Del «{folderName}»</span>
            <button
              type="button"
              role="switch"
              aria-checked={shared}
              aria-label="Del mappen med lenke"
              aria-busy={busy}
              className="switch"
              disabled={disabled}
              onClick={() => onSetShared(!shared)}
              data-testid="toggle-folder-share"
              data-state={unsupported ? 'unsupported' : busy ? 'busy' : shared ? 'on' : 'off'}
            >
              <span className="switch__thumb" />
            </button>
          </div>
          <p className="hint folder-share__hint" role={status === 'error' ? 'alert' : undefined}>
            {hint}
          </p>
          {shared && link && (
            <div className="folder-share__link">
              <input
                ref={linkField}
                type="text"
                className="input"
                readOnly
                value={link}
                aria-label="Delingslenke til mappen"
                data-testid="folder-share-link"
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                className="btn btn--sm"
                data-testid="copy-folder-share-link"
                onClick={() => {
                  void copyToClipboard(link).then((ok) => {
                    if (!ok) {
                      // The link is already on screen; select it so Ctrl+C is
                      // all that is left to do.
                      linkField.current?.focus()
                      linkField.current?.select()
                      notify.error('Kunne ikke kopiere automatisk. Lenken er merket – kopier den selv.')
                      return
                    }
                    setCopiedLink(link)
                    if (copiedTimer.current) clearTimeout(copiedTimer.current)
                    copiedTimer.current = setTimeout(() => setCopiedLink(null), COPIED_FEEDBACK_MS)
                  })
                }}
              >
                <Icon name={copiedLink === link ? 'check' : 'copy'} size={15} />{' '}
                {copiedLink === link ? 'Kopiert' : 'Kopier lenke'}
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
