/**
 * Editor state.
 *
 * The store owns the current presentation and the selection, and is the only
 * place a domain command is executed. React components never mutate domain
 * objects; they call `run` / `runStructural` with a command.
 */

import { create } from 'zustand'
import type { StructuralOutcome } from '../domain/commands'
import { describeError, type Result } from '../domain/result'
import {
  firstChildIdOf,
  findNode,
  parentIdOf,
  siblingIdOf,
} from '../domain/layout'
import { findSlide } from '../domain/presentation'
import type { NodeId, Presentation, Slide } from '../domain/types'
import { notify } from './toast'

export type EditorMode = 'content' | 'zone'
export type SaveStatus = 'saved' | 'saving' | 'dirty' | 'error'

export interface ActiveField {
  nodeId: NodeId
  /** `null` addresses a card title; a subfield id addresses a body field. */
  subfieldId: string | null
  kind: 'body' | 'card-title' | 'slide-title'
}

interface HistoryEntry {
  presentation: Presentation
  label: string
  at: number
}

const HISTORY_LIMIT = 100
/** Idle gap that ends a typing run. */
const COALESCE_IDLE_MS = 700
/** Hard cap on a single coalesced run, so one Ctrl+Z cannot erase a paragraph. */
const COALESCE_RUN_MS = 4000

interface EditorStore {
  presentation: Presentation | null
  loading: boolean
  loadError: string | null

  currentSlideId: string | null
  selectedNodeId: NodeId | null
  activeField: ActiveField | null
  mode: EditorMode

  past: HistoryEntry[]
  future: HistoryEntry[]
  lastLabel: string | null
  lastChangeAt: number
  coalesceStartedAt: number

  saveStatus: SaveStatus
  lastSavedAt: string | null

  setPresentation: (presentation: Presentation | null) => void
  setLoading: (loading: boolean) => void
  setLoadError: (message: string | null) => void
  setSaveStatus: (status: SaveStatus, savedAt?: string) => void

  run: (label: string, command: (presentation: Presentation) => Result<Presentation>) => boolean
  runStructural: (
    label: string,
    command: (presentation: Presentation) => Result<StructuralOutcome>,
  ) => boolean

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  selectSlide: (slideId: string) => void
  selectNode: (nodeId: NodeId | null) => void
  setMode: (mode: EditorMode) => void
  toggleMode: () => void
  setActiveField: (field: ActiveField | null) => void
  navigate: (direction: 'up' | 'down' | 'left' | 'right') => void

  currentSlide: () => Slide | null
}

function clampHistory(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.length > HISTORY_LIMIT ? entries.slice(entries.length - HISTORY_LIMIT) : entries
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  presentation: null,
  loading: false,
  loadError: null,

  currentSlideId: null,
  selectedNodeId: null,
  activeField: null,
  mode: 'content',

  past: [],
  future: [],
  lastLabel: null,
  lastChangeAt: 0,
  coalesceStartedAt: 0,

  saveStatus: 'saved',
  lastSavedAt: null,

  setPresentation: (presentation) =>
    set({
      presentation,
      currentSlideId: presentation?.slides[0]?.id ?? null,
      selectedNodeId: presentation?.slides[0]?.root.id ?? null,
      activeField: null,
      past: [],
      future: [],
      lastLabel: null,
      lastChangeAt: 0,
      coalesceStartedAt: 0,
      saveStatus: 'saved',
    }),

  setLoading: (loading) => set({ loading }),
  setLoadError: (loadError) => set({ loadError }),
  setSaveStatus: (saveStatus, savedAt) =>
    set(savedAt ? { saveStatus, lastSavedAt: savedAt } : { saveStatus }),

  run: (label, command) => {
    const state = get()
    const current = state.presentation
    if (!current) return false
    const result = command(current)
    if (!result.ok) {
      notify.error(describeError(result.error))
      return false
    }
    if (result.value === current) return true
    commit(set, state, result.value, label)
    return true
  },

  runStructural: (label, command) => {
    const state = get()
    const current = state.presentation
    if (!current) return false
    const result = command(current)
    if (!result.ok) {
      notify.error(describeError(result.error))
      return false
    }
    const { presentation, movedToSandbox, discarded } = result.value
    if (presentation !== current) commit(set, state, presentation, label)
    if (movedToSandbox.length > 0) {
      notify.warning(
        movedToSandbox.length === 1
          ? 'Innholdet ble flyttet til sandkassen.'
          : `${movedToSandbox.length} innholdselementer ble flyttet til sandkassen.`,
      )
    }
    if (discarded.length > 0) {
      notify.warning(
        discarded.length === 1 ? 'Innholdet ble slettet.' : `${discarded.length} innholdselementer ble slettet.`,
      )
    }
    return true
  },

  undo: () => {
    const state = get()
    const previous = state.past[state.past.length - 1]
    if (!previous || !state.presentation) return
    set({
      presentation: previous.presentation,
      past: state.past.slice(0, -1),
      future: [
        ...state.future,
        { presentation: state.presentation, label: previous.label, at: Date.now() },
      ],
      saveStatus: 'dirty',
      lastLabel: null,
      lastChangeAt: 0,
      coalesceStartedAt: 0,
      ...reconcileSelection(previous.presentation, state),
    })
  },

  redo: () => {
    const state = get()
    const next = state.future[state.future.length - 1]
    if (!next || !state.presentation) return
    set({
      presentation: next.presentation,
      future: state.future.slice(0, -1),
      past: clampHistory([
        ...state.past,
        { presentation: state.presentation, label: next.label, at: Date.now() },
      ]),
      saveStatus: 'dirty',
      lastLabel: null,
      lastChangeAt: 0,
      coalesceStartedAt: 0,
      ...reconcileSelection(next.presentation, state),
    })
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  selectSlide: (slideId) => {
    const presentation = get().presentation
    const slide = presentation ? findSlide(presentation, slideId) : null
    if (!slide) return
    set({ currentSlideId: slideId, selectedNodeId: slide.root.id, activeField: null })
  },

  selectNode: (selectedNodeId) => set({ selectedNodeId }),
  setMode: (mode) => set({ mode, activeField: mode === 'zone' ? null : get().activeField }),
  toggleMode: () => {
    const mode = get().mode === 'zone' ? 'content' : 'zone'
    set({ mode, activeField: mode === 'zone' ? null : get().activeField })
  },
  setActiveField: (activeField) => set({ activeField }),

  navigate: (direction) => {
    const state = get()
    const slide = state.currentSlide()
    if (!slide || !state.selectedNodeId) return
    const root = slide.root
    let next: NodeId | null = null
    switch (direction) {
      case 'up':
        next = parentIdOf(root, state.selectedNodeId)
        break
      case 'down':
        next = firstChildIdOf(root, state.selectedNodeId)
        break
      case 'left':
        next = siblingIdOf(root, state.selectedNodeId, -1)
        break
      case 'right':
        next = siblingIdOf(root, state.selectedNodeId, 1)
        break
    }
    if (next) set({ selectedNodeId: next })
  },

  currentSlide: () => {
    const { presentation, currentSlideId } = get()
    if (!presentation || !currentSlideId) return null
    return findSlide(presentation, currentSlideId)
  },
}))

type SetState = (partial: Partial<EditorStore>) => void

function commit(
  set: SetState,
  state: EditorStore,
  next: Presentation,
  label: string,
): void {
  const now = Date.now()
  /**
   * Typing coalesces into one undo step while it stays in the same field, but
   * only within an idle gap and a bounded run length — otherwise a single Ctrl+Z
   * would wipe out a whole paragraph, or edits to two different fields would
   * collapse into each other.
   */
  const coalesce =
    state.lastLabel === label &&
    label.startsWith('typing:') &&
    now - state.lastChangeAt < COALESCE_IDLE_MS &&
    now - state.coalesceStartedAt < COALESCE_RUN_MS &&
    state.past.length > 0

  set({
    presentation: next,
    past: coalesce
      ? state.past
      : clampHistory([...state.past, { presentation: state.presentation as Presentation, label, at: now }]),
    future: [],
    lastLabel: label,
    lastChangeAt: now,
    coalesceStartedAt: coalesce ? state.coalesceStartedAt : now,
    saveStatus: 'dirty',
    ...reconcileSelection(next, state),
  })
}

/**
 * Selection can point at a node that a command removed. Fall back to the slide
 * root rather than leaving a stale id behind.
 */
function reconcileSelection(
  presentation: Presentation,
  state: EditorStore,
): Partial<EditorStore> {
  const slide =
    (state.currentSlideId ? findSlide(presentation, state.currentSlideId) : null) ??
    presentation.slides[0]
  if (!slide) return { currentSlideId: null, selectedNodeId: null, activeField: null }

  const patch: Partial<EditorStore> = {}
  if (slide.id !== state.currentSlideId) patch.currentSlideId = slide.id

  const selectionValid =
    state.selectedNodeId !== null && findNode(slide.root, state.selectedNodeId) !== null
  if (!selectionValid) patch.selectedNodeId = slide.root.id

  if (state.activeField && !findNode(slide.root, state.activeField.nodeId)) {
    patch.activeField = null
  }
  return patch
}
