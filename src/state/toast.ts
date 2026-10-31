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

/** How long a toast stays after the last time its message was pushed. */
export const TOAST_DURATION_MS: Record<ToastTone, number> = {
  info: 4000,
  success: 4000,
  warning: 4000,
  error: 7000,
}

/** Each toast's pending removal, so a repeat can push it back. */
const removals = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Repeated identical messages are collapsed. Without this, a guard that fires on
 * every keystroke — such as the content-fit rollback — would flood the screen
 * and the render loop.
 *
 * A repeat restarts the toast's clock instead: the message is about the latest
 * refusal, not the first, so it must not run out while the same thing is still
 * being refused. Restarting a timer changes no state, so a flood stays cheap.
 */
export const useToasts = create<ToastStore>((set, get) => {
  const remove = (id: string): void => {
    clearTimeout(removals.get(id))
    removals.delete(id)
    set((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== id) }))
  }
  const scheduleRemoval = (toast: Toast): void => {
    clearTimeout(removals.get(toast.id))
    removals.set(
      toast.id,
      setTimeout(() => remove(toast.id), TOAST_DURATION_MS[toast.tone]),
    )
  }
  return {
    toasts: [],
    push: (tone, message) => {
      const repeat = get().toasts.find((entry) => entry.message === message && entry.tone === tone)
      if (repeat) {
        scheduleRemoval(repeat)
        return
      }
      const toast: Toast = { id: createId('toast'), tone, message }
      const kept = [...get().toasts, toast].slice(-MAX_TOASTS)
      for (const dropped of get().toasts.filter((entry) => !kept.includes(entry))) {
        clearTimeout(removals.get(dropped.id))
        removals.delete(dropped.id)
      }
      set({ toasts: kept })
      scheduleRemoval(toast)
    },
    dismiss: remove,
  }
})

export const notify = {
  info: (message: string) => useToasts.getState().push('info', message),
  success: (message: string) => useToasts.getState().push('success', message),
  warning: (message: string) => useToasts.getState().push('warning', message),
  error: (message: string) => useToasts.getState().push('error', message),
}
