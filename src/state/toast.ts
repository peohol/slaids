/** Small transient-notification store. */

import { create } from 'zustand'
import { createId } from '../domain/ids'

export type ToastTone = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: string
  tone: ToastTone
  message: string
}

interface ToastStore {
  toasts: Toast[]
  push: (tone: ToastTone, message: string) => void
  dismiss: (id: string) => void
}

const MAX_TOASTS = 4

/**
 * Repeated identical messages are collapsed. Without this, a guard that fires on
 * every keystroke — such as the content-fit rollback — would flood the screen
 * and the render loop.
 */
export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (tone, message) => {
    if (get().toasts.some((entry) => entry.message === message && entry.tone === tone)) return
    const toast: Toast = { id: createId('toast'), tone, message }
    set((state) => ({ toasts: [...state.toasts, toast].slice(-MAX_TOASTS) }))
    setTimeout(
      () => {
        set((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== toast.id) }))
      },
      tone === 'error' ? 7000 : 4000,
    )
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== id) })),
}))

export const notify = {
  info: (message: string) => useToasts.getState().push('info', message),
  success: (message: string) => useToasts.getState().push('success', message),
  warning: (message: string) => useToasts.getState().push('warning', message),
  error: (message: string) => useToasts.getState().push('error', message),
}
