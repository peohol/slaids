/**
 * Radix Dialog wrapper with the app's chrome styling.
 *
 * `width` is a *wish*, not a size. It is published as a custom property and the
 * stylesheet clamps it to what is actually on screen, so a dialog that asks for
 * 720 px gets 720 px on a desktop and the width of a phone on a phone —
 * without every dialog having to know that phones exist. The header and the
 * footer stay put and the body scrolls, so the title and the buttons that
 * finish the job are reachable however short the viewport gets.
 *
 * Closing gives the focus back to the control that opened the dialog. Radix
 * does that only for its own `Dialog.Trigger`, and these dialogs are opened
 * from state — by an inspector button, an icon over a zone, a menu entry, a
 * shortcut — so without this the focus fell to the page and a keyboard user
 * started over from the top. A dialog opened from a menu entry gives it back
 * to the control the menu was opened from, since the entry is gone. Focus that
 * has already moved on by the time the dialog is gone is left where it is.
 */

import * as Dialog from '@radix-ui/react-dialog'
import { useRef, type CSSProperties, type ReactNode } from 'react'
import { focusBeforeClosedMenu } from './contextMenu'

export interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  width?: number
  testId?: string
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width,
  testId,
}: ModalProps) {
  const opener = useRef<HTMLElement | null>(null)
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog"
          style={width ? ({ '--dialog-width': `${width}px` } as CSSProperties) : undefined}
          data-testid={testId}
          aria-describedby={description ? undefined : ''}
          // Still the opener here: the focus moves into the dialog after this.
          onOpenAutoFocus={() => {
            const active = document.activeElement
            const fromMenu =
              !(active instanceof HTMLElement) ||
              active === document.body ||
              active.closest('[role="menu"]') !== null
            opener.current = fromMenu ? focusBeforeClosedMenu() : active
          }}
          // Radix runs this a task after the dialog is gone. Only focus that
          // went with the dialog is given back: when something has taken the
          // focus since (a click, the app, a script), it stays there.
          onCloseAutoFocus={(event) => {
            const back = opener.current
            opener.current = null
            const active = document.activeElement
            const lost = !active || active === document.body || (event.target as Node).contains(active)
            if (!lost || !back?.isConnected || back === document.body) return
            event.preventDefault()
            back.focus({ preventScroll: true })
          }}
        >
          <div className="dialog__header">
            <Dialog.Title className="dialog__title">{title}</Dialog.Title>
            {description && <Dialog.Description className="dialog__description">{description}</Dialog.Description>}
          </div>
          <div className="dialog__body">{children}</div>
          {footer && <div className="dialog__footer">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
