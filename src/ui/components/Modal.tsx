/** Radix Dialog wrapper with the app's chrome styling. */

import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

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
          style={width ? { width } : undefined}
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
