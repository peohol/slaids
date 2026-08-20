/**
 * Confirmation for destructive actions.
 *
 * Supports a third path (typically "move to the sandbox") so content never has
 * to be destroyed just to change the layout.
 */

import { Modal } from './Modal'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Optional non-destructive alternative, e.g. rescuing content. */
  alternativeLabel?: string
  onConfirm: () => void
  onAlternative?: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Slett',
  cancelLabel = 'Avbryt',
  alternativeLabel,
  onConfirm,
  onAlternative,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      title={title}
      testId="confirm-dialog"
      width={520}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          {alternativeLabel && onAlternative && (
            <button type="button" className="btn" onClick={onAlternative} data-testid="confirm-alternative">
              {alternativeLabel}
            </button>
          )}
          <button type="button" className="btn btn--danger" onClick={onConfirm} data-testid="confirm-accept">
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{message}</p>
    </Modal>
  )
}
