/** Renders queued toasts. */

import { useToasts } from '../../state/toast'
import { Icon } from './Icon'

export function Toaster() {
  const toasts = useToasts((state) => state.toasts)
  const dismiss = useToasts((state) => state.dismiss)

  if (toasts.length === 0) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`} data-testid="toast">
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            onClick={() => dismiss(toast.id)}
            aria-label="Lukk"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
