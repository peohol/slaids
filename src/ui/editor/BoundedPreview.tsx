/**
 * A picture of a rect, as large as its box allows and never larger.
 *
 * The split dialog's preview and the template editor's overview are the same
 * kind of thing: a zone (or a whole slide) drawn at one uniform scale inside a
 * box the stylesheet bounds in width *and* height. The box asks for the rect's
 * aspect ratio, the caps decide how much of it it gets, and the drawing is
 * scaled to fit what it got — contain, never cover — so a tall, narrow zone
 * makes a small picture rather than a tall one, an open keyboard shrinks the
 * picture instead of pushing the controls away, and nothing ever scrolls.
 *
 * This is only the box and the scale. What is drawn, and how a press on it is
 * read, belongs to the caller: the split dialog's zones and the template
 * editor's are different questions about the same geometry. No geometry is
 * made here either — the caller draws the engine's own rects at `scale`.
 */

import { useRef, type CSSProperties, type ReactNode } from 'react'
import { useContainerBox } from '../slide/useFitScale'
import { containScale, type Size } from './splitPreviewModel'

export function BoundedPreview({
  size,
  className,
  padding = 0,
  testId,
  children,
}: {
  /** The rect being drawn, in slide units. */
  size: Size
  /** Where the stylesheet sets the box's caps. */
  className: string
  /** Room kept free inside the box, for strokes and frames drawn outside the rect. */
  padding?: number
  testId?: string
  /** The drawing at `scale`; not called until the box has been measured. */
  children: (scale: number) => ReactNode
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const box = useContainerBox(boxRef)
  const scale = containScale(box, size)
  const style: CSSProperties = { aspectRatio: `${size.width} / ${size.height}`, padding }

  return (
    <div ref={boxRef} className={className} data-testid={testId} style={style}>
      {scale > 0 && children(scale)}
    </div>
  )
}
