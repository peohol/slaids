/**
 * Editor shell.
 *
 * Owns loading, autosave, keyboard shortcuts, drag-and-drop routing and every
 * dialog. All state changes go through domain commands via the store.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  addInteractiveSlide,
  addSection,
  addSlide,
  canAcceptContent,
  clearLayoutNode,
  deleteLayoutNode,
  deleteSlide,
  moveSlide,
  moveZoneContentToSandbox,
  placeSandboxItem,
  registerAsset,
  setContentKind,
  setPresentationTitle,
  setSlideHasTitle,
  setZoneContent,
  splitLeaf,
  updateSplit,
} from '../../domain/commands'
import { CONTENT_KIND_LABELS, createContentOfKind } from '../../domain/content'
import { computeReferenceNumbering } from '../../domain/references'
import { isDocEmpty } from '../../domain/richdoc'
import { computeSlideGeometry } from '../../domain/geometry'
import { geometryForTheme } from '../../domain/metrics'
import {
  deckPages,
  deckProgress,
  deckSectionColors,
  derivedPageNote,
  isDerivedPage,
} from '../../domain/pages'
import { sectionGoverning } from '../../domain/presentation'
import { DEFAULT_PILL_COLOR } from '../../domain/constants'
import {
  cloneSubtreeWithNewIds,
  collectLeaves,
  countContent,
  findLeaf,
  findNode,
} from '../../domain/layout'
import { repository } from '../../persistence/activeRepository'
import { leaveWhenSaved, startAutosave } from '../../state/autosave'
import { isInteractiveRuntimeActive } from '../../state/interactiveRuntime'
import { readPref, writePref } from '../../state/prefs'
import { useSharingStore, useShareUrl } from '../../state/sharing'
import { useEditorStore } from '../../state/store'
import { ok } from '../../domain/result'
import { notify } from '../../state/toast'
import { domFitCheckers, overflowingCount } from '../../state/measure'
import { ensureWebFonts, webFontsReady } from '../fonts'
import { readStructuralClipboard, writeStructuralClipboard } from '../../state/clipboard'
import { materializeClipboardContent } from '../../state/pasteAssets'
import type { InteractiveSource } from '../../domain/interactive'
import type { LayoutTemplate, Slide, TitleDoc, ZoneContentKind } from '../../domain/types'
import { SlideRenderProvider } from '../slide/SlideRenderContext'
import { ZoneContentView } from '../slide/ZoneContentView'
import { pillTokenStyle } from '../slide/SlideView'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Modal } from '../components/Modal'
import { SectionInspector } from './SectionInspector'
import { SectionStage } from './SectionStage'
import { InteractiveInspector } from './InteractiveInspector'
import { InteractiveStage } from './InteractiveStage'
import { EditorStage } from './EditorStage'
import { Filmstrip } from './Filmstrip'
import { Inspector } from './Inspector'
import { ReadOnlySlideStage } from '../slide/ReadOnlySlideStage'
import { ImageUploadModal } from './ImageUploadModal'
import { IdeasWindow } from './IdeasWindow'
import { NewInteractiveModal } from './NewInteractiveModal'
import { NewSectionModal } from './NewSectionModal'
import { NewSlideModal } from './NewSlideModal'
import { ReferenceModal } from './ReferenceModal'
import { SandboxWindow } from './SandboxWindow'
import { SplitModal, type SplitModalResult } from './SplitModal'
import { ShortcutsModal } from './ShortcutsModal'
import { StatusBar } from './StatusBar'
import { TemplateModal } from './TemplateModal'
import { TextToolbar } from './TextToolbar'
import { ThemeModal } from './ThemeModal'
import { TopToolbar } from './TopToolbar'
import { PresentView } from '../present/PresentView'
import { DRAG_ACTIVATION, SurfacePointerSensor } from './dragActivation'
import type { ZoneAction } from './ZoneOverlay'

/**
 * Where the pointer is beats where the boxes overlap.
 *
 * Asking what is under the pointer first is what makes a drop land where it
 * looks like it will; the geometric fallback covers keyboard dragging and
 * pointers outside every droppable.
 */
const dropTargetUnderPointer: CollisionDetection = (args) => {
  const pointer = pointerWithin(args)
  return pointer.length > 0 ? pointer : closestCenter(args)
}

/**
 * Is a modal dialog on screen?
 *
 * Asked of the DOM rather than of a list of open-state flags: every dialog in
 * the app is a Radix `Dialog`, which is what `role="dialog"` means here, and a
 * list would have to be remembered every time a new one is added.
 */
function hasOpenDialog(): boolean {
  return document.querySelector('[role="dialog"]') !== null
}

/*
 * A wheel tick smaller than this is trackpad noise, not an intentional
 * scroll — without a deadzone the faint inertia at the end of a gesture would
 * read as another step.
 */
const WHEEL_STEP_DEADZONE = 4

/*
 * One scroll gesture, one slide. A trackpad or a fast wheel fires many events
 * for a single motion; without a cooldown between steps the deck would fly
 * past several slides on one swipe instead of moving the one the arrow keys
 * would.
 */
const WHEEL_STEP_COOLDOWN_MS = 350

export function EditorView({
  presentationId,
  onClose,
}: {
  presentationId: string
  onClose: () => void
}) {
  const presentation = useEditorStore((state) => state.presentation)
  const loading = useEditorStore((state) => state.loading)
  const loadError = useEditorStore((state) => state.loadError)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const currentSlideId = useEditorStore((state) => state.currentSlideId)
  const setPresentation = useEditorStore((state) => state.setPresentation)
  const setLoading = useEditorStore((state) => state.setLoading)
  const setLoadError = useEditorStore((state) => state.setLoadError)
  const setMode = useEditorStore((state) => state.setMode)
  const toggleMode = useEditorStore((state) => state.toggleMode)
  const run = useEditorStore((state) => state.run)
  const runStructural = useEditorStore((state) => state.runStructural)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)

  const [splitOpen, setSplitOpen] = useState(false)
  const [newSlideOpen, setNewSlideOpen] = useState(false)
  const [newSectionOpen, setNewSectionOpen] = useState(false)
  const [newInteractiveOpen, setNewInteractiveOpen] = useState(false)
  const [referencesOpen, setReferencesOpen] = useState(false)
  /** Reference to scroll to and highlight when the list is opened from a pill. */
  const [focusedReference, setFocusedReference] = useState<string | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  /**
   * The image dialog, and whether it still has a question to ask.
   *
   * `'zone'` is a press on an empty picture panel: the user has pointed at
   * where the picture goes, so the dialog does not offer the text field.
   */
  const [imageOpen, setImageOpen] = useState<false | 'ask' | 'zone'>(false)
  const [ideasOpen, setIdeasOpen] = useState(() => readPref('ideasOpen', false))
  const [sandboxOpen, setSandboxOpen] = useState(() => readPref('sandboxOpen', false))
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [presenting, setPresenting] = useState(false)
  const [deletingSlide, setDeletingSlide] = useState<Slide | null>(null)
  const [deletingZoneId, setDeletingZoneId] = useState<string | null>(null)
  const [clearingZoneId, setClearingZoneId] = useState<string | null>(null)
  const [dragItemId, setDragItemId] = useState<string | null>(null)
  const [derivedView, setDerivedView] = useState<{ id: string; from: string } | null>(null)
  const [removingTitle, setRemovingTitle] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  /** Settled web font loads, keyed by the theme they belong to. */
  const [fontLoad, setFontLoad] = useState<{ fonts: string; failed: number } | null>(null)
  /** Titles removed in this session, so toggling the zone back on restores the text. */
  const removedTitles = useRef(new Map<string, TitleDoc>())
  const [dropTargets, setDropTargets] = useState<ReadonlySet<string>>(() => new Set())
  const autosaveRef = useRef<ReturnType<typeof startAutosave> | null>(null)
  const [leaving, setLeaving] = useState(false)

  /* -------------------------------------------------------------- *
   * Loading and autosave
   * -------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    repository
      .loadPresentation(presentationId)
      .then((loaded) => {
        if (cancelled) return
        setPresentation(loaded)
        setLoading(false)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : 'Kunne ikke åpne presentasjonen.')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [presentationId, setLoadError, setLoading, setPresentation])

  useEffect(() => {
    const controller = startAutosave(repository)
    autosaveRef.current = controller
    return () => {
      // No flush here. Leaving through the toolbar is what guarantees the last
      // change is stored, and a second flush from unmount could only race it —
      // by the time this runs the editor is gone and a failure would have
      // nowhere to report to. Closing the tab is still covered by the
      // controller's own pagehide and visibility handlers.
      controller.stop()
      autosaveRef.current = null
    }
  }, [])

  /* -------------------------------------------------------------- *
   * Sharing
   *
   * Deliberately not part of the presentation: it is a fact about the stored
   * row, not about the document, so it is not undoable, not autosaved, and not
   * carried along by a duplicate or a `.slaids` export.
   * -------------------------------------------------------------- */

  const shareUrl = useShareUrl()
  const loadShareState = useSharingStore((state) => state.load)
  const resetShareState = useSharingStore((state) => state.reset)

  useEffect(() => {
    void loadShareState(presentationId)
    return () => resetShareState()
  }, [presentationId, loadShareState, resetShareState])

  /**
   * Publishing is a save point of its own.
   *
   * The audience should see the last version the author saved, so the pending
   * autosave is drained first and nothing is published if that write does not
   * land — the store says so and the toggle stays off. Both directions are
   * guarded against a second press while one is in flight.
   */
  const toggleShare = useCallback(() => {
    const state = useSharingStore.getState()
    if (state.busy || state.status !== 'ready') return
    if (state.shared) {
      void state.disable()
      return
    }
    void state.enable(() => {
      const controller = autosaveRef.current
      return controller ? controller.flush() : Promise.resolve(true)
    })
  }, [])

  /**
   * Going back is a save point: the pending snapshot lives only in the autosave
   * controller, which stops retrying the moment this view unmounts. So the
   * editor stays open until the write lands, and the save error already on
   * screen explains why. Pressing again tries once more.
   */
  const handleBack = useCallback(async (): Promise<void> => {
    setLeaving(true)
    const saved = await leaveWhenSaved(autosaveRef.current, onClose)
    if (!saved) setLeaving(false)
  }, [onClose])

  useEffect(() => {
    return () => {
      useEditorStore.getState().setPresentation(null)
    }
  }, [])

  useEffect(() => {
    writePref('ideasOpen', ideasOpen)
  }, [ideasOpen])

  useEffect(() => {
    writePref('sandboxOpen', sandboxOpen)
  }, [sandboxOpen])

  const themeFonts = presentation
    ? `${presentation.theme.headingFontFamily}|${presentation.theme.bodyFontFamily}`
    : ''

  /**
   * Web fonts are loaded, waited for, and then the deck is re-measured.
   *
   * A presentation that already uses a web font renders with the fallback for
   * the first frames and swaps when the real faces arrive — which changes the
   * metrics under content that was written, and validated, against the real
   * font. Nothing can be rolled back here (the document is simply what it is),
   * but it must not pass unnoticed, so the swap is followed by one pass over
   * the deck and a warning naming how many zones no longer fit.
   */
  useEffect(() => {
    if (!themeFonts) return
    let cancelled = false
    void ensureWebFonts(themeFonts.split('|')).then((loaded) => {
      if (cancelled) return
      setFontLoad({ fonts: themeFonts, failed: loaded.failed.length })
      if (loaded.failed.length > 0) {
        notify.warning(
          `Fonten «${loaded.failed.join('», «')}» kunne ikke lastes. Slidene vises med reservefonten.`,
        )
      }
      if (loaded.ready.length === 0) return
      const deck = useEditorStore.getState().presentation
      if (!deck) return
      const clipped = overflowingCount(deck)
      if (clipped > 0) {
        notify.warning(
          clipped === 1
            ? 'Ett sted i presentasjonen får ikke plass til innholdet sitt etter at fonten ble lastet ferdig.'
            : `${clipped} steder i presentasjonen får ikke plass til innholdet sitt etter at fonten ble lastet ferdig.`,
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [themeFonts])

  /**
   * Derived rather than synchronised: a theme change makes the previous load
   * irrelevant the moment it renders, without an effect to reset it.
   */
  const fontState =
    fontLoad?.fonts === themeFonts
      ? fontLoad.failed > 0
        ? 'failed'
        : 'ready'
      : webFontsReady(themeFonts.split('|'))
        ? 'ready'
        : 'pending'

  const slide = useMemo(
    () => presentation?.slides.find((entry) => entry.id === currentSlideId) ?? null,
    [presentation, currentSlideId],
  )
  /*
   * The three kinds, named once.
   *
   * Everything about zones — the selection, the overlay, the zone tools, the
   * clipboard, the sandbox drop targets — is about a slide that has them,
   * everything about pills and section colours is about a section, and a
   * miniapp's name and file are an interactive slide's. Deriving all three
   * here means the rest of the view says which it means instead of re-testing
   * `slide.kind` at every use.
   */
  const contentSlide = slide?.kind === 'content' ? slide : null
  const section = slide?.kind === 'section' ? slide : null
  const interactive = slide?.kind === 'interactive' ? slide : null
  /** The accent in force here — for chrome drawn outside the slide's own box. */
  const currentAccent =
    presentation && currentSlideId
      ? sectionGoverning(presentation, currentSlideId).accentColor
      : DEFAULT_PILL_COLOR

  /**
   * The generated pages, derived on every render rather than stored: the
   * reference slides always match the citations, and the QR page is there for
   * exactly as long as the share link is. Both are read-only in the editor —
   * turning `Del` off makes the QR page disappear by itself, because nothing
   * ever put it in `presentation.slides`.
   */
  const pages = useMemo(
    () => (presentation ? deckPages(presentation, { shareUrl }) : []),
    [presentation, shareUrl],
  )
  const derived = useMemo(() => pages.filter(isDerivedPage), [pages])
  /**
   * The editor draws the same progress indicator the audience sees, on the
   * stage and on every thumbnail — a deck being edited is a deck, and the strip
   * it takes is reserved on every slide whether or not anyone is watching.
   */
  const progress = useMemo(() => deckProgress(pages), [pages])
  /**
   * Which colours each page inherits, from the section that governs it.
   *
   * Derived from the same page list the indicator is, and for the same reason:
   * it is a fact about the deck rather than about any one page, and every
   * renderer under the provider reads it instead of counting backwards for
   * itself.
   */
  const sectionColors = useMemo(() => deckSectionColors(pages), [pages])

  /**
   * Derived by construction rather than synchronised. Selecting an authored
   * slide clears the view outright; remembering which slide it was opened from
   * additionally closes it when the selection moves for some other reason —
   * an undo, or the slide it belonged to being deleted.
   */
  const viewedDerivedPage =
    derivedView && derivedView.from === currentSlideId
      ? (derived.find((entry) => entry.id === derivedView.id) ?? null)
      : null

  const numbering = useMemo(
    () => (presentation ? computeReferenceNumbering(presentation) : new Map<string, number>()),
    [presentation],
  )

  const selectedNode =
    contentSlide && selectedNodeId ? findNode(contentSlide.root, selectedNodeId) : null
  const selectedLeaf =
    contentSlide && selectedNodeId ? findLeaf(contentSlide.root, selectedNodeId) : null
  const geometry =
    contentSlide && presentation
      ? computeSlideGeometry(contentSlide, geometryForTheme(presentation.theme))
      : null
  const selectedRect = geometry && selectedNodeId ? geometry.rects.get(selectedNodeId) : undefined

  /* -------------------------------------------------------------- *
   * Commands
   * -------------------------------------------------------------- */

  const addContentTo = useCallback(
    (nodeId: string, kind: ZoneContentKind) => {
      if (!contentSlide) return
      runStructural('content-add', (current) =>
        setZoneContent(current, {
          slideId: contentSlide.id,
          nodeId,
          content: createContentOfKind(kind),
          ...domFitCheckers,
        }),
      )
      useEditorStore.getState().selectNode(nodeId)
      setMode('content')
    },
    [contentSlide, runStructural, setMode],
  )

  const applyContentKind = useCallback(
    (kind: ZoneContentKind) => {
      if (!contentSlide || !selectedNodeId) return
      const leaf = findLeaf(contentSlide.root, selectedNodeId)
      if (!leaf) {
        notify.error('Velg en bladsone for å legge inn innhold.')
        return
      }
      if (leaf.content) {
        run('content-kind', (current) =>
          setContentKind(current, {
            slideId: contentSlide.id,
            nodeId: selectedNodeId,
            kind,
            ...domFitCheckers,
          }),
        )
        return
      }
      runStructural('content-add', (current) =>
        setZoneContent(current, {
          slideId: contentSlide.id,
          nodeId: selectedNodeId,
          content: createContentOfKind(kind),
          ...domFitCheckers,
        }),
      )
      setMode('content')
    },
    [contentSlide, run, runStructural, selectedNodeId, setMode],
  )

  const handleSplitApply = useCallback(
    (result: SplitModalResult) => {
      if (!contentSlide || !selectedNodeId) return
      const isSplit = selectedNode?.kind === 'split'
      const ok = isSplit
        ? runStructural('update-split', (current) =>
            updateSplit(current, {
              slideId: contentSlide.id,
              nodeId: selectedNodeId,
              axis: result.axis,
              weights: result.weights,
              childCount: result.weights.length,
              removedDisposition: result.removedDisposition,
              ...domFitCheckers,
            }),
          )
        : runStructural('split-leaf', (current) =>
            splitLeaf(current, {
              slideId: contentSlide.id,
              nodeId: selectedNodeId,
              axis: result.axis,
              weights: result.weights,
              contentTargetIndex: result.contentTargetIndex,
              ...domFitCheckers,
            }),
          )
      if (ok) setSplitOpen(false)
    },
    [contentSlide, runStructural, selectedNode, selectedNodeId],
  )

  /**
   * Insert a slide after the current one and move to it. Creating a slide you
   * cannot see would be a trap.
   */
  const insertSlide = useCallback(
    (hasTitle: boolean, root?: LayoutTemplate['root']) => {
      const current = useEditorStore.getState().presentation
      if (!current) return
      const index = current.slides.findIndex((entry) => entry.id === currentSlideId)
      const insertAt = index >= 0 ? index + 1 : current.slides.length
      const created = run('add-slide', (presentationState) =>
        addSlide(presentationState, { index: insertAt, hasTitle, root }),
      )
      if (!created) return
      const next = useEditorStore.getState().presentation?.slides[insertAt]
      if (next) {
        setDerivedView(null)
        useEditorStore.getState().selectSlide(next.id)
      }
    },
    [currentSlideId, run],
  )

  /**
   * Take the zone away — measured, even though this slide only gains room.
   *
   * The checkers are what make the removal a *guarded* one, and leaving them out
   * is invisible: the guard runs, finds no measurer, and reports no regression.
   * They matter here for a reason that has nothing to do with this slide. A
   * title may cite, and a citation that goes away takes its reference's first
   * occurrence with it — every number after it moves up, and a label that was
   * `1–4` can come back as `1, 2, 5, 6`, wider, in a zone on a slide nobody
   * touched. `restoreTitle` below needs them for the opposite reason, and the
   * command owns both rules.
   */
  const removeTitle = useCallback(() => {
    if (!contentSlide?.title) return
    const removed = contentSlide.title
    // `force` is the user's confirmation; the command refuses without it.
    const done = run('toggle-title', (current) =>
      setSlideHasTitle(current, contentSlide.id, false, { ...domFitCheckers, force: true }),
    )
    if (done) removedTitles.current.set(contentSlide.id, removed)
  }, [contentSlide, run])

  /**
   * Put the zone and the remembered text back in one command.
   *
   * The text was written under whatever font was in force then; the zone it is
   * going back into is measured under the font in force now. Doing it in two
   * steps would validate the zone but not the text, and a failure halfway would
   * leave an empty title zone behind — so the command takes both and either
   * commits both or changes nothing. The remembered title is kept until it has
   * actually been restored.
   */
  const restoreTitle = useCallback(() => {
    if (!contentSlide) return
    const remembered = removedTitles.current.get(contentSlide.id)
    const restored = run('toggle-title', (current) =>
      setSlideHasTitle(current, contentSlide.id, true, { ...domFitCheckers, title: remembered }),
    )
    if (restored) removedTitles.current.delete(contentSlide.id)
  }, [contentSlide, run])

  /**
   * Insert a section after the current slide and move to it.
   *
   * The heading is asked for up front rather than left blank: a section is a
   * heading, and an empty one is a coloured page that says nothing. It is
   * measured on the way in by the command, so a heading too long for one line
   * leaves the dialog open with the text still in it — which is where the
   * author shortens it.
   */
  const insertSection = useCallback(
    (title: string) => {
      const current = useEditorStore.getState().presentation
      if (!current) return false
      const index = current.slides.findIndex((entry) => entry.id === currentSlideId)
      const insertAt = index >= 0 ? index + 1 : current.slides.length
      const created = run('add-section', (presentationState) =>
        addSection(presentationState, { index: insertAt, title, ...domFitCheckers }),
      )
      if (!created) return false
      const next = useEditorStore.getState().presentation?.slides[insertAt]
      if (next) {
        setDerivedView(null)
        useEditorStore.getState().selectSlide(next.id)
      }
      return true
    },
    [currentSlideId, run],
  )

  /**
   * Insert an interactive slide after the current slide and move to it.
   *
   * The file has already passed the door in the dialog; the command checks it
   * again — the same rules, it is cheap — and the deck-wide budget, and a
   * refusal leaves the dialog open with the reason on screen. A slide is
   * created only when the command says yes, so a cancelled or refused dialog
   * never leaves an empty one behind.
   */
  const insertInteractive = useCallback(
    (source: InteractiveSource, name: string) => {
      const current = useEditorStore.getState().presentation
      if (!current) return false
      const index = current.slides.findIndex((entry) => entry.id === currentSlideId)
      const insertAt = index >= 0 ? index + 1 : current.slides.length
      const created = run('add-interactive', (presentationState) =>
        addInteractiveSlide(presentationState, {
          index: insertAt,
          name,
          fileName: source.fileName,
          html: source.html,
        }),
      )
      if (!created) return false
      const next = useEditorStore.getState().presentation?.slides[insertAt]
      if (next) {
        setDerivedView(null)
        useEditorStore.getState().selectSlide(next.id)
      }
      return true
    },
    [currentSlideId, run],
  )

  const createSlideFromTemplate = useCallback(
    (template: LayoutTemplate) => {
      insertSlide(template.hasTitle, cloneSubtreeWithNewIds(template.root))
    },
    [insertSlide],
  )

  /* -------------------------------------------------------------- *
   * Keyboard
   * -------------------------------------------------------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (presenting) return
      // A running miniapp owns the keyboard: no paging, no zone walking, no
      // undo, no F5 — and no `preventDefault`, so a key on Slaids' own exit
      // button is still a press on that button.
      if (isInteractiveRuntimeActive()) return
      const target = event.target as HTMLElement | null
      const typing =
        target?.isContentEditable ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT'

      const meta = event.ctrlKey || event.metaKey

      /*
       * Undo and redo are the document's, always, and the editors inside it
       * keep no history of their own (see `extensions.ts`). Capture phase and
       * `stopImmediatePropagation` are what make that true no matter what has
       * focus: a rich-text field, a dialog, a floating window — the deck is one
       * document, so one Ctrl+Z steps back through one history.
       */
      if (meta && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (event.key.toLowerCase() === 'y' || event.shiftKey) redo()
        else undo()
        return
      }
      if (meta && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        toggleMode()
        return
      }
      if (event.key === 'F5') {
        event.preventDefault()
        setPresenting(true)
        return
      }

      const state = useEditorStore.getState()

      /*
       * Escape leaves zone editing for content editing.
       *
       * Only when nothing is stacked on top: a dialog owns Escape while it is
       * open, and closing it *and* dropping out of zone mode from one press
       * would undo a mode the user did not ask to leave.
       */
      if (event.key === 'Escape' && state.mode === 'zone' && !hasOpenDialog()) {
        event.preventDefault()
        setMode('content')
        return
      }

      if (typing) return

      /*
       * Up and down move through the deck — but not over the shoulder of
       * someone editing text, where they move the caret between lines, and not
       * in zone mode, where they walk the layout tree.
       */
      if (state.mode !== 'zone' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        setDerivedView(null)
        state.stepPage(event.key === 'ArrowDown' ? 1 : -1)
        return
      }

      if (state.mode !== 'zone') return

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault()
        const direction =
          event.key === 'ArrowUp'
            ? 'up'
            : event.key === 'ArrowDown'
              ? 'down'
              : event.key === 'ArrowLeft'
                ? 'left'
                : 'right'
        state.navigate(direction)
        return
      }

      if (!meta) return
      const current = state.presentation
      // Only a slide with zones has anything to cut, copy or paste into.
      const activeSlide = current ? state.currentContentSlide() : null
      if (!current || !activeSlide || !state.selectedNodeId) return
      const leaf = findLeaf(activeSlide.root, state.selectedNodeId)

      if (event.key.toLowerCase() === 'c' && leaf?.content) {
        event.preventDefault()
        writeStructuralClipboard(leaf.content, current.assets)
        notify.info('Innholdet ble kopiert.')
        return
      }
      if (event.key.toLowerCase() === 'x' && leaf?.content) {
        event.preventDefault()
        writeStructuralClipboard(leaf.content, current.assets)
        runStructural('cut-content', (presentationState) =>
          setZoneContent(presentationState, {
            slideId: activeSlide.id,
            nodeId: state.selectedNodeId as string,
            content: null,
            replace: true,
            replacedDisposition: 'delete',
          }),
        )
        return
      }
      if (event.key.toLowerCase() === 'v' && leaf && !leaf.content) {
        event.preventDefault()
        const targetNodeId = state.selectedNodeId
        // The system clipboard is read first so a copy survives a reload or
        // reaches another tab; it falls back to the in-memory payload.
        void readStructuralClipboard().then(async (payload) => {
          if (!payload) {
            notify.warning('Utklippstavlen er tom.')
            return
          }
          const live = useEditorStore.getState().presentation
          if (!live || live.id !== current.id) return
          // Copy any referenced assets into this presentation first, so a paste
          // across presentations does not depend on the source surviving.
          const { content, refs, missing } = await materializeClipboardContent(payload, live)
          if (missing.length > 0) {
            notify.warning(
              missing.length === 1
                ? `Filen «${missing[0].name}» finnes ikke lenger, så den ble ikke med.`
                : `${missing.length} filer finnes ikke lenger, så de ble ikke med.`,
            )
          }
          // Content and the metadata for the files it points at are one commit:
          // undone separately, the document would reference assets the
          // presentation no longer lists, and export would quietly drop them.
          useEditorStore.getState().runStructural('paste-content', (presentationState) => {
            const placed = setZoneContent(presentationState, {
              slideId: activeSlide.id,
              nodeId: targetNodeId,
              content,
              ...domFitCheckers,
            })
            if (!placed.ok) return placed
            let next = placed.value.presentation
            for (const ref of refs) {
              const registered = registerAsset(next, ref)
              if (!registered.ok) return registered
              next = registered.value
            }
            return ok({ ...placed.value, presentation: next })
          })
        })
      }
    }

    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [presenting, redo, runStructural, setMode, toggleMode, undo])

  /*
   * The mouse wheel steps through the deck, the same slide the up and down
   * arrow keys land on — but only while it hovers the stage itself. The
   * filmstrip and inspector panels can scroll their own content, and every
   * stage variant (editor, section, read-only derived page) shares the same
   * `stage-viewport` root, so that's the one selector this checks against
   * rather than naming the panels to exclude.
   */
  useEffect(() => {
    let lastStepAt = 0
    const onWheel = (event: WheelEvent): void => {
      if (presenting) return
      // Over a running miniapp the wheel is the app's, whatever it is over.
      if (isInteractiveRuntimeActive()) return
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('[data-testid="stage-viewport"]')) return
      event.preventDefault()
      if (Math.abs(event.deltaY) < WHEEL_STEP_DEADZONE) return
      const now = Date.now()
      if (now - lastStepAt < WHEEL_STEP_COOLDOWN_MS) return
      lastStepAt = now
      setDerivedView(null)
      useEditorStore.getState().stepPage(event.deltaY > 0 ? 1 : -1)
    }
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => window.removeEventListener('wheel', onWheel, { capture: true })
  }, [presenting])

  /* -------------------------------------------------------------- *
   * Drag and drop
   * -------------------------------------------------------------- */

  /*
   * The constraint here is the default for a surface that asks for nothing.
   * A slide thumbnail is both a link and a drag handle and asks for `hold`
   * instead — see `dragActivation.ts`.
   */
  const sensors = useSensors(
    useSensor(SurfacePointerSensor, { activationConstraint: DRAG_ACTIVATION.immediate }),
  )

  const handleDragStart = (event: DragStartEvent): void => {
    const data = event.active.data.current
    if (data?.kind !== 'sandbox-item') return
    setDragItemId(String(data.itemId))

    // Decide valid drop targets here, in an event handler, where the offscreen
    // fit measurement is allowed to render synchronously.
    const current = useEditorStore.getState().presentation
    const activeSlide = useEditorStore.getState().currentContentSlide()
    const item = current?.sandbox.find((entry) => entry.id === String(data.itemId))
    if (!current || !activeSlide || !item) {
      setDropTargets(new Set())
      return
    }
    const targets = new Set<string>()
    for (const leaf of collectLeaves(activeSlide.root)) {
      if (
        canAcceptContent(current, {
          slideId: activeSlide.id,
          nodeId: leaf.id,
          content: item.content,
          ...domFitCheckers,
        })
      ) {
        targets.add(leaf.id)
      }
    }
    setDropTargets(targets)
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    setDragItemId(null)
    setDropTargets(new Set())
    const { active, over } = event
    const data = active.data.current
    if (!over) return

    if (data?.kind === 'slide') {
      const targetIndex = presentation?.slides.findIndex((entry) => entry.id === over.id) ?? -1
      if (targetIndex < 0 || active.id === over.id) return
      // Reordering renumbers citations, so this is fit-validated like any
      // other change that can shrink what a zone has room for.
      run('reorder-slide', (current) =>
        moveSlide(current, String(active.id), targetIndex, domFitCheckers),
      )
      return
    }

    if (data?.kind === 'sandbox-item') {
      const overId = String(over.id)
      if (!overId.startsWith('zone:') || !contentSlide) return
      runStructural('place-sandbox-item', (current) =>
        placeSandboxItem(current, {
          itemId: String(data.itemId),
          slideId: contentSlide.id,
          nodeId: overId.slice('zone:'.length),
          ...domFitCheckers,
        }),
      )
    }
  }

  /* -------------------------------------------------------------- *
   * Zone actions
   * -------------------------------------------------------------- */

  const zoneActions: ZoneAction[] = useMemo(() => {
    if (!contentSlide || !selectedNodeId || !selectedNode) return []
    const isLeaf = selectedNode.kind === 'leaf'
    const hasContent = isLeaf && selectedLeaf?.content != null
    const isRoot = contentSlide.root.id === selectedNodeId

    return [
      {
        id: 'content',
        label: 'Velg innholdstype',
        icon: 'card',
        disabled: !isLeaf,
        onSelect: () => undefined,
        menu: (Object.keys(CONTENT_KIND_LABELS) as ZoneContentKind[]).map((kind) => ({
          id: kind,
          label: CONTENT_KIND_LABELS[kind],
          icon:
            kind === 'container' ? 'container' : kind === 'untitled-card' ? 'card' : 'card-titled',
          onSelect: () => applyContentKind(kind),
        })),
      },
      {
        id: 'split',
        label: isLeaf ? 'Splitt sone' : 'Rediger splitting',
        icon: isLeaf ? 'split-x' : 'edit',
        onSelect: () => setSplitOpen(true),
        testId: 'zone-action-split',
      },
      {
        id: 'sandbox',
        label: 'Flytt innhold til sandkassen',
        icon: 'sandbox',
        disabled: !hasContent,
        onSelect: () => {
          runStructural('to-sandbox', (current) =>
            moveZoneContentToSandbox(current, {
              slideId: contentSlide.id,
              nodeId: selectedNodeId,
            }),
          )
          setSandboxOpen(true)
        },
      },
      {
        id: 'clear',
        label: 'Tøm sone',
        icon: 'eraser',
        onSelect: () => setClearingZoneId(selectedNodeId),
      },
      {
        id: 'delete',
        label: 'Slett sone',
        icon: 'trash',
        disabled: isRoot,
        onSelect: () => setDeletingZoneId(selectedNodeId),
      },
      {
        id: 'image',
        label: 'Sett inn bilde',
        icon: 'image',
        disabled: !isLeaf,
        onSelect: () => setImageOpen('ask'),
      },
    ]
  }, [applyContentKind, contentSlide, runStructural, selectedLeaf, selectedNode, selectedNodeId])

  /* -------------------------------------------------------------- *
   * Render
   * -------------------------------------------------------------- */

  if (loading) return <div className="editor-loading">Laster presentasjon …</div>
  if (loadError) {
    return (
      <div className="editor-loading">
        <p className="error-text">{loadError}</p>
        <button type="button" className="btn" onClick={onClose}>
          Tilbake til biblioteket
        </button>
      </div>
    )
  }
  if (!presentation || !slide) return <div className="editor-loading">Laster …</div>

  if (presenting) {
    return (
      <PresentView
        presentation={presentation}
        startIndex={presentation.slides.findIndex((entry) => entry.id === currentSlideId)}
        shareUrl={shareUrl}
        onExit={(lastSlideId) => {
          useEditorStore.getState().selectSlide(lastSlideId)
          setPresenting(false)
        }}
      />
    )
  }

  // Recomputed on every render, so a dialog can never act on a stale snapshot.
  const deletingZoneNode =
    contentSlide && deletingZoneId ? findNode(contentSlide.root, deletingZoneId) : null
  const deletingZoneHasContent = deletingZoneNode ? countContent(deletingZoneNode) > 0 : false
  const clearingZoneNode =
    contentSlide && clearingZoneId ? findNode(contentSlide.root, clearingZoneId) : null
  const clearingZoneHasContent = clearingZoneNode ? countContent(clearingZoneNode) > 0 : false

  const draggedItem = dragItemId
    ? presentation.sandbox.find((item) => item.id === dragItemId) ?? null
    : null

  return (
    <SlideRenderProvider
      value={{
        theme: presentation.theme,
        numbering,
        sectionColors,
        progress,
        isStatic: false,
        // A citation is the shortest path to the source it stands for: one
        // reference opens on that reference, several open the list.
        onCitationClick: (referenceIds) => {
          setFocusedReference(referenceIds.length === 1 ? referenceIds[0] : null)
          setReferencesOpen(true)
        },
      }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={dropTargetUnderPointer}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setDragItemId(null)
          setDropTargets(new Set())
        }}
      >
        <div className="editor" data-testid="editor" data-fonts={fontState}>
          <TopToolbar
            title={presentation.title}
            hasTitleZone={contentSlide?.title != null}
            canToggleTitle={viewedDerivedPage === null && contentSlide !== null}
            selectionIsLeaf={
              viewedDerivedPage === null && contentSlide !== null && selectedNode?.kind === 'leaf'
            }
            selectionHasContent={Boolean(selectedLeaf?.content)}
            canEditZones={viewedDerivedPage === null && contentSlide !== null}
            sandboxCount={presentation.sandbox.length}
            onBack={() => void handleBack()}
            backPending={leaving}
            onRename={() => {
              setRenameValue(presentation.title)
              setRenameOpen(true)
            }}
            onToggleTitle={() => {
              if (contentSlide?.title != null) {
                if (!isDocEmpty(contentSlide.title)) {
                  setRemovingTitle(true)
                  return
                }
                removeTitle()
                return
              }
              restoreTitle()
            }}
            onSetContentKind={applyContentKind}
            onOpenReferences={() => setReferencesOpen(true)}
            onOpenTemplates={() => setTemplatesOpen(true)}
            onOpenImage={() => setImageOpen('ask')}
            onToggleIdeas={() => setIdeasOpen((open) => !open)}
            onToggleSandbox={() => setSandboxOpen((open) => !open)}
            onPresent={() => setPresenting(true)}
            onOpenTheme={() => setThemeOpen(true)}
            onToggleShare={toggleShare}
          />

          <TextToolbar onInsertReference={() => setReferencesOpen(true)} />

          <div className="editor__body">
            <Filmstrip
              presentation={presentation}
              derived={derived}
              viewingDerivedId={viewedDerivedPage?.id ?? null}
              onSelectDerived={(pageId) =>
                setDerivedView(currentSlideId ? { id: pageId, from: currentSlideId } : null)
              }
              onSelectAuthored={() => setDerivedView(null)}
              onRequestDelete={setDeletingSlide}
              onRequestNewSlide={() => setNewSlideOpen(true)}
              onRequestNewSection={() => setNewSectionOpen(true)}
              onRequestNewInteractive={() => setNewInteractiveOpen(true)}
            />
            {viewedDerivedPage ? (
              <ReadOnlySlideStage
                page={viewedDerivedPage}
                note={derivedPageNote(viewedDerivedPage)}
              />
            ) : section ? (
              <SectionStage section={section} />
            ) : interactive ? (
              // Keyed by the slide, so moving between two interactive slides
              // replaces the surface — and closes whatever was running on it.
              // The stage and the inspector are siblings in one list, so the
              // two keys must differ: React keys siblings by key alone, and
              // two children under one key leave one of them never removed.
              <InteractiveStage key={`stage:${interactive.id}`} slide={interactive} />
            ) : contentSlide ? (
              <EditorStage
                slide={contentSlide}
                actions={zoneActions}
                onAddContent={addContentTo}
                onPickImage={(nodeId) => {
                  useEditorStore.getState().selectNode(nodeId)
                  setImageOpen('zone')
                }}
                dropTargets={dropTargets}
              />
            ) : null}
            {viewedDerivedPage ? (
              <aside className="inspector" data-testid="inspector">
                <section className="inspector__section">
                  <h2 className="inspector__heading">
                    {viewedDerivedPage.kind === 'qr' ? 'Avledet QR-side' : 'Avledet slide'}
                  </h2>
                  <p className="hint">
                    {viewedDerivedPage.kind === 'qr'
                      ? 'QR-koden peker på delingslenken og lages av Del-knappen. Siden ligger alltid helt sist, etter referansesidene, og forsvinner når du slår av delingen.'
                      : 'Denne sliden bygges fra referansene som faktisk er i bruk. Nummereringen følger rekkefølgen de først nevnes i, og oppdateres automatisk.'}
                  </p>
                </section>
              </aside>
            ) : section ? (
              <SectionInspector section={section} />
            ) : interactive ? (
              <InteractiveInspector key={`inspector:${interactive.id}`} slide={interactive} />
            ) : contentSlide ? (
              <Inspector
                // Remounting per selection drops any half-finished panel
                // state, so a dialog can never apply to the wrong zone.
                key={selectedNodeId ?? 'none'}
                slide={contentSlide}
                actions={zoneActions}
                onAddContent={addContentTo}
              />
            ) : null}
          </div>

          <StatusBar presentation={presentation} onShowShortcuts={() => setShortcutsOpen(true)} />
        </div>

        <DragOverlay dropAnimation={null}>
          {draggedItem && (
            <div className="drag-overlay" data-testid="drag-overlay">
              <div
                style={{
                  width: 480,
                  height: 270,
                  transform: 'scale(0.375)',
                  transformOrigin: 'top left',
                  pointerEvents: 'none',
                  // Dragged outside the slide, but still the accent of the
                  // section the current page belongs to.
                  ...pillTokenStyle(currentAccent),
                }}
              >
                <ZoneContentView content={draggedItem.content} />
              </div>
            </div>
          )}
        </DragOverlay>

        <IdeasWindow open={ideasOpen} onClose={() => setIdeasOpen(false)} />
        <SandboxWindow open={sandboxOpen} onClose={() => setSandboxOpen(false)} />
      </DndContext>

      {splitOpen && selectedRect && (
        <SplitModal
          key={`split-${selectedNodeId}`}
          open={splitOpen}
          onOpenChange={setSplitOpen}
          targetRect={selectedRect}
          mode={selectedNode?.kind === 'split' ? 'edit' : 'create'}
          existingChildren={selectedNode?.kind === 'split' ? selectedNode.children : undefined}
          existingAxis={selectedNode?.kind === 'split' ? selectedNode.axis : undefined}
          existingWeights={selectedNode?.kind === 'split' ? selectedNode.weights : undefined}
          hasContent={Boolean(selectedLeaf?.content)}
          onApply={handleSplitApply}
        />
      )}

      <NewSlideModal
        open={newSlideOpen}
        onOpenChange={setNewSlideOpen}
        onCreate={(hasTitle) => {
          insertSlide(hasTitle)
          setNewSlideOpen(false)
        }}
      />

      <NewSectionModal
        open={newSectionOpen}
        onOpenChange={setNewSectionOpen}
        onCreate={(title) => {
          const created = insertSection(title)
          if (created) setNewSectionOpen(false)
          return created
        }}
      />

      <NewInteractiveModal
        open={newInteractiveOpen}
        onOpenChange={setNewInteractiveOpen}
        onCreate={insertInteractive}
      />

      <ReferenceModal
        open={referencesOpen}
        focusReferenceId={focusedReference}
        onOpenChange={(open) => {
          setReferencesOpen(open)
          if (!open) setFocusedReference(null)
        }}
      />
      <TemplateModal
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        currentSlide={contentSlide}
        onApplyTemplate={createSlideFromTemplate}
      />
      <ThemeModal open={themeOpen} onOpenChange={setThemeOpen} />
      <ShortcutsModal open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {imageOpen && (
        <ImageUploadModal
          onOpenChange={(open) => setImageOpen(open ? imageOpen : false)}
          zoneNodeId={selectedNode?.kind === 'leaf' ? selectedNodeId : null}
          fillZone={imageOpen === 'zone'}
        />
      )}

      <Modal
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Gi presentasjonen nytt navn"
        width={460}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setRenameOpen(false)}>
              Avbryt
            </button>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="rename-presentation-confirm"
              onClick={() => {
                run('rename-presentation', (current) => setPresentationTitle(current, renameValue))
                setRenameOpen(false)
              }}
            >
              Lagre
            </button>
          </>
        }
      >
        <input
          className="input"
          value={renameValue}
          autoFocus
          data-testid="rename-presentation-input"
          onChange={(event) => setRenameValue(event.target.value)}
        />
      </Modal>

      <ConfirmDialog
        open={removingTitle}
        title="Fjerne overskriftssonen?"
        message="Overskriften har tekst. Teksten kan hentes tilbake ved å slå sonen på igjen, eller med Ctrl+Z."
        confirmLabel="Fjern sonen"
        onConfirm={() => {
          removeTitle()
          setRemovingTitle(false)
        }}
        onCancel={() => setRemovingTitle(false)}
      />

      <ConfirmDialog
        open={deletingSlide !== null}
        title="Slette sliden?"
        message="Sliden og alt innhold på den fjernes."
        onConfirm={() => {
          if (!deletingSlide) return
          run('delete-slide', (current) => deleteSlide(current, deletingSlide.id))
          setDeletingSlide(null)
        }}
        onCancel={() => setDeletingSlide(null)}
      />

      <ConfirmDialog
        open={deletingZoneId !== null}
        title="Slette sonen?"
        message={
          deletingZoneHasContent
            ? 'Sonen har innhold. Du kan flytte innholdet til sandkassen i stedet for å slette det.'
            : 'Sonen fjernes, og søsknene fyller plassen.'
        }
        confirmLabel={deletingZoneHasContent ? 'Slett innholdet' : 'Slett sonen'}
        alternativeLabel={deletingZoneHasContent ? 'Flytt til sandkassen' : undefined}
        onAlternative={
          deletingZoneHasContent
            ? () => {
                if (!deletingZoneId) return
                runStructural('delete-zone', (current) =>
                  deleteLayoutNode(current, {
                    slideId: slide.id,
                    nodeId: deletingZoneId,
                    contentDisposition: 'sandbox',
                  }),
                )
                setDeletingZoneId(null)
              }
            : undefined
        }
        onConfirm={() => {
          if (!deletingZoneId) return
          runStructural('delete-zone', (current) =>
            deleteLayoutNode(current, {
              slideId: slide.id,
              nodeId: deletingZoneId,
              // Content is only ever discarded when the dialog said so; if content
              // appeared since (an undo, say), it is rescued instead.
              contentDisposition: deletingZoneHasContent ? 'delete' : 'sandbox',
            }),
          )
          setDeletingZoneId(null)
        }}
        onCancel={() => setDeletingZoneId(null)}
      />

      <ConfirmDialog
        open={clearingZoneId !== null}
        title="Tømme sonen?"
        message={
          clearingZoneHasContent
            ? 'Alle subsoner og alt innhold i denne sonen fjernes.'
            : 'Sonen tømmes.'
        }
        confirmLabel="Tøm og slett innhold"
        alternativeLabel="Flytt innhold til sandkassen"
        onAlternative={() => {
          if (!clearingZoneId) return
          runStructural('clear-zone', (current) =>
            clearLayoutNode(current, {
              slideId: slide.id,
              nodeId: clearingZoneId,
              contentDisposition: 'sandbox',
            }),
          )
          setClearingZoneId(null)
        }}
        onConfirm={() => {
          if (!clearingZoneId) return
          runStructural('clear-zone', (current) =>
            clearLayoutNode(current, {
              slideId: slide.id,
              nodeId: clearingZoneId,
              contentDisposition: clearingZoneHasContent ? 'delete' : 'sandbox',
            }),
          )
          setClearingZoneId(null)
        }}
        onCancel={() => setClearingZoneId(null)}
      />
    </SlideRenderProvider>
  )
}
