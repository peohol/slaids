/**
 * A zone's content, drawn smaller when it does not fit at normal size.
 *
 * Only a person can leave a zone with more content than it has room for at
 * normal size — by resizing it, writing or pasting more into it, a new theme,
 * placing content in it, and every other edit in the app, none of which is
 * refused for lack of room (`domain/commands/manualLayout.ts`). Either way
 * nothing may be hidden. So the content is laid out in a box `1/s` times the zone and drawn
 * scaled back down by `s`, with `s` the largest scale at which it fits
 * (`domain/softSize.ts`). Everything in the zone shrinks together — the type,
 * the space between paragraphs, list indents, pictures in the text, captions,
 * citation pills — because what is scaled is the drawing, not a list of sizes
 * somebody remembered to multiply.
 *
 * Unntaket er et kort med tittel, som har to felt som forminskes hver for seg:
 * innholdet er sitt eget område (`fitTarget`), og tittelen settes mindre for
 * seg (`fitTitleLines`). Det ene feltet gjør aldri det andre mindre, og bare
 * feltet som er forminsket, merkes.
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
import { CARD_TITLE_PART } from '../../domain/fit'
import { fitScale } from '../../domain/softSize'
import { measureOverflowParts } from './overflowParts'
import { useSlideRender } from './SlideRenderContext'
import { fitTitleLines } from './titleFit'

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
  // Et område inne i et kort er et flex-element; den gitte størrelsen gjelder.
  element.style.flex = '0 0 auto'
  element.style.transform = scaled ? `scale(${scale})` : ''
  element.parentElement?.classList.toggle('zone-fit__clip--scaled', scaled)
}

/** Det som forminskes i en sone, og plassen det har i normal størrelse. */
export interface FitTarget {
  element: HTMLElement
  width: number
  height: number
}

/**
 * Hva i sonen som tegnes mindre når innholdet ikke får plass.
 *
 * Et kort med tittel har to felt som forminskes hver for seg: tittelen
 * (`fitTitleLines`) og innholdet under den, som er merket `data-fit-region`.
 * Finnes et slikt område, er det området som forminskes, i plassen kortet gir
 * det; tittelen og kortets egne mål står urørt. Ellers er det hele sonen,
 * `element` selv, i `width × height`.
 *
 * Området slippes først løs fra en tidligere forminsking, så plassen leses av
 * kortet slik det står i normal størrelse.
 *
 * Selvstendig, som `drawZoneFit`, så forhåndsvisningens rasterisering kan gi
 * den til siden den tegner.
 */
export function fitTarget(element: HTMLElement, width: number, height: number): FitTarget {
  const region = element.querySelector<HTMLElement>('[data-fit-region]')
  const box = region?.parentElement
  if (!region || !box) return { element, width, height }
  for (const property of ['width', 'height', 'flex', 'transform']) region.style.removeProperty(property)
  box.classList.remove('zone-fit__clip--scaled')
  const style = getComputedStyle(box)
  return {
    element: region,
    width: box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    height: box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
  }
}

/** Titlene i kortene i en sone: de forminskes hver for seg (`fitTitleLines`). */
export const CARD_HEADER_SELECTOR = '.card-header'

/** Et felt som er tegnet mindre, i sonens egne enheter, regnet fra sonens øvre venstre hjørne. */
export interface ShrunkBox {
  x: number
  y: number
  width: number
  height: number
}

export interface ZoneFitBoxProps {
  width: number
  height: number
  /** Told every scale the box settles on — `1` at normal size. */
  onScale?: (scale: number) => void
  /**
   * Tegnes over hvert felt som er forminsket – hele sonen, eller bare tittelen
   * eller innholdet i et kort med tittel – i feltets egen boks.
   */
  marker?: (box: ShrunkBox) => ReactNode
  children: ReactNode
}

/**
 * Den verste overflyten i sonens innhold. En korttittel holdes utenfor: den
 * tilpasser seg selv (`fitTitleLines`), så en lang tittel gjør aldri resten
 * av sonen mindre.
 */
function worstOverflow(element: HTMLElement): number {
  return Object.entries(measureOverflowParts(element)).reduce(
    (worst, [part, value]) => (part === CARD_TITLE_PART ? worst : Math.max(worst, value)),
    0,
  )
}

/**
 * En endring som er forminskingen selv i arbeid, ikke nytt innhold: stilen på
 * en kortheader (`fitTitleLines`) eller på et område som forminskes, og
 * klassen på boksen rundt området (`drawZoneFit`).
 */
function isFitDrawing(record: MutationRecord): boolean {
  const target = record.target
  if (record.type !== 'attributes' || !(target instanceof HTMLElement)) return false
  if (record.attributeName === 'style') return target.matches('.card-header, [data-fit-region]')
  return record.attributeName === 'class' && target.querySelector(':scope > [data-fit-region]') !== null
}

/** `inner` sin boks i sonens egne enheter, regnet fra `zone` sitt øvre venstre hjørne. */
function boxWithin(zone: HTMLElement, inner: HTMLElement): ShrunkBox {
  const outer = zone.getBoundingClientRect()
  const rect = inner.getBoundingClientRect()
  // Skjermpiksler per sone-enhet: sliden er tegnet skalert på stagen.
  const unit = outer.width / (zone.offsetWidth || 1) || 1
  return {
    x: (rect.left - outer.left) / unit,
    y: (rect.top - outer.top) / unit,
    width: rect.width / unit,
    height: rect.height / unit,
  }
}

function sameBoxes(a: ShrunkBox[], b: ShrunkBox[]): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) < 0.5
  return (
    a.length === b.length &&
    a.every(
      (box, i) =>
        near(box.x, b[i].x) && near(box.y, b[i].y) && near(box.width, b[i].width) && near(box.height, b[i].height),
    )
  )
}

interface DrawnFit {
  /** Skalaen hele sonen er tegnet i – `1` når det er et område i den som forminskes. */
  zone: number
  /** Skalaen innholdet er tegnet i, enten det er hele sonen eller kortets innhold. */
  content: number
  /** Hvor mye mindre den minste korttittelen er satt. */
  title: number
  /** Feltene som er forminsket. */
  shrunk: ShrunkBox[]
}

const NORMAL: DrawnFit = { zone: 1, content: 1, title: 1, shrunk: [] }

export function ZoneFitBox({ width, height, onScale, marker, children }: ZoneFitBoxProps) {
  const { theme, numbering, authorYearLabels } = useSlideRender()
  const rootRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(1)
  const [fit, setFit] = useState<DrawnFit>(NORMAL)
  const onScaleRef = useRef(onScale)
  useEffect(() => {
    onScaleRef.current = onScale
  }, [onScale])
  // A zone that leaves — emptied, deleted, another slide shown — is no longer
  // drawn small anywhere.
  useEffect(() => () => onScaleRef.current?.(1), [])

  const refit = useCallback(() => {
    const element = innerRef.current
    const root = rootRef.current
    if (!element || !root) return
    // Sonen i normal størrelse først: et område i den leser plassen sin av den.
    drawZoneFit(element, width, height, 1, false)
    const target = fitTarget(element, width, height)
    const found = fitScale(
      (w, h) => {
        drawZoneFit(target.element, w, h, 1, false)
        return worstOverflow(element) <= FIT_TOLERANCE
      },
      target.width,
      target.height,
      scaleRef.current,
    )
    const content = isZoneFitScaled(found) ? found : 1
    scaleRef.current = content
    if (target.element !== element && content === 1) fitTarget(element, width, height)
    else drawZoneFit(target.element, target.width, target.height, content, content !== 1)
    // Titlene for seg: de har sin egen plass i headeren, uansett hvor mye
    // innholdet under er forminsket.
    const titleFit = fitTitleLines(element.querySelectorAll<HTMLElement>(CARD_HEADER_SELECTOR))
    const title = isZoneFitScaled(titleFit) ? titleFit : 1

    const shrunk: ShrunkBox[] = []
    if (content !== 1) {
      shrunk.push(
        target.element === element
          ? { x: 0, y: 0, width, height }
          : boxWithin(root, target.element.parentElement ?? target.element),
      )
    }
    for (const header of element.querySelectorAll<HTMLElement>(CARD_HEADER_SELECTOR)) {
      if (!header.style.getPropertyValue('--slaids-title-fit')) continue
      const box = boxWithin(root, header)
      // En fane står opp bak innholdet; merket følger bare den synlige delen.
      const body = header.parentElement?.querySelector<HTMLElement>(':scope > .card-body')
      const below = body ? boxWithin(root, body).y : Infinity
      shrunk.push({ ...box, height: Math.max(0, Math.min(box.height, below - box.y)) })
    }
    const zone = target.element === element ? content : 1
    setFit((current) =>
      current.zone === zone &&
      current.content === content &&
      current.title === title &&
      sameBoxes(current.shrunk, shrunk)
        ? current
        : { zone, content, title, shrunk },
    )
    // Den minste skriften noe sted i sonen er det editoren melder.
    onScaleRef.current?.(Math.min(content, title))
  }, [width, height])

  // The geometry, the theme and the numbering: re-fitted before the change is
  // painted, so a drag never shows a frame of the new size at the old scale.
  useLayoutEffect(() => {
    refit()
  }, [refit, theme, numbering, authorYearLabels])

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
      if (records.some((record) => record.target !== element && !isFitDrawing(record))) schedule()
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

  const zoneScaled = isZoneFitScaled(fit.zone)
  const contentScaled = isZoneFitScaled(fit.content)
  const titleScaled = isZoneFitScaled(fit.title)
  return (
    <div
      ref={rootRef}
      className="zone-fit"
      data-fit-scale={contentScaled ? fit.content.toFixed(3) : undefined}
      data-title-fit={titleScaled ? fit.title.toFixed(3) : undefined}
    >
      <div className={zoneScaled ? 'zone-fit__clip zone-fit__clip--scaled' : 'zone-fit__clip'}>
        <div
          className="zone-fit__inner"
          ref={innerRef}
          style={{
            width: width / fit.zone,
            height: height / fit.zone,
            transform: zoneScaled ? `scale(${fit.zone})` : undefined,
          }}
        >
          {children}
        </div>
      </div>
      {marker &&
        fit.shrunk.map((box, index) => (
          <div
            key={index}
            className="zone-fit__mark"
            style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
          >
            {marker(box)}
          </div>
        ))}
    </div>
  )
}
