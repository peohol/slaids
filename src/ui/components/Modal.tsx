/**
 * Radix Dialog wrapper with the app's chrome styling.
 *
 * `width` is a *wish*, not a size. It is published as a custom property and the
 * stylesheet clamps it to what is actually on screen, so a dialog that asks for
 * 720 px gets 720 px on a desktop and the width of a phone on a phone —
 * without every dialog having to know that phones exist. The header and the
 * footer stay put and the body scrolls, so the title and the buttons that
 * finish the job are reachable however short the viewport gets.
 */

import * as Dialog from '@radix-ui/react-dialog'
import type { CSSProperties, ReactNode } from 'react'

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
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog"
          style={width ? ({ '--dialog-width': `${width}px` } as CSSProperties) : undefined}
          data-testid={testId}
          aria-describedby={description ? undefined : ''}
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
