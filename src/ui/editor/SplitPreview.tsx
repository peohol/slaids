/**
 * The split dialog's picture of the proposal.
 *
 * Purely a view: `splitPreviewModel` has already decided what is a zone being
 * edited and what is kept structure, from the engine's own rects. This draws it
 * at one uniform scale that fits the target into the box the stylesheet gives
 * the preview — bounded in width *and* height — so a tall, narrow zone is drawn
 * small rather than tall, and the dialog never grows a scrollbar for a picture.
 *
 * The visual language (UX plan for zone editing, § 3):
 *  - the target is one neutral frame around the whole drawing, set a few
 *    pixels outside it so it never doubles a zone's edge;
 *  - the zones being edited are solid, tinted and numbered;
 *  - what is kept inside them is dashed, thinner and dimmer, and fainter the
 *    deeper it lies;
 *  - a zone that would be too small is hatched as well as red, so the state
 *    reads without colour;
 *  - the zone whose ratio field has focus or the pointer is drawn with a
 *    thicker stroke, and the zone that receives the content already in the
 *    split leaf says so in words.
 *
 * Pointing at a zone — or at anything kept inside it — names that direct zone
 * to the dialog, which focuses its ratio field. It never changes which level
 * is being edited: deeper zones are edited by selecting them on the stage.
 *
 * Everything is drawn inside a measured safety margin, so the outermost
 * strokes — right and bottom included — are never cut by the box's edge.
 */

import { useId, useRef } from 'react'
import { useContainerBox } from '../slide/useFitScale'
import { containScale, type Size, type SplitPreviewModel } from './splitPreviewModel'

/** Stroke of a zone being edited; drawn inside its rect, so neighbours never overlap. */
const ZONE_STROKE = 2
/** The zone whose field is in use: thicker, so the link reads without colour. */
const ZONE_STROKE_ACTIVE = 3.5
/** How far outside the drawing the target's frame sits, to its outer edge. */
const FRAME_OUTSET = 6
/** Room around the drawing for the frame; the box's padding, so nothing reaches its edge. */
const SAFE_MARGIN = FRAME_OUTSET + 2
/** Below this a number would not be legible in the zone; the caption carries it instead. */
const ZONE_LABEL_MIN = 18
const CONTEXT_LABEL_MIN = { width: 34, height: 18 }
/** Room for «2 · innhold»; below it the number alone, and the caption says the rest. */
const CONTENT_LABEL_MIN = { width: 92, height: 24 }

export interface SplitPreviewProps {
  /** The target zone's real size, in slide units. */
  size: Size
  /** What to draw; `null` when the fields cannot be read, and only the frame is shown. */
  model: SplitPreviewModel | null
  /** Read out instead of the picture. */
  description: string
  /** The direct zone whose field has focus or the pointer; `null` for none. */
  activeIndex?: number | null
  /** The direct zone that receives the content of the leaf being split, if any. */
  contentIndex?: number | null
  /** The pointer entered a direct zone (or anything inside it), or left them all. */
  onZoneHover?: (index: number | null) => void
  /** A direct zone (or anything inside it) was clicked. */
  onZoneSelect?: (index: number) => void
}

export function SplitPreview({
  size,
  model,
  description,
  activeIndex = null,
  contentIndex = null,
  onZoneHover,
  onZoneSelect,
}: SplitPreviewProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const box = useContainerBox(boxRef)
  const hatchId = `${useId()}-hatch`
  const scale = containScale(box, size)
  const drawn = { width: size.width * scale, height: size.height * scale }
  const offset = FRAME_OUTSET

  return (
    <div
      ref={boxRef}
      className="split-preview"
      data-testid="split-preview"
      style={{ aspectRatio: `${size.width} / ${size.height}`, padding: SAFE_MARGIN }}
    >
      {scale > 0 && (
        <svg
          className="split-preview__drawing"
          role="img"
          aria-label={description}
          width={drawn.width + 2 * offset}
          height={drawn.height + 2 * offset}
          data-scale={scale}
          onPointerLeave={onZoneHover ? () => onZoneHover(null) : undefined}
        >
          <defs>
            <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="split-preview__hatch" />
            </pattern>
          </defs>
          <g transform={`translate(${offset} ${offset})`}>
            <rect
              className="split-preview__frame"
              data-preview-frame=""
              x={-FRAME_OUTSET + 0.5}
              y={-FRAME_OUTSET + 0.5}
              width={drawn.width + 2 * FRAME_OUTSET - 1}
              height={drawn.height + 2 * FRAME_OUTSET - 1}
              rx={4}
            />
            {model?.zones.map((zone) => {
              const x = zone.rect.x * scale
              const y = zone.rect.y * scale
              const width = zone.rect.width * scale
              const height = zone.rect.height * scale
              const inner = {
                x: x + ZONE_STROKE / 2,
                y: y + ZONE_STROKE / 2,
                width: Math.max(width - ZONE_STROKE, 0.5),
                height: Math.max(height - ZONE_STROKE, 0.5),
              }
              const active = zone.index === activeIndex
              const receives = zone.index === contentIndex
              const className = [
                'split-preview__zone',
                zone.tooSmall && 'split-preview__zone--too-small',
                active && 'split-preview__zone--active',
              ]
                .filter(Boolean)
                .join(' ')
              const label =
                receives && width >= CONTENT_LABEL_MIN.width && height >= CONTENT_LABEL_MIN.height
                  ? `${zone.label} · innhold`
                  : zone.label
              return (
                <g
                  key={zone.index}
                  className={onZoneSelect ? 'split-preview__hit' : undefined}
                  onPointerEnter={onZoneHover ? () => onZoneHover(zone.index) : undefined}
                  onClick={onZoneSelect ? () => onZoneSelect(zone.index) : undefined}
                >
                  <rect
                    className={className}
                    data-preview-zone={zone.label}
                    data-too-small={zone.tooSmall || undefined}
                    data-active={active || undefined}
                    data-content-target={receives || undefined}
                    {...inner}
                    strokeWidth={active ? ZONE_STROKE_ACTIVE : ZONE_STROKE}
                    rx={2}
                  />
                  {zone.tooSmall && <rect {...inner} fill={`url(#${hatchId})`} />}
                  {Math.min(width, height) >= ZONE_LABEL_MIN && (
                    <text
                      className="split-preview__label"
                      x={x + width / 2}
                      y={y + height / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      {label}
                    </text>
                  )}
                </g>
              )
            })}
            {model?.dividers.map((divider, index) => (
              <line
                key={index}
                className={
                  divider.depth > 2
                    ? 'split-preview__divider split-preview__divider--deep'
                    : 'split-preview__divider'
                }
                data-preview-divider={divider.depth}
                x1={divider.x1 * scale}
                y1={divider.y1 * scale}
                x2={divider.x2 * scale}
                y2={divider.y2 * scale}
              />
            ))}
            {model?.context.map((zone) => {
              const width = zone.rect.width * scale
              const height = zone.rect.height * scale
              if (width < CONTEXT_LABEL_MIN.width || height < CONTEXT_LABEL_MIN.height) return null
              return (
                <text
                  key={zone.label}
                  className="split-preview__context-label"
                  data-preview-context={zone.label}
                  x={zone.rect.x * scale + 6}
                  y={zone.rect.y * scale + 6}
                  dominantBaseline="hanging"
                >
                  {zone.label}
                </text>
              )
            })}
          </g>
        </svg>
      )}
    </div>
  )
}
