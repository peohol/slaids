/**
 * Tittellinjer som ikke får plass, settes i mindre skrift.
 *
 * En tittel er én linje som aldri brytes: slidetittelen, de to linjene på en
 * inndelingsside (også forsiden) og tittelen i et kort med tittel. Blir
 * linjen for lang for boksen sin – fordi en person skrev mer, valgte en
 * bredere font eller en større skriftstørrelse i temaet, eller et
 * tittelutseende som gir mindre plass – settes skriften i linjen mindre til
 * den får plass. Boksen selv står urørt: samme høyde, samme polstring, samme
 * plass på sliden. Bare skriften krymper.
 *
 * Forminskningen er CSS-variabelen `--slaids-title-fit`, som boksens
 * skriftstørrelse ganges med (`slide.css`, og stilene i `SlideView`,
 * `EditorStage` og `SectionFrame`). Ingenting lagres: skalaen finnes på nytt
 * hver gang linjen tegnes, slik en sones skala gjør (`ZoneFitBox`).
 *
 * En agent måles fortsatt i normal størrelse (`state/measure.tsx` og
 * estimatoren), så en linje som tegnes mindre, regnes aldri som en som får
 * plass.
 */

import { useCallback, useLayoutEffect, useState, type RefObject } from 'react'
import { useSlideRender } from './SlideRenderContext'

/** Under dette er en skala en skala; over det er det avrunding. */
const SCALED = 1 - 1e-4

/**
 * Sett hver tittellinje i `boxes` i mindre skrift til den får plass i boksen
 * sin, og si hvor liten den minste måtte bli (`1` når alle får plass).
 *
 * Plassen er boksens innholdsboks uten polstring, så en forminsket linje
 * beholder lik luft på begge sider og står midtstilt.
 *
 * Selvstendig – ingen referanse utenfor egne parametere – så forhåndsvisningens
 * rasterisering kan gi akkurat denne funksjonen til siden den tegner
 * (`render/chromium.ts`).
 */
export function fitTitleLines(boxes: Iterable<HTMLElement>): number {
  let smallest = 1
  for (const box of boxes) {
    box.style.removeProperty('--slaids-title-fit')
    const line = box.querySelector<HTMLElement>('p')
    if (!line) continue
    let fit = 1
    // Skrift skalerer ikke helt lineært med størrelsen, så første gjetning
    // kontrolleres og strammes inn; den faller på plass etter et steg eller to.
    for (let step = 0; step < 6; step += 1) {
      // Plassen leses på nytt hver gang: en boks som er like bred som teksten
      // (pillen på en inndelingsside), blir smalere med den.
      const style = getComputedStyle(box)
      const room = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      if (!(room > 0)) break
      // Linjens egen bredde der den legges ut i tekstens bredde, rullebredden
      // der en flex-rad har klemt den inn til boksen.
      const needed = Math.max(line.offsetWidth, line.scrollWidth)
      if (needed <= room + 0.5) break
      fit *= room / needed
      box.style.setProperty('--slaids-title-fit', String(fit))
    }
    smallest = Math.min(smallest, fit)
  }
  return smallest
}

/** Om en funnet skala tegnes som en, i stedet for å være avrunding. */
export function isTitleFitScaled(scale: number): boolean {
  return scale < SCALED
}

/** Hvor tittellinjen står og hvor stor den er, i slidens egne enheter. */
export interface TitleFitBox {
  x: number
  y: number
  width: number
  height: number
}

export interface TitleFit {
  /** Skalaen linjen er tegnet i – `1` i normal størrelse. */
  scale: number
  /** Boksen linjen står i, der en markering skal tegnes, eller `null` når den får plass. */
  box: TitleFitBox | null
}

const NORMAL: TitleFit = { scale: 1, box: null }

function sameFit(a: TitleFit, b: TitleFit): boolean {
  if (a.scale !== b.scale) return false
  if (!a.box || !b.box) return a.box === b.box
  const near = (x: number, y: number): boolean => Math.abs(x - y) < 0.5
  return near(a.box.x, b.box.x) && near(a.box.y, b.box.y) && near(a.box.width, b.box.width) && near(a.box.height, b.box.height)
}

/**
 * Hold én tittellinje i `ref` innenfor boksen sin, og si hvor mye den er
 * forminsket.
 *
 * Finnes på nytt når temaet eller nummereringen endres, og en bildeframe
 * senere når noe inni linjen endres – teksten som skrives, en font som kommer.
 * Boksens egne attributter er forminskingen i arbeid og teller ikke som en
 * endring; det som flytter boksen, er temaet.
 */
export function useTitleFit(ref: RefObject<HTMLElement | null>): TitleFit {
  const { theme, numbering } = useSlideRender()
  const [fit, setFit] = useState<TitleFit>(NORMAL)

  const refit = useCallback(() => {
    const box = ref.current
    if (!box) return
    const found = fitTitleLines([box])
    const next: TitleFit = isTitleFitScaled(found)
      ? {
          scale: found,
          // Layoutmål, som ikke påvirkes av at sliden er skalert på skjermen.
          box: { x: box.offsetLeft, y: box.offsetTop, width: box.offsetWidth, height: box.offsetHeight },
        }
      : NORMAL
    setFit((current) => (sameFit(current, next) ? current : next))
  }, [ref])

  useLayoutEffect(() => {
    refit()
  }, [refit, theme, numbering])

  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    let frame: number | null = null
    const schedule = (): void => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        refit()
      })
    }
    const observer = new MutationObserver((records) => {
      if (records.some((record) => !(record.target === box && record.type === 'attributes'))) schedule()
    })
    observer.observe(box, { subtree: true, childList: true, characterData: true, attributes: true })
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    fonts?.addEventListener?.('loadingdone', schedule)
    return () => {
      observer.disconnect()
      fonts?.removeEventListener?.('loadingdone', schedule)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [ref, refit])

  return fit
}

/** Tittellinjene utenfor sonene: slidetittelen og linjene på en inndelingsside. */
export const TITLE_LINE_SELECTOR = '.slide-title, .section-pill'
