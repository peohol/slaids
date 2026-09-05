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
  viewportToSlide,
} from '../../domain/geometry'
import { findSplit, updateNode } from '../../domain/layout'
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
import type { ContentSlide, LayoutNode, NodeId, Rect, ZoneContentKind } from '../../domain/types'
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
import { commitDraggedRatios, draggedWeights } from './ratioDrag'
import { ZoneOverlay, type ZoneAction } from './ZoneOverlay'
import { ZoneDropZone } from './ZoneDropZone'
import { EmptyZone } from './EmptyZone'

interface DragState {
  splitId: NodeId
  boundary: number
  axis: 'x' | 'y'
  startPointer: number
  originalWeights: number[]
  usable: number
  minShare: number[]
  /** Captured so the drag can be fit-validated without re-reading the tree. */
  parentRect: Rect
  children: LayoutNode[]
  /**
   * Overflow of the two zones on either side of the boundary before the drag
   * started. The handle is allowed to move as long as neither gets worse, which
   * is the same rule `setSplitWeights` applies on release — so the handle never
   * stops somewhere the commit would refuse, and a zone that already overflows
   * can still be dragged wider to repair it.
   */
  baseline: Map<NodeId, number>
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
    const point = toSlidePoint(event.clientX, event.clientY)
    if (!point) return
    const hit = hitTestLayout(displaySlide.root, geometry.rects, point.x, point.y)
    if (hit) selectNode(hit)
  }

  const beginHandleDrag = (splitId: NodeId, boundary: number, event: React.PointerEvent): void => {
    const split = findSplit(displaySlide.root, splitId)
    const parentRect = geometry.rects.get(splitId)
    if (!split || !parentRect) return
    event.preventDefault()
    event.stopPropagation()
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)

    const along = split.axis === 'x' ? parentRect.width : parentRect.height
    const usable = along - tokens.gap * (split.children.length - 1)
    const total = split.weights.reduce((sum, weight) => sum + weight, 0)
    const minShare = split.children.map((child) => {
      const min = minimumSizeFor(child)
      const need = split.axis === 'x' ? min.width : min.height
      return (need / usable) * total
    })

    const startRects = splitRect(parentRect, split.axis, split.weights, tokens.gap)
    const baseline = new Map<NodeId, number>()
    for (const index of [boundary, boundary + 1]) {
      const child = split.children[index]
      if (!child) continue
      for (const [nodeId, overflow] of subtreeOverflow(
        child,
        startRects[index],
        fitContext,
        domFitCheckers,
      )) {
        baseline.set(nodeId, overflow)
      }
    }

    dragRef.current = {
      splitId,
      boundary,
      axis: split.axis,
      startPointer: split.axis === 'x' ? event.clientX : event.clientY,
      originalWeights: [...split.weights],
      usable,
      minShare,
      parentRect,
      children: split.children,
      baseline,
    }
    selectNode(splitId)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    const move = (event: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const pointer = drag.axis === 'x' ? event.clientX : event.clientY
      const deltaPx = (pointer - drag.startPointer) / (scale || 1)
      const total = drag.originalWeights.reduce((sum, weight) => sum + weight, 0)
      const deltaWeight = (deltaPx / drag.usable) * total

      // Nothing is rounded here: the boundary follows the pointer, and the
      // layout only snaps to a whole ratio once the pointer is let go.
      const weights = draggedWeights(
        drag.originalWeights,
        drag.boundary,
        deltaWeight,
        drag.minShare,
      )
      if (!weights) return

      // The handle stops where the content stops fitting, rather than letting
      // the user drag into an invalid state and snapping back on release.
      const childRects = splitRect(drag.parentRect, drag.axis, weights, tokens.gap)
      for (const index of [drag.boundary, drag.boundary + 1]) {
        const next = subtreeOverflow(
          drag.children[index],
          childRects[index],
          fitContext,
          domFitCheckers,
        )
        if (overflowRegressions(next, (nodeId) => drag.baseline.get(nodeId) ?? 0).length > 0) return
      }
      setPreview({ nodeId: drag.splitId, weights })
    }

    const up = (): void => {
      const drag = dragRef.current
      dragRef.current = null
      const pending = preview
      setPreview(null)
      if (!drag || !pending) return

      // The released geometry is a wish; what gets stored is the nearest ratio
      // the deck can be written in, keeping zones that shared a ratio before
      // the gesture sharing one.
      runStructural('ratio', (presentation) =>
        commitDraggedRatios(drag.originalWeights, drag.boundary, pending.weights, (weights) =>
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
