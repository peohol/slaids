/**
 * The slide stage.
 *
 * The slide is always drawn in the fixed 1600x900 design space and scaled
 * uniformly to the viewport. Pointer coordinates are converted back into slide
 * coordinates before hit-testing, so selection uses the geometry engine rather
 * than overlapping DOM elements.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FIT_TOLERANCE, SLIDE_WIDTH, TITLE_LINE_HEIGHT } from '../../domain/constants'
import { geometryForTheme, themeMetrics } from '../../domain/metrics'
import {
  TITLE_NODE_ID,
  computeSlideGeometry,
  hitTestLayout,
  minimumSizeFor,
  rectContainsPoint,
  viewportToSlide,
} from '../../domain/geometry'
import { collectContent, replaceNode } from '../../domain/layout'
import { normalizedSlide } from '../../domain/presentation'
import { bestTextColor, textShadowFor } from '../../domain/color'
import {
  rearrangeZones,
  setSlideTitle,
  setSplitWeights,
  subtreeOverflow,
  type StructuralOutcome,
} from '../../domain/commands'
import { rearrangeZonesByHand, setSplitWeightsByHand } from '../../domain/commands/manualLayout'
import type { Result } from '../../domain/result'
import { isNegativeSpace } from '../../domain/negativeSpace'
import { useEditorStore, type ActiveField } from '../../state/store'
import { useActiveEditor } from '../../state/activeEditor'
import { useZoneScales } from '../../state/zoneScales'
import type { MenuAnchor } from '../components/contextMenu'
import type { Editor } from '@tiptap/react'
import type {
  ContentSlide,
  LayoutNode,
  NodeId,
  Presentation,
  Rect,
  ZoneContentKind,
} from '../../domain/types'
import { SlideProgressBar } from '../slide/SlideProgressBar'
import { SlideView, absoluteStyle } from '../slide/SlideView'
import { useSectionColorsFor, useSlideRender } from '../slide/SlideRenderContext'
import { domFitCheckers, measureElementOverflow } from '../../state/measure'
import { docEditRenumberProblem } from '../../state/citationFit'
import { ZoneContentView } from '../slide/ZoneContentView'
import { RichDocView } from '../slide/RichDocView'
import { EditableZoneContent } from './EditableZoneContent'
import { RichTextEditor } from './RichTextEditor'
import {
  childRects,
  dragAmount,
  layoutKey,
  lengthsAt,
  manipulatedIds,
  shownFor,
  startZoneDrag,
  withShift,
  type ZoneDragCommit,
  type ZoneDragContext,
  type ZoneDrag,
  type ZoneDragStart,
  type ZoneDragView,
} from './zoneGesture'
import {
  SOFT_LIMIT_RESISTANCE_PX,
  STEP_HYSTERESIS_PX,
  isPastSoftLimit,
  learnSoftLimit,
  magneticAmount,
  softThresholds,
  type ChildSoftLimit,
  type SoftThreshold,
} from './softLimitDrag'
import { ZoneFitBox } from '../slide/ZoneFitBox'
import { ShrunkZoneMarker } from './ShrunkZoneMarker'
import { canTypeIn, type StageTextEditing } from './stageFocus'
import { FULL_SLIDE, NO_ZOOM, type StageZoom } from './stageView'
import { StageSurface } from './StageSurface'
import { ZoneOverlay, type ZoneAction } from './ZoneOverlay'
import { ZoneDropZone } from './ZoneDropZone'
import { EmptyZone } from './EmptyZone'

/**
 * What a right-click landed on, as the stage sees it.
 *
 * `fieldId` is the geometry engine's answer — the slide title, or the deepest
 * zone under the pointer — so a menu is always about the zone a click there
 * would have selected. `target` is the element the browser hit, for the host to
 * tell the parts of a zone apart (a caption, a picture, a field being typed in).
 */
export interface StageMenuHit {
  fieldId: string
  target: Element | null
}

/**
 * A zone drag in flight: what `zoneGesture.ts` decided about it, where the
 * pointer started, and what it has measured about the content so far.
 */
interface DragState {
  drag: ZoneDrag
  /** What the drag was started from, to start it over when Shift changes (`withShift`). */
  context: ZoneDragContext
  startX: number
  startY: number
  /** Where the pointer is now, so a Shift pressed without moving redraws at once. */
  pointerX: number
  pointerY: number
  /** Where each of the drag's children sat when it started, for measuring against. */
  startRects: Map<NodeId, Rect>
  /**
   * Each child's soft limit — the shortest it can be with its content at
   * normal size — by its index in the drag's split, measured the first time
   * the gesture moves that child in a direction where the limit matters. It is
   * an offscreen render per probe, so it is done on demand, once per drag.
   */
  limits: Map<number, ChildSoftLimit>
  /** The limits as points on the pointer's axis; `null` until worked out again. */
  thresholds: SoftThreshold[] | null
  /** The step being shown, and the pointer amount it was chosen at (`STEP_HYSTERESIS_PX`). */
  shown: { amount: number; view: ZoneDragView; byHand: boolean } | null
  /** The document the drag started from, which every step it shows is checked against. */
  presentation: Presentation
  /**
   * Whether the release command accepts a layout: a drag that steps through
   * layouts meets the same few again and again, and each answer is an
   * offscreen render.
   */
  verdicts: Map<string, boolean>
}

/**
 * The layout a drag is showing, the pointer's lengths it came from, and
 * whether storing it takes a zone below its content's soft minimum — which
 * only the hand-made commands do (`domain/commands/manualLayout.ts`).
 */
type DragPreview = ZoneDragView & { lengths: number[]; byHand: boolean }

/** One string per commit: same command, same layout, same string. */
function commitKey(commit: ZoneDragCommit): string {
  return commit.kind === 'ratios'
    ? `r:${commit.nodeId}:${commit.weights.join(',')}`
    : `a:${commit.nodeId}|${layoutKey(commit.layout)}`
}

/**
 * The command letting go of a drag runs.
 *
 * A step that keeps every zone at or above its content's soft minimum goes
 * through the ordinary commands, fit guard and all — exactly what an agent's
 * call would run. One the hand pushed past a soft limit goes through the
 * hand-made ones, which check everything but the fit at normal size.
 */
function commitDrag(
  presentation: Presentation,
  slideId: string,
  commit: ZoneDragCommit,
  byHand: boolean,
): Result<StructuralOutcome> {
  if (commit.kind === 'ratios') {
    const input = { slideId, nodeId: commit.nodeId, weights: commit.weights }
    return byHand ? setSplitWeightsByHand(presentation, input) : setSplitWeights(presentation, { ...input, ...domFitCheckers })
  }
  const input = { slideId, nodeId: commit.nodeId, layout: commit.layout }
  return byHand ? rearrangeZonesByHand(presentation, input) : rearrangeZones(presentation, { ...input, ...domFitCheckers })
}

export interface EditorStageProps {
  slide: ContentSlide
  actions: ZoneAction[]
  onAddContent: (nodeId: NodeId, kind: ZoneContentKind) => void
  /** Opens the upload dialog for a picture zone that has no file yet. */
  onPickImage: (nodeId: NodeId) => void
  /** Opens the note in a zone that holds one. */
  /**
   * Zones that can accept what is currently looking for one — the item being
   * dragged, or the content waiting for a target press. Decided when the
   * gesture starts, because deciding it needs a measurement.
   */
  dropTargets: ReadonlySet<NodeId>
  /**
   * A press on a zone selects it even in content mode.
   *
   * What a finger means by a press is "this one", not "put the caret here":
   * the type on a slide scaled to a phone is a few pixels tall, so aiming at a
   * word is not a thing anyone can do. Selection first, then an action.
   */
  selectOnTap?: boolean
  /** Which text on the stage may be typed into where it is drawn. */
  textEditing?: StageTextEditing
  /**
   * The one field that should take the caret, or `null` to leave it to a tap.
   *
   * See `StageFocus`: a press already says where in the text to write, but a
   * name chosen from a list does not, so only the second asks for this.
   */
  caret?: ActiveField | null
  /**
   * One finger that rested on the page, answered with the field under it.
   *
   * The stage's own hit test rather than the DOM's: what is under a fingertip
   * is a question about the 1600 × 900 geometry, and answering it any other
   * way would be a second hit-testing model beside the one a press uses.
   * Given only where a long press means something, which is a compact
   * workspace.
   */
  onLongPressField?: (fieldId: string) => void
  /** A press lands content in a zone rather than selecting it. */
  onPlace?: ((nodeId: NodeId) => void) | null
  /**
   * A right-click on the slide. Returns whether a menu was opened; when it
   * was not, the browser's own menu is left alone.
   */
  onContextMenu?: (hit: StageMenuHit, anchor: MenuAnchor) => boolean
  /**
   * Show this part of the slide filling the stage instead of the whole slide.
   *
   * A view transform and nothing else: the geometry, the document and every
   * measurement are the whole slide's, exactly as they are when this is unset.
   * Nothing about it is stored, and no command can see it.
   */
  focusRect?: Rect | null
  /**
   * The pinch on top of it, and the way to change it.
   *
   * Given only where pinching is wanted; without `onZoomChange` the stage does
   * not listen for two fingers at all, which is what leaves the browser's own
   * pinch alone on a roomy workspace.
   */
  zoom?: StageZoom
  onZoomChange?: (update: (zoom: StageZoom) => StageZoom) => void
  /** Whether the breadcrumb and action buttons are drawn on the slide itself. */
  chrome?: boolean
}

/**
 * How far the slide title reaches past the zone it was given, live.
 *
 * A title is one line, so overflow is sideways. Both the zone and the title's
 * own box clip it, and which of them the text spills out of is an accident of
 * how the box happens to be sized — so the worst of the two is the answer. The
 * offscreen `measureTitleFit` is the one that judges a committed change; this
 * is the guard that runs while the author is still typing.
 */
function titleOverflow(host: HTMLElement | null): number {
  // The title zone is the one box that clips, and it carries `data-fit-scroll`
  // like every other clipping box — so the shared measurement is the whole
  // answer. It was not always: `.rich-doc--title` used to clip too, which kept
  // the overflow to itself and made the zone read zero. See `slide.css`.
  return host ? measureElementOverflow(host) : 0
}

/** Whether a gesture asked for the ratios the split already has. */
function sameWeights(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((weight, index) => weight === b[index])
}

export function EditorStage({
  slide,
  actions,
  onAddContent,
  onPickImage,
  dropTargets,
  selectOnTap = false,
  textEditing = 'all',
  caret = null,
  onLongPressField,
  onPlace = null,
  onContextMenu,
  focusRect = null,
  zoom = NO_ZOOM,
  onZoomChange,
  chrome = true,
}: EditorStageProps) {
  const slideRef = useRef<HTMLDivElement>(null)
  const titleHostRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<NodeId | null>(null)
  const [preview, setPreview] = useState<DragPreview | null>(null)
  const dragRef = useRef<DragState | null>(null)
  /**
   * Set by a drag that changed something, and consumed by the click the browser
   * sends afterwards: releasing a zone somewhere else must not re-select
   * whatever the pointer happens to have landed on.
   */
  const draggedRef = useRef(false)
  /** The kind of pointer that last pressed the stage — see `handleContextMenu`. */
  const pointerTypeRef = useRef<string>('mouse')

  const mode = useEditorStore((state) => state.mode)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const selectNode = useEditorStore((state) => state.selectNode)
  const run = useEditorStore((state) => state.run)
  const runStructural = useEditorStore((state) => state.runStructural)
  const setActiveField = useEditorStore((state) => state.setActiveField)
  const setActiveEditor = useActiveEditor((state) => state.setEditor)
  const reportScale = useZoneScales((state) => state.report)
  const titleEditorRef = useRef<Editor | null>(null)
  const { theme, numbering } = useSlideRender()
  const colors = useSectionColorsFor(slide.id)
  // A ratio drag changes geometry, never the deck's citation numbers, so the
  // same context serves as both baseline and prospective state.
  const fitContext = useMemo(() => ({ theme, numbering }), [theme, numbering])
  // The gap the author set is the gap a ratio drag works in.
  const tokens = themeMetrics(theme)

  // A step is drawn as it will be stored: normalised the way `withSlide`
  // normalises every edit, so air it brings to air already on that edge is
  // drawn as the one piece it will be.
  const displaySlide: ContentSlide = preview
    ? normalizedSlide({ ...slide, root: replaceNode(slide.root, preview.nodeId, preview.node) })
    : slide

  const geometry = computeSlideGeometry(displaySlide, geometryForTheme(theme))

  /**
   * A point on screen, as a point on the slide.
   *
   * The scale is read back off the element rather than taken from the render:
   * it is the same number either way, and reading it means a pointer lands on
   * the right zone even mid-pinch, when the view has moved on from the render
   * that drew it.
   */
  const toSlidePoint = useCallback((clientX: number, clientY: number) => {
    const element = slideRef.current
    if (!element) return null
    const rect = element.getBoundingClientRect()
    const rendered = rect.width / SLIDE_WIDTH
    if (rendered <= 0) return null
    return viewportToSlide(clientX, clientY, { left: rect.left, top: rect.top }, rendered)
  }, [])

  /**
   * How many screen pixels one slide unit is, right now.
   *
   * Read off the element for the same reason `toSlidePoint` is: a ratio drag
   * converts pointer travel into weights, and a pinch mid-drag would otherwise
   * have it converting against the scale some earlier render drew.
   */
  const renderedScale = useCallback((): number => {
    const element = slideRef.current
    if (!element) return 1
    return element.getBoundingClientRect().width / SLIDE_WIDTH || 1
  }, [])

  /** Abandon an in-flight ratio drag without committing anything. */
  const cancelDrag = useCallback((): void => {
    if (!dragRef.current) return
    dragRef.current = null
    setPreview(null)
  }, [])

  /**
   * Whether a ratio drag has actually taken the hand.
   *
   * Not the same question as whether one is *armed*. In zone mode every press
   * on a zone arms one, and a gesture that has not moved yet has not decided
   * what it is — see `zoneDragMode`, which leaves `mode` null until the
   * movement is big enough to mean something. A finger that then stays still
   * never became a layout gesture at all, and is free to be a long press.
   */
  const dragHasTheHand = (): boolean => {
    const current = dragRef.current
    if (!current) return false
    return current.drag.start.kind !== 'zone' || current.drag.operation !== null
  }

  const handlePointerMove = (event: React.PointerEvent): void => {
    if (mode !== 'zone' || dragRef.current) return
    const point = toSlidePoint(event.clientX, event.clientY)
    if (!point) return
    setHovered(hitTestLayout(displaySlide.root, geometry.rects, point.x, point.y))
  }

  /**
   * The field one resting finger asked for, as the geometry engine sees it.
   *
   * The title is checked before the layout because it is not *in* the layout:
   * `computeSlideGeometry` gives it a rect in the same map, but `hitTestLayout`
   * only walks the tree, so a press on the heading would otherwise find
   * nothing. Everywhere else the answer is the same deepest-zone answer a press
   * gets, so a long press and a tap can never disagree about what was pressed.
   */
  const fieldUnder = (point: { x: number; y: number }): string | null => {
    const title = geometry.rects.get(TITLE_NODE_ID)
    if (slide.title && title && rectContainsPoint(title, point.x, point.y)) return TITLE_NODE_ID
    return hitTestLayout(displaySlide.root, geometry.rects, point.x, point.y)
  }

  const handleClick = (event: React.MouseEvent): void => {
    // Content mode on a roomy workspace answers a click where the click landed
    // — in a text field — so there is nothing to hit-test.
    if (!onPlace && mode !== 'zone' && !selectOnTap) return
    if (draggedRef.current) {
      draggedRef.current = false
      return
    }
    const point = toSlidePoint(event.clientX, event.clientY)
    if (!point) return
    const hit = hitTestLayout(displaySlide.root, geometry.rects, point.x, point.y)
    if (!hit) return
    // Content waiting for a zone takes the press: the target was worked out
    // when the placement started, so a press on anything else does nothing
    // rather than quietly moving the selection out from under the prompt.
    if (onPlace) {
      if (dropTargets.has(hit)) onPlace(hit)
      return
    }
    selectNode(hit)
  }

  /**
   * The menu for whatever is under the pointer.
   *
   * Hit-tested exactly like a click, so the menu is about the zone a click
   * there would have chosen — never about whatever happened to be selected
   * before. A finger resting on a compact stage already means «open this
   * field» (`onLongPressField`), and the browser reports that same long press
   * as a context menu too; there the press keeps its existing meaning.
   */
  const handleContextMenu = (event: React.MouseEvent): void => {
    if (!onContextMenu || onPlace) return
    if (onLongPressField && pointerTypeRef.current === 'touch') return
    const point = toSlidePoint(event.clientX, event.clientY)
    const fieldId = point ? fieldUnder(point) : null
    if (!fieldId) return
    const target = event.target instanceof Element ? event.target : null
    if (onContextMenu({ fieldId, target }, { x: event.clientX, y: event.clientY })) {
      event.preventDefault()
    }
  }

  /**
   * Start a zone drag, whichever operation it turns out to be.
   *
   * What the gesture needs to know is captured here rather than re-read on
   * every pointer move — the rects, each zone's minimum for what it holds, and
   * the layout the drag started from. Every frame is computed from those, so
   * nothing drifts as the pointer travels.
   */
  const beginDrag = (start: ZoneDragStart, event: React.PointerEvent): boolean => {
    const options = geometryForTheme(theme)
    const context: ZoneDragContext = {
      root: displaySlide.root,
      rects: geometry.rects,
      gap: tokens.gap,
      // What the child actually holds decides how small it may get — an
      // empty zone can be dragged down to nothing, a card stops at the card.
      // Measured under this deck's own theme, because the chrome a card
      // spends is the chrome the tokens dictate.
      minimumAlong: (node, axis) => {
        const min = minimumSizeFor(node, options)
        return axis === 'x' ? min.width : min.height
      },
    }
    const drag = startZoneDrag(context, start)
    const presentation = useEditorStore.getState().presentation
    if (!drag || !presentation) return false
    dragRef.current = {
      drag,
      context,
      startX: event.clientX,
      startY: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      startRects: childRects(drag, drag.span.lengths),
      limits: new Map(),
      thresholds: null,
      shown: null,
      presentation,
      verdicts: new Map(),
    }
    return true
  }

  /** A press on a handle the overlay draws: a divider, or an edge grip. */
  const beginHandleDrag = (start: ZoneDragStart, select: NodeId, event: React.PointerEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    if (!beginDrag(start, event)) return
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    selectNode(select)
  }

  /**
   * A press *inside* a zone, which resizes or moves that zone within its parent
   * split.
   *
   * The gap between two zones is covered by its own handle, and so is a
   * selected zone's outer edge, and those handles stop the press from reaching
   * here — so the interactions never have to be told apart by measuring how
   * close to an edge the pointer landed. Which zone was pressed is the geometry
   * engine's answer, the same one a click uses, so what is dragged is always
   * what is selected.
   */
  const handlePointerDown = (event: React.PointerEvent): void => {
    draggedRef.current = false
    if (onPlace) return
    if (mode !== 'zone' || event.button !== 0 || dragRef.current) return
    const point = toSlidePoint(event.clientX, event.clientY)
    if (!point) return
    const hit = hitTestLayout(displaySlide.root, geometry.rects, point.x, point.y)
    if (!hit) return
    if (beginDrag({ kind: 'zone', nodeId: hit }, event)) selectNode(hit)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    /** Whether everything in `node` fits `rect` at normal size. */
    const fitsNormally = (node: LayoutNode, rect: Rect): boolean => {
      for (const overflow of subtreeOverflow(node, rect, fitContext, domFitCheckers).values()) {
        if (overflow > FIT_TOLERANCE) return false
      }
      return true
    }

    /**
     * Learn the soft limit of every child the pointer at `lengths` is moving,
     * where it matters: a child that fits, once it is being made smaller; one
     * that does not fit, as soon as it moves at all — it can be pulled up onto
     * its limit, or pushed further below it. Returns whether anything new was
     * learnt.
     */
    const learnLimits = (state: DragState, lengths: readonly number[]): boolean => {
      const { span, rect } = state.drag
      const axis = span.split.axis
      const room = axis === 'x' ? rect.width : rect.height
      let learnt = false
      span.split.children.forEach((child, index) => {
        if (isNegativeSpace(child) || collectContent(child).length === 0) return
        const start = span.lengths[index]
        const now = lengths[index]
        const startRect = state.startRects.get(child.id)
        if (Math.abs(now - start) < 1e-9 || !startRect) return
        const known = state.limits.get(index)
        const limit = learnSoftLimit(known, index, start, now, span.floors[index], room, (length) =>
          fitsNormally(child, axis === 'x' ? { ...startRect, width: length } : { ...startRect, height: length }),
        )
        if (limit === known) return
        state.limits.set(index, limit)
        learnt = true
      })
      return learnt
    }

    /** Whether the release would store `commit`: the same command, asked in advance. */
    const accepts = (state: DragState, commit: ZoneDragCommit, byHand: boolean): boolean => {
      const key = `${byHand ? 'hand' : 'fit'}|${commitKey(commit)}`
      let verdict = state.verdicts.get(key)
      if (verdict === undefined) {
        verdict = commitDrag(state.presentation, slide.id, commit, byHand).ok
        state.verdicts.set(key, verdict)
      }
      return verdict
    }

    /**
     * The drag with Shift as it is now. Pressed or let go mid-drag, it turns
     * the drag into the other kind from the same press; the rects the drag
     * started from are the new kind's own, as its children may differ.
     */
    const followShift = (state: DragState, shift: boolean): boolean => {
      const drag = withShift(state.drag, state.context, shift)
      if (drag === state.drag) return false
      state.drag = drag
      state.startRects = childRects(drag, drag.span.lengths)
      // The children may be other ones, and the limits were theirs.
      state.limits = new Map()
      state.thresholds = null
      state.shown = null
      // What was shown belonged to the other kind; until this one has a frame
      // of its own, letting go stores nothing.
      setPreview(null)
      return true
    }

    /**
     * Show the drag for the pointer where it is now.
     *
     * The pointer's travel goes through the magnet first (`softLimitDrag.ts`),
     * which holds the drag on each soft limit for a stretch of the hand's
     * travel; the step shown is then the nearest one the release would store,
     * checked with the very command the release runs.
     */
    const show = (state: DragState): void => {
      // A pointer distance on screen, in design-space pixels.
      const scale = renderedScale()
      const { drag } = state
      const raw = dragAmount(drag, (state.pointerX - state.startX) / scale, (state.pointerY - state.startY) / scale)
      if (raw === null) return
      const rawLengths = lengthsAt(drag, raw)
      if (!rawLengths) return
      if (learnLimits(state, rawLengths)) state.thresholds = null
      const limits = [...state.limits.values()]
      const room = drag.span.split.axis === 'x' ? drag.rect.width : drag.rect.height
      state.thresholds ??= softThresholds((amount) => lengthsAt(drag, amount), limits, room * 4)
      const amount = magneticAmount(raw, state.thresholds, SOFT_LIMIT_RESISTANCE_PX / scale)
      const lengths = lengthsAt(drag, amount)
      if (!lengths) return
      // A gesture the geometry cannot honour — a zone at the end of its split,
      // a side already at its minimum, a pointer back where it started — asks
      // for the layout the split already has, and there is nothing to preview
      // or, later, to commit.
      if (sameWeights(lengths, drag.span.lengths)) {
        state.shown = null
        setPreview(null)
        return
      }
      const byHand = isPastSoftLimit(lengths, drag.span.lengths, limits)
      // The hysteresis is for a hand trembling between two steps, never for
      // the soft limit: a hair either side of where the magnet holds is a
      // different answer — text at normal size or not — and must show as one.
      const kept = state.shown
      if (kept && kept.byHand === byHand && Math.abs(amount - kept.amount) < STEP_HYSTERESIS_PX / scale) {
        setPreview({ ...kept.view, byHand, lengths })
        return
      }
      const view = shownFor(drag, lengths, (commit) => accepts(state, commit, byHand))
      state.shown = { amount, view, byHand }
      setPreview({ ...view, byHand, lengths })
    }

    const move = (event: PointerEvent): void => {
      const state = dragRef.current
      if (!state) return
      state.pointerX = event.clientX
      state.pointerY = event.clientY
      // Read on every move as well as from the keys, so a Shift changed while
      // the window had no key focus is still the one that counts.
      followShift(state, event.shiftKey)
      show(state)
    }

    const up = (): void => {
      const state = dragRef.current
      dragRef.current = null
      const pending = preview
      setPreview(null)
      if (!state || !pending) return
      draggedRef.current = true

      // A drag stores exactly the step it was showing, which was checked with
      // the same command when it was shown; one that ends where it began
      // leaves nothing behind — no air, no extra level.
      const { commit, byHand } = pending
      if (commit) runStructural('ratio', (presentation) => commitDrag(presentation, slide.id, commit, byHand))
    }

    /** Escape lets go of the drag and leaves the slide as it was; Shift switches its kind. */
    const key = (event: KeyboardEvent): void => {
      const state = dragRef.current
      if (!state) return
      if (event.key === 'Shift') {
        // The modifier, not the key: with both Shift keys down, letting go of one leaves Shift held.
        if (followShift(state, event.getModifierState('Shift'))) show(state)
        return
      }
      if (event.key !== 'Escape' || event.type !== 'keydown') return
      event.preventDefault()
      event.stopPropagation()
      draggedRef.current = true
      cancelDrag()
    }

    /** A gesture the browser took over (touch panning) must not commit. */
    const cancel = (): void => cancelDrag()

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', key, true)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', key, true)
    }
  }, [cancelDrag, fitContext, preview, renderedScale, runStructural, slide.id])

  const titleColor = bestTextColor(colors.background)

  return (
    <StageSurface
      base={focusRect ?? FULL_SLIDE}
      zoom={zoom}
      onZoomChange={onZoomChange}
      slideRef={slideRef}
      /* Two fingers always mean the view, so a ratio drag lets go rather than
         fighting the pinch for the same hand — and the press that ends the
         gesture must not also select whatever it landed on. */
      onViewMoved={() => {
        cancelDrag()
        draggedRef.current = true
      }}
      /* One finger may well mean the layout: while a ratio drag has the hand,
         the view holds still underneath it. */
      canPan={() => dragRef.current === null}
      /* A long press opens the field under it — unless the press was already
         spoken for: a placement is waiting for one of its own, and a ratio
         drag that has started moving is a layout gesture, not a resting
         finger. One that has only been armed is neither yet, so it is let go
         of here rather than left to commit on the way up. */
      onLongPress={
        onLongPressField && !onPlace
          ? (point) => {
              if (dragHasTheHand()) return
              const field = fieldUnder(point)
              if (!field) return
              cancelDrag()
              onLongPressField(field)
            }
          : undefined
      }
      onPointerDown={(event) => {
        pointerTypeRef.current = event.pointerType
        handlePointerDown(event)
        if (dragRef.current) {
          /* A ratio drag has taken this press. Stopping it here is how the
             surface around the stage learns that the gesture is spoken for —
             otherwise dragging a zone sideways would also turn the page. */
          event.stopPropagation()
        }
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHovered(null)}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {(scale) => (
        <>
          <SlideView
            slide={displaySlide}
            className={mode === 'zone' ? 'slide--zone-mode' : undefined}
            renderTitle={(rect) => (
              <div
                className="slide-title"
                data-testid="slide-title"
                ref={titleHostRef}
                style={{
                  ...absoluteStyle(rect),
                  color: titleColor,
                  fontFamily: theme.headingFontFamily,
                  fontSize: tokens.titleFontSize,
                  lineHeight: TITLE_LINE_HEIGHT,
                  textShadow: textShadowFor(colors.background),
                }}
                data-fit-scroll=""
                data-fit-axis="x"
              >
                {slide.title && mode === 'content' && canTypeIn(textEditing, TITLE_NODE_ID) ? (
                  <RichTextEditor
                    doc={slide.title}
                    variant="title"
                    placeholder="Slidetittel"
                    takeCaret={caret?.nodeId === TITLE_NODE_ID}
                    overflowMessage="Overskriften får ikke plass i tittelsonen."
                    measureOverflow={() => titleOverflow(titleHostRef.current)}
                    onEditorReady={(editor) => {
                      titleEditorRef.current = editor
                      if (!editor && useActiveEditor.getState().editor === editor) {
                        setActiveEditor(null)
                      }
                    }}
                    onFocus={() => {
                      // Without this the toolbars would still target the last
                      // body field, and citations would land in the wrong zone.
                      setActiveEditor(titleEditorRef.current)
                      setActiveField({ nodeId: TITLE_NODE_ID, subfieldId: null, kind: 'slide-title' })
                    }}
                    validateDoc={(next, previous) =>
                      docEditRenumberProblem({
                        slideId: slide.id,
                        nodeId: TITLE_NODE_ID,
                        previousDoc: previous,
                        nextDoc: next,
                        commit: (presentation, doc) => setSlideTitle(presentation, slide.id, doc),
                      })
                    }
                    onChange={(doc) =>
                      run(`typing:${slide.id}:slide-title`, (presentation) =>
                        setSlideTitle(presentation, slide.id, doc),
                      )
                    }
                  />
                ) : (
                  slide.title && <RichDocView doc={slide.title} className="rich-doc--title" field="title" />
                )}
              </div>
            )}
            renderLeaf={(leaf, rect) => (
              <ZoneDropZone nodeId={leaf.id} acceptable={dropTargets.has(leaf.id)}>
                {!leaf.content ? (
                  /* The picker's buttons are drawn inside the slide, so they
                     shrink with it: at a phone's scale they are a few pixels
                     tall and unhittable. There the zone says what it is and
                     the zone panel offers the content types at full size. */
                  <EmptyZone
                    nodeId={leaf.id}
                    rect={geometry.rects.get(leaf.id) ?? null}
                    compact={mode === 'zone' || textEditing !== 'all'}
                    onAdd={onAddContent}
                  />
                ) : (
                  /* Drawn smaller when a person's resize took the zone below
                     what its content needs at normal size — and marked, in
                     both modes, for as long as it is. */
                  <ZoneFitBox
                    width={rect.width}
                    height={rect.height}
                    onScale={(fit) => reportScale(leaf.id, fit)}
                    marker={<ShrunkZoneMarker stageScale={scale || 1} width={rect.width} height={rect.height} />}
                  >
                    {mode === 'zone' ? (
                      /* Zone mode draws content statically — there is no
                         typing in it — because the mode is about the zones
                         themselves. */
                      <ZoneContentView content={leaf.content} />
                    ) : (
                      <EditableZoneContent
                        content={leaf.content}
                        nodeId={leaf.id}
                        slideId={slide.id}
                        editable={canTypeIn(textEditing, leaf.id)}
                        caret={caret}
                        rect={rect}
                        onPickImage={onPickImage}
                      />
                    )}
                  </ZoneFitBox>
                )}
              </ZoneDropZone>
            )}
          >
            {/*
              The same overlay for two jobs. In zone mode it is the zone
              chrome; where a press selects instead of putting in a caret, it is
              the one thing that says which zone the press landed on — without
              which «selected zone» would be a step of the ladder with nothing
              on screen to show for it. While that zone is being typed in there
              is a caret saying so, and the outline is only noise.
            */}
            {(mode === 'zone' ||
              (selectOnTap &&
                selectedNodeId !== null &&
                /* The root *is* the slide, and every slide opens with it
                   selected — outlining it would put a border on the page
                   before anyone has chosen anything. */
                selectedNodeId !== displaySlide.root.id)) && (
              <ZoneOverlay
                slide={displaySlide}
                geometry={geometry}
                selectedNodeId={selectedNodeId}
                hoveredNodeId={hovered}
                scale={scale || 1}
                actions={actions}
                onBreadcrumb={selectNode}
                onHandleDown={beginHandleDrag}
                handleGap={tokens.gap}
                dragging={
                  dragRef.current && preview
                    ? {
                        ids: manipulatedIds(dragRef.current.drag),
                        rects: childRects(dragRef.current.drag, preview.lengths),
                      }
                    : null
                }
                chrome={chrome}
                purpose={mode === 'zone' ? 'zones' : 'selection'}
              />
            )}

            {/*
              The editor draws the page the audience will see, indicator and
              all. Placed by its host rather than by `SlideView`, for the reason
              `DeckPageView` states: the stripe belongs to the page, and the
              slide is only one kind of page.
            */}
            <SlideProgressBar pageId={slide.id} />
          </SlideView>
        </>
      )}
    </StageSurface>
  )
}
