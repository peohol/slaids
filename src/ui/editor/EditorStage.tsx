/**
 * The slide stage.
 *
 * The slide is always drawn in the fixed 1600x900 design space and scaled
 * uniformly to the viewport. Pointer coordinates are converted back into slide
 * coordinates before hit-testing, so selection uses the geometry engine rather
 * than overlapping DOM elements.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SLIDE_WIDTH, TITLE_LINE_HEIGHT } from '../../domain/constants'
import { geometryForTheme, themeMetrics } from '../../domain/metrics'
import {
  TITLE_NODE_ID,
  computeSlideGeometry,
  hitTestLayout,
  minimumSizeFor,
  rectContainsPoint,
  splitRect,
  sumWeights,
  viewportToSlide,
} from '../../domain/geometry'
import { findParent, findSplit, updateNode } from '../../domain/layout'
import { equalityKeysForDrag, equalityKeysForZoneDrag } from '../../domain/ratios'
import { bestTextColor, textShadowFor } from '../../domain/color'
import {
  overflowRegressions,
  setSlideTitle,
  setSplitWeights,
  subtreeOverflow,
} from '../../domain/commands'
import { useEditorStore } from '../../state/store'
import { useActiveEditor } from '../../state/activeEditor'
import type { Editor } from '@tiptap/react'
import type {
  Axis,
  ContentSlide,
  LayoutNode,
  NodeId,
  Rect,
  SplitNode,
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
  commitDraggedRatios,
  draggedWeights,
  keepsZoneSize,
  resizedWeights,
  translatedWeights,
  zoneDragAmount,
  zoneDragMode,
  type ZoneDragMode,
} from './ratioDrag'
import { canTypeIn, type StageTextEditing } from './stageFocus'
import { FULL_SLIDE, NO_ZOOM, type StageZoom } from './stageView'
import { StageSurface } from './StageSurface'
import { ZoneOverlay, type ZoneAction } from './ZoneOverlay'
import { ZoneDropZone } from './ZoneDropZone'
import { EmptyZone } from './EmptyZone'

/** A press in the gap between two zones: the boundary follows the pointer. */
interface BoundaryGesture {
  kind: 'boundary'
  boundary: number
}

/**
 * A press inside a zone: it resizes about its centre or slides along the split,
 * depending on which way the hand went.
 *
 * `mode` is decided once, as soon as the movement is big enough to mean
 * something, and then held for the rest of the gesture — see `zoneDragMode`.
 */
interface ZoneGesture {
  kind: 'zone'
  index: number
  mode: ZoneDragMode | null
}

interface DragState {
  splitId: NodeId
  axis: Axis
  gesture: BoundaryGesture | ZoneGesture
  startX: number
  startY: number
  originalWeights: number[]
  usable: number
  minShare: number[]
  /** Captured so the drag can be fit-validated without re-reading the tree. */
  parentRect: Rect
  children: LayoutNode[]
  /** Where each zone sat when the gesture started, for measuring against. */
  startRects: Rect[]
  /**
   * Overflow each zone had before the drag started, measured the first time it
   * is asked for. The gesture may move as long as no zone gets worse, which is
   * the same rule `setSplitWeights` applies on release — so a drag never stops
   * somewhere the commit would refuse, and a zone that already overflows can
   * still be dragged wider to repair it.
   *
   * Measuring is an offscreen render per zone, so it is done on demand and only
   * for zones the gesture actually takes room from: a zone that keeps its rect
   * cannot change how much of it shows, and one that gains room cannot show
   * less of its content than it did with less.
   */
  baseline: Map<NodeId, number>
  measured: Set<number>
}

export interface EditorStageProps {
  slide: ContentSlide
  actions: ZoneAction[]
  onAddContent: (nodeId: NodeId, kind: ZoneContentKind) => void
  /** Opens the upload dialog for a picture zone that has no file yet. */
  onPickImage: (nodeId: NodeId) => void
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
  onLongPressField,
  onPlace = null,
  focusRect = null,
  zoom = NO_ZOOM,
  onZoomChange,
  chrome = true,
}: EditorStageProps) {
  const slideRef = useRef<HTMLDivElement>(null)
  const titleHostRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<NodeId | null>(null)
  const [preview, setPreview] = useState<{ nodeId: NodeId; weights: number[] } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  /**
   * Set by a drag that changed something, and consumed by the click the browser
   * sends afterwards: releasing a zone somewhere else must not re-select
   * whatever the pointer happens to have landed on.
   */
  const draggedRef = useRef(false)

  const mode = useEditorStore((state) => state.mode)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const selectNode = useEditorStore((state) => state.selectNode)
  const run = useEditorStore((state) => state.run)
  const runStructural = useEditorStore((state) => state.runStructural)
  const setActiveField = useEditorStore((state) => state.setActiveField)
  const setActiveEditor = useActiveEditor((state) => state.setEditor)
  const titleEditorRef = useRef<Editor | null>(null)
  const { theme, numbering } = useSlideRender()
  const colors = useSectionColorsFor(slide.id)
  // A ratio drag changes geometry, never the deck's citation numbers, so the
  // same context serves as both baseline and prospective state.
  const fitContext = useMemo(() => ({ theme, numbering }), [theme, numbering])
  // The gap the author set is the gap a ratio drag works in.
  const tokens = themeMetrics(theme)

  const displaySlide: ContentSlide = preview
    ? {
        ...slide,
        root: updateNode(slide.root, preview.nodeId, (node) =>
          node.kind === 'split' ? ({ ...node, weights: preview.weights } as LayoutNode) : node,
        ),
      }
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
    const drag = dragRef.current
    if (!drag) return false
    return drag.gesture.kind === 'boundary' || drag.gesture.mode !== null
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
   * Start a drag on `split`, whichever of the two gestures it turns out to be.
   *
   * What the gesture needs to know is the same either way and is captured here
   * rather than re-read on every pointer move: the split's rect, its zones'
   * minimum sizes expressed in the weight units the drag arithmetic works in,
   * and the ratios the gesture started from — every frame is computed from
   * those, so nothing drifts as the pointer travels.
   */
  const beginDrag = (
    split: SplitNode,
    parentRect: Rect,
    gesture: BoundaryGesture | ZoneGesture,
    event: React.PointerEvent,
  ): void => {
    const along = split.axis === 'x' ? parentRect.width : parentRect.height
    const usable = along - tokens.gap * (split.children.length - 1)
    const total = sumWeights(split.weights)
    const minShare = split.children.map((child) => {
      // What the child actually holds decides how small it may get — air and an
      // empty zone can be dragged down to nothing, a card stops at the card.
      // Measured under this deck's own theme, because the chrome a card spends
      // is the chrome the tokens dictate.
      const min = minimumSizeFor(child, geometryForTheme(theme))
      const need = split.axis === 'x' ? min.width : min.height
      return (need / usable) * total
    })

    dragRef.current = {
      splitId: split.id,
      axis: split.axis,
      gesture,
      startX: event.clientX,
      startY: event.clientY,
      originalWeights: [...split.weights],
      usable,
      minShare,
      parentRect,
      children: split.children,
      startRects: splitRect(parentRect, split.axis, split.weights, tokens.gap),
      baseline: new Map(),
      measured: new Set(),
    }
  }

  const beginHandleDrag = (splitId: NodeId, boundary: number, event: React.PointerEvent): void => {
    const split = findSplit(displaySlide.root, splitId)
    const parentRect = geometry.rects.get(splitId)
    if (!split || !parentRect) return
    event.preventDefault()
    event.stopPropagation()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    beginDrag(split, parentRect, { kind: 'boundary', boundary }, event)
    selectNode(splitId)
  }

  /**
   * A press *inside* a zone, which resizes or moves that zone within its parent
   * split.
   *
   * The gap between two zones is covered by its own handle, and that handle
   * stops the press from reaching here — so the two interactions never have to
   * be told apart by measuring how close to an edge the pointer landed. Which
   * zone was pressed is the geometry engine's answer, the same one a click uses,
   * so what is dragged is always what is selected.
   */
  const handlePointerDown = (event: React.PointerEvent): void => {
    draggedRef.current = false
    if (onPlace) return
    if (mode !== 'zone' || event.button !== 0 || dragRef.current) return
    const point = toSlidePoint(event.clientX, event.clientY)
    if (!point) return
    const hit = hitTestLayout(displaySlide.root, geometry.rects, point.x, point.y)
    if (!hit) return
    const parent = findParent(displaySlide.root, hit)
    const parentRect = parent ? geometry.rects.get(parent.id) : undefined
    // The root zone has no split to move inside; the click still selects it.
    if (!parent || !parentRect) return
    const index = parent.children.findIndex((child) => child.id === hit)
    if (index < 0) return
    beginDrag(parent, parentRect, { kind: 'zone', index, mode: null }, event)
    selectNode(hit)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    /** The overflow the zone at `index` had before the drag started. */
    const rememberBaseline = (drag: DragState, index: number): void => {
      if (drag.measured.has(index)) return
      drag.measured.add(index)
      for (const [nodeId, overflow] of subtreeOverflow(
        drag.children[index],
        drag.startRects[index],
        fitContext,
        domFitCheckers,
      )) {
        drag.baseline.set(nodeId, overflow)
      }
    }

    /**
     * Whether the layout the pointer is asking for would hide content that is
     * visible now.
     *
     * Only the zones that lost room are asked: a zone whose ratio is unchanged
     * has the same rect it had, and one that gained room cannot show less than
     * it did with less. That is also what keeps a drag affordable — the answer
     * is an offscreen render of the zone.
     */
    const wouldHideContent = (drag: DragState, weights: readonly number[]): boolean => {
      const childRects = splitRect(drag.parentRect, drag.axis, weights, tokens.gap)
      for (let index = 0; index < weights.length; index += 1) {
        if (weights[index] >= drag.originalWeights[index]) continue
        rememberBaseline(drag, index)
        const next = subtreeOverflow(
          drag.children[index],
          childRects[index],
          fitContext,
          domFitCheckers,
        )
        if (overflowRegressions(next, (nodeId) => drag.baseline.get(nodeId) ?? 0).length > 0) {
          return true
        }
      }
      return false
    }

    /**
     * The ratios the gesture is asking for, in design-space units, or `null`
     * when it is not asking for anything yet.
     *
     * Nothing is rounded here: the layout follows the pointer, and only snaps to
     * a whole ratio once the pointer is let go.
     */
    const wishFor = (drag: DragState, event: PointerEvent): number[] | null => {
      const total = sumWeights(drag.originalWeights)
      /** A pointer distance on screen, in the weight units the split is in. */
      const inWeights = (deltaPx: number): number =>
        (deltaPx / renderedScale() / drag.usable) * total
      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY

      if (drag.gesture.kind === 'boundary') {
        const along = drag.axis === 'x' ? deltaX : deltaY
        return draggedWeights(
          drag.originalWeights,
          drag.gesture.boundary,
          inWeights(along),
          drag.minShare,
        )
      }

      const gesture = drag.gesture
      const mode = gesture.mode ?? zoneDragMode(drag.axis, deltaX, deltaY)
      if (!mode) return null
      // Locked for the rest of the gesture, so a hand that wanders off its
      // first direction goes on doing what it started rather than flipping.
      gesture.mode = mode
      const amount = inWeights(zoneDragAmount(drag.axis, mode, deltaX, deltaY))
      return mode === 'translate'
        ? translatedWeights(drag.originalWeights, gesture.index, amount, drag.minShare)
        : resizedWeights(drag.originalWeights, gesture.index, amount, drag.minShare)
    }

    const move = (event: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const weights = wishFor(drag, event)
      if (!weights) return
      // A gesture the geometry cannot honour — a zone at the end of its split,
      // a side already at its minimum, a pointer back where it started — asks
      // for the ratios the split already has, and there is nothing to preview
      // or, later, to commit.
      if (sameWeights(weights, drag.originalWeights)) {
        setPreview(null)
        return
      }
      // The drag stops where the content stops fitting, rather than letting the
      // user drag into an invalid state and snapping back on release.
      if (wouldHideContent(drag, weights)) return
      setPreview({ nodeId: drag.splitId, weights })
    }

    const up = (): void => {
      const drag = dragRef.current
      dragRef.current = null
      const pending = preview
      setPreview(null)
      if (!drag || !pending) return
      draggedRef.current = true

      // The released geometry is a wish; what gets stored is the nearest ratio
      // the deck can be written in, keeping zones that shared a ratio before
      // the gesture sharing one.
      const equalityKeys =
        drag.gesture.kind === 'boundary'
          ? equalityKeysForDrag(drag.originalWeights, drag.gesture.boundary)
          : equalityKeysForZoneDrag(drag.originalWeights, drag.gesture.index)
      // A move promised the zone would keep its size, so the snap is held to it.
      const prefer =
        drag.gesture.kind === 'zone' && drag.gesture.mode === 'translate'
          ? keepsZoneSize(drag.originalWeights, drag.gesture.index)
          : undefined
      runStructural('ratio', (presentation) =>
        commitDraggedRatios(
          equalityKeys,
          pending.weights,
          (weights) =>
            setSplitWeights(presentation, {
              slideId: slide.id,
              nodeId: pending.nodeId,
              weights,
              // A ratio change may not shrink a zone past what its content needs.
              ...domFitCheckers,
            }),
          prefer,
        ),
      )
    }

    /** A gesture the browser took over (touch panning) must not commit. */
    const cancel = (): void => cancelDrag()

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
    }
  }, [cancelDrag, fitContext, preview, renderedScale, runStructural, slide.id, tokens.gap])

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
                    validateDoc={(next) =>
                      docEditRenumberProblem({
                        nodeId: TITLE_NODE_ID,
                        currentDoc: slide.title ?? next,
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
                  slide.title && <RichDocView doc={slide.title} className="rich-doc--title" />
                )}
              </div>
            )}
            renderLeaf={(leaf) => (
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
                ) : mode === 'zone' ? (
                  <ZoneContentView content={leaf.content} />
                ) : (
                  <EditableZoneContent
                    content={leaf.content}
                    nodeId={leaf.id}
                    slideId={slide.id}
                    editable={canTypeIn(textEditing, leaf.id)}
                    onPickImage={onPickImage}
                  />
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
