/**
 * The slide stage.
 *
 * The slide is always drawn in the fixed 1600x900 design space and scaled
 * uniformly to the viewport. Pointer coordinates are converted back into slide
 * coordinates before hit-testing, so selection uses the geometry engine rather
 * than overlapping DOM elements.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  TITLE_FONT_SIZE,
  TITLE_LINE_HEIGHT,
  G,
} from '../../domain/constants'
import {
  computeSlideGeometry,
  fitScale,
  hitTestLayout,
  minimumSizeFor,
  viewportToSlide,
} from '../../domain/geometry'
import { findSplit, updateNode } from '../../domain/layout'
import { bestTextColor, textShadowFor } from '../../domain/color'
import { setSlideTitle, setSplitWeights } from '../../domain/commands'
import { useEditorStore } from '../../state/store'
import type { LayoutNode, NodeId, Slide, ZoneContentKind } from '../../domain/types'
import { SlideView, absoluteStyle } from '../slide/SlideView'
import { useSlideRender } from '../slide/SlideRenderContext'
import { ZoneContentView } from '../slide/ZoneContentView'
import { RichDocView } from '../slide/RichDocView'
import { EditableZoneContent } from './EditableZoneContent'
import { RichTextEditor } from './RichTextEditor'
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
}

export interface EditorStageProps {
  slide: Slide
  actions: ZoneAction[]
  onAddContent: (nodeId: NodeId, kind: ZoneContentKind) => void
}

export function EditorStage({ slide, actions, onAddContent }: EditorStageProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const slideRef = useRef<HTMLDivElement>(null)
  const titleHostRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  const [hovered, setHovered] = useState<NodeId | null>(null)
  const [preview, setPreview] = useState<{ nodeId: NodeId; weights: number[] } | null>(null)
  const dragRef = useRef<DragState | null>(null)

  const mode = useEditorStore((state) => state.mode)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const selectNode = useEditorStore((state) => state.selectNode)
  const run = useEditorStore((state) => state.run)
  const runStructural = useEditorStore((state) => state.runStructural)
  const setActiveField = useEditorStore((state) => state.setActiveField)
  const { theme } = useSlideRender()

  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const update = (): void => {
      // clientWidth/Height include padding, which is not usable stage area.
      const styles = getComputedStyle(element)
      const width =
        element.clientWidth -
        parseFloat(styles.paddingLeft || '0') -
        parseFloat(styles.paddingRight || '0')
      const height =
        element.clientHeight -
        parseFloat(styles.paddingTop || '0') -
        parseFloat(styles.paddingBottom || '0')
      setScale(fitScale(width, height))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const displaySlide: Slide = preview
    ? {
        ...slide,
        root: updateNode(slide.root, preview.nodeId, (node) =>
          node.kind === 'split' ? ({ ...node, weights: preview.weights } as LayoutNode) : node,
        ),
      }
    : slide

  const geometry = computeSlideGeometry(displaySlide)

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
    const usable = along - G * (split.children.length - 1)
    const total = split.weights.reduce((sum, weight) => sum + weight, 0)
    const minShare = split.children.map((child) => {
      const min = minimumSizeFor(child)
      const need = split.axis === 'x' ? min.width : min.height
      return (need / usable) * total
    })

    dragRef.current = {
      splitId,
      boundary,
      axis: split.axis,
      startPointer: split.axis === 'x' ? event.clientX : event.clientY,
      originalWeights: [...split.weights],
      usable,
      minShare,
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

      const weights = [...drag.originalWeights]
      const i = drag.boundary
      const minA = drag.minShare[i]
      const minB = drag.minShare[i + 1]
      const pairTotal = weights[i] + weights[i + 1]
      let next = weights[i] + deltaWeight
      next = Math.max(minA, Math.min(next, pairTotal - minB))
      if (!Number.isFinite(next) || next <= 0 || pairTotal - next <= 0) return
      weights[i] = next
      weights[i + 1] = pairTotal - next
      setPreview({ nodeId: drag.splitId, weights })
    }

    const up = (): void => {
      const drag = dragRef.current
      dragRef.current = null
      const pending = preview
      setPreview(null)
      if (!drag || !pending) return
      runStructural('ratio', (presentation) =>
        setSplitWeights(presentation, {
          slideId: slide.id,
          nodeId: pending.nodeId,
          weights: pending.weights,
        }),
      )
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [preview, runStructural, scale, slide.id])

  const titleColor = bestTextColor(theme.backgroundColor)

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
                  fontSize: TITLE_FONT_SIZE,
                  lineHeight: TITLE_LINE_HEIGHT,
                  textShadow: textShadowFor(theme.backgroundColor),
                }}
                data-fit-scroll=""
              >
                {slide.title && mode === 'content' ? (
                  <RichTextEditor
                    doc={slide.title}
                    variant="title"
                    placeholder="Slidetittel"
                    overflowMessage="Overskriften får ikke plass i tittelsonen."
                    measureOverflow={() =>
                      titleHostRef.current
                        ? Math.max(
                            0,
                            titleHostRef.current.scrollWidth - titleHostRef.current.clientWidth,
                          )
                        : 0
                    }
                    onFocus={() => setActiveField({ nodeId: '__title__', subfieldId: null, kind: 'slide-title' })}
                    onChange={(doc) =>
                      run('typing:slide-title', (presentation) =>
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
              <ZoneDropZone nodeId={leaf.id} slideId={slide.id}>
                {!leaf.content ? (
                  <EmptyZone nodeId={leaf.id} compact={mode === 'zone'} onAdd={onAddContent} />
                ) : mode === 'zone' ? (
                  <ZoneContentView content={leaf.content} />
                ) : (
                  <EditableZoneContent content={leaf.content} nodeId={leaf.id} slideId={slide.id} />
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
                handleGap={G}
              />
            )}
          </SlideView>
        </div>
      </div>
    </div>
  )
}
