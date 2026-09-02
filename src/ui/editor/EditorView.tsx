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
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
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
import { buildReferenceSlides } from '../../domain/referenceSlides'
import {
  cloneSubtreeWithNewIds,
  collectLeaves,
  countContent,
  findLeaf,
  findNode,
} from '../../domain/layout'
import { repository } from '../../persistence/activeRepository'
import { leaveWhenSaved, startAutosave } from '../../state/autosave'
import { readPref, writePref } from '../../state/prefs'
import { useEditorStore } from '../../state/store'
import { ok } from '../../domain/result'
import { notify } from '../../state/toast'
import { domFitCheckers, overflowingZoneCount } from '../../state/measure'
import { ensureWebFonts, webFontsReady } from '../fonts'
import { readStructuralClipboard, writeStructuralClipboard } from '../../state/clipboard'
import { materializeClipboardContent } from '../../state/pasteAssets'
import type { LayoutTemplate, Slide, TitleDoc, ZoneContentKind } from '../../domain/types'
import { SlideRenderProvider } from '../slide/SlideRenderContext'
import { ZoneContentView } from '../slide/ZoneContentView'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Modal } from '../components/Modal'
import { EditorStage } from './EditorStage'
import { Filmstrip } from './Filmstrip'
import { Inspector } from './Inspector'
import { ReadOnlySlideStage } from '../slide/ReadOnlySlideStage'
import { ImageUploadModal } from './ImageUploadModal'
import { IdeasWindow } from './IdeasWindow'
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
  const [referencesOpen, setReferencesOpen] = useState(false)
  /** Reference to scroll to and highlight when the list is opened from a pill. */
  const [focusedReference, setFocusedReference] = useState<string | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [imageOpen, setImageOpen] = useState(false)
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
      const zones = overflowingZoneCount(deck)
      if (zones > 0) {
        notify.warning(
          zones === 1
            ? 'Én sone får ikke plass til innholdet sitt etter at fonten ble lastet ferdig.'
            : `${zones} soner får ikke plass til innholdet sitt etter at fonten ble lastet ferdig.`,
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

  /**
   * Reference slides are derived on every render rather than stored, so they
   * always match the citations. They are read-only in the editor.
   */
  const derivedSlides = useMemo(
    () => (presentation ? buildReferenceSlides(presentation) : []),
    [presentation],
  )

  /**
   * Derived by construction rather than synchronised. Selecting an authored
   * slide clears the view outright; remembering which slide it was opened from
   * additionally closes it when the selection moves for some other reason —
   * an undo, or the slide it belonged to being deleted.
   */
  const viewedDerivedSlide =
    derivedView && derivedView.from === currentSlideId
      ? (derivedSlides.find((entry) => entry.id === derivedView.id) ?? null)
      : null

  const numbering = useMemo(
    () => (presentation ? computeReferenceNumbering(presentation) : new Map<string, number>()),
    [presentation],
  )

  const selectedNode = slide && selectedNodeId ? findNode(slide.root, selectedNodeId) : null
  const selectedLeaf = slide && selectedNodeId ? findLeaf(slide.root, selectedNodeId) : null
  const geometry =
    slide && presentation
      ? computeSlideGeometry(slide, geometryForTheme(presentation.theme))
      : null
  const selectedRect = geometry && selectedNodeId ? geometry.rects.get(selectedNodeId) : undefined

  /* -------------------------------------------------------------- *
   * Commands
   * -------------------------------------------------------------- */

  const addContentTo = useCallback(
    (nodeId: string, kind: ZoneContentKind) => {
      if (!slide) return
      runStructural('content-add', (current) =>
        setZoneContent(current, {
          slideId: slide.id,
          nodeId,
          content: createContentOfKind(kind),
          ...domFitCheckers,
        }),
      )
      useEditorStore.getState().selectNode(nodeId)
      setMode('content')
    },
    [runStructural, setMode, slide],
  )

  const applyContentKind = useCallback(
    (kind: ZoneContentKind) => {
      if (!slide || !selectedNodeId) return
      const leaf = findLeaf(slide.root, selectedNodeId)
      if (!leaf) {
        notify.error('Velg en bladsone for å legge inn innhold.')
        return
      }
      if (leaf.content) {
        run('content-kind', (current) =>
          setContentKind(current, {
            slideId: slide.id,
            nodeId: selectedNodeId,
            kind,
            ...domFitCheckers,
          }),
        )
        return
      }
      runStructural('content-add', (current) =>
        setZoneContent(current, {
          slideId: slide.id,
          nodeId: selectedNodeId,
          content: createContentOfKind(kind),
          ...domFitCheckers,
        }),
      )
      setMode('content')
    },
    [run, runStructural, selectedNodeId, setMode, slide],
  )

  const handleSplitApply = useCallback(
    (result: SplitModalResult) => {
      if (!slide || !selectedNodeId) return
      const isSplit = selectedNode?.kind === 'split'
      const ok = isSplit
        ? runStructural('update-split', (current) =>
            updateSplit(current, {
              slideId: slide.id,
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
              slideId: slide.id,
              nodeId: selectedNodeId,
              axis: result.axis,
              weights: result.weights,
              contentTargetIndex: result.contentTargetIndex,
              ...domFitCheckers,
            }),
          )
      if (ok) setSplitOpen(false)
    },
    [runStructural, selectedNode, selectedNodeId, slide],
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

  const removeTitle = useCallback(() => {
    if (!slide?.title) return
    const removed = slide.title
    // `force` is the user's confirmation; the command refuses without it.
    const done = run('toggle-title', (current) =>
      setSlideHasTitle(current, slide.id, false, { force: true }),
    )
    if (done) removedTitles.current.set(slide.id, removed)
  }, [run, slide])

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
    if (!slide) return
    const remembered = removedTitles.current.get(slide.id)
    const restored = run('toggle-title', (current) =>
      setSlideHasTitle(current, slide.id, true, { ...domFitCheckers, title: remembered }),
    )
    if (restored) removedTitles.current.delete(slide.id)
  }, [run, slide])

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
      const target = event.target as HTMLElement | null
      const typing =
        target?.isContentEditable ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT'

      const meta = event.ctrlKey || event.metaKey

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
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
      if (typing) return

      const state = useEditorStore.getState()
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
      const activeSlide = current?.slides.find((entry) => entry.id === state.currentSlideId)
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

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [presenting, redo, runStructural, toggleMode, undo])

  /* -------------------------------------------------------------- *
   * Drag and drop
   * -------------------------------------------------------------- */

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragStart = (event: DragStartEvent): void => {
    const data = event.active.data.current
    if (data?.kind !== 'sandbox-item') return
    setDragItemId(String(data.itemId))

    // Decide valid drop targets here, in an event handler, where the offscreen
    // fit measurement is allowed to render synchronously.
    const current = useEditorStore.getState().presentation
    const activeSlide = current?.slides.find((entry) => entry.id === currentSlideId)
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
      if (!overId.startsWith('zone:') || !slide) return
      runStructural('place-sandbox-item', (current) =>
        placeSandboxItem(current, {
          itemId: String(data.itemId),
          slideId: slide.id,
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
    if (!slide || !selectedNodeId || !selectedNode) return []
    const isLeaf = selectedNode.kind === 'leaf'
    const hasContent = isLeaf && selectedLeaf?.content != null
    const isRoot = slide.root.id === selectedNodeId

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
            moveZoneContentToSandbox(current, { slideId: slide.id, nodeId: selectedNodeId }),
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
        onSelect: () => setImageOpen(true),
      },
    ]
  }, [applyContentKind, runStructural, selectedLeaf, selectedNode, selectedNodeId, slide])

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
        onExit={() => setPresenting(false)}
      />
    )
  }

  // Recomputed on every render, so a dialog can never act on a stale snapshot.
  const deletingZoneNode = deletingZoneId ? findNode(slide.root, deletingZoneId) : null
  const deletingZoneHasContent = deletingZoneNode ? countContent(deletingZoneNode) > 0 : false
  const clearingZoneNode = clearingZoneId ? findNode(slide.root, clearingZoneId) : null
  const clearingZoneHasContent = clearingZoneNode ? countContent(clearingZoneNode) > 0 : false

  const draggedItem = dragItemId
    ? presentation.sandbox.find((item) => item.id === dragItemId) ?? null
    : null

  return (
    <SlideRenderProvider
      value={{
        theme: presentation.theme,
        numbering,
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
            hasTitleZone={slide.title !== null}
            canToggleTitle={viewedDerivedSlide === null}
            selectionIsLeaf={viewedDerivedSlide === null && selectedNode?.kind === 'leaf'}
            selectionHasContent={Boolean(selectedLeaf?.content)}
            sandboxCount={presentation.sandbox.length}
            onBack={() => void handleBack()}
            backPending={leaving}
            onRename={() => {
              setRenameValue(presentation.title)
              setRenameOpen(true)
            }}
            onToggleTitle={() => {
              if (slide.title !== null) {
                if (!isDocEmpty(slide.title)) {
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
            onOpenImage={() => setImageOpen(true)}
            onToggleIdeas={() => setIdeasOpen((open) => !open)}
            onToggleSandbox={() => setSandboxOpen((open) => !open)}
            onPresent={() => setPresenting(true)}
            onOpenTheme={() => setThemeOpen(true)}
          />

          <TextToolbar onInsertReference={() => setReferencesOpen(true)} />

          <div className="editor__body">
            <Filmstrip
              presentation={presentation}
              derivedSlides={derivedSlides}
              viewingDerivedId={viewedDerivedSlide?.id ?? null}
              onSelectDerived={(slideId) =>
                setDerivedView(currentSlideId ? { id: slideId, from: currentSlideId } : null)
              }
              onSelectAuthored={() => setDerivedView(null)}
              onRequestDelete={setDeletingSlide}
              onRequestNewSlide={() => setNewSlideOpen(true)}
            />
            {viewedDerivedSlide ? (
              <ReadOnlySlideStage
                slide={viewedDerivedSlide}
                note="Referanseslides genereres automatisk fra referansene og kan ikke redigeres."
              />
            ) : (
              <EditorStage
                slide={slide}
                actions={zoneActions}
                onAddContent={addContentTo}
                dropTargets={dropTargets}
              />
            )}
            {viewedDerivedSlide ? (
              <aside className="inspector" data-testid="inspector">
                <section className="inspector__section">
                  <h2 className="inspector__heading">Avledet slide</h2>
                  <p className="hint">
                    Denne sliden bygges fra referansene som faktisk er i bruk. Nummereringen følger
                    rekkefølgen de først nevnes i, og oppdateres automatisk.
                  </p>
                </section>
              </aside>
            ) : (
              <Inspector
                // Remounting per selection drops any half-finished panel
                // state, so a dialog can never apply to the wrong zone.
                key={selectedNodeId ?? 'none'}
                slide={slide}
                actions={zoneActions}
                onAddContent={addContentTo}
              />
            )}
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
        currentSlide={slide}
        onApplyTemplate={createSlideFromTemplate}
      />
      <ThemeModal open={themeOpen} onOpenChange={setThemeOpen} />
      <ShortcutsModal open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {imageOpen && (
        <ImageUploadModal
          onOpenChange={setImageOpen}
          zoneNodeId={selectedNode?.kind === 'leaf' ? selectedNodeId : null}
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
