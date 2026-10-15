import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './store'
import { useToasts } from './toast'
import { createInteractiveSlide, createPresentation } from '../domain/presentation'
import { createLeaf, createSplit, findNode } from '../domain/layout'
import { createImage, createUntitledCard } from '../domain/content'
import {
  addSlide,
  deleteLayoutNode,
  deleteSlide,
  setContentKind,
  setImagePlan,
  setInteractiveSlideHtml,
  splitLeaf,
} from '../domain/commands'
import { depositIsOpen } from '../domain/imageDeposit'
import { err, ok } from '../domain/result'
import type { Presentation } from '../domain/types'
import { contentAt, interactiveAt, sectionAt } from '../domain/testDecks'

/** A deck of two: the front section every deck opens with, and one split slide. */
function seed(): Presentation {
  const presentation = createPresentation({ title: 'Store' })
  return {
    ...presentation,
    slides: [
      sectionAt(presentation, 0),
      {
        ...contentAt(presentation, 1),
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
    pendingDepositBreak: null,
  })
  useToasts.setState({ toasts: [] })
})

describe('store initialisation', () => {
  it('selects the first slide and its root node', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    const state = useEditorStore.getState()
    expect(state.currentSlideId).toBe(presentation.slides[1].id)
    expect(state.selectedNodeId).toBe(contentAt(presentation, 1).root.id)
    expect(state.saveStatus).toBe('saved')
  })
})

describe('run', () => {
  it('commits a successful command and marks the presentation dirty', () => {
    useEditorStore.getState().setPresentation(seed())
    const ok = useEditorStore.getState().run('add-slide', (presentation) => addSlide(presentation, {}))
    expect(ok).toBe(true)
    expect(useEditorStore.getState().presentation?.slides).toHaveLength(3)
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
    expect(useEditorStore.getState().presentation?.slides).toHaveLength(3)

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().presentation?.slides).toHaveLength(2)
    expect(useEditorStore.getState().canRedo()).toBe(true)

    useEditorStore.getState().redo()
    expect(useEditorStore.getState().presentation?.slides).toHaveLength(3)
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
    const root = contentAt(presentation, 1).root
    if (root.kind !== 'split') throw new Error('expected split')
    const doomed = root.children[1].id
    useEditorStore.getState().selectNode(doomed)

    useEditorStore.getState().runStructural('delete', (current) =>
      deleteLayoutNode(current, { slideId: presentation.slides[1].id, nodeId: doomed }),
    )

    const state = useEditorStore.getState()
    const slide = contentAt(state.presentation!, 1)
    expect(findNode(slide.root, doomed)).toBeNull()
    expect(state.selectedNodeId).toBe(slide.root.id)
  })

  it('keeps a still-valid selection', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    const root = contentAt(presentation, 1).root
    if (root.kind !== 'split') throw new Error('expected split')
    const kept = root.children[0].id
    useEditorStore.getState().selectNode(kept)
    useEditorStore.getState().run('add-slide', (current) => addSlide(current, {}))
    expect(useEditorStore.getState().selectedNodeId).toBe(kept)
  })

  it('clears the active field when its node is gone', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    const root = contentAt(presentation, 1).root
    if (root.kind !== 'split') throw new Error('expected split')
    const doomed = root.children[0].id
    useEditorStore.getState().setActiveField({ nodeId: doomed, subfieldId: null, kind: 'body' })
    useEditorStore.getState().runStructural('delete', (current) =>
      deleteLayoutNode(current, { slideId: presentation.slides[1].id, nodeId: doomed }),
    )
    expect(useEditorStore.getState().activeField).toBeNull()
  })

  it('moves to the slide before it when the current slide is deleted', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    useEditorStore.getState().run('add-slide', (current) => addSlide(current, {}))
    const third = useEditorStore.getState().presentation?.slides[2]
    expect(third).toBeDefined()
    useEditorStore.getState().selectSlide(third!.id)
    useEditorStore.getState().run('delete-slide', (current) => deleteSlide(current, third!.id))
    expect(useEditorStore.getState().currentSlideId).toBe(presentation.slides[1].id)
  })

  it('moves to the nearest earlier slide that survived, when several went at once', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    useEditorStore.getState().run('add-slide', (current) => addSlide(current, {}))
    useEditorStore.getState().run('add-slide', (current) => addSlide(current, {}))
    const slides = useEditorStore.getState().presentation!.slides
    useEditorStore.getState().selectSlide(slides[3].id)
    useEditorStore.getState().run('delete', (current) => ({
      ok: true,
      value: { ...current, slides: [current.slides[0], current.slides[1]] },
    }))
    expect(useEditorStore.getState().currentSlideId).toBe(slides[1].id)
  })

  it('moves to the deck’s first page when nothing before the current slide is left', () => {
    const presentation = seed()
    const replacement = { ...sectionAt(presentation, 0), id: 'new-front' }
    useEditorStore.getState().setPresentation(presentation)
    useEditorStore.getState().selectSlide(presentation.slides[0].id)
    useEditorStore.getState().run('delete', (current) => ({
      ok: true,
      value: { ...current, slides: [replacement, current.slides[1]] },
    }))
    expect(useEditorStore.getState().currentSlideId).toBe('new-front')
  })

  it('goes back to the slide it was added after when adding it is undone', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    useEditorStore.getState().run('add-slide', (current) => addSlide(current, {}))
    const added = useEditorStore.getState().presentation!.slides[2]
    useEditorStore.getState().selectSlide(added.id)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().currentSlideId).toBe(presentation.slides[1].id)
  })
})

describe('runStructural', () => {
  it('warns when content was moved to the sandbox', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    const root = contentAt(presentation, 1).root
    if (root.kind !== 'split') throw new Error('expected split')
    useEditorStore.getState().runStructural('delete', (current) =>
      deleteLayoutNode(current, {
        slideId: presentation.slides[1].id,
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
        slideId: current.slides[1].id,
        nodeId: contentAt(current, 1).root.id,
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
      slides: [sectionAt(presentation, 0), { ...contentAt(presentation, 1), root }],
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

describe('a section slide', () => {
  it('is not what the editor opens on, but is one click away', () => {
    const presentation = seed()
    useEditorStore.getState().setPresentation(presentation)
    // A deck opens where the work is: the front page is first in the strip,
    // but it is two lines of text, not the thing being built.
    expect(useEditorStore.getState().currentSlideId).toBe(presentation.slides[1].id)
  })

  it('has no zone to select, and gives the selection back on the way out', () => {
    const presentation = seed()
    const store = useEditorStore.getState()
    store.setPresentation(presentation)

    store.selectSlide(presentation.slides[0].id)
    expect(useEditorStore.getState().currentSlideId).toBe(presentation.slides[0].id)
    expect(useEditorStore.getState().selectedNodeId).toBeNull()

    useEditorStore.getState().selectSlide(presentation.slides[1].id)
    expect(useEditorStore.getState().selectedNodeId).toBe(contentAt(presentation, 1).root.id)
  })

  it('refuses zone mode, whichever way it is asked for', () => {
    const presentation = seed()
    const store = useEditorStore.getState()
    store.setPresentation(presentation)
    store.selectSlide(presentation.slides[0].id)

    // A section has no layout tree, so there is nothing for a zone action to
    // act on — the toolbar button and Ctrl+E hit the same rule.
    useEditorStore.getState().setMode('zone')
    expect(useEditorStore.getState().mode).toBe('content')
    useEditorStore.getState().toggleMode()
    expect(useEditorStore.getState().mode).toBe('content')
  })

  it('keeps the caret in a section line across a commit', () => {
    const presentation = seed()
    const store = useEditorStore.getState()
    store.setPresentation(presentation)
    store.selectSlide(presentation.slides[0].id)
    useEditorStore
      .getState()
      .setActiveField({ nodeId: '__section_title__', subfieldId: null, kind: 'section-title' })

    // A section line is text on a page, not a node in a layout tree: nothing a
    // command does to the tree can invalidate it.
    useEditorStore.getState().run('typing:section:title', (current) => ok({ ...current }))
    expect(useEditorStore.getState().activeField?.kind).toBe('section-title')
  })

  it('walks the deck with the arrow keys, front page included', () => {
    const presentation = seed()
    const store = useEditorStore.getState()
    store.setPresentation(presentation)

    useEditorStore.getState().stepPage(-1)
    expect(useEditorStore.getState().currentSlideId).toBe(presentation.slides[0].id)
    useEditorStore.getState().stepPage(-1)
    expect(useEditorStore.getState().currentSlideId).toBe(presentation.slides[0].id)
    useEditorStore.getState().stepPage(1)
    expect(useEditorStore.getState().currentSlideId).toBe(presentation.slides[1].id)
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

describe('an interactive slide', () => {
  function seedWithApp(): Presentation {
    const presentation = seed()
    return {
      ...presentation,
      slides: [
        ...presentation.slides,
        createInteractiveSlide({ name: 'Teller', fileName: 'teller.html', html: '<p>x</p>' }),
      ],
    }
  }

  it('has no zone to select and refuses zone mode, like a section', () => {
    const presentation = seedWithApp()
    const store = useEditorStore.getState()
    store.setPresentation(presentation)
    store.selectSlide(presentation.slides[2].id)
    expect(useEditorStore.getState().currentSlideId).toBe(presentation.slides[2].id)
    expect(useEditorStore.getState().selectedNodeId).toBeNull()

    useEditorStore.getState().setMode('zone')
    expect(useEditorStore.getState().mode).toBe('content')

    useEditorStore.getState().selectSlide(presentation.slides[1].id)
    expect(useEditorStore.getState().selectedNodeId).toBe(contentAt(presentation, 1).root.id)
  })

  it('is walked with the arrow keys like any other page', () => {
    const presentation = seedWithApp()
    useEditorStore.getState().setPresentation(presentation)
    useEditorStore.getState().stepPage(1)
    expect(useEditorStore.getState().currentSlideId).toBe(presentation.slides[2].id)
    useEditorStore.getState().stepPage(1)
    expect(useEditorStore.getState().currentSlideId).toBe(presentation.slides[2].id)
  })

  it('replaces its file as an ordinary, undoable edit', () => {
    const presentation = seedWithApp()
    useEditorStore.getState().setPresentation(presentation)
    const slideId = presentation.slides[2].id
    const ok = useEditorStore.getState().run('interactive-replace', (current) =>
      setInteractiveSlideHtml(current, slideId, { fileName: 'quiz.html', html: '<p>ny</p>' }),
    )
    expect(ok).toBe(true)
    expect(interactiveAt(useEditorStore.getState().presentation!, 2).html).toBe('<p>ny</p>')
    useEditorStore.getState().undo()
    expect(interactiveAt(useEditorStore.getState().presentation!, 2)).toMatchObject({
      fileName: 'teller.html',
      html: '<p>x</p>',
    })
    useEditorStore.getState().redo()
    expect(interactiveAt(useEditorStore.getState().presentation!, 2).fileName).toBe('quiz.html')
  })
})


/* ------------------------------------------------------------------ *
 * The image deposit
 *
 * The store is the one place every structural command passes through, which is
 * why the question «does this edit end the deposit» is asked here rather than
 * inside a dozen commands with nothing in common but their outcome.
 * ------------------------------------------------------------------ */

/** A deck of two picture zones, planned and numbered: a deposit waiting. */
function pendingDeposit(): { deck: Presentation; slideId: string; nodeIds: string[] } {
  const presentation = createPresentation({ title: 'Bilder' })
  const leaves = [createLeaf(createImage()), createLeaf(createImage())]
  const base: Presentation = {
    ...presentation,
    imageContext: 'Fotorealistisk, dempet palett.',
    slides: [
      sectionAt(presentation, 0),
      { ...contentAt(presentation, 1), root: createSplit('x', [1, 1], leaves) },
    ],
  }
  const slideId = base.slides[1].id
  const written = setImagePlan(
    base,
    leaves.map((leaf, index) => ({
      slideId,
      nodeId: leaf.id,
      subject: `Motiv nummer ${index + 1}, tydelig forskjellig fra det andre`,
      composition: 'Sentrert motiv.',
      requirements: '',
      avoid: '',
    })),
  )
  if (!written.ok) throw new Error(written.error.message)
  return { deck: written.value, slideId, nodeIds: leaves.map((leaf) => leaf.id) }
}

describe('image deposit guard', () => {
  it('holds back a structural change that would break the deposit', () => {
    const { deck, slideId, nodeIds } = pendingDeposit()
    useEditorStore.getState().setPresentation(deck)

    const committed = useEditorStore.getState().runStructural('delete-zone', (current) =>
      deleteLayoutNode(current, { slideId, nodeId: nodeIds[0], contentDisposition: 'delete' }),
    )

    expect(committed).toBe(false)
    // Nothing was written: the deck is exactly what it was.
    expect(useEditorStore.getState().presentation).toBe(deck)
    expect(useEditorStore.getState().saveStatus).toBe('saved')
    expect(useEditorStore.getState().pendingDepositBreak).not.toBeNull()
  })

  it('cancelling leaves the deck untouched', () => {
    const { deck, slideId, nodeIds } = pendingDeposit()
    useEditorStore.getState().setPresentation(deck)
    useEditorStore.getState().runStructural('delete-zone', (current) =>
      deleteLayoutNode(current, { slideId, nodeId: nodeIds[0], contentDisposition: 'delete' }),
    )

    useEditorStore.getState().cancelDepositBreak()

    expect(useEditorStore.getState().pendingDepositBreak).toBeNull()
    expect(useEditorStore.getState().presentation).toBe(deck)
    expect(depositIsOpen(deck)).toBe(true)
  })

  it('confirming commits the change and abandons the deposit in one undo step', () => {
    const { deck, slideId, nodeIds } = pendingDeposit()
    useEditorStore.getState().setPresentation(deck)
    useEditorStore.getState().runStructural('delete-zone', (current) =>
      deleteLayoutNode(current, { slideId, nodeId: nodeIds[0], contentDisposition: 'delete' }),
    )

    useEditorStore.getState().confirmDepositBreak()

    const after = useEditorStore.getState().presentation as Presentation
    expect(after.imageDeposit).toEqual({ status: 'abandoned', expectedCount: 2 })
    expect(depositIsOpen(after)).toBe(false)
    expect(useEditorStore.getState().saveStatus).toBe('dirty')
    // One decision, one history entry: Ctrl+Z takes both halves back together.
    expect(useEditorStore.getState().past).toHaveLength(1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().presentation).toBe(deck)
  })

  it('lets go of the held change when the user steps through history instead', () => {
    const { deck, slideId, nodeIds } = pendingDeposit()
    useEditorStore.getState().setPresentation(deck)
    // Something to step back to, so undo has somewhere to go.
    useEditorStore.getState().run('add-slide', (current) => addSlide(current, {}))
    const withSlide = useEditorStore.getState().presentation as Presentation

    useEditorStore.getState().runStructural('delete-zone', (current) =>
      deleteLayoutNode(current, { slideId, nodeId: nodeIds[0], contentDisposition: 'delete' }),
    )
    expect(useEditorStore.getState().pendingDepositBreak).not.toBeNull()

    // Ctrl+Z reaches the deck even while the dialog is up — one deck, one
    // history — so the held change is about a document that is no longer here.
    useEditorStore.getState().undo()

    expect(useEditorStore.getState().pendingDepositBreak).toBeNull()
    expect(useEditorStore.getState().presentation).toBe(deck)
    // And confirming afterwards cannot put the undone slide back.
    useEditorStore.getState().confirmDepositBreak()
    expect(useEditorStore.getState().presentation).toBe(deck)
    expect(withSlide.slides.length).toBe(deck.slides.length + 1)
  })

  it('also catches a change of content kind, which is not a structural command', () => {
    const { deck, slideId, nodeIds } = pendingDeposit()
    useEditorStore.getState().setPresentation(deck)

    const committed = useEditorStore
      .getState()
      .run('kind', (current) => setContentKind(current, { slideId, nodeId: nodeIds[1], kind: 'titled-card' }))

    expect(committed).toBe(false)
    expect(useEditorStore.getState().pendingDepositBreak).not.toBeNull()
  })

  it('lets harmless edits through untouched', () => {
    const { deck } = pendingDeposit()
    useEditorStore.getState().setPresentation(deck)

    const committed = useEditorStore.getState().run('add-slide', (current) => addSlide(current, {}))

    expect(committed).toBe(true)
    expect(useEditorStore.getState().pendingDepositBreak).toBeNull()
    expect(depositIsOpen(useEditorStore.getState().presentation as Presentation)).toBe(true)
  })
})
