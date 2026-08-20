/**
 * Editor shell.
 *
 * Owns loading, autosave, keyboard shortcuts, drag-and-drop routing and every
 * dialog. All state changes go through domain commands via the store.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  addSlide,
  clearLayoutNode,
  deleteLayoutNode,
  deleteSlide,
  moveIdea,
  moveSlide,
  moveZoneContentToSandbox,
  placeSandboxItem,
  setContentKind,
  setPresentationTitle,
  setSlideHasTitle,
  setZoneContent,
  splitLeaf,
  updateSplit,
} from '../../domain/commands'
import { CONTENT_KIND_LABELS, createContentOfKind } from '../../domain/content'
import { computeReferenceNumbering } from '../../domain/references'
import { computeSlideGeometry } from '../../domain/geometry'
import { cloneSubtreeWithNewIds, findLeaf, findNode } from '../../domain/layout'
import { repository } from '../../persistence/dexieRepository'
import { startAutosave } from '../../state/autosave'
import { readPref, writePref } from '../../state/prefs'
import { useEditorStore } from '../../state/store'
import { notify } from '../../state/toast'
import { fitCheckerFor } from '../../state/measure'
import { loadWebFonts } from '../fonts'
import {
  instantiateClipboardContent,
  readStructuralClipboardSync,
  writeStructuralClipboard,
} from '../../state/clipboard'
import type { LayoutTemplate, Slide, ZoneContentKind } from '../../domain/types'
import { SlideRenderProvider } from '../slide/SlideRenderContext'
import { ZoneContentView } from '../slide/ZoneContentView'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Modal } from '../components/Modal'
import { EditorStage } from './EditorStage'
import { Filmstrip } from './Filmstrip'
import { Inspector } from './Inspector'
import { ImageUploadModal } from './ImageUploadModal'
import { IdeasWindow } from './IdeasWindow'
import { NewSlideModal } from './NewSlideModal'
import { ReferenceModal } from './ReferenceModal'
import { SandboxWindow } from './SandboxWindow'
import { SplitModal, type SplitModalResult } from './SplitModal'
import { StatusBar } from './StatusBar'
import { TemplateModal } from './TemplateModal'
import { TextToolbar } from './TextToolbar'
import { ThemeModal } from './ThemeModal'
import { TopToolbar } from './TopToolbar'
import { PresentView } from '../present/PresentView'
import type { ZoneAction } from './ZoneOverlay'

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
  const mode = useEditorStore((state) => state.mode)
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
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [imageOpen, setImageOpen] = useState(false)
  const [ideasOpen, setIdeasOpen] = useState(() => readPref('ideasOpen', false))
  const [sandboxOpen, setSandboxOpen] = useState(() => readPref('sandboxOpen', false))
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [presenting, setPresenting] = useState(false)
  const [deletingSlide, setDeletingSlide] = useState<Slide | null>(null)
  const [deletingZone, setDeletingZone] = useState<{ nodeId: string; hasContent: boolean } | null>(null)
  const [clearingZone, setClearingZone] = useState<{ nodeId: string; hasContent: boolean } | null>(null)
  const [dragItemId, setDragItemId] = useState<string | null>(null)
  const autosaveRef = useRef<ReturnType<typeof startAutosave> | null>(null)

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
      void controller.flush().finally(() => controller.stop())
      autosaveRef.current = null
    }
  }, [])

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

  useEffect(() => {
    if (!themeFonts) return
    loadWebFonts(themeFonts.split('|'))
  }, [themeFonts])

  const slide = useMemo(
    () => presentation?.slides.find((entry) => entry.id === currentSlideId) ?? null,
    [presentation, currentSlideId],
  )

  const numbering = useMemo(
    () => (presentation ? computeReferenceNumbering(presentation) : new Map<string, number>()),
    [presentation],
  )

  const fits = useMemo(
    () => (presentation ? fitCheckerFor(presentation.theme) : undefined),
    [presentation],
  )

  const selectedNode = slide && selectedNodeId ? findNode(slide.root, selectedNodeId) : null
  const selectedLeaf = slide && selectedNodeId ? findLeaf(slide.root, selectedNodeId) : null
  const geometry = slide ? computeSlideGeometry(slide) : null
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
          fits,
        }),
      )
      useEditorStore.getState().selectNode(nodeId)
      setMode('content')
    },
    [fits, runStructural, setMode, slide],
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
          setContentKind(current, { slideId: slide.id, nodeId: selectedNodeId, kind }),
        )
        return
      }
      runStructural('content-add', (current) =>
        setZoneContent(current, {
          slideId: slide.id,
          nodeId: selectedNodeId,
          content: createContentOfKind(kind),
          fits,
        }),
      )
      setMode('content')
    },
    [fits, run, runStructural, selectedNodeId, setMode, slide],
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
              fits,
            }),
          )
        : runStructural('split-leaf', (current) =>
            splitLeaf(current, {
              slideId: slide.id,
              nodeId: selectedNodeId,
              axis: result.axis,
              weights: result.weights,
              contentTargetIndex: result.contentTargetIndex,
              fits,
            }),
          )
      if (ok) setSplitOpen(false)
    },
    [fits, runStructural, selectedNode, selectedNodeId, slide],
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
      if (next) useEditorStore.getState().selectSlide(next.id)
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
        const payload = readStructuralClipboardSync()
        if (!payload) {
          notify.warning('Utklippstavlen er tom.')
          return
        }
        runStructural('paste-content', (presentationState) =>
          setZoneContent(presentationState, {
            slideId: activeSlide.id,
            nodeId: state.selectedNodeId as string,
            content: instantiateClipboardContent(payload),
            fits,
          }),
        )
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fits, presenting, redo, runStructural, toggleMode, undo])

  /* -------------------------------------------------------------- *
   * Drag and drop
   * -------------------------------------------------------------- */

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragStart = (event: DragStartEvent): void => {
    const data = event.active.data.current
    if (data?.kind === 'sandbox-item') setDragItemId(String(data.itemId))
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    setDragItemId(null)
    const { active, over } = event
    const data = active.data.current
    if (!over) return

    if (data?.kind === 'slide') {
      const targetIndex = presentation?.slides.findIndex((entry) => entry.id === over.id) ?? -1
      if (targetIndex < 0 || active.id === over.id) return
      run('reorder-slide', (current) => moveSlide(current, String(active.id), targetIndex))
      return
    }

    if (data?.kind === 'idea') {
      const overId = String(over.id)
      if (!overId.startsWith('category:')) return
      run('idea-move', (current) =>
        moveIdea(current, String(data.ideaId), overId.slice('category:'.length), Number.MAX_SAFE_INTEGER),
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
          fits,
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
        onSelect: () =>
          setClearingZone({
            nodeId: selectedNodeId,
            hasContent: selectedNode.kind === 'split' || Boolean(hasContent),
          }),
      },
      {
        id: 'delete',
        label: 'Slett sone',
        icon: 'trash',
        disabled: isRoot,
        onSelect: () => setDeletingZone({ nodeId: selectedNodeId, hasContent: Boolean(hasContent) }),
      },
      {
        id: 'image',
        label: 'Sett inn bilde eller figur',
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

  const draggedItem = dragItemId
    ? presentation.sandbox.find((item) => item.id === dragItemId) ?? null
    : null

  return (
    <SlideRenderProvider value={{ theme: presentation.theme, numbering, isStatic: false }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragItemId(null)}
      >
        <div className="editor" data-testid="editor">
          <TopToolbar
            title={presentation.title}
            hasTitleZone={slide.title !== null}
            canToggleTitle
            selectionIsLeaf={selectedNode?.kind === 'leaf'}
            selectionHasContent={Boolean(selectedLeaf?.content)}
            sandboxCount={presentation.sandbox.length}
            onBack={onClose}
            onRename={() => {
              setRenameValue(presentation.title)
              setRenameOpen(true)
            }}
            onToggleTitle={() =>
              run('toggle-title', (current) =>
                setSlideHasTitle(current, slide.id, slide.title === null),
              )
            }
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
              onRequestDelete={setDeletingSlide}
              onRequestNewSlide={() => setNewSlideOpen(true)}
            />
            <EditorStage slide={slide} actions={zoneActions} onAddContent={addContentTo} />
            <Inspector slide={slide} actions={zoneActions} onAddContent={addContentTo} />
          </div>

          <StatusBar presentation={presentation} />
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

      <ReferenceModal open={referencesOpen} onOpenChange={setReferencesOpen} />
      <TemplateModal
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        currentSlide={slide}
        onApplyTemplate={createSlideFromTemplate}
      />
      <ThemeModal open={themeOpen} onOpenChange={setThemeOpen} />
      <ImageUploadModal
        open={imageOpen}
        onOpenChange={setImageOpen}
        targetNodeId={mode === 'zone' && selectedNode?.kind === 'leaf' ? selectedNodeId : null}
      />

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
        open={deletingZone !== null}
        title="Slette sonen?"
        message={
          deletingZone?.hasContent
            ? 'Sonen har innhold. Du kan flytte innholdet til sandkassen i stedet for å slette det.'
            : 'Sonen fjernes, og søsknene fyller plassen.'
        }
        confirmLabel={deletingZone?.hasContent ? 'Slett innholdet' : 'Slett sonen'}
        alternativeLabel={deletingZone?.hasContent ? 'Flytt til sandkassen' : undefined}
        onAlternative={
          deletingZone?.hasContent
            ? () => {
                runStructural('delete-zone', (current) =>
                  deleteLayoutNode(current, {
                    slideId: slide.id,
                    nodeId: deletingZone.nodeId,
                    contentDisposition: 'sandbox',
                  }),
                )
                setDeletingZone(null)
              }
            : undefined
        }
        onConfirm={() => {
          if (!deletingZone) return
          runStructural('delete-zone', (current) =>
            deleteLayoutNode(current, {
              slideId: slide.id,
              nodeId: deletingZone.nodeId,
              contentDisposition: 'delete',
            }),
          )
          setDeletingZone(null)
        }}
        onCancel={() => setDeletingZone(null)}
      />

      <ConfirmDialog
        open={clearingZone !== null}
        title="Tømme sonen?"
        message={
          clearingZone?.hasContent
            ? 'Alle subsoner og alt innhold i denne sonen fjernes.'
            : 'Sonen tømmes.'
        }
        confirmLabel="Tøm og slett innhold"
        alternativeLabel="Flytt innhold til sandkassen"
        onAlternative={() => {
          if (!clearingZone) return
          runStructural('clear-zone', (current) =>
            clearLayoutNode(current, {
              slideId: slide.id,
              nodeId: clearingZone.nodeId,
              contentDisposition: 'sandbox',
            }),
          )
          setClearingZone(null)
        }}
        onConfirm={() => {
          if (!clearingZone) return
          runStructural('clear-zone', (current) =>
            clearLayoutNode(current, {
              slideId: slide.id,
              nodeId: clearingZone.nodeId,
              contentDisposition: 'delete',
            }),
          )
          setClearingZone(null)
        }}
        onCancel={() => setClearingZone(null)}
      />
    </SlideRenderProvider>
  )
}
