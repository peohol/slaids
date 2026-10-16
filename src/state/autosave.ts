/**
 * Debounced autosave.
 *
 * Writes are serialised through a single pump: at most one repository call is in
 * flight, and a change that lands mid-write is picked up by the next iteration.
 * The status only becomes `Saved` once the *latest* snapshot has actually been
 * persisted, and `flush()` does not resolve until the queue is drained — which
 * is what makes leaving the editor or hiding the tab safe.
 */

import type { SlaidsRepository } from '../persistence/repository'
import type { Presentation } from '../domain/types'
import { useEditorStore } from './store'
import { notify } from './toast'

export const AUTOSAVE_DEBOUNCE_MS = 600

export interface AutosaveController {
  stop: () => void
  /**
   * Drain the queue. Resolves `true` when everything the store has produced is
   * stored, `false` when a write failed or the controller was stopped with work
   * still pending — the caller decides what to do about it.
   */
  flush: () => Promise<boolean>
  /**
   * Run `task` once a write has actually landed.
   *
   * Some work is only correct after the *stored* document is the new one:
   * deleting the files an optimised document stopped pointing at, above all.
   * The save that follows such a change can fail, and autosave then keeps
   * retrying it for as long as the editor is mounted — so the work belongs to
   * whichever write finally lands, not to the first attempt. Without this, a
   * moment's trouble with the network would leave those files behind for good:
   * the document that replaced them gets stored a second later, and nothing
   * ever comes back for them.
   *
   * Dropped when the controller stops with the write still pending. The stored
   * document is then still the old one, which still points at those files, and
   * doing the work would be exactly wrong.
   */
  afterSave: (task: () => Promise<void>) => void
}

/**
 * Leave the editor only once the work is safely stored.
 *
 * Autosave retries a failed write for as long as the editor is mounted, and the
 * pending snapshot lives nowhere else. Unmounting on a failed save would throw
 * that change away, so leaving is a save point: flush first, and stay where we
 * are if it did not land. The failure is already on screen, and pressing again
 * simply tries once more.
 */
export async function leaveWhenSaved(
  controller: AutosaveController | null,
  onLeave: () => void,
): Promise<boolean> {
  const saved = controller ? await controller.flush() : true
  if (saved) onLeave()
  return saved
}

export function startAutosave(
  repository: SlaidsRepository,
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
): AutosaveController {
  let pending: Presentation | null = null
  let pumping: Promise<void> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let lastWriteFailed = false
  let afterSaveTasks: (() => Promise<void>)[] = []

  /**
   * Best effort, and deliberately so: the write has landed, the stored document
   * is correct, and nothing a task does can make it wrong. One that throws is
   * the store's own trouble to report.
   */
  const runAfterSaveTasks = async (): Promise<void> => {
    if (afterSaveTasks.length === 0) return
    const tasks = afterSaveTasks
    afterSaveTasks = []
    for (const task of tasks) {
      try {
        await task()
      } catch {
        // Nothing to do here; see above.
      }
    }
  }

  const pump = (): Promise<void> => {
    if (pumping) return pumping
    pumping = (async () => {
      while (pending && !stopped) {
        const snapshot = pending
        useEditorStore.getState().setSaveStatus('saving')
        try {
          await repository.savePresentation(snapshot)
        } catch (error) {
          // Keep `pending` so the next change or flush retries this snapshot,
          // rather than spinning on a failure that is not going away.
          lastWriteFailed = true
          useEditorStore.getState().setSaveStatus('error')
          notify.error(
            `Kunne ikke lagre: ${
              error instanceof Error ? error.message : 'ukjent feil'
            }. Endringene ligger fortsatt i minnet.`,
          )
          return
        }
        lastWriteFailed = false
        if (pending === snapshot) {
          pending = null
          useEditorStore.getState().setSaveStatus('saved', new Date().toISOString())
        }
        // After the status, so the editor says «lagret» the moment it is true
        // rather than when the follow-up work happens to finish.
        await runAfterSaveTasks()
      }
    })().finally(() => {
      pumping = null
    })
    return pumping
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void pump()
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

  const flush = async (): Promise<boolean> => {
    // An undo or redo still waiting for its page is a change the user already
    // made: a save point — leaving, hiding the tab, publishing — stores it too.
    useEditorStore.getState().settleHistory()
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    await pump()
    // A change can land between the pump's last check and its teardown.
    if (pending && !stopped && !lastWriteFailed) await pump()
    return pending === null && !lastWriteFailed
  }

  const onHide = (): void => {
    if (document.visibilityState === 'hidden') void flush()
  }
  const onPageHide = (): void => {
    void flush()
  }

  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onPageHide)

  return {
    stop: () => {
      stopped = true
      afterSaveTasks = []
      unsubscribe()
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
    },
    flush,
    afterSave: (task) => {
      if (!stopped) afterSaveTasks.push(task)
    },
  }
}
