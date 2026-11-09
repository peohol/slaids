/**
 * At most one run per interval, and never a lost one.
 *
 * A call inside the interval is not dropped: it is owed a run, and gets one
 * when the interval has passed — one trailing run however many calls arrived
 * in between. Dropping it instead would let the last word be an old one for as
 * long as nothing calls again (the access re-check: a tab that regains focus
 * just after a check, and then keeps it, would never ask again).
 */

export interface Throttled {
  call: () => void
  cancel: () => void
}

export function throttleWithTrailing(
  run: () => void,
  intervalMs: number,
  /** When the last run happened; a fresh throttle counts from now. */
  lastRunAt: number = Date.now(),
): Throttled {
  let last = lastRunAt
  let timer: ReturnType<typeof setTimeout> | null = null

  const fire = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    last = Date.now()
    run()
  }

  return {
    call: () => {
      const wait = last + intervalMs - Date.now()
      if (wait <= 0) fire()
      else timer ??= setTimeout(fire, wait)
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
