/**
 * Debounced autosave.
 *
 * Saving is serialised: at most one write is in flight, and a change that
 * arrives mid-write schedules another one. The status only becomes `Saved`
 * after the repository call for the *latest* snapshot has actually resolved.
 */

import type { SlaidsRepository } from '../persistence/repository'
import type { Presentation } from '../domain/types'
import { useEditorStore } from './store'
import { notify } from './toast'

export const AUTOSAVE_DEBOUNCE_MS = 600

export interface AutosaveController {
  stop: () => void
  flush: () => Promise<void>
}

export function startAutosave(
  repository: SlaidsRepository,
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
): AutosaveController {
  let pending: Presentation | null = null
  let inFlight = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const write = async (): Promise<void> => {
    if (inFlight || !pending || stopped) return
    const snapshot = pending
    inFlight = true
    useEditorStore.getState().setSaveStatus('saving')
    try {
      await repository.savePresentation(snapshot)
      inFlight = false
      if (pending === snapshot) {
        pending = null
        useEditorStore.getState().setSaveStatus('saved', new Date().toISOString())
      } else {
        void write()
      }
    } catch (error) {
      inFlight = false
      useEditorStore.getState().setSaveStatus('error')
      notify.error(
        `Kunne ikke lagre: ${error instanceof Error ? error.message : 'ukjent feil'}. Endringene ligger fortsatt i minnet.`,
      )
    }
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void write()
    }, debounceMs)
  }

  const unsubscribe = useEditorStore.subscribe((state, previous) => {
    if (stopped) return
    if (!state.presentation) return
    if (state.presentation === previous.presentation) return
    if (state.saveStatus !== 'dirty') return
    pending = state.presentation
    schedule()
  })

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    await write()
    // A change may have landed while the first write was in flight.
    if (pending && !inFlight) await write()
  }

  const onHide = (): void => {
    if (document.visibilityState === 'hidden') void flush()
  }

  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', flush)

  return {
    stop: () => {
      stopped = true
      unsubscribe()
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
    },
    flush,
  }
}
