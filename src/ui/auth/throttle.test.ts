import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { throttleWithTrailing } from './throttle'

const INTERVAL = 15_000

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('throttleWithTrailing', () => {
  it('kjører med en gang når intervallet har gått', () => {
    const run = vi.fn()
    const throttled = throttleWithTrailing(run, INTERVAL)

    vi.advanceTimersByTime(INTERVAL)
    throttled.call()

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('mister ikke et kall innenfor intervallet, men kjører det når intervallet er over', () => {
    const run = vi.fn()
    const throttled = throttleWithTrailing(run, INTERVAL)

    vi.advanceTimersByTime(5_000)
    throttled.call()
    expect(run).not.toHaveBeenCalled()

    // Ingen nye kall: den skyldige kjøringen kommer likevel.
    vi.advanceTimersByTime(INTERVAL - 5_000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('slår sammen mange kall innenfor intervallet til én etterslepende kjøring', () => {
    const run = vi.fn()
    const throttled = throttleWithTrailing(run, INTERVAL)

    for (let second = 1; second < 15; second += 1) {
      vi.advanceTimersByTime(1_000)
      throttled.call()
    }
    vi.advanceTimersByTime(INTERVAL)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('teller intervallet fra den etterslepende kjøringen', () => {
    const run = vi.fn()
    const throttled = throttleWithTrailing(run, INTERVAL)
    throttled.call()
    vi.advanceTimersByTime(INTERVAL)
    expect(run).toHaveBeenCalledTimes(1)

    throttled.call()
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(INTERVAL)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('kjører ikke etter at den er avbrutt', () => {
    const run = vi.fn()
    const throttled = throttleWithTrailing(run, INTERVAL)
    throttled.call()

    throttled.cancel()
    vi.advanceTimersByTime(INTERVAL * 2)

    expect(run).not.toHaveBeenCalled()
  })
})
