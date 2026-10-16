/**
 * Editor state.
 *
 * The store owns the current presentation and the selection, and is the only
 * place a domain command is executed. React components never mutate domain
 * objects; they call `run` / `runStructural` with a command.
 */

import { create } from 'zustand'
import { abandonImageDeposit, type StructuralOutcome } from '../domain/commands'
import { depositIsOpen } from '../domain/imageDeposit'
import { describeError, type Result } from '../domain/result'
import {
  firstChildIdOf,
  findNode,
  parentIdOf,
  siblingIdOf,
} from '../domain/layout'
import { SECTION_SUBTITLE_NODE_ID, SECTION_TITLE_NODE_ID, TITLE_NODE_ID } from '../domain/geometry'
import { findSlide } from '../domain/presentation'
import { slidesTouchedBy } from '../domain/slideChanges'
import type { ContentSlide, NodeId, Presentation, Slide } from '../domain/types'
import { notify } from './toast'

export type EditorMode = 'content' | 'zone'
export type SaveStatus = 'saved' | 'saving' | 'dirty' | 'error'

export interface ActiveField {
  nodeId: NodeId
  /** `null` addresses a card title; a subfield id addresses a body field. */
  subfieldId: string | null
  kind: 'body' | 'card-title' | 'caption' | 'slide-title' | 'section-title' | 'section-subtitle'
}

/** Fields that are text on a page rather than a node in a layout tree. */
const NON_LAYOUT_FIELD_IDS: ReadonlySet<string> = new Set([
  SECTION_TITLE_NODE_ID,
  SECTION_SUBTITLE_NODE_ID,
])

/** The held change, and what to call it in the history once it is committed. */
export interface PendingDepositBreak {
  presentation: Presentation
  label: string
}

interface HistoryEntry {
  presentation: Presentation
  label: string
  at: number
}

const HISTORY_LIMIT = 100
/**
 * How long an undo or redo whose change is on another page shows that page
 * before it changes it — long enough to see where you are, short enough not to
 * wait for it.
 */
export const HISTORY_REVEAL_DELAY_MS = 300
/** Idle gap that ends a typing run. */
const COALESCE_IDLE_MS = 700
/** Hard cap on a single coalesced run, so one Ctrl+Z cannot erase a paragraph. */
const COALESCE_RUN_MS = 4000

interface EditorStore {
  presentation: Presentation | null
  loading: boolean
  loadError: string | null

  currentSlideId: string | null
  /**
   * The selected zone, or `null` when the page has none.
   *
   * A section is a slide like any other as far as selection goes — it is
   * addressed by `currentSlideId`, paged to with the arrow keys, deleted and
   * moved by the same commands — but it has no layout tree, so there is no zone
   * to select and no zone mode to be in. That is the whole of what makes it
   * different here, and it is stated once rather than as a flag beside the id.
   */
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

  /**
   * A change that is finished except for one question: it would end the deck's
   * automatic image deposit, and the user has not said whether that is all
   * right.
   *
   * Held here rather than refused in each command, because "this edit breaks
   * the deposit" is not a property of any one edit. Deleting a numbered zone,
   * emptying it, converting it to text, deleting the slide it is on and cutting
   * its content are five commands with nothing in common except the state they
   * leave behind, and the store is the one place every one of them passes
   * through. So the document is computed, held, and committed only if the user
   * says yes — which is also what makes cancelling free: nothing was written.
   *
   * It is only ever valid against the document it was computed from, so every
   * path that replaces that document lets it go — including undo and redo,
   * which reach the deck even while a dialog is up (see `EditorView`'s capture
   * handler: one deck, one history, whatever has focus). Committing a held
   * change afterwards would put back a document the user had just stepped away
   * from.
   */
  pendingDepositBreak: PendingDepositBreak | null
  /** Commit the held change and give up the deposit, for good. */
  confirmDepositBreak: () => void
  /** Throw the held change away. The deck is exactly as it was. */
  cancelDepositBreak: () => void

  setPresentation: (presentation: Presentation | null) => void
  setLoading: (loading: boolean) => void
  setLoadError: (message: string | null) => void
  setSaveStatus: (status: SaveStatus, savedAt?: string) => void

  run: (label: string, command: (presentation: Presentation) => Result<Presentation>) => boolean
  runStructural: (
    label: string,
    command: (presentation: Presentation) => Result<StructuralOutcome>,
  ) => boolean
  /**
   * Put a document in place that cannot be stepped back from.
   *
   * The optimiser rewrites the deck to point at files it has just stored, and
   * once the rewritten deck is saved the files it stopped pointing at are
   * deleted. An undo entry for that would restore a document pointing at bytes
   * that are gone — a slide with a hole in it, reached by Ctrl+Z. So the change
   * is committed *outside* the history: the document is replaced, the history
   * is cleared, and the dialog that asked for it says so beforehand.
   */
  replaceDocument: (presentation: Presentation) => void

  /**
   * Step back or forwards through the history.
   *
   * A step whose change is on another page goes to that page first and makes
   * the change `HISTORY_REVEAL_DELAY_MS` later, so the user sees what is taken
   * back or put back. Steps asked for meanwhile wait their turn, in order: none
   * is lost and none overtakes another.
   */
  undo: () => void
  redo: () => void
  /**
   * Make every waiting undo and redo now. For a caller about to put a document
   * in place that it computed from the live one: the steps the user asked for
   * meanwhile have to land first, or its check that the deck is still the one
   * it started from would pass for a deck that is about to move.
   */
  settleHistory: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  selectSlide: (slideId: string) => void
  /** Move one page forwards or backwards through the authored slides. */
  stepPage: (delta: number) => void
  selectNode: (nodeId: NodeId | null) => void
  setMode: (mode: EditorMode) => void
  toggleMode: () => void
  setActiveField: (field: ActiveField | null) => void
  navigate: (direction: 'up' | 'down' | 'left' | 'right') => void

  currentSlide: () => Slide | null
  /** The current slide when it has zones — `null` on a section. */
  currentContentSlide: () => ContentSlide | null
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

  pendingDepositBreak: null,

  saveStatus: 'saved',
  lastSavedAt: null,

  setPresentation: (presentation) => {
    // A deck opens where the work is. The front page is page one and sits first
    // in the filmstrip, but it is two lines of text, not the thing being built.
    const opening = presentation ? openingSlide(presentation) : null
    dropSteps()
    set({
      presentation,
      currentSlideId: opening?.id ?? null,
      selectedNodeId: opening?.kind === 'content' ? opening.root.id : null,
      activeField: null,
      past: [],
      future: [],
      lastLabel: null,
      lastChangeAt: 0,
      coalesceStartedAt: 0,
      saveStatus: 'saved',
      // A question about the deck that is being put away is not a question
      // about the one being opened.
      pendingDepositBreak: null,
    })
  },

  setLoading: (loading) => set({ loading }),
  setLoadError: (loadError) => set({ loadError }),
  setSaveStatus: (saveStatus, savedAt) =>
    set(savedAt ? { saveStatus, lastSavedAt: savedAt } : { saveStatus }),

  run: (label, command) => {
    settleSteps(set, get)
    const state = get()
    const current = state.presentation
    if (!current) return false
    const result = command(current)
    if (!result.ok) {
      notify.error(describeError(result.error))
      return false
    }
    if (result.value === current) return true
    if (holdDepositBreak(set, current, result.value, label)) return false
    commit(set, state, result.value, label)
    return true
  },

  runStructural: (label, command) => {
    settleSteps(set, get)
    const state = get()
    const current = state.presentation
    if (!current) return false
    const result = command(current)
    if (!result.ok) {
      notify.error(describeError(result.error))
      return false
    }
    const { presentation, movedToSandbox, discarded } = result.value
    if (holdDepositBreak(set, current, presentation, label)) return false
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

  confirmDepositBreak: () => {
    settleSteps(set, get)
    const state = get()
    const held = state.pendingDepositBreak
    if (!held || !state.presentation) return
    /*
     * One history entry for the edit and the abandonment together. They are one
     * decision — the user was asked about exactly this pairing — so a Ctrl+Z
     * that took the zone back but left the deck without its deposit would undo
     * something nobody did.
     */
    const given = abandonImageDeposit(held.presentation)
    if (!given.ok) {
      notify.error(describeError(given.error))
      set({ pendingDepositBreak: null })
      return
    }
    set({ pendingDepositBreak: null })
    commit(set, get(), given.value, held.label)
  },

  cancelDepositBreak: () => set({ pendingDepositBreak: null }),

  replaceDocument: (presentation) => {
    if (get().presentation?.id !== presentation.id) return
    // Steps asked for before this go first; the history they leave is cleared
    // with the rest.
    settleSteps(set, get)
    const state = get()
    set({
      presentation,
      past: [],
      future: [],
      lastLabel: null,
      lastChangeAt: 0,
      coalesceStartedAt: 0,
      pendingDepositBreak: null,
      saveStatus: 'dirty',
      ...reconcileSelection(presentation, state),
    })
  },

  undo: () => requestStep(set, get, 'undo'),
  redo: () => requestStep(set, get, 'redo'),
  settleHistory: () => settleSteps(set, get),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  selectSlide: (slideId) => {
    const presentation = get().presentation
    const slide = presentation ? findSlide(presentation, slideId) : null
    if (!slide) return
    set({
      currentSlideId: slideId,
      selectedNodeId: slide.kind === 'content' ? slide.root.id : null,
      activeField: null,
      // Zone mode has nothing to act on where there are no zones, so leaving it
      // on would show zone tools for a page that has none.
      ...(slide.kind === 'content' ? null : { mode: 'content' as EditorMode }),
    })
  },

  /**
   * The deck as the arrow keys walk it: the authored slides, in order.
   *
   * The derived pages are deliberately not in the walk. They are generated, so
   * there is nothing to edit when the caret arrives, and the two of them that
   * exist at all depend on state — a citation, a share link — that the reader
   * of an arrow key has not asked about.
   */
  stepPage: (delta) => {
    const state = get()
    const presentation = state.presentation
    if (!presentation) return
    const slides = presentation.slides
    const current = slides.findIndex((slide) => slide.id === state.currentSlideId)
    if (current < 0) return
    const next = current + delta
    if (next < 0 || next >= slides.length) return
    get().selectSlide(slides[next].id)
  },

  selectNode: (selectedNodeId) => set({ selectedNodeId }),
  /*
   * Zone mode is refused on a section rather than merely hidden there: a
   * section has no layout tree, so every zone action would have nothing to act
   * on. Keeping the rule here means the toolbar button and Ctrl+E obey the same
   * one, instead of each remembering it.
   */
  setMode: (mode) => set(modePatch(get(), mode)),
  toggleMode: () => set(modePatch(get(), get().mode === 'zone' ? 'content' : 'zone')),
  setActiveField: (activeField) => set({ activeField }),

  navigate: (direction) => {
    const state = get()
    const slide = state.currentContentSlide()
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

  currentContentSlide: () => {
    const slide = get().currentSlide()
    return slide?.kind === 'content' ? slide : null
  },
}))

/** Where a freshly loaded deck opens: the first page with something to build. */
function openingSlide(presentation: Presentation): Slide {
  return presentation.slides.find((slide) => slide.kind === 'content') ?? presentation.slides[0]
}

function modePatch(state: EditorStore, mode: EditorMode): Partial<EditorStore> {
  if (mode === 'zone' && state.currentContentSlide() === null) return {}
  return { mode, activeField: mode === 'zone' ? null : state.activeField }
}

type SetState = (partial: Partial<EditorStore>) => void
type GetState = () => EditorStore
type HistoryDirection = 'undo' | 'redo'

/**
 * Undo and redo presses waiting their turn, and the timer of the one whose page
 * is on show. Kept beside the store rather than in it: nothing renders them,
 * and a timer is not state a component could subscribe to.
 */
const historySteps: {
  queued: HistoryDirection[]
  timer: ReturnType<typeof setTimeout> | null
} = { queued: [], timer: null }

function requestStep(set: SetState, get: GetState, direction: HistoryDirection): void {
  // The held change was computed from the document the user is stepping away
  // from, so the question about it goes now, not when the step lands.
  if (get().pendingDepositBreak) set({ pendingDepositBreak: null })
  historySteps.queued.push(direction)
  if (historySteps.timer === null) runSteps(set, get)
}

/**
 * Make the waiting steps in order. One whose change is on another page goes
 * there and makes the change after `HISTORY_REVEAL_DELAY_MS`; the ones behind
 * it wait, and each of them is asked the same question when its turn comes.
 */
function runSteps(set: SetState, get: GetState): void {
  while (historySteps.queued.length > 0) {
    const state = get()
    const entry = historyEntry(state, historySteps.queued[0])
    const page = entry ? pageToReveal(state, entry.presentation) : null
    if (page) {
      state.selectSlide(page)
      historySteps.timer = setTimeout(() => {
        historySteps.timer = null
        applyStep(set, get(), historySteps.queued.shift() as HistoryDirection)
        runSteps(set, get)
      }, HISTORY_REVEAL_DELAY_MS)
      return
    }
    applyStep(set, state, historySteps.queued.shift() as HistoryDirection)
  }
}

/**
 * Make every waiting step now. A new edit belongs after the steps the user
 * asked for before it, so it must not be computed from the document they were
 * about to leave.
 */
function settleSteps(set: SetState, get: GetState): void {
  if (historySteps.timer !== null) clearTimeout(historySteps.timer)
  historySteps.timer = null
  while (historySteps.queued.length > 0) {
    applyStep(set, get(), historySteps.queued.shift() as HistoryDirection)
  }
}

/** Forget the waiting steps: the history they would step through is gone. */
function dropSteps(): void {
  if (historySteps.timer !== null) clearTimeout(historySteps.timer)
  historySteps.timer = null
  historySteps.queued.length = 0
}

function historyEntry(state: EditorStore, direction: HistoryDirection): HistoryEntry | null {
  const entries = direction === 'undo' ? state.past : state.future
  return entries[entries.length - 1] ?? null
}

/** The page to show before going to `next`, or `null` when the change is in view already. */
function pageToReveal(state: EditorStore, next: Presentation): string | null {
  if (!state.presentation) return null
  const touched = slidesTouchedBy(state.presentation, next)
  if (touched.length === 0) return null
  if (state.currentSlideId !== null && touched.includes(state.currentSlideId)) return null
  return touched[0]
}

function applyStep(set: SetState, state: EditorStore, direction: HistoryDirection): void {
  const entry = historyEntry(state, direction)
  if (!entry || !state.presentation) return
  const left = { presentation: state.presentation, label: entry.label, at: Date.now() }
  set({
    presentation: entry.presentation,
    ...(direction === 'undo'
      ? { past: state.past.slice(0, -1), future: [...state.future, left] }
      : { future: state.future.slice(0, -1), past: clampHistory([...state.past, left]) }),
    saveStatus: 'dirty',
    lastLabel: null,
    lastChangeAt: 0,
    coalesceStartedAt: 0,
    // The held change was computed from the document that just went away.
    pendingDepositBreak: null,
    ...reconcileSelection(entry.presentation, state),
  })
}

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
 * Hold a change back when it would end the deck's image deposit.
 *
 * Asked of the *prospective* document rather than of the command that produced
 * it: the question is only ever "are the numbered zones still 1‥N afterwards",
 * and that has one answer however the deck got there. A deck with no open
 * deposit is never held, so this costs a cheap predicate on the commands of
 * decks that have nothing to lose.
 *
 * `true` means the caller must not commit — the dialog is up.
 */
function holdDepositBreak(
  set: SetState,
  current: Presentation,
  next: Presentation,
  label: string,
): boolean {
  if (next === current) return false
  if (!depositIsOpen(current) || depositIsOpen(next)) return false
  set({ pendingDepositBreak: { presentation: next, label } })
  return true
}

/**
 * The page to land on when the current one is gone: the nearest one before it
 * that is still there.
 *
 * Deleting the page you are on — or undoing the one you just added — should
 * leave you where you were in the deck, not send you back to the front page.
 * Only when nothing before it survived is the deck's first page the answer.
 */
function survivingNeighbour(
  previous: Presentation | null,
  next: Presentation,
  slideId: string | null,
): Slide {
  const slides = previous?.slides ?? []
  const index = slides.findIndex((slide) => slide.id === slideId)
  for (let at = index - 1; at >= 0; at -= 1) {
    const survivor = findSlide(next, slides[at].id)
    if (survivor) return survivor
  }
  return next.slides[0]
}

/**
 * Selection can point at a slide or a node that a command removed. Fall back to
 * the slide before it, and to the slide root, rather than leaving a stale id
 * behind.
 */
function reconcileSelection(
  presentation: Presentation,
  state: EditorStore,
): Partial<EditorStore> {
  const slide =
    (state.currentSlideId ? findSlide(presentation, state.currentSlideId) : null) ??
    survivingNeighbour(state.presentation, presentation, state.currentSlideId)

  const patch: Partial<EditorStore> = {}
  if (slide.id !== state.currentSlideId) patch.currentSlideId = slide.id

  // A section has no zones, so there is no selection to keep and none to fall
  // back to — which is exactly what `null` says.
  if (slide.kind !== 'content') {
    return { ...patch, selectedNodeId: null, mode: 'content' }
  }

  const selectionValid =
    state.selectedNodeId !== null && findNode(slide.root, state.selectedNodeId) !== null
  if (!selectionValid) patch.selectedNodeId = slide.root.id

  /* Only a field that addresses a *layout node* can be invalidated by a command:
     a slide title and a section's two lines are text on a page, not nodes, and
     clearing them here would drop the toolbar out from under the caret on the
     first keystroke. */
  if (
    state.activeField &&
    state.activeField.nodeId !== TITLE_NODE_ID &&
    !NON_LAYOUT_FIELD_IDS.has(state.activeField.nodeId) &&
    !findNode(slide.root, state.activeField.nodeId)
  ) {
    patch.activeField = null
  }
  return patch
}
