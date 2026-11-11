/**
 * Tittellinjer som ikke får plass, settes i mindre skrift.
 *
 * jsdom legger ikke ut noe, så bredden linjen trenger, er her en funksjon av
 * skriftskalaen boksen har fått – og bredden en pille har, følger teksten
 * opp til taket sitt, slik den gjør på en inndelingsside.
 */

import { describe, expect, it } from 'vitest'
import { fitTitleLines, isTitleFitScaled } from './titleFit'

const FIT = '--slaids-title-fit'

function scaleOf(box: HTMLElement): number {
  const value = parseFloat(box.style.getPropertyValue(FIT))
  return Number.isFinite(value) ? value : 1
}

/**
 * En boks med én linje. Linjen er `text` bred i normal størrelse; boksen er
 * `width` bred, eller – for en pille – like bred som linjen, høyst `width`.
 * `rounded` er boksens bredde i hele piksler, når den skal avvike fra `width`.
 */
function titleBox(
  text: number,
  width: number,
  { hugs = false, padding = 0, rounded = width } = {},
): HTMLElement & { text: number } {
  const box = Object.assign(document.createElement('div'), { text })
  box.style.paddingLeft = `${padding}px`
  box.style.paddingRight = `${padding}px`
  const line = document.createElement('p')
  box.append(line)
  const lineWidth = (): number => box.text * scaleOf(box)
  Object.defineProperty(line, 'offsetWidth', { get: lineWidth })
  Object.defineProperty(line, 'scrollWidth', { get: lineWidth })
  Object.defineProperty(box, 'clientWidth', {
    get: () => (hugs ? Math.min(width, lineWidth() + padding * 2) : rounded),
  })
  document.body.append(box)
  return box
}

describe('fitTitleLines', () => {
  it('lar en linje som får plass stå i normal størrelse', () => {
    const box = titleBox(300, 400)
    expect(fitTitleLines([box])).toBe(1)
    expect(box.style.getPropertyValue(FIT)).toBe('')
  })

  it('setter en for lang linje mindre til den får plass i boksen, innenfor polstringen', () => {
    const box = titleBox(1000, 440, { padding: 20 })
    const scale = fitTitleLines([box])
    expect(isTitleFitScaled(scale)).toBe(true)
    expect(scale).toBeCloseTo(0.4, 3)
    expect(scaleOf(box)).toBeCloseTo(scale, 6)
  })

  it('gjør det samme i en pille som er like bred som teksten', () => {
    const box = titleBox(2000, 800, { hugs: true, padding: 30 })
    const scale = fitTitleLines([box])
    // Linjen får plass i pillens største bredde, uten polstringen.
    expect(2000 * scale).toBeLessThanOrEqual(800 - 60 + 0.5)
    expect(2000 * scale).toBeGreaterThan(800 - 60 - 2)
  })

  it('lar en pille som er like bred som teksten stå, selv når bredden ikke er et helt tall', () => {
    // Pillen og linjen er begge 511,6 piksler. I hele piksler er linjen 512
    // og pillen 511 – det er avrunding, ikke en linje som ikke får plass.
    const box = titleBox(512, 800, { rounded: 511 })
    box.style.width = '511.6px'
    expect(fitTitleLines([box])).toBe(1)
    expect(box.style.getPropertyValue(FIT)).toBe('')
  })

  it('finner skalaen på nytt fra normal størrelse, så kortere tekst vokser tilbake', () => {
    const box = titleBox(1000, 500)
    fitTitleLines([box])
    expect(scaleOf(box)).toBeCloseTo(0.5, 3)
    box.text = 300
    expect(fitTitleLines([box])).toBe(1)
    expect(box.style.getPropertyValue(FIT)).toBe('')
  })

  it('svarer med den minste skalaen blant flere linjer', () => {
    const boxes = [titleBox(300, 400), titleBox(800, 400), titleBox(1600, 400)]
    expect(fitTitleLines(boxes)).toBeCloseTo(0.25, 3)
    expect(scaleOf(boxes[0])).toBe(1)
    expect(scaleOf(boxes[1])).toBeCloseTo(0.5, 3)
  })
})
