// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notify, TOAST_DURATION_MS, useToasts, type ToastTone } from './toast'

const messages = () => useToasts.getState().toasts.map((toast) => toast.message)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const toast of useToasts.getState().toasts) useToasts.getState().dismiss(toast.id)
  vi.useRealTimers()
})

describe('toast-meldinger', () => {
  it.each(Object.keys(TOAST_DURATION_MS) as ToastTone[])(
    'en %s-melding forsvinner når tiden dens er ute',
    (tone) => {
      notify[tone]('Hei')
      vi.advanceTimersByTime(TOAST_DURATION_MS[tone] - 1)
      expect(messages()).toEqual(['Hei'])
      vi.advanceTimersByTime(1)
      expect(messages()).toEqual([])
    },
  )

  it.each(Object.keys(TOAST_DURATION_MS) as ToastTone[])(
    'en gjentatt %s-melding vises én gang og står til tiden er ute etter siste gjentakelse',
    (tone) => {
      const duration = TOAST_DURATION_MS[tone]
      notify[tone]('Får ikke plass')
      vi.advanceTimersByTime(duration - 1)
      notify[tone]('Får ikke plass')
      expect(messages()).toEqual(['Får ikke plass'])

      vi.advanceTimersByTime(duration - 1)
      expect(messages()).toEqual(['Får ikke plass'])
      vi.advanceTimersByTime(1)
      expect(messages()).toEqual([])
    },
  )

  it('samme tekst i en annen tone er en egen melding', () => {
    notify.warning('Lagret')
    notify.success('Lagret')
    expect(useToasts.getState().toasts.map((toast) => toast.tone)).toEqual(['warning', 'success'])
  })

  it('en lukket melding kommer ikke tilbake, og en ny med samme tekst får full tid', () => {
    notify.warning('Lukk meg')
    useToasts.getState().dismiss(useToasts.getState().toasts[0].id)
    expect(messages()).toEqual([])

    vi.advanceTimersByTime(TOAST_DURATION_MS.warning / 2)
    notify.warning('Lukk meg')
    vi.advanceTimersByTime(TOAST_DURATION_MS.warning - 1)
    expect(messages()).toEqual(['Lukk meg'])
  })

  it('holder høyst fire meldinger, og de eldste går først', () => {
    for (const text of ['a', 'b', 'c', 'd', 'e']) notify.info(text)
    expect(messages()).toEqual(['b', 'c', 'd', 'e'])
  })
})
