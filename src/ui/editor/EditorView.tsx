/**
 * The editor.
 *
 * Owns loading, autosave, keyboard shortcuts, drag-and-drop routing, the
 * discrete «choose a target zone» placements, and every dialog. All state
 * changes go through domain commands via the store.
 *
 * It also builds the three big surfaces — the strip, the stage, the inspector —
 * and hands them to a *shell*, which decides only where they go. There are two
 * shells, and exactly one of them is mounted: the roomy three-column layout,
 * and the compact one for a window too small to hold it. See
 * `shell/editorShell.ts` for why that is one at a time rather than two trees
 * with one hidden.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  addInteractiveSlide,
  addSection,
  addSlide,
  clearLayoutNode,
  deleteLayoutNode,
  deleteSlide,
  duplicateLayoutNode,
  moveSlide,
  moveZoneContent,
  moveZoneContentToSandbox,
  placeSandboxItem,
  reorderLayoutNode,
  setContentKind,
  setPresentationTitle,
  setSlideHasTitle,
  setZoneContent,
  splitLeaf,
  updateSplit,
  type StructuralOutcome,
} from '../../domain/commands'
import { HUMAN_EDIT, setSplitWeightsByHand } from '../../domain/commands/manualLayout'
import { contentIsEmpty, createContentOfKind, imagePanelOf } from '../../domain/content'
import { CONTENT_KIND_ICONS, CONTENT_KIND_TONES, contentKindOptions } from './contentKinds'
import { computeReferenceNumbering } from '../../domain/references'
import { isDocEmpty } from '../../domain/richdoc'
import { TITLE_NODE_ID, computeSlideGeometry } from '../../domain/geometry'
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
  breadcrumbLabels,
  cloneSubtreeWithNewIds,
  collectContent,
  countContent,
  findLeaf,
  findNode,
  findParent,
  findSplit,
} from '../../domain/layout'
import { repository } from '../../persistence/activeRepository'
import { leaveWhenSaved, startAutosave } from '../../state/autosave'
import { isInteractiveRuntimeActive } from '../../state/interactiveRuntime'
import { readPref, writePref } from '../../state/prefs'
import { useSharingStore, useShareUrl } from '../../state/sharing'
import { useEditorStore, type ActiveField } from '../../state/store'
import { notify } from '../../state/toast'
import { ensureWebFonts, webFontsReady } from '../fonts'
import { copyZoneToClipboard, cutZoneToClipboard, pasteClipboardIntoZone } from './zoneClipboard'
import type { InteractiveSource } from '../../domain/interactive'
import type { OptimizationScope } from '../../domain/imageOptimization'
import type {
  LayoutTemplate,
  Presentation,
  Slide,
  TitleDoc,
  ZoneContentKind,
} from '../../domain/types'
import { describeError, err, type Result } from '../../domain/result'
import { SlideRenderProvider } from '../slide/SlideRenderContext'
import { ZoneContentView } from '../slide/ZoneContentView'
import { pillTokenStyle } from '../slide/SlideView'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ContextMenuHost } from '../components/ContextMenuHost'
import {
  anchorBelow,
  anchorInside,
  useContextMenu,
  type MenuAnchor,
} from '../components/contextMenu'
import {
  canClearZone,
  reorderStepForKey,
  ROOT_REMOVE_REASON,
  ZONE_ACTIONS,
  zoneModeMenu,
  type ZoneMenuHandlers,
} from './contextMenu/zoneMenu'
import { contentModeMenu, type ContentMenuHandlers } from './contextMenu/contentMenu'
import {
  contentTargetAt,
  contentTargetOfSelection,
  type ContentTarget,
  type FieldTarget,
} from './contextMenu/contentTarget'
import { sectionMenu } from './contextMenu/sectionMenu'
import type { TextMenuHandlers } from './contextMenu/textMenu'
import { useActiveEditor } from '../../state/activeEditor'
import { Modal } from '../components/Modal'
import { SectionInspector } from './SectionInspector'
import { SectionStage } from './SectionStage'
import { InteractiveInspector } from './InteractiveInspector'
import { InteractiveStage } from './InteractiveStage'
import { EditorStage, type StageMenuHit } from './EditorStage'
import { Filmstrip } from './Filmstrip'
import { insertionIndex, pageName, placementText, type NewPageRequest } from './pageKinds'
import { Inspector } from './Inspector'
import { InspectorHeader, InspectorPanel } from './InspectorParts'
import { ReadOnlySlideStage } from './ReadOnlySlideStage'
import { ImageOptimizeModal } from './ImageOptimizeModal'
import { ImageUploadModal } from './ImageUploadModal'
import { IdeasWindow } from './IdeasWindow'
import { NewInteractiveModal } from './NewInteractiveModal'
import { NewSectionModal } from './NewSectionModal'
import { NewSlideModal } from './NewSlideModal'
import { ReferenceModal } from './ReferenceModal'
import { SandboxWindow } from './SandboxWindow'
import { SplitModal, type SplitModalResult } from './SplitModal'
import { splitCheck, type SplitCheck } from './splitDraft'
import { ShortcutsModal } from './ShortcutsModal'
import { editorShortcutFor } from './editorShortcuts'
import { AutocorrectModal } from './AutocorrectModal'
import { StatusBar } from './StatusBar'
import { TemplateModal } from './TemplateModal'
import { TextToolbar } from './TextToolbar'
import { depositIsWaiting } from '../../domain/imageDeposit'
import { ImageBriefModal } from './ImageBriefModal'
import { ImageDepositIntroModal } from './ImageDepositIntroModal'
import { ImageDepositModal } from './ImageDepositModal'
import { ThemeModal } from './ThemeModal'
import { useUserSettings } from '../../state/userSettings'
import { PresentView } from '../present/PresentView'
import { useSurfacePointerSensor } from './dragActivation'
import type { ZoneAction } from './ZoneOverlay'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { CompactEditorShell } from './shell/CompactEditorShell'
import { DesktopEditorShell } from './shell/DesktopEditorShell'
import type { CompactPanel, EditorShellProps } from './shell/editorShell'
import {
  PLACEMENT_PROMPT,
  placementTargets,
  type Placement,
  type PlacementSource,
} from './placement'
import { activeFieldFor, firstFieldIn, type TextTargetEntry } from './textTarget'
import { focusFieldRect, isZoneField, liveFocus, type StageFocus } from './stageFocus'
import { NO_ZOOM, isZoomed, type StageZoom } from './stageView'

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
 * Is a modal dialog — or a context menu — on screen?
 *
 * Asked of the DOM rather than of a list of open-state flags: every dialog in
 * the app is a Radix `Dialog`, which is what `role="dialog"` means here, and a
 * list would have to be remembered every time a new one is added. A menu owns
 * Escape the same way a dialog does: closing it must not also leave zone mode.
 */
function hasOpenDialog(): boolean {
  return document.querySelector('[role="dialog"], [role="menu"]') !== null
}

/*
 * A wheel tick smaller than this is trackpad noise, not an intentional
 * scroll — without a deadzone the faint inertia at the end of a gesture would
 * read as another step.
 */
const WHEEL_STEP_DEADZONE = 4

/*
 * One scroll gesture, one slide. A trackpad or a fast wheel fires many events
 * for a single motion, so the deck would otherwise fly past several slides on
 * one swipe instead of moving the one the arrow keys would.
 *
 * What ends a gesture is the quiet after it, not a stopwatch started at the
 * last step: a flick keeps sending events for as long as its momentum lasts,
 * and any fixed cooldown short enough to feel responsive is shorter than that
 * momentum — so the tail of one swipe would step the deck again, and again.
 * Every event instead pushes the end of the gesture ahead of itself, and only
 * an event arriving into silence steps. A wheel turned notch by notch has that
 * silence between the notches, so deliberate stepping still steps.
 */
const WHEEL_GESTURE_GAP_MS = 150

/**
 * Where the deck's picture errand is: explaining itself, handing over the
 * brief, taking the files back, or nowhere — the ordinary editor.
 */
type ImageStep = null | 'intro' | 'brief' | 'deposit'

export function EditorView({
  presentationId,
  onClose,
  openThemeOnLoad = false,
}: {
  presentationId: string
  onClose: () => void
  /** Åpne temaeditoren straks dekket er lastet: et nettopp opprettet dekk (§ 15.1). */
  openThemeOnLoad?: boolean
}) {
  const presentation = useEditorStore((state) => state.presentation)
  const loading = useEditorStore((state) => state.loading)
  const loadError = useEditorStore((state) => state.loadError)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const currentSlideId = useEditorStore((state) => state.currentSlideId)
  const setPresentation = useEditorStore((state) => state.setPresentation)
  const setLoading = useEditorStore((state) => state.setLoading)
  const setLoadError = useEditorStore((state) => state.setLoadError)
  const mode = useEditorStore((state) => state.mode)
  const setMode = useEditorStore((state) => state.setMode)
  const toggleMode = useEditorStore((state) => state.toggleMode)
  const run = useEditorStore((state) => state.run)
  const runStructural = useEditorStore((state) => state.runStructural)
  const depositBreak = useEditorStore((state) => state.pendingDepositBreak)
  const confirmDepositBreak = useEditorStore((state) => state.confirmDepositBreak)
  const cancelDepositBreak = useEditorStore((state) => state.cancelDepositBreak)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const openContextMenu = useContextMenu((state) => state.open)

  const [splitOpen, setSplitOpen] = useState(false)
  /** Which new-page dialog is open, and where its page goes. */
  const [newPage, setNewPage] = useState<NewPageRequest | null>(null)
  const closeNewPage = (open: boolean): void => {
    if (!open) setNewPage(null)
  }
  const [referencesOpen, setReferencesOpen] = useState(false)
  /** Reference to scroll to and highlight when the list is opened from a pill. */
  const [focusedReference, setFocusedReference] = useState<string | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(openThemeOnLoad)
  /**
   * Where the deck's picture errand is on screen, as one value.
   *
   * A deck waiting for its pictures walks one path — it explains itself, hands
   * over the brief, then takes the files — and the steps replace each other
   * rather than stack. Three booleans would allow two of them at once, which is
   * a state with no meaning; `null` is the ordinary editor.
   */
  const [imageStep, setImageStep] = useState<ImageStep>(null)
  /**
   * The image dialog, and whether it still has a question to ask.
   *
   * `'zone'` is a press on an empty picture panel: the user has pointed at
   * where the picture goes, so the dialog does not offer the text field.
   */
  const [imageOpen, setImageOpen] = useState<false | 'ask' | 'zone'>(false)
  /** The picture optimiser, and which files it is about. `null` while closed. */
  const [optimizeScope, setOptimizeScope] = useState<OptimizationScope | null>(null)
  const [ideasOpen, setIdeasOpen] = useState(() => readPref('ideasOpen', false))
  const [sandboxOpen, setSandboxOpen] = useState(() => readPref('sandboxOpen', false))
  const toggleSandbox = useCallback(() => setSandboxOpen((open) => !open), [])
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
  const [autocorrectOpen, setAutocorrectOpen] = useState(false)
  /** Settled web font loads, keyed by the theme they belong to. */
  const [fontLoad, setFontLoad] = useState<{ fonts: string; failed: number } | null>(null)
  /** Titles removed in this session, so toggling the zone back on restores the text. */
  const removedTitles = useRef(new Map<string, TitleDoc>())
  const [dropTargets, setDropTargets] = useState<ReadonlySet<string>>(() => new Set())
  const autosaveRef = useRef<ReturnType<typeof startAutosave> | null>(null)
  const [leaving, setLeaving] = useState(false)
  /**
   * Content waiting for a zone to be pressed, or `null`.
   *
   * The discrete half of every content drag — see `placement.ts`. It is UI
   * state and nothing else: what finally happens is the same domain command a
   * drop runs.
   */
  const [placement, setPlacement] = useState<Placement | null>(null)
  /**
   * The one field filling the compact stage, or `null` for the whole page —
   * the two states of `stageFocus.ts`.
   *
   * Held here for the same reason the panel choice is: a rotation that crosses
   * the compact threshold swaps the shell, and a state the shell was holding
   * would go with it. Read through `liveFocus`, never directly, so it cannot
   * outlive the field it is about.
   */
  const [stageFocus, setStageFocus] = useState<StageFocus | null>(null)
  /**
   * The pinch on the stage, and which step of the ladder it belongs to.
   *
   * Kept beside a key rather than reset by an effect: a magnification of one
   * zone means nothing on the next slide, so a zoom whose key no longer matches
   * simply is not the current one. Stated in slide coordinates, so rotating the
   * phone or opening a panel keeps looking at the same part of the page.
   */
  const [stageZoom, setStageZoom] = useState<{ key: string; zoom: StageZoom }>(() => ({
    key: '',
    zoom: NO_ZOOM,
  }))

  /*
   * How much room there is and how precisely it can be pointed at. Two facts
   * about the browser window; neither is ever written to the document.
   *
   * Read before the state that depends on it: the panel below decides its very
   * first value from the shape the session started in.
   */
  const workspace = useWorkspace()
  const compact = workspace.compact

  /**
   * The compact surface the user last opened.
   *
   * Held here rather than in the shell that draws it: rotating a tablet across
   * the compact threshold swaps which shell is mounted, and a choice the shell
   * was holding would go with it. The first value is the shape the session
   * started in — upright, the text below the preview is the work; on its side
   * the slide is, and nothing opens until it is asked for.
   */
  const [compactPanel, setCompactPanel] = useState<CompactPanel | null>(() =>
    workspace.compact && workspace.orientation === 'portrait' ? 'content' : null,
  )

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
        /*
         * A deck that is waiting for its pictures says so as it opens.
         *
         * Here rather than in an effect on the document, because this is the
         * act of opening — the one moment the question belongs to. Declining is
         * not a decision, so the deck asks again next time it is opened, and it
         * stops asking the moment the pictures are in, which is the only thing
         * that actually settles it.
         */
        if (depositIsWaiting(loaded)) setImageStep('intro')
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

  /**
   * How many pictures the deck is still waiting for, or 0.
   *
   * `depositIsWaiting` rather than «has a deposit»: a deck whose zones have all
   * been filled by hand is finished, and offering to fill them again would be
   * offering to redo somebody's work.
   */
  const depositCount = useMemo(
    () =>
      presentation && depositIsWaiting(presentation)
        ? (presentation.imageDeposit?.expectedCount ?? 0)
        : 0,
    [presentation],
  )

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
   * Web fonts are loaded and waited for.
   *
   * A presentation that already uses a web font renders with the fallback for
   * the first frames and swaps when the real faces arrive. Text that no longer
   * fits at normal size after the swap is drawn smaller and marked, like any
   * other text that does not fit (`ZoneFitBox`, `titleFit.ts`), so there is
   * nothing to warn about — only a font that could not be loaded at all.
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
  const includeReferencesInProgress = useUserSettings((state) => state.includeReferencesInProgress)
  const progress = useMemo(
    () => deckProgress(pages, includeReferencesInProgress),
    [pages, includeReferencesInProgress],
  )
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
  /**
   * The content kinds as they stand for the selected zone.
   *
   * Built once and handed to every surface that offers them — the toolbar, the
   * zone menu and the compact tools panel — so «what fits here» is asked of the
   * domain in one place. The picker drawn *inside* an empty zone asks for its
   * own zone rather than the selected one, which is the same rule about a
   * different rectangle.
   */
  const selectionKindOptions = useMemo(
    () => contentKindOptions(selectedRect ?? null, presentation?.theme, selectedLeaf?.content ?? null),
    [presentation?.theme, selectedLeaf?.content, selectedRect],
  )

  /* -------------------------------------------------------------- *
   * Commands
   * -------------------------------------------------------------- */

  /**
   * Put fresh content of this kind into an empty zone, and go where it leads.
   *
   * The one way an empty zone is filled, whichever control asked — the picker
   * drawn in the zone, the inspector, the toolbar menu — so that what follows
   * is the same from all three. What follows for a picture is the upload
   * dialog: a new picture panel has no file, and the only thing anyone does
   * with an empty panel is choose one, so asking for a click on the panel first
   * was a step that led nowhere else. The dialog opens in `'zone'` mode for the
   * reason a press on the panel does — the user has already pointed at where
   * the picture goes — and cancelling it leaves the empty panel, exactly as
   * cancelling after that press did.
   */
  const addContentTo = useCallback(
    (nodeId: string, kind: ZoneContentKind, { keepMode = false }: { keepMode?: boolean } = {}) => {
      if (!contentSlide) return
      const content = createContentOfKind(kind)
      const placed = runStructural('content-add', (current) =>
        setZoneContent(current, {
          slideId: contentSlide.id,
          nodeId,
          content,
          ...HUMAN_EDIT,
        }),
      )
      useEditorStore.getState().selectNode(nodeId)
      /*
       * On a roomy workspace, filling a zone is an invitation to type in it,
       * so the editor goes where the caret will be. On a compact one the stage
       * is never typed on — the text is opened on its own surface — and the
       * zone panel the content was added from is still the panel on screen, so
       * dropping out of zone mode would take the outlines away from under it.
       * And a context menu never changes the mode at all: it acts on the zone
       * it was opened on, in the mode it was opened in.
       */
      if (!compact && !keepMode) setMode('content')
      if (placed && imagePanelOf(content)) setImageOpen('zone')
    },
    [compact, contentSlide, runStructural, setMode],
  )

  /**
   * Give a zone content of this kind: fresh content in an empty one, the same
   * content converted in a full one.
   */
  const applyContentKindTo = useCallback(
    (nodeId: string, kind: ZoneContentKind) => {
      if (!contentSlide) return
      const leaf = findLeaf(contentSlide.root, nodeId)
      if (!leaf) {
        notify.error('Velg en bladsone for å legge inn innhold.')
        return
      }
      if (leaf.content) {
        run('content-kind', (current) =>
          setContentKind(current, {
            slideId: contentSlide.id,
            nodeId,
            kind,
            ...HUMAN_EDIT,
          }),
        )
        return
      }
      addContentTo(nodeId, kind)
    },
    [addContentTo, contentSlide, run],
  )

  const applyContentKind = useCallback(
    (kind: ZoneContentKind) => {
      if (selectedNodeId) applyContentKindTo(selectedNodeId, kind)
    },
    [applyContentKindTo, selectedNodeId],
  )

  /**
   * The command the split dialog's proposal stands for — `updateSplit` on a
   * split, `splitLeaf` on a leaf — with the editor's fit checks. One builder
   * for both the dialog's dry run and «Bruk», so what the dialog warns about
   * is what «Bruk» then does.
   *
   * A proposal that keeps the split's direction and its zones and changes only
   * the ratio is a resize by hand, as the same ratio picked from the zone menu
   * is (`setWeights` below). En ny retning eller et annet antall soner er en ny
   * struktur, men også den er en persons valg: innhold som ikke lenger får
   * plass i normal størrelse, blir i sonen sin og tegnes mindre (`HUMAN_EDIT`).
   */
  const splitCommand = useCallback(
    (result: SplitModalResult) =>
      (current: Presentation): Result<StructuralOutcome> => {
        if (!contentSlide || !selectedNodeId) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')
        if (
          selectedNode?.kind === 'split' &&
          result.axis === selectedNode.axis &&
          result.weights.length === selectedNode.children.length
        ) {
          return setSplitWeightsByHand(current, {
            slideId: contentSlide.id,
            nodeId: selectedNodeId,
            weights: result.weights,
          })
        }
        return selectedNode?.kind === 'split'
          ? updateSplit(current, {
              slideId: contentSlide.id,
              nodeId: selectedNodeId,
              axis: result.axis,
              weights: result.weights,
              childCount: result.weights.length,
              removedDisposition: result.removedDisposition,
              ...HUMAN_EDIT,
            })
          : splitLeaf(current, {
              slideId: contentSlide.id,
              nodeId: selectedNodeId,
              axis: result.axis,
              weights: result.weights,
              contentTargetIndex: result.contentTargetIndex,
              ...HUMAN_EDIT,
            })
      },
    [contentSlide, selectedNode, selectedNodeId],
  )

  const checkSplit = useCallback(
    (result: SplitModalResult): SplitCheck => {
      const current = useEditorStore.getState().presentation
      const children = selectedNode?.kind === 'split' ? selectedNode.children : []
      if (!current) return { ok: false, message: 'Fant ikke presentasjonen.', zones: [] }
      return splitCheck(splitCommand(result)(current), children)
    },
    [selectedNode, splitCommand],
  )

  const handleSplitApply = useCallback(
    (result: SplitModalResult): string | null => {
      let refusal: string | null = null
      const ok = runStructural(selectedNode?.kind === 'split' ? 'update-split' : 'split-leaf', (current) => {
        const outcome = splitCommand(result)(current)
        if (!outcome.ok) refusal = describeError(outcome.error)
        return outcome
      })
      if (ok) setSplitOpen(false)
      return refusal
    },
    [runStructural, selectedNode, splitCommand],
  )

  /**
   * Put a new page in the deck and move to it — in front of the slide the author
   * pointed at, between two slides in the strip, or otherwise after the current
   * slide. Creating a page you cannot see would be a trap.
   *
   * The place is named by a slide rather than a number, and looked up when the
   * page is created: the dialog in between can take a while, and the deck the
   * page goes into is the one that is there then.
   */
  const insertPage = useCallback(
    (
      label: string,
      place: Pick<NewPageRequest, 'before' | 'after'>,
      command: (presentation: Presentation, index: number) => Result<Presentation>,
    ): boolean => {
      const current = useEditorStore.getState().presentation
      if (!current) return false
      const insertAt = insertionIndex(current.slides, place, currentSlideId)
      if (!run(label, (presentationState) => command(presentationState, insertAt))) return false
      const next = useEditorStore.getState().presentation?.slides[insertAt]
      if (next) {
        setDerivedView(null)
        useEditorStore.getState().selectSlide(next.id)
      }
      return true
    },
    [currentSlideId, run],
  )

  const insertSlide = useCallback(
    (hasTitle: boolean, root?: LayoutTemplate['root'], place: Pick<NewPageRequest, 'before' | 'after'> = {}) =>
      insertPage('add-slide', place, (presentationState, index) =>
        addSlide(presentationState, { index, hasTitle, root }),
      ),
    [insertPage],
  )

  /**
   * Take the zone away.
   *
   * A title may cite, and a citation that goes away renumbers the deck, so a
   * label in a zone on a slide nobody touched can get wider. Som alt en person
   * gjør, avvises det ikke for det (`HUMAN_EDIT`): den sonen tegnes mindre.
   */
  const removeTitle = useCallback(() => {
    if (!contentSlide?.title) return
    const removed = contentSlide.title
    // `force` is the user's confirmation; the command refuses without it.
    const done = run('toggle-title', (current) =>
      setSlideHasTitle(current, contentSlide.id, false, { ...HUMAN_EDIT, force: true }),
    )
    if (done) removedTitles.current.set(contentSlide.id, removed)
  }, [contentSlide, run])

  /**
   * Put the zone and the remembered text back in one command.
   *
   * One command for both, so a failure halfway cannot leave an empty title
   * zone behind. The remembered title is kept until it has actually been
   * restored. Tekst som ikke lenger får plass – tittelen selv, eller sonene
   * tittelen tar plass fra – tegnes mindre.
   */
  const restoreTitle = useCallback(() => {
    if (!contentSlide) return
    const remembered = removedTitles.current.get(contentSlide.id)
    const restored = run('toggle-title', (current) =>
      setSlideHasTitle(current, contentSlide.id, true, { ...HUMAN_EDIT, title: remembered }),
    )
    if (restored) removedTitles.current.delete(contentSlide.id)
  }, [contentSlide, run])

  /**
   * A new section.
   *
   * The heading is asked for up front rather than left blank: a section is a
   * heading, and an empty one is a coloured page that says nothing. En
   * overskrift for lang for linjen tas imot og settes i mindre skrift.
   */
  const insertSection = useCallback(
    (title: string, place: Pick<NewPageRequest, 'before' | 'after'> = {}) =>
      insertPage('add-section', place, (presentationState, index) =>
        addSection(presentationState, { index, title, ...HUMAN_EDIT }),
      ),
    [insertPage],
  )

  /**
   * A new interactive slide.
   *
   * The file has already passed the door in the dialog; the command checks it
   * again — the same rules, it is cheap — and the deck-wide budget, and a
   * refusal leaves the dialog open with the reason on screen. A slide is
   * created only when the command says yes, so a cancelled or refused dialog
   * never leaves an empty one behind.
   */
  const insertInteractive = useCallback(
    (source: InteractiveSource, name: string, place: Pick<NewPageRequest, 'before' | 'after'> = {}) =>
      insertPage('add-interactive', place, (presentationState, index) =>
        addInteractiveSlide(presentationState, {
          index,
          name,
          fileName: source.fileName,
          html: source.html,
        }),
      ),
    [insertPage],
  )

  const createSlideFromTemplate = useCallback(
    (template: LayoutTemplate) => {
      insertSlide(template.hasTitle, cloneSubtreeWithNewIds(template.root))
    },
    [insertSlide],
  )

  /**
   * One page along the deck, however the reader asked for it.
   *
   * The arrow keys, the wheel and a finger swiped across the slide all walk the
   * audience order, including generated reference and QR pages. `currentSlideId`
   * intentionally remains on the authored slide while a generated page is on
   * screen, so `derivedView` keeps that authored anchor while the visible page
   * id determines where the next step goes.
   */
  const stepDeck = useCallback(
    (delta: number) => {
      const visibleId = viewedDerivedPage?.id ?? currentSlideId
      if (!visibleId) return
      const index = pages.findIndex((page) => page.id === visibleId)
      if (index < 0) return
      const next = pages[index + delta]
      if (!next) return

      if (isDerivedPage(next)) {
        if (!currentSlideId) return
        setDerivedView({ id: next.id, from: currentSlideId })
        return
      }

      setDerivedView(null)
      useEditorStore.getState().selectSlide(next.id)
    },
    [currentSlideId, pages, viewedDerivedPage],
  )

  /** When the wheel gesture in progress last sent an event. See below. */
  const lastWheelAt = useRef(0)

  /*
   * The mouse wheel steps through the deck, the same slide the up and down
   * arrow keys land on — but only while it hovers the stage itself. The
   * filmstrip and inspector panels can scroll their own content, and every
   * stage variant (editor, section, read-only derived page) shares the same
   * `stage-viewport` root, so that's the one selector this checks against
   * rather than naming the panels to exclude.
   *
   * The gesture clock is a ref and not a variable in the effect: `stepDeck`
   * changes with the slide it just moved to, so the effect re-subscribes on
   * every step — and a clock kept in its closure would be reset by the one
   * step it exists to be the only one of. That is what let a single swipe
   * walk the whole deck.
   */
  useEffect(() => {
    const onWheel = (event: WheelEvent): void => {
      if (presenting) return
      // Over a running miniapp the wheel is the app's, whatever it is over.
      if (isInteractiveRuntimeActive()) return
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('[data-testid="stage-viewport"]')) return
      event.preventDefault()
      if (Math.abs(event.deltaY) < WHEEL_STEP_DEADZONE) return
      const now = Date.now()
      const quiet = now - lastWheelAt.current
      lastWheelAt.current = now
      if (quiet < WHEEL_GESTURE_GAP_MS) return
      stepDeck(event.deltaY > 0 ? 1 : -1)
    }
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => window.removeEventListener('wheel', onWheel, { capture: true })
  }, [presenting, stepDeck])

  /* -------------------------------------------------------------- *
   * Drag and drop
   * -------------------------------------------------------------- */

  /*
   * The constraint here is the default for a surface that asks for nothing.
   * A slide in the strip is both a link and a drag handle and asks for
   * `surface` instead — see `dragActivation.ts`.
   */
  const sensors = useSensors(useSurfacePointerSensor())

  const handleDragStart = (event: DragStartEvent): void => {
    const data = event.active.data.current
    if (data?.kind !== 'sandbox-item') return
    setDragItemId(String(data.itemId))

    // Where a drop may land is the same question a press asks, so it has the
    // same answer — `placementTargets`. Decided here, in an event handler,
    // where the offscreen fit measurement is allowed to render synchronously.
    const current = useEditorStore.getState().presentation
    const activeSlide = useEditorStore.getState().currentContentSlide()
    if (!current || !activeSlide) {
      setDropTargets(new Set())
      return
    }
    setDropTargets(
      placementTargets(current, activeSlide.id, {
        kind: 'sandbox',
        itemId: String(data.itemId),
      }),
    )
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
        moveSlide(current, String(active.id), targetIndex, HUMAN_EDIT),
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
          ...HUMAN_EDIT,
        }),
      )
    }
  }

  /* -------------------------------------------------------------- *
   * Placing content without dragging it
   * -------------------------------------------------------------- */

  /**
   * Start looking for a target zone.
   *
   * The legal targets are worked out here, in an event handler, for the reason
   * `handleDragStart` works them out there: deciding needs an offscreen render
   * per candidate, and React only allows a synchronous one outside a render
   * pass. Nothing is committed yet — this is the question, not the answer.
   */
  const beginPlacement = useCallback((next: PlacementSource) => {
    const current = useEditorStore.getState().presentation
    const slideId = useEditorStore.getState().currentContentSlide()?.id
    if (!current || !slideId) return
    const started: Placement = { ...next, slideId }
    const targets = placementTargets(current, slideId, started)
    if (targets.size === 0) {
      notify.warning('Ingen ledige soner på denne sliden kan ta imot innholdet.')
      return
    }
    setPlacement(started)
    setDropTargets(targets)
  }, [])

  const cancelPlacement = useCallback(() => {
    setPlacement(null)
    setDropTargets(new Set())
  }, [])

  /** The target was pressed. Same commands a drop would have run. */
  const commitPlacement = useCallback(
    (nodeId: string) => {
      const slide = useEditorStore.getState().currentContentSlide()
      if (!placement || !slide || placement.slideId !== slide.id) return
      if (placement.kind === 'sandbox') {
        runStructural('place-sandbox-item', (current) =>
          placeSandboxItem(current, {
            itemId: placement.itemId,
            slideId: slide.id,
            nodeId,
            ...HUMAN_EDIT,
          }),
        )
      } else {
        runStructural('move-zone-content', (current) =>
          moveZoneContent(current, {
            slideId: slide.id,
            fromNodeId: placement.nodeId,
            toNodeId: nodeId,
            ...HUMAN_EDIT,
          }),
        )
      }
      useEditorStore.getState().selectNode(nodeId)
      cancelPlacement()
    },
    [cancelPlacement, placement, runStructural],
  )

  /*
   * A placement belongs to the slide its targets were measured on. Paging away
   * therefore does not cancel it — it simply is no longer the current one, and
   * the prompt and the highlighted zones go with the page, without an effect
   * having to notice and reset anything.
   */
  const activePlacement = placement?.slideId === currentSlideId ? placement : null

  /* -------------------------------------------------------------- *
   * Focused fields
   * -------------------------------------------------------------- */

  /**
   * Fill the compact stage with one field of the page, and write in it.
   *
   * A compact workspace's whole answer to "I want to change this". A long
   * press on the slide lands here, and so does a press in the text list: the
   * field is selected, the view fills the stage with it, and — because it is
   * then drawn several times larger — it simply *is* a writing surface, with
   * no second step to take and nothing extra to press. The same Tiptap
   * document, the same commands, the same undo history and the same fit
   * measurement as on a desktop; the only thing that differs is how big it is
   * drawn. A field with no text to type, a picture without a caption, is
   * focused just the same and has nothing to put a caret in.
   */
  const focusField = useCallback((fieldId: string, caret: ActiveField | null = null) => {
    const store = useEditorStore.getState()
    const slideId = store.currentSlideId
    if (!slideId) return
    // Typing happens in content mode; zone outlines and ratio handles are the
    // other mode's chrome, and a finger cannot mean both at once.
    store.setMode('content')
    // A title and a section's lines are text on the page without being zones,
    // so there is nothing for the selection to point at.
    if (isZoneField(fieldId)) store.selectNode(fieldId)
    setStageFocus({ slideId, fieldId, caret })
    // The stage has to be visible to be written on.
    setCompactPanel(null)
  }, [])

  /**
   * The same thing, from a finger that rested on the page.
   *
   * The caret is placed rather than left to the press that ends the gesture.
   * That press *sometimes* lands in the text — the field is re-laid out several
   * times larger the moment it is focused, so where the finger ends up is an
   * accident of the zoom — and a way in that works from one spot of a zone and
   * not from another is not a way in. It is still the first field of what was
   * pressed, never a guess at which of several; a tap inside the text moves the
   * caret from there, as it does anywhere else.
   */
  const focusPressedField = useCallback(
    (fieldId: string) => {
      const current = useEditorStore.getState().currentSlide()
      focusField(fieldId, current ? firstFieldIn(current, fieldId) : null)
    },
    [focusField],
  )

  /* -------------------------------------------------------------- *
   * Zone actions
   *
   * What can be done to a zone, said once and addressed by the zone it is
   * done to. The toolbar over the selection, the inspector and the context
   * menu all call these: the toolbar and the inspector with the selected zone,
   * the menu with whichever zone was right-clicked.
   * -------------------------------------------------------------- */

  const zoneHandlers: ZoneMenuHandlers | null = useMemo(() => {
    if (!contentSlide) return null
    const slideId = contentSlide.id
    return {
      addContent: (nodeId, kind) => addContentTo(nodeId, kind, { keepMode: true }),
      setContentKind: applyContentKindTo,
      copy: (nodeId) => void copyZoneToClipboard(nodeId),
      cut: (nodeId) => void cutZoneToClipboard(nodeId),
      paste: (nodeId) => void pasteClipboardIntoZone(nodeId),
      placeSandboxItem: (nodeId, itemId) =>
        void runStructural('place-sandbox-item', (current) =>
          placeSandboxItem(current, { itemId, slideId, nodeId, ...HUMAN_EDIT }),
        ),
      openSandbox: () => setSandboxOpen(true),
      moveContent: (nodeId) => beginPlacement({ kind: 'zone', nodeId }),
      moveToSandbox: (nodeId) => {
        runStructural('to-sandbox', (current) =>
          moveZoneContentToSandbox(current, { slideId, nodeId }),
        )
        setSandboxOpen(true)
      },
      split: (nodeId, axis) =>
        void runStructural('split-leaf', (current) =>
          splitLeaf(current, {
            slideId,
            nodeId,
            axis,
            weights: [1, 1],
            contentTargetIndex: 0,
            ...HUMAN_EDIT,
          }),
        ),
      openSplitDialog: (nodeId) => {
        useEditorStore.getState().selectNode(nodeId)
        setSplitOpen(true)
      },
      // A ratio a person picks is a resize by hand: see `weightsRefusal` in
      // `contextMenu/zoneMenu.ts`, which asks this same command.
      setWeights: (splitId, weights) =>
        void runStructural('ratio', (current) =>
          setSplitWeightsByHand(current, { slideId, nodeId: splitId, weights }),
        ),
      duplicate: (nodeId) => {
        const parentId = findParent(contentSlide.root, nodeId)?.id
        const done = runStructural('duplicate-zone', (current) =>
          duplicateLayoutNode(current, { slideId, nodeId, ...HUMAN_EDIT }),
        )
        // The copy is what the author is about to work on, so it is what is
        // selected: the sibling right after the original.
        const root = useEditorStore.getState().currentContentSlide()?.root
        const parent = done && root && parentId ? findSplit(root, parentId) : null
        const index = parent ? parent.children.findIndex((child) => child.id === nodeId) : -1
        if (parent && index >= 0) useEditorStore.getState().selectNode(parent.children[index + 1].id)
      },
      // The zone keeps its id, so the selection follows it to its new place.
      reorder: (nodeId, toIndex) =>
        void runStructural('reorder-zone', (current) =>
          reorderLayoutNode(current, { slideId, nodeId, toIndex, ...HUMAN_EDIT }),
        ),
      clear: setClearingZoneId,
      remove: setDeletingZoneId,
    }
  }, [addContentTo, applyContentKindTo, beginPlacement, contentSlide, runStructural])

  /**
   * Open the zone menu for one zone.
   *
   * The zone is selected first, so the outline and the inspector say which
   * zone the menu is about — selecting is not a change of mode, and the mode
   * is left exactly as it was. Whether each entry can be used is measured
   * here, in an event handler, where the offscreen fit measurement may render.
   */
  const openZoneMenu = useCallback(
    (nodeId: string, anchor: MenuAnchor, keyboard = false): boolean => {
      const state = useEditorStore.getState()
      const slide = state.currentContentSlide()
      if (!state.presentation || !slide || !zoneHandlers) return false
      const menu = zoneModeMenu(
        { presentation: state.presentation, slide, nodeId, checks: HUMAN_EDIT },
        zoneHandlers,
      )
      if (!menu) return false
      state.selectNode(nodeId)
      openContextMenu({ anchor, title: menu.title, entries: menu.entries, keyboard })
      return true
    },
    [openContextMenu, zoneHandlers],
  )

  /** What a menu about text opens: the dialogs the formatting toolbar opens. */
  const textHandlers: TextMenuHandlers = useMemo(
    () => ({
      optimizeAsset: (assetId) => setOptimizeScope({ kind: 'asset', assetId }),
      insertReference: () => setReferencesOpen(true),
      copyText: (text) => {
        void navigator.clipboard.writeText(text).then(
          () => notify.info('Teksten ble kopiert.'),
          () => notify.error('Teksten kunne ikke kopieres.'),
        )
      },
    }),
    [],
  )

  /** What the content menu's entries open: the dialogs the toolbar and inspector open. */
  const contentHandlers: ContentMenuHandlers | null = useMemo(() => {
    if (!contentSlide || !zoneHandlers) return null
    return {
      ...textHandlers,
      addContent: zoneHandlers.addContent,
      setContentKind: zoneHandlers.setContentKind,
      paste: zoneHandlers.paste,
      placeSandboxItem: zoneHandlers.placeSandboxItem,
      openSandbox: zoneHandlers.openSandbox,
      pickImage: (nodeId) => {
        useEditorStore.getState().selectNode(nodeId)
        setImageOpen('zone')
      },
      optimizePanel: (nodeId) => setOptimizeScope({ kind: 'panel', slideId: contentSlide.id, nodeId }),
    }
  }, [contentSlide, textHandlers, zoneHandlers])

  /**
   * Open the content menu for something in one zone.
   *
   * The zone is selected, as a click in it would, so the inspector shows what
   * the menu is about; the slide title belongs to no zone and selects none.
   */
  const openContentMenu = useCallback(
    (nodeId: string, target: ContentTarget, anchor: MenuAnchor, keyboard = false): boolean => {
      const state = useEditorStore.getState()
      const slide = state.currentContentSlide()
      if (!state.presentation || !slide || !contentHandlers) return false
      const menu = contentModeMenu(
        {
          presentation: state.presentation,
          slide,
          nodeId,
          checks: HUMAN_EDIT,
          commit: (label, change) => useEditorStore.getState().run(label, change),
        },
        contentHandlers,
        target,
      )
      if (!menu) return false
      if (nodeId !== TITLE_NODE_ID) state.selectNode(nodeId)
      openContextMenu({ anchor, title: menu.title, entries: menu.entries, keyboard })
      return true
    },
    [contentHandlers, openContextMenu],
  )

  /**
   * A right-click on the stage, with what the geometry found under it.
   *
   * Zone mode is about the zones, so a zone gets its menu wherever it was
   * pressed. Content mode is about what is in them, so the menu is about
   * whatever the pointer is on. Anything this does not answer is left to the
   * browser.
   */
  const handleStageMenu = useCallback(
    (hit: StageMenuHit, anchor: MenuAnchor): boolean => {
      if (useEditorStore.getState().mode === 'zone') {
        if (hit.fieldId === TITLE_NODE_ID) return false
        return openZoneMenu(hit.fieldId, anchor)
      }
      return openContentMenu(hit.fieldId, contentTargetAt(hit.target, anchor, hit.fieldId), anchor)
    },
    [openContentMenu, openZoneMenu],
  )

  /** Open the menu for the section on screen, about one of its lines when `at` is one. */
  const openSectionMenu = useCallback(
    (at: FieldTarget | null, anchor: MenuAnchor, keyboard = false): boolean => {
      const { presentation, currentSlideId } = useEditorStore.getState()
      const section = presentation?.slides.find((each) => each.id === currentSlideId)
      if (!presentation || section?.kind !== 'section') return false
      const menu = sectionMenu(
        {
          section,
          isFront: presentation.slides[0]?.id === section.id,
          commit: (label, change) => useEditorStore.getState().run(label, change),
        },
        textHandlers,
        at,
      )
      openContextMenu({ anchor, title: menu.title, entries: menu.entries, keyboard })
      return true
    },
    [openContextMenu, textHandlers],
  )

  /** A right-click on a section page: on one of its lines, or beside them. */
  const handleSectionMenu = useCallback(
    (fieldId: string | null, target: Element | null, anchor: MenuAnchor): boolean => {
      const found: ContentTarget = fieldId ? contentTargetAt(target, anchor, fieldId) : { kind: 'zone' }
      return openSectionMenu('at' in found ? found.at : null, anchor)
    },
    [openSectionMenu],
  )

  /*
   * The selected zone's actions, for the inspector and the icon row over the
   * zone. Named and drawn as the zone menu names them (`ZONE_ACTIONS`), and
   * only those that apply to this zone are offered: an empty zone has no
   * content to move, and a split has no content kind. What is offered but
   * cannot be done says why.
   */
  const zoneActions: ZoneAction[] = useMemo(() => {
    if (!contentSlide || !selectedNodeId || !selectedNode || !zoneHandlers) return []
    const isLeaf = selectedNode.kind === 'leaf'
    const content = selectedLeaf?.content ?? null
    const isRoot = contentSlide.root.id === selectedNodeId
    const panel = content ? imagePanelOf(content) : null
    const actions: ZoneAction[] = []

    if (isLeaf) {
      actions.push(
        {
          id: 'content',
          group: 'content',
          label: content ? 'Endre innholdstype' : 'Legg til innhold',
          icon: content ? CONTENT_KIND_ICONS[content.kind] : 'plus',
          tone: content ? CONTENT_KIND_TONES[content.kind] : undefined,
          onSelect: () => undefined,
          menu: selectionKindOptions.map((option) => ({
            id: option.kind,
            label: option.label,
            icon: option.icon,
            tone: option.tone,
            checked: option.kind === content?.kind,
            disabled: option.disabled,
            reason: option.reason,
            onSelect: () => applyContentKind(option.kind),
          })),
        },
        {
          id: 'image',
          group: 'content',
          // Said as the content menu says it: a picture panel's file is put in
          // or replaced where it is; any other zone is asked where it goes.
          label: panel ? (panel.assetId ? 'Erstatt bildet …' : 'Sett inn bilde …') : 'Sett inn bilde fra fil …',
          icon: 'image-add',
          tone: 'media',
          onSelect: () => setImageOpen(panel ? 'zone' : 'ask'),
        },
      )
    }
    if (content) {
      actions.push(
        {
          id: 'move',
          group: 'content',
          ...ZONE_ACTIONS.moveContent,
          onSelect: () => zoneHandlers.moveContent(selectedNodeId),
          testId: 'zone-action-move',
        },
        {
          id: 'sandbox',
          group: 'content',
          ...ZONE_ACTIONS.toSandbox,
          onSelect: () => zoneHandlers.moveToSandbox(selectedNodeId),
        },
      )
    }
    actions.push(
      {
        id: 'split',
        group: 'zone',
        ...(isLeaf ? { ...ZONE_ACTIONS.split, label: `${ZONE_ACTIONS.split.label} …` } : ZONE_ACTIONS.editSplit),
        onSelect: () => setSplitOpen(true),
        testId: 'zone-action-split',
      },
      /*
       * Everything else the zone menu has, from a button: the way to it for a
       * finger, which has no right button, and for anyone who did not know
       * there was a menu to right-click for.
       */
      {
        id: 'more',
        group: 'zone',
        label: 'Flere valg',
        icon: 'more',
        onSelect: (anchor) => void openZoneMenu(selectedNodeId, anchorBelow(anchor)),
      },
    )
    if (canClearZone(selectedNode)) {
      actions.push({
        id: 'clear',
        group: 'zone',
        danger: true,
        ...ZONE_ACTIONS.clear,
        onSelect: () => zoneHandlers.clear(selectedNodeId),
      })
    }
    actions.push({
      id: 'delete',
      group: 'zone',
      danger: true,
      ...ZONE_ACTIONS.remove,
      disabled: isRoot,
      reason: isRoot ? ROOT_REMOVE_REASON : null,
      onSelect: () => zoneHandlers.remove(selectedNodeId),
    })
    return actions
  }, [
    applyContentKind,
    contentSlide,
    openZoneMenu,
    selectedLeaf,
    selectedNode,
    selectedNodeId,
    selectionKindOptions,
    zoneHandlers,
  ])

  /**
   * The menu the keyboard asks for. Whether one opened, so the key is only
   * taken from the browser when it did.
   */
  const openKeyboardMenu = useCallback((): boolean => {
    const state = useEditorStore.getState()
    const { editor } = useActiveEditor.getState()
    const field = state.activeField
    const typing = editor?.isFocused && field ? { editor, field } : null
    const caret = typing ? typing.editor.view.coordsAtPos(typing.editor.state.selection.from) : null
    const atCaret = caret ? { x: caret.left, y: caret.bottom } : null
    const page = state.presentation?.slides.find((each) => each.id === state.currentSlideId)
    if (page?.kind === 'section') {
      const stageSlide = document.querySelector('[data-testid="stage-slide"]')
      const anchor = atCaret ?? (stageSlide ? anchorInside(stageSlide) : null)
      return anchor ? openSectionMenu(typing, anchor, true) : false
    }
    if (state.mode === 'content' && typing && atCaret && state.currentContentSlide()) {
      return openContentMenu(typing.field.nodeId, contentTargetOfSelection(typing.editor, typing.field), atCaret, true)
    }
    const selected = state.selectedNodeId
    if (!selected) return false
    if (state.mode === 'zone') {
      const outline = document.querySelector(`[data-node-outline="${CSS.escape(selected)}"]`)
      return outline ? openZoneMenu(selected, anchorInside(outline), true) : false
    }
    const zone = document.querySelector(`.slide-zone[data-node-id="${CSS.escape(selected)}"]`)
    return zone ? openContentMenu(selected, { kind: 'zone' }, anchorInside(zone), true) : false
  }, [openContentMenu, openSectionMenu, openZoneMenu])

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
      // The open context menu has the keyboard: its arrows walk its entries,
      // not the deck or the zones behind it.
      if (target?.closest?.('[role="menu"]')) return
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

      const shortcut = editorShortcutFor(event)
      if (shortcut && state.presentation && !hasOpenDialog()) {
        let act: (() => void) | undefined
        if (shortcut === 'sandbox') act = toggleSandbox
        if (shortcut === 'slide') act = () => setNewPage({ kind: 'content' })
        if (shortcut === 'reference') {
          const editor = useActiveEditor.getState().editor
          if (editor?.isFocused && editor.isEditable && typeof editor.commands.insertCitation === 'function') {
            act = textHandlers.insertReference
          }
        }

        const slide = state.currentContentSlide()
        const id = state.selectedNodeId
        if (!typing && state.mode === 'zone' && slide && !viewedDerivedPage && id && zoneHandlers) {
          const node = findNode(slide.root, id)
          if (shortcut === 'splitVertical' && node?.kind === 'leaf') act = () => zoneHandlers.split(id, 'x')
          if (shortcut === 'splitHorizontal' && node?.kind === 'leaf') act = () => zoneHandlers.split(id, 'y')
          if (shortcut === 'clear' && node && canClearZone(node)) act = () => zoneHandlers.clear(id)
          if (shortcut === 'remove' && node && id !== slide.root.id) act = () => zoneHandlers.remove(id)
          if (shortcut === 'toSandbox' && node?.kind === 'leaf' && node.content) {
            act = () => zoneHandlers.moveToSandbox(id)
          }
        }

        if (act) {
          event.preventDefault()
          if (!event.repeat) act()
          return
        }
      }

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

      /*
       * Shift+F10 and the menu key open the menu for what the keyboard is on,
       * the way a right-click there would: in a field being typed in, for the
       * selection; otherwise for the selected zone. Opened on the thing
       * itself, so the menu visibly belongs to it.
       */
      if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && !hasOpenDialog()) {
        // A page in the slide overview opens its own menu; see `Filmstrip`.
        if (target?.closest?.('[data-page-menu]')) return
        if (openKeyboardMenu()) event.preventDefault()
        return
      }

      if (typing) return
      /*
       * A dialog's own keys are its own: arrows move between its choices (the
       * split dialog's direction, say), not through the deck or the zone tree
       * behind it — where a step would also change the zone the dialog is
       * about.
       */
      if (target?.closest?.('[role="dialog"]')) return

      /*
       * Up and down move through the deck — but not over the shoulder of
       * someone editing text, where they move the caret between lines, and not
       * in zone mode, where they walk the layout tree.
       */
      if (state.mode !== 'zone' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        stepDeck(event.key === 'ArrowDown' ? 1 : -1)
        return
      }

      if (state.mode !== 'zone') return

      /*
       * Shift with an arrow moves the selected zone one place among its
       * siblings instead of walking to the next one — the same step the zone
       * menu's «Flytt sone» takes.
       */
      const step = event.shiftKey && !meta && !event.altKey ? reorderStepForKey(event.key) : null
      if (step !== null) {
        event.preventDefault()
        const activeSlide = state.currentContentSlide()
        const nodeId = state.selectedNodeId
        const parent = activeSlide && nodeId ? findParent(activeSlide.root, nodeId) : null
        if (!parent || !nodeId || !zoneHandlers) return
        const toIndex = parent.children.findIndex((child) => child.id === nodeId) + step
        if (toIndex >= 0 && toIndex < parent.children.length) zoneHandlers.reorder(nodeId, toIndex)
        return
      }

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
      // Only a slide with zones has anything to cut, copy or paste into.
      const activeSlide = state.currentContentSlide()
      if (!activeSlide || !state.selectedNodeId) return
      const leaf = findLeaf(activeSlide.root, state.selectedNodeId)
      const key = event.key.toLowerCase()

      if ((key === 'c' || key === 'x') && leaf?.content) {
        event.preventDefault()
        if (key === 'c') copyZoneToClipboard(leaf.id)
        else cutZoneToClipboard(leaf.id)
        return
      }
      if (key === 'v' && leaf && !leaf.content) {
        event.preventDefault()
        void pasteClipboardIntoZone(leaf.id)
      }
    }

    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [
    openKeyboardMenu, presenting, redo, setMode, setNewPage, stepDeck, textHandlers,
    toggleMode, toggleSandbox, undo, viewedDerivedPage, zoneHandlers,
  ])

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

  /** Where the page a new-page dialog creates will go, as the strip says it. */
  const newPagePlacement = newPage
    ? placementText(presentation.slides, insertionIndex(presentation.slides, newPage, currentSlideId))
    : undefined
  /** What the delete question calls the page it is about — «slide 3», «inndeling 5». */
  const deletingSlideIndex = deletingSlide
    ? presentation.slides.findIndex((each) => each.id === deletingSlide.id)
    : -1
  const deletingSlideName =
    deletingSlide && deletingSlideIndex >= 0
      ? pageName(deletingSlide.kind, deletingSlideIndex).toLowerCase()
      : 'siden'

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
  // Only what has something in it is worth asking about or rescuing: deliberate
  // air and an untouched card leave nothing behind when they go.
  const clearingZoneKeeps = clearingZoneNode
    ? collectContent(clearingZoneNode).some((content) => !contentIsEmpty(content))
    : false

  const draggedItem = dragItemId
    ? presentation.sandbox.find((item) => item.id === dragItemId) ?? null
    : null

  /* -------------------------------------------------------------- *
   * The shell
   *
   * The three big surfaces are built once, here, and handed to whichever shell
   * is mounted. Exactly one of them is — see `shell/editorShell.ts` — so there
   * is one Tiptap tree, one set of drop targets and one thing being measured,
   * whatever size the window is.
   * -------------------------------------------------------------- */

  /*
   * Whether the focus is still about something on screen, as opposed to where
   * it was last put. An undo that deletes the zone, a title switched off, a
   * page turn and a generated page opened over the slide all land on the state
   * that is true now — see `liveFocus`.
   *
   * A derived page is a *view of* a slide rather than the slide, so there is no
   * field of it to focus: the rect is asked for against `null`, which is the
   * same answer a page with no such field gives.
   */
  const focusCandidateRect =
    stageFocus && !viewedDerivedPage
      ? focusFieldRect(slide, presentation.theme, stageFocus.fieldId)
      : null
  const focus = liveFocus(stageFocus, { slideId: currentSlideId, rect: focusCandidateRect, mode })
  const focusRect = focus ? focusCandidateRect : null
  /** Whether the focused field is one there is anything to type in. */
  const focusedText = focus && slide ? firstFieldIn(slide, focus.fieldId) !== null : false

  /*
   * The pinch belongs to this page and this field; anywhere else there is none.
   */
  const zoomKey = `${viewedDerivedPage?.id ?? currentSlideId ?? ''}:${focus?.fieldId ?? ''}`
  const zoom = stageZoom.key === zoomKey ? stageZoom.zoom : NO_ZOOM

  /*
   * Hidden is not the same as gone, and here it has to be gone.
   *
   * Reading the two through a derived value is what makes them fall to what is
   * true — but the stale value is still in state, and a page can come *back*:
   * focus a field, turn to another slide and back, and a focused view nobody
   * asked for would return, with the magnification taken inside it. So what is
   * no longer live is discarded on the spot.
   *
   * A set during render rather than in an effect, which is React's own answer
   * to "adjust state when something changes": it re-renders before anything is
   * painted, so the view that was let go is never on screen for a frame. Both
   * are conditional on there being something to drop, so neither can loop.
   */
  if (stageFocus !== null && focus !== stageFocus) setStageFocus(focus)
  if (stageZoom.key !== zoomKey && isZoomed(stageZoom.zoom)) {
    setStageZoom({ key: zoomKey, zoom: NO_ZOOM })
  }
  const changeZoom = (update: (current: StageZoom) => StageZoom): void => {
    setStageZoom((previous) => ({
      key: zoomKey,
      // A pinch sends several moves per frame, and each has to build on the one
      // before it rather than on whatever the last render drew.
      zoom: update(previous.key === zoomKey ? previous.zoom : NO_ZOOM),
    }))
  }

  /**
   * Out of the focused field, all the way, in one press.
   *
   * Not a step down a ladder: the focused field is one mode and the whole page
   * is the other, so leaving means leaving both the writing surface and the
   * view that made it one — and the magnification taken on top of it, which
   * belonged to the field rather than to the page. One × does all of it, and
   * there is nothing left behind to press again.
   */
  const exitFocus = (): void => {
    if (focus) setStageFocus(null)
    changeZoom(() => NO_ZOOM)
  }

  /*
   * The pinch, handed to whichever page is on the stage.
   *
   * Every page kind gets it, not only the one with zones: the requirement is
   * that a pinch *inside the slide area* magnifies the slide rather than the
   * application, and a section or a generated page is as much the slide area
   * as a content slide is. They share one `StageSurface`, so it is the same
   * transform in all four cases and not four of them.
   */
  const stageZoomProps = compact ? { zoom, onZoomChange: changeZoom } : {}
  /*
   * What a compact stage needs to be a writing surface: which field is one,
   * where it is drawn, and the gesture that gets there. Built once, because a
   * slide and a section answer the same three questions about different
   * fields — and a second copy of the answer is a second interaction model.
   */
  const stageFocusProps = compact
    ? {
        textEditing: focus ? ({ only: focus.fieldId } as const) : ('none' as const),
        focusRect,
        caret: focus?.caret ?? null,
        onLongPressField: focusPressedField,
      }
    : focus
      ? /* A roomy workspace focuses a field only to write in text a person's
           resize drew small (`ShrunkZoneNotice`): the same view, entered from
           the inspector rather than by a long press. */
        { textEditing: { only: focus.fieldId } as const, focusRect, caret: focus.caret }
      : {}

  const stageNode = viewedDerivedPage ? (
    <ReadOnlySlideStage
      page={viewedDerivedPage}
      note={derivedPageNote(viewedDerivedPage)}
      {...stageZoomProps}
    />
  ) : section ? (
    <SectionStage
      section={section}
      {...stageFocusProps}
      {...stageZoomProps}
      onContextMenu={handleSectionMenu}
    />
  ) : interactive ? (
    // Keyed by the slide, so moving between two interactive slides replaces
    // the surface — and closes whatever was running on it. The stage and the
    // inspector are siblings in one list, so the two keys must differ: React
    // keys siblings by key alone, and two children under one key leave one of
    // them never removed.
    <InteractiveStage key={`stage:${interactive.id}`} slide={interactive} {...stageZoomProps} />
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
      // While a field is focused, a press means "put the caret here" again —
      // which is what the field was made big enough for.
      selectOnTap={compact && !focus}
      chrome={!compact}
      {...stageFocusProps}
      {...stageZoomProps}
      onPlace={activePlacement ? commitPlacement : null}
      onContextMenu={handleStageMenu}
    />
  ) : null

  const inspectorNode = viewedDerivedPage ? (
    <InspectorPanel>
      <InspectorHeader
        icon={viewedDerivedPage.kind === 'qr' ? 'qr' : 'reference'}
        title={viewedDerivedPage.kind === 'qr' ? 'Avledet QR-side' : 'Avledet slide'}
        detail="Lages automatisk og har ingen soner å redigere."
      />
      <p className="hint">
        {viewedDerivedPage.kind === 'qr'
          ? 'QR-koden peker på delingslenken og lages av Del-knappen. Siden ligger alltid helt sist, etter referansesidene, og forsvinner når du slår av delingen.'
          : 'Denne sliden bygges fra referansene som faktisk er i bruk. Nummereringen følger rekkefølgen de først nevnes i, og oppdateres automatisk.'}
      </p>
    </InspectorPanel>
  ) : section ? (
    <SectionInspector section={section} />
  ) : interactive ? (
    <InteractiveInspector key={`inspector:${interactive.id}`} slide={interactive} />
  ) : contentSlide ? (
    <Inspector
      // Remounting per selection drops any half-finished panel state, so a
      // dialog can never apply to the wrong zone.
      key={selectedNodeId ?? 'none'}
      slide={contentSlide}
      actions={zoneActions}
      contentKinds={selectionKindOptions}
      onSetContentKind={applyContentKind}
      onOptimizeImage={(nodeId) =>
        setOptimizeScope({ kind: 'panel', slideId: contentSlide.id, nodeId })
      }
      readableEditing={{
        enlarged: focus !== null,
        onEnlarge: focusPressedField,
        onShowSlide: exitFocus,
      }}
    />
  ) : null

  const shellProps: EditorShellProps = {
    // A derived page is generated and read-only, and it is what the stage is
    // showing — so it is what the panels answer about, not the authored slide
    // the view was opened from.
    slide: viewedDerivedPage ? null : slide,
    fontState,
    panels: {
      ideasOpen,
      sandboxOpen,
      setIdeasOpen,
      setSandboxOpen,
      compactPanel,
      setCompactPanel,
    },
    toolbar: {
      title: presentation.title,
      hasTitleZone: contentSlide?.title != null,
      canToggleTitle: viewedDerivedPage === null && contentSlide !== null,
      selectionIsLeaf:
        viewedDerivedPage === null && contentSlide !== null && selectedNode?.kind === 'leaf',
      selectionHasContent: Boolean(selectedLeaf?.content),
      selectedKind: viewedDerivedPage === null ? (selectedLeaf?.content?.kind ?? null) : null,
      canEditZones: viewedDerivedPage === null && contentSlide !== null,
      sandboxCount: presentation.sandbox.length,
      onBack: () => void handleBack(),
      backPending: leaving,
      onRename: () => {
        setRenameValue(presentation.title)
        setRenameOpen(true)
      },
      onToggleTitle: () => {
        if (contentSlide?.title != null) {
          if (!isDocEmpty(contentSlide.title)) {
            setRemovingTitle(true)
            return
          }
          removeTitle()
          return
        }
        restoreTitle()
      },
      onSetContentKind: applyContentKind,
      contentKinds: selectionKindOptions,
      onOpenReferences: () => setReferencesOpen(true),
      onOpenTemplates: () => setTemplatesOpen(true),
      onOpenImage: () => setImageOpen('ask'),
      onToggleIdeas: () => setIdeasOpen((open) => !open),
      onToggleSandbox: toggleSandbox,
      ideasOpen,
      sandboxOpen,
      onShowShortcuts: () => setShortcutsOpen(true),
      onEditAutocorrect: () => setAutocorrectOpen(true),
      onPresent: () => setPresenting(true),
      onOpenTheme: () => setThemeOpen(true),
      onOpenImageBrief: () => setImageStep('brief'),
      onOptimizeImages: () => setOptimizeScope({ kind: 'all' }),
      onToggleShare: toggleShare,
    },
    /*
     * A compact workspace has no field on the stage to format — until one that
     * holds text is focused, and then this is the bar for it.
     *
     * «Holds text» rather than merely «is focused»: a picture with no caption
     * fills the stage like any other zone and has nothing to type into, and a
     * bar offered over it would be a bar aimed at whatever was edited last.
     */
    textToolbar: compact && !focusedText ? null : (
      <TextToolbar
        onInsertReference={() => setReferencesOpen(true)}
        onOptimizeImage={(assetId) => setOptimizeScope({ kind: 'asset', assetId })}
      />
    ),
    filmstrip: (
      <Filmstrip
        presentation={presentation}
        derived={derived}
        viewingDerivedId={viewedDerivedPage?.id ?? null}
        onSelectDerived={(pageId) =>
          setDerivedView(currentSlideId ? { id: pageId, from: currentSlideId } : null)
        }
        onSelectAuthored={() => setDerivedView(null)}
        onRequestDelete={setDeletingSlide}
        onRequestNewPage={setNewPage}
        // On a compact workspace the strip is the whole slide overview rather
        // than a column beside the stage, so its pages are drawn as big as the
        // panel allows. Same component, same commands.
        overview={compact}
      />
    ),
    stage: stageNode,
    inspector: inspectorNode,
    statusBar: (
      <StatusBar presentation={presentation} onShowShortcuts={() => setShortcutsOpen(true)} />
    ),
    ideas: <IdeasWindow open={ideasOpen} onClose={() => setIdeasOpen(false)} />,
    sandbox: (
      <SandboxWindow
        open={sandboxOpen}
        onClose={() => setSandboxOpen(false)}
        onPlace={(item) => {
          // The sheet is the whole screen on a phone; the zone to press is
          // underneath it.
          setSandboxOpen(false)
          beginPlacement({ kind: 'sandbox', itemId: item.id })
        }}
      />
    ),
    placementBar: activePlacement ? (
      <div className="placement-bar" data-testid="placement-bar" role="status">
        <span>{PLACEMENT_PROMPT}</span>
        <button
          type="button"
          className="btn btn--sm"
          onClick={cancelPlacement}
          data-testid="placement-cancel"
        >
          Avbryt
        </button>
      </div>
    ) : null,
    // The text list addresses *fields*; the stage focuses the field's own rect
    // — a zone, the slide's heading or a section's line — and hands the caret
    // to the one editor inside it the entry actually named.
    onEditText: (entry: TextTargetEntry) => {
      const field = activeFieldFor(entry.target)
      focusField(field.nodeId, field)
    },
    onStepPage: stepDeck,
    focus: {
      focused: focus !== null,
      magnified: isZoomed(zoom),
      onExit: exitFocus,
    },
    onShowShortcuts: () => setShortcutsOpen(true),
  }

  const Shell = compact ? CompactEditorShell : DesktopEditorShell

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
        <Shell {...shellProps} />

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
      </DndContext>

      <ContextMenuHost />

      {splitOpen && selectedRect && contentSlide && selectedNodeId && (
        <SplitModal
          key={`split-${selectedNodeId}`}
          open={splitOpen}
          onOpenChange={setSplitOpen}
          targetRect={selectedRect}
          theme={presentation?.theme}
          targetLabels={breadcrumbLabels(contentSlide.root, selectedNodeId)}
          mode={selectedNode?.kind === 'split' ? 'edit' : 'create'}
          existingChildren={selectedNode?.kind === 'split' ? selectedNode.children : undefined}
          existingAxis={selectedNode?.kind === 'split' ? selectedNode.axis : undefined}
          existingWeights={selectedNode?.kind === 'split' ? selectedNode.weights : undefined}
          leafContent={selectedLeaf?.content ?? null}
          check={checkSplit}
          onApply={handleSplitApply}
        />
      )}

      <NewSlideModal
        open={newPage?.kind === 'content'}
        placement={newPagePlacement}
        onOpenChange={closeNewPage}
        onCreate={(hasTitle) => {
          insertSlide(hasTitle, undefined, newPage ?? {})
          setNewPage(null)
        }}
      />

      <NewSectionModal
        open={newPage?.kind === 'section'}
        placement={newPagePlacement}
        onOpenChange={closeNewPage}
        onCreate={(title) => {
          const created = insertSection(title, newPage ?? {})
          if (created) setNewPage(null)
          return created
        }}
      />

      <NewInteractiveModal
        open={newPage?.kind === 'interactive'}
        placement={newPagePlacement}
        onOpenChange={closeNewPage}
        onCreate={(source, name) => insertInteractive(source, name, newPage ?? {})}
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
      {imageStep === 'intro' && depositCount > 0 && (
        <ImageDepositIntroModal
          expectedCount={depositCount}
          onGenerate={() => setImageStep('brief')}
          onEdit={() => setImageStep(null)}
        />
      )}
      {imageStep === 'brief' && (
        <ImageBriefModal
          onClose={() => setImageStep(null)}
          onDeposit={() => setImageStep('deposit')}
        />
      )}
      {imageStep === 'deposit' && <ImageDepositModal onClose={() => setImageStep(null)} />}
      <ShortcutsModal
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        onEditAutocorrect={() => {
          setShortcutsOpen(false)
          setAutocorrectOpen(true)
        }}
      />
      <AutocorrectModal open={autocorrectOpen} onOpenChange={setAutocorrectOpen} />
      {imageOpen && (
        <ImageUploadModal
          onOpenChange={(open) => setImageOpen(open ? imageOpen : false)}
          zoneNodeId={selectedNode?.kind === 'leaf' ? selectedNodeId : null}
          fillZone={imageOpen === 'zone'}
        />
      )}
      {optimizeScope && (
        <ImageOptimizeModal
          scope={optimizeScope}
          onOpenChange={(open) => {
            if (!open) setOptimizeScope(null)
          }}
          // The rewritten document is a save point of its own: the files it
          // stopped pointing at are only deleted once it is stored — and with
          // no controller to store it, they are not deleted at all. A save that
          // fails is only a delay, so the deletion is handed to whichever write
          // finally lands.
          save={() => autosaveRef.current?.flush() ?? Promise.resolve(false)}
          onceSaved={(task) => autosaveRef.current?.afterSave(task)}
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
        open={depositBreak !== null}
        title="Avslutte den automatiske bildeinnsettingen?"
        message="Denne endringen fjerner en av bildeplassene presentasjonen venter på. Da kan ikke bildene lenger legges inn samlet, og du må sette inn hvert bilde selv. Det kan ikke gjøres om."
        confirmLabel="Fortsett likevel"
        onConfirm={confirmDepositBreak}
        onCancel={cancelDepositBreak}
      />

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
        title={`Slette ${deletingSlideName}?`}
        message={`${deletingSlideName.charAt(0).toUpperCase()}${deletingSlideName.slice(1)} og alt innhold på den fjernes. Du kan angre etterpå.`}
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
          clearingZoneKeeps
            ? 'Alle subsoner og alt innhold i denne sonen fjernes.'
            : clearingZoneNode?.kind === 'split'
              ? 'Delingen fjernes, og sonen blir tom.'
              : 'Sonen blir tom.'
        }
        confirmLabel={clearingZoneKeeps ? 'Tøm og slett innhold' : 'Tøm sone'}
        alternativeLabel={clearingZoneKeeps ? 'Flytt innhold til sandkassen' : undefined}
        onAlternative={
          clearingZoneKeeps
            ? () => {
                if (!clearingZoneId) return
                runStructural('clear-zone', (current) =>
                  clearLayoutNode(current, {
                    slideId: slide.id,
                    nodeId: clearingZoneId,
                    contentDisposition: 'sandbox',
                  }),
                )
                setClearingZoneId(null)
              }
            : undefined
        }
        onConfirm={() => {
          if (!clearingZoneId) return
          // What the dialog said goes is what goes: with nothing worth keeping,
          // there is nothing to park in the sandbox either.
          runStructural('clear-zone', (current) =>
            clearLayoutNode(current, {
              slideId: slide.id,
              nodeId: clearingZoneId,
              contentDisposition: 'delete',
            }),
          )
          setClearingZoneId(null)
        }}
        onCancel={() => setClearingZoneId(null)}
      />
    </SlideRenderProvider>
  )
}
