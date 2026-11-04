/**
 * A zone's content, drawn smaller when it does not fit at normal size.
 *
 * Only a person can leave a zone with more content than it has room for at
 * normal size: by resizing it below its content's soft minimum
 * (`domain/commands/manualLayout.ts`), or by writing or pasting more into it
 * than fits — a zone's fields take all of it (`ui/editor/EditableZoneContent`).
 * Either way nothing may be hidden. So the content is laid out in a box `1/s` times the zone and drawn
 * scaled back down by `s`, with `s` the largest scale at which it fits
 * (`domain/softSize.ts`). Everything in the zone shrinks together — the type,
 * the space between paragraphs, list indents, a card's header and padding,
 * pictures in the text, captions, citation pills — because what is scaled is
 * the drawing, not a list of sizes somebody remembered to multiply.
 *
 * Measuring and drawing cannot disagree, because they are the same thing: the
 * fit is read off this very element, at the size it is about to be drawn at,
 * with the same clipping boxes and the same `measureOverflowParts` every fit
 * answer in the app reads. Nothing here touches the document or the theme —
 * the stored type sizes are the normal ones — and the offscreen measurer that
 * every command and agent call is judged by renders the content *without*
 * this box, so a zone drawn small is never mistaken for a zone that fits.
 *
 * The scale is found again whenever something it depends on changes: the
 * zone's size, the theme and the citation numbers at once; the drawing inside
 * — the content, a font arriving, a picture loading — one animation frame
 * later, after the editor has had its say about the edit. The search starts
 * from the last answer, so a geometry that moves a little costs a layout or
 * two of this one zone, and a zone that fits costs one.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { FIT_TOLERANCE } from '../../domain/constants'
import { fitScale } from '../../domain/softSize'
import { measureOverflowParts } from './overflowParts'
import { useSlideRender } from './SlideRenderContext'

/** Below this a scale is a scale; above it, rounding. */
const SCALED = 1 - 1e-4

/** Whether a found scale is drawn as one, rather than being rounding. */
export function isZoneFitScaled(scale: number): boolean {
  return scale < SCALED
}

/**
 * Lay the content box out for a zone of `width × height` drawn at `scale`.
 *
 * Self-contained on purpose — no reference outside its own parameters — so
 * the preview rasteriser can hand this very function to the page it
 * screenshots (`render/chromium.ts`) and the preview draws a small zone the
 * way the app does, rather than by a copy of how the app does it.
 */
export function drawZoneFit(
  element: HTMLElement,
  width: number,
  height: number,
  scale: number,
  scaled: boolean,
): void {
  element.style.width = `${width / scale}px`
  element.style.height = `${height / scale}px`
  element.style.transform = scaled ? `scale(${scale})` : ''
  element.parentElement?.classList.toggle('zone-fit__clip--scaled', scaled)
}

export interface ZoneFitBoxProps {
  width: number
  height: number
  /** Told every scale the box settles on — `1` at normal size. */
  onScale?: (scale: number) => void
  /** Drawn over the content while it is scaled, in the zone's own box. */
  marker?: ReactNode
  children: ReactNode
}

function worstOverflow(element: HTMLElement): number {
  return Object.values(measureOverflowParts(element)).reduce((worst, value) => Math.max(worst, value), 0)
}

export function ZoneFitBox({ width, height, onScale, marker, children }: ZoneFitBoxProps) {
  const { theme, numbering } = useSlideRender()
  const innerRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(1)
  const [scale, setScale] = useState(1)
  const onScaleRef = useRef(onScale)
  useEffect(() => {
    onScaleRef.current = onScale
  }, [onScale])
  // A zone that leaves — emptied, deleted, another slide shown — is no longer
  // drawn small anywhere.
  useEffect(() => () => onScaleRef.current?.(1), [])

  const refit = useCallback(() => {
    const element = innerRef.current
    if (!element) return
    const found = fitScale(
      (w, h) => {
        drawZoneFit(element, w, h, 1, false)
        return worstOverflow(element) <= FIT_TOLERANCE
      },
      width,
      height,
      scaleRef.current,
    )
    const next = isZoneFitScaled(found) ? found : 1
    drawZoneFit(element, width, height, next, next !== 1)
    if (next !== scaleRef.current) {
      scaleRef.current = next
      setScale(next)
    }
    onScaleRef.current?.(next)
  }, [width, height])

  // The geometry, the theme and the numbering: re-fitted before the change is
  // painted, so a drag never shows a frame of the new size at the old scale.
  useLayoutEffect(() => {
    refit()
  }, [refit, theme, numbering])

  // Whatever is drawn inside, a frame later — but still before anything is
  // painted. The content arrives, changes and is swapped (the editor's fields
  // for a static drawing, an editor that fills itself after mounting, a
  // picture that loads, a font that arrives) without any prop of this box
  // changing, so it watches the drawing itself. And not at once: what the
  // editor hands over while someone types has not been judged yet — the editor
  // looks at it in the next animation frame and rolls back an edit that would
  // hide content in *another* zone (`RichTextEditor`, `validateDoc`).
  // Re-fitting at once would draw that edit shrunk, mark and all, and then put
  // it back. A frame asked for after the edit runs after the editor's, so it
  // measures what stays. Several changes in one frame are one re-fit.
  useLayoutEffect(() => {
    const element = innerRef.current
    if (!element) return
    let frame: number | null = null
    const schedule = (): void => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        refit()
      })
    }
    // The box's own size and transform are this component's doing, not the
    // content's.
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.target !== element)) schedule()
    })
    observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true })
    element.addEventListener('load', schedule, true)
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    fonts?.addEventListener?.('loadingdone', schedule)
    return () => {
      observer.disconnect()
      element.removeEventListener('load', schedule, true)
      fonts?.removeEventListener?.('loadingdone', schedule)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [refit])

  const scaled = isZoneFitScaled(scale)
  return (
    <div className="zone-fit" data-fit-scale={scaled ? scale.toFixed(3) : undefined}>
      <div className={scaled ? 'zone-fit__clip zone-fit__clip--scaled' : 'zone-fit__clip'}>
        <div
          className="zone-fit__inner"
          ref={innerRef}
          style={{
            width: width / scale,
            height: height / scale,
            transform: scaled ? `scale(${scale})` : undefined,
          }}
        >
          {children}
        </div>
      </div>
      {scaled && marker}
    </div>
  )
}
