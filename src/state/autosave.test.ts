import { beforeEach, describe, expect, it, vi } from 'vitest'
import { leaveWhenSaved, startAutosave } from './autosave'
import { useEditorStore } from './store'
import { useToasts } from './toast'
import { createPresentation } from '../domain/presentation'
import { setPresentationTitle } from '../domain/commands'
import type { Presentation } from '../domain/types'
import type { SlaidsRepository } from '../persistence/repository'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function fakeRepository() {
  const saved: Presentation[] = []
  const gates: Array<{ promise: Promise<void>; resolve: (value: void) => void; reject: (error: unknown) => void }> = []
  let manual = false
  let failure: string | null = null

  const repository = {
    savePresentation: vi.fn(async (presentation: Presentation) => {
      if (failure) throw new Error(failure)
      saved.push(presentation)
      if (!manual) return
      const gate = deferred<void>()
      gates.push(gate)
      await gate.promise
    }),
  } as unknown as SlaidsRepository

  return {
    repository,
    saved,
    gates,
    setManual: (value: boolean) => {
      manual = value
    },
    /** Make every write reject, as an unreachable Supabase would. */
    setFailure: (message: string | null) => {
      failure = message
    },
  }
}

beforeEach(() => {
  useEditorStore.setState({
    presentation: null,
    past: [],
    future: [],
    saveStatus: 'saved',
    lastLabel: null,
    lastChangeAt: 0,
  })
  useToasts.setState({ toasts: [] })
})

describe('autosave', () => {
  it('writes after the debounce and reports Saved', async () => {
    const fake = fakeRepository()
    const controller = startAutosave(fake.repository, 5)
    useEditorStore.getState().setPresentation(createPresentation({ title: 'A' }))
    useEditorStore.getState().run('rename', (current) => setPresentationTitle(current, 'B'))

    await controller.flush()
    expect(fake.saved.at(-1)?.title).toBe('B')
    expect(useEditorStore.getState().saveStatus).toBe('saved')
    controller.stop()
  })

  it('does not write when nothing is dirty', async () => {
    const fake = fakeRepository()
    const controller = startAutosave(fake.repository, 5)
    useEditorStore.getState().setPresentation(createPresentation({ title: 'A' }))
    await controller.flush()
    expect(fake.saved).toHaveLength(0)
    controller.stop()
  })

  it('persists a change made while a write is already in flight', async () => {
    const fake = fakeRepository()
    fake.setManual(true)
    const controller = startAutosave(fake.repository, 1)

    useEditorStore.getState().setPresentation(createPresentation({ title: 'Start' }))
    useEditorStore.getState().run('rename', (current) => setPresentationTitle(current, 'Første'))

    const flushed = controller.flush()
    await vi.waitFor(() => expect(fake.saved).toHaveLength(1))

    // A second edit lands while the first write is still open.
    useEditorStore.getState().run('rename2', (current) => setPresentationTitle(current, 'Andre'))
    fake.gates[0].resolve()
    await vi.waitFor(() => expect(fake.saved).toHaveLength(2))
    fake.gates[1].resolve()
    await flushed

    expect(fake.saved.at(-1)?.title).toBe('Andre')
    expect(useEditorStore.getState().saveStatus).toBe('saved')
    controller.stop()
  })

  it('never reports Saved while a newer change is unsaved', async () => {
    const fake = fakeRepository()
    fake.setManual(true)
    const controller = startAutosave(fake.repository, 1)

    useEditorStore.getState().setPresentation(createPresentation({ title: 'Start' }))
    useEditorStore.getState().run('rename', (current) => setPresentationTitle(current, 'Første'))
    void controller.flush()
    await vi.waitFor(() => expect(fake.saved).toHaveLength(1))

    useEditorStore.getState().run('rename2', (current) => setPresentationTitle(current, 'Andre'))
    fake.gates[0].resolve()
    await vi.waitFor(() => expect(fake.saved).toHaveLength(2))
    expect(useEditorStore.getState().saveStatus).not.toBe('saved')

    fake.gates[1].resolve()
    await vi.waitFor(() => expect(useEditorStore.getState().saveStatus).toBe('saved'))
    controller.stop()
  })

  it('reports a failed write and keeps the change queued for a retry', async () => {
    const failing = {
      savePresentation: vi
        .fn<(presentation: Presentation) => Promise<void>>()
        .mockRejectedValueOnce(new Error('disk full'))
        .mockResolvedValue(undefined),
    } as unknown as SlaidsRepository
    const controller = startAutosave(failing, 1)

    useEditorStore.getState().setPresentation(createPresentation({ title: 'A' }))
    useEditorStore.getState().run('rename', (current) => setPresentationTitle(current, 'B'))
    await controller.flush()

    expect(useEditorStore.getState().saveStatus).toBe('error')
    expect(useToasts.getState().toasts[0]?.message).toContain('disk full')

    await controller.flush()
    expect(useEditorStore.getState().saveStatus).toBe('saved')
    controller.stop()
  })

  it('reports whether the flush actually landed', async () => {
    const fake = fakeRepository()
    const controller = startAutosave(fake.repository, 1)
    useEditorStore.getState().setPresentation(createPresentation({ title: 'A' }))

    expect(await controller.flush()).toBe(true)

    fake.setFailure('Supabase svarer ikke')
    useEditorStore.getState().run('rename', (current) => setPresentationTitle(current, 'B'))
    expect(await controller.flush()).toBe(false)

    fake.setFailure(null)
    expect(await controller.flush()).toBe(true)
    controller.stop()
  })
})

describe('å forlate editoren', () => {
  it('går tilbake når endringen ble lagret', async () => {
    const fake = fakeRepository()
    const controller = startAutosave(fake.repository, 1)
    useEditorStore.getState().setPresentation(createPresentation({ title: 'A' }))
    useEditorStore.getState().run('rename', (current) => setPresentationTitle(current, 'B'))

    const onLeave = vi.fn()
    expect(await leaveWhenSaved(controller, onLeave)).toBe(true)

    expect(onLeave).toHaveBeenCalledTimes(1)
    expect(fake.saved.at(-1)?.title).toBe('B')
    controller.stop()
  })

  it('blir stående når lagringen feilet', async () => {
    const fake = fakeRepository()
    fake.setFailure('Supabase svarer ikke')
    const controller = startAutosave(fake.repository, 1)
    useEditorStore.getState().setPresentation(createPresentation({ title: 'A' }))
    useEditorStore.getState().run('rename', (current) => setPresentationTitle(current, 'B'))

    const onLeave = vi.fn()
    // Leaving here would take the only copy of the change with it: the pending
    // snapshot lives in the controller, and the controller dies with the view.
    expect(await leaveWhenSaved(controller, onLeave)).toBe(false)
    expect(onLeave).not.toHaveBeenCalled()
    expect(useEditorStore.getState().saveStatus).toBe('error')
    controller.stop()
  })

  it('slipper oss ut når neste forsøk lykkes', async () => {
    const fake = fakeRepository()
    fake.setFailure('Supabase svarer ikke')
    const controller = startAutosave(fake.repository, 1)
    useEditorStore.getState().setPresentation(createPresentation({ title: 'A' }))
    useEditorStore.getState().run('rename', (current) => setPresentationTitle(current, 'B'))

    const onLeave = vi.fn()
    expect(await leaveWhenSaved(controller, onLeave)).toBe(false)

    // Pressing Back again is the retry.
    fake.setFailure(null)
    expect(await leaveWhenSaved(controller, onLeave)).toBe(true)
    expect(onLeave).toHaveBeenCalledTimes(1)
    expect(fake.saved.at(-1)?.title).toBe('B')
    controller.stop()
  })

  it('skriver ikke snapshotet en gang til når kontrolleren stoppes etterpå', async () => {
    const fake = fakeRepository()
    const controller = startAutosave(fake.repository, 1)
    useEditorStore.getState().setPresentation(createPresentation({ title: 'A' }))
    useEditorStore.getState().run('rename', (current) => setPresentationTitle(current, 'B'))

    const onLeave = vi.fn()
    expect(await leaveWhenSaved(controller, onLeave)).toBe(true)

    // What unmount does now: stop, and nothing else. One change, one write.
    controller.stop()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fake.saved).toHaveLength(1)
  })

  it('går tilbake uten videre når det ikke finnes noen autosave', async () => {
    const onLeave = vi.fn()
    expect(await leaveWhenSaved(null, onLeave)).toBe(true)
    expect(onLeave).toHaveBeenCalledTimes(1)
  })
})

describe('autosave, forts.', () => {
  it('stops writing after stop()', async () => {
    const fake = fakeRepository()
    const controller = startAutosave(fake.repository, 1)
    useEditorStore.getState().setPresentation(createPresentation({ title: 'A' }))
    controller.stop()
    useEditorStore.getState().run('rename', (current) => setPresentationTitle(current, 'B'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fake.saved).toHaveLength(0)
  })
})
