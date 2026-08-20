import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './store'
import { useToasts } from './toast'
import { createPresentation } from '../domain/presentation'
import { createLeaf, createSplit, findNode } from '../domain/layout'
import { createUntitledCard } from '../domain/content'
import { addSlide, deleteLayoutNode, splitLeaf } from '../domain/commands'
import { err, ok } from '../domain/result'
import type { Presentation } from '../domain/types'

function seed(): Presentation {
  const presentation = createPresentation({ title: 'Store' })
  return {
    ...presentation,
    slides: [
      {
        ...presentation.slides[0],
        root: createSplit('x', [1, 1], [createLeaf(createUntitledCard()), createLeaf()]),
      },
    ],
  }
}

beforeEach(() => {
  useEditorStore.setState({
    presentation: null,
    currentSlideId: null,
    selectedNodeId: null,
    activeField: null,
    mode: 'content',
    past: [],
    future: [],
    lastLabel: null,
    lastChangeAt: 0,
    saveStatus: 'saved',
  })
  useToasts.setState({ toasts: [] })
})

describe('store initialisation', () => {
  it('selects the first slide and its root node', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    const state = useEditorStore.getState()
    expect(state.currentSlideId).toBe(presentation.slides[0].id)
    expect(state.selectedNodeId).toBe(presentation.slides[0].root.id)
    expect(state.saveStatus).toBe('saved')
  })
})

describe('run', () => {
  it('commits a successful command and marks the presentation dirty', () => {
    useEditorStore.getState().setPresentation(seed())
    const ok = useEditorStore.getState().run('add-slide', (presentation) => addSlide(presentation, {}))
    expect(ok).toBe(true)
    expect(useEditorStore.getState().presentation?.slides).toHaveLength(2)
    expect(useEditorStore.getState().saveStatus).toBe('dirty')
    expect(useEditorStore.getState().past).toHaveLength(1)
  })

  it('reports a failed command as a toast and changes nothing', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    const result = useEditorStore
      .getState()
      .run('bad', () => err('INVALID_ARGUMENT', 'Nei'))
    expect(result).toBe(false)
    expect(useEditorStore.getState().presentation).toBe(presentation)
    expect(useToasts.getState().toasts[0]?.message).toBe('Nei')
  })

  it('does not push history when the command is a no-op', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    useEditorStore.getState().run('noop', (current) => ok(current))
    expect(useEditorStore.getState().past).toHaveLength(0)
  })

  it('coalesces consecutive typing under the same label', () => {
    useEditorStore.getState().setPresentation(seed())
    for (let i = 0; i < 5; i += 1) {
      useEditorStore.getState().run('typing:a:b', (presentation) => ok({ ...presentation, title: `T${i}` }))
    }
    expect(useEditorStore.getState().past).toHaveLength(1)
    expect(useEditorStore.getState().presentation?.title).toBe('T4')
  })

  it('does not coalesce structural changes', () => {
    useEditorStore.getState().setPresentation(seed())
    useEditorStore.getState().run('add-slide', (presentation) => addSlide(presentation, {}))
    useEditorStore.getState().run('add-slide', (presentation) => addSlide(presentation, {}))
    expect(useEditorStore.getState().past).toHaveLength(2)
  })
})

describe('undo and redo', () => {
  it('restores the previous presentation and can redo it', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    useEditorStore.getState().run('add-slide', (current) => addSlide(current, {}))
    expect(useEditorStore.getState().presentation?.slides).toHaveLength(2)

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().presentation?.slides).toHaveLength(1)
    expect(useEditorStore.getState().canRedo()).toBe(true)

    useEditorStore.getState().redo()
    expect(useEditorStore.getState().presentation?.slides).toHaveLength(2)
  })

  it('clears the redo stack on a new change', () => {
    useEditorStore.getState().setPresentation(seed())
    useEditorStore.getState().run('add-slide', (current) => addSlide(current, {}))
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().future).toHaveLength(1)
    useEditorStore.getState().run('add-slide', (current) => addSlide(current, {}))
    expect(useEditorStore.getState().future).toHaveLength(0)
  })

  it('does nothing when there is no history', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    useEditorStore.getState().undo()
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().presentation).toBe(presentation)
  })
})

describe('selection reconciliation', () => {
  it('falls back to the slide root when the selected node disappears', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    const root = presentation.slides[0].root
    if (root.kind !== 'split') throw new Error('expected split')
    const doomed = root.children[1].id
    useEditorStore.getState().selectNode(doomed)

    useEditorStore.getState().runStructural('delete', (current) =>
      deleteLayoutNode(current, { slideId: presentation.slides[0].id, nodeId: doomed }),
    )

    const state = useEditorStore.getState()
    const slide = state.presentation?.slides[0]
    expect(slide).toBeDefined()
    expect(findNode(slide!.root, doomed)).toBeNull()
    expect(state.selectedNodeId).toBe(slide!.root.id)
  })

  it('keeps a still-valid selection', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    const root = presentation.slides[0].root
    if (root.kind !== 'split') throw new Error('expected split')
    const kept = root.children[0].id
    useEditorStore.getState().selectNode(kept)
    useEditorStore.getState().run('add-slide', (current) => addSlide(current, {}))
    expect(useEditorStore.getState().selectedNodeId).toBe(kept)
  })

  it('clears the active field when its node is gone', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    const root = presentation.slides[0].root
    if (root.kind !== 'split') throw new Error('expected split')
    const doomed = root.children[0].id
    useEditorStore.getState().setActiveField({ nodeId: doomed, subfieldId: null, kind: 'body' })
    useEditorStore.getState().runStructural('delete', (current) =>
      deleteLayoutNode(current, { slideId: presentation.slides[0].id, nodeId: doomed }),
    )
    expect(useEditorStore.getState().activeField).toBeNull()
  })

  it('moves to the first slide when the current slide is deleted', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    useEditorStore.getState().run('add-slide', (current) => addSlide(current, {}))
    const second = useEditorStore.getState().presentation?.slides[1]
    expect(second).toBeDefined()
    useEditorStore.getState().selectSlide(second!.id)
    useEditorStore.getState().run('delete', (current) => ({
      ok: true,
      value: { ...current, slides: [current.slides[0]] },
    }))
    expect(useEditorStore.getState().currentSlideId).toBe(presentation.slides[0].id)
  })
})

describe('runStructural', () => {
  it('warns when content was moved to the sandbox', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    const root = presentation.slides[0].root
    if (root.kind !== 'split') throw new Error('expected split')
    useEditorStore.getState().runStructural('delete', (current) =>
      deleteLayoutNode(current, {
        slideId: presentation.slides[0].id,
        nodeId: root.children[0].id,
        contentDisposition: 'sandbox',
      }),
    )
    expect(useEditorStore.getState().presentation?.sandbox).toHaveLength(1)
    expect(useToasts.getState().toasts[0]?.message).toContain('sandkassen')
  })

  it('surfaces a typed command failure', () => {
    useEditorStore.getState().setPresentation(seed())
    const result = useEditorStore.getState().runStructural('split', (current) =>
      splitLeaf(current, {
        slideId: current.slides[0].id,
        nodeId: current.slides[0].root.id,
        axis: 'x',
        weights: [1, 1],
      }),
    )
    expect(result).toBe(false)
    expect(useToasts.getState().toasts[0]?.message).toContain('allerede delt')
  })
})

describe('navigation', () => {
  it('walks the hierarchy with wraparound', () => {
    const presentation = createPresentation({ title: 'Nav' })
    const a = createLeaf()
    const b = createLeaf()
    const c = createLeaf()
    const root = createSplit('x', [1, 1, 1], [a, b, c])
    useEditorStore.getState().setPresentation({
      ...presentation,
      slides: [{ ...presentation.slides[0], root }],
    })

    const store = useEditorStore.getState()
    expect(store.selectedNodeId).toBe(root.id)
    store.navigate('down')
    expect(useEditorStore.getState().selectedNodeId).toBe(a.id)
    store.navigate('right')
    expect(useEditorStore.getState().selectedNodeId).toBe(b.id)
    store.navigate('left')
    store.navigate('left')
    expect(useEditorStore.getState().selectedNodeId).toBe(c.id)
    store.navigate('up')
    expect(useEditorStore.getState().selectedNodeId).toBe(root.id)
    store.navigate('up')
    expect(useEditorStore.getState().selectedNodeId).toBe(root.id)
  })
})

describe('toasts', () => {
  it('collapses repeated identical messages', () => {
    for (let i = 0; i < 20; i += 1) useToasts.getState().push('warning', 'Samme melding')
    expect(useToasts.getState().toasts).toHaveLength(1)
  })

  it('keeps at most four distinct toasts', () => {
    for (let i = 0; i < 10; i += 1) useToasts.getState().push('info', `Melding ${i}`)
    expect(useToasts.getState().toasts).toHaveLength(4)
    expect(useToasts.getState().toasts[3].message).toBe('Melding 9')
  })
})
