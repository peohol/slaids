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

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (tone, message) => {
    const toast: Toast = { id: createId('toast'), tone, message }
    set((state) => ({ toasts: [...state.toasts, toast] }))
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== toast.id) }))
    }, tone === 'error' ? 7000 : 4000)
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== id) })),
}))

export const notify = {
  info: (message: string) => useToasts.getState().push('info', message),
  success: (message: string) => useToasts.getState().push('success', message),
  warning: (message: string) => useToasts.getState().push('warning', message),
  error: (message: string) => useToasts.getState().push('error', message),
}
