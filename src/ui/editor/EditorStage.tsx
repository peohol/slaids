/**
 * The slide stage.
 *
 * The slide is always drawn in the fixed 1600x900 design space and scaled
 * uniformly to the viewport. Pointer coordinates are converted back into slide
 * coordinates before hit-testing, so selection uses the geometry engine rather
 * than overlapping DOM elements.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  TITLE_LINE_HEIGHT,
} from '../../domain/constants'
import { geometryForTheme, themeMetrics } from '../../domain/metrics'
import {
  TITLE_NODE_ID,
  computeSlideGeometry,
  hitTestLayout,
  minimumSizeFor,
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
import { useFitScale } from '../slide/useFitScale'
import { domFitCheckers } from '../../state/measure'
import { docEditRenumberProblem } from '../../state/citationFit'
import { ZoneContentView } from '../slide/ZoneContentView'
import { RichDocView } from '../slide/RichDocView'
import { EditableZoneContent } from './EditableZoneContent'
import { RichTextEditor } from './RichTextEditor'
import {
  commitDraggedRatios,
  draggedWeights,
  resizedWeights,
  translatedWeights,
  zoneDragAmount,
  zoneDragMode,
  type ZoneDragMode,
} from './ratioDrag'
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
  /** Zones that can accept the item currently being dragged, decided at drag start. */
  dropTargets: ReadonlySet<NodeId>
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
  if (!host) return 0
  const boxes = [host, ...host.querySelectorAll<HTMLElement>('.rich-doc--title')]
  return boxes.reduce((worst, box) => Math.max(worst, box.scrollWidth - box.clientWidth), 0)
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
}: EditorStageProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
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

  const scale = useFitScale(viewportRef)
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

  const toSlidePoint = useCallback(
    (clientX: number, clientY: number) => {
      const element = slideRef.current
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return viewportToSlide(clientX, clientY, { left: rect.left, top: rect.top }, scale || 1)
    },
    [scale],
  )

  const handlePointerMove = (event: React.PointerEvent): void => {
    if (mode !== 'zone' || dragRef.current) return
    const point = toSlidePoint(event.clientX, event.clientY)
    if (!point) return
    setHovered(hitTestLayout(displaySlide.root, geometry.rects, point.x, point.y))
  }

  const handleClick = (event: React.MouseEvent): void => {
    if (mode !== 'zone') return
    if (draggedRef.current) {
      draggedRef.current = false
      return
    }
    const point = toSlidePoint(event.clientX, event.clientY)
    if (!point) return
    const hit = hitTestLayout(displaySlide.root, geometry.rects, point.x, point.y)
    if (hit) selectNode(hit)
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
      const min = minimumSizeFor(child)
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
        (deltaPx / (scale || 1) / drag.usable) * total
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
      runStructural('ratio', (presentation) =>
        commitDraggedRatios(equalityKeys, pending.weights, (weights) =>
          setSplitWeights(presentation, {
            slideId: slide.id,
            nodeId: pending.nodeId,
            weights,
            // A ratio change may not shrink a zone past what its content needs.
            ...domFitCheckers,
          }),
        ),
      )
    }

    /** A gesture the browser took over (touch panning) must not commit. */
    const cancel = (): void => {
      if (!dragRef.current) return
      dragRef.current = null
      setPreview(null)
    }

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
  }, [fitContext, preview, runStructural, scale, slide.id, tokens.gap])

  const titleColor = bestTextColor(colors.background)

  return (
    <div
      className="stage-viewport"
      ref={viewportRef}
      data-testid="stage-viewport"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHovered(null)}
      onClick={handleClick}
    >
      <div
        className="stage-scaler"
        style={{ width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale }}
      >
        <div
          ref={slideRef}
          className="stage-slide"
          data-testid="stage-slide"
          data-scale={scale}
          style={{
            width: SLIDE_WIDTH,
            height: SLIDE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
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
              >
                {slide.title && mode === 'content' ? (
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
                  <EmptyZone nodeId={leaf.id} compact={mode === 'zone'} onAdd={onAddContent} />
                ) : mode === 'zone' ? (
                  <ZoneContentView content={leaf.content} />
                ) : (
                  <EditableZoneContent
                    content={leaf.content}
                    nodeId={leaf.id}
                    slideId={slide.id}
                    onPickImage={onPickImage}
                  />
                )}
              </ZoneDropZone>
            )}
          >
            {mode === 'zone' && (
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
        </div>
      </div>
    </div>
  )
}
