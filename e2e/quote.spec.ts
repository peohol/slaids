import { expect, test, type Locator, type Page } from './fixtures'
import {
  addContentToZone,
  chooseFromToolbarMenu,
  createPresentation,
  stage,
  watchForErrors,
  zoneRects,
} from './helpers'
import { FONT_SCALE_PRESETS } from '../src/domain/metrics'
import { decodePng } from './png'

const QUOTE =
  'Et mønster av gjentatt eller kontinuerlig stoffbruk der evnen til å regulere bruken er svekket, slik at bruken fortsetter tross skade og gjentatte forsøk på å slutte.'

/** Et kort uten tittel med en innledende linje og et sitat under den. */
async function quoteCard(page: Page, title: string): Promise<Locator> {
  await createPresentation(page, title)
  const zones = await zoneRects(page)
  await addContentToZone(page, zones[0].id, 'untitled-card')
  const field = stage(page).locator('.subfield .tiptap').first()
  await field.click()
  await page.keyboard.type('Innledning.')
  await page.keyboard.press('Enter')
  // Tiptap gjør «> » først på en linje til et sitat, akkurat som knappen.
  await page.keyboard.type('> ')
  await page.keyboard.insertText(QUOTE)
  await expect(field.locator('blockquote')).toHaveCount(1)
  return field
}

/**
 * Hvor sitatet og sitattegnet står, i skjermpiksler.
 *
 * Tegnet er et pseudoelement og har ingen egen boks å spørre etter, men den
 * brukte bredden og forskyvningen står i den beregnede stilen. Linjene leses
 * av tekstens egne rektangler, én per linje.
 */
async function quoteLayout(field: Locator) {
  return field.locator('blockquote').evaluate((quote) => {
    const first = quote.firstElementChild as HTMLElement
    const mark = getComputedStyle(first, '::before')
    const range = document.createRange()
    range.selectNodeContents(first)
    const lines = [...range.getClientRects()].filter((rect) => rect.width > 1)
    const box = quote.getBoundingClientRect()
    const style = getComputedStyle(quote)
    return {
      opening: mark.content,
      closing: getComputedStyle(quote, '::after').content,
      markWidth: Number.parseFloat(mark.width),
      markFontSize: Number.parseFloat(mark.fontSize),
      bodyFontSize: Number.parseFloat(getComputedStyle(first).fontSize),
      indent: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
      quoteLeft: box.left + Number.parseFloat(style.borderLeftWidth),
      lineLefts: lines.map((rect) => rect.left),
    }
  })
}

/**
 * Øverste og nederste rad med blekk i et skjermbilde, i bildets piksler.
 *
 * Tegnet er et pseudoelement, og hvor blekket i et gåseøye sitter i skriftens
 * høyde, varierer fra skrift til skrift – det er bare bildet som kan si om
 * tegnet og bokstavene står i vater. Øverste venstre hjørne regnes som bakgrunn.
 */
function inkRows(png: Buffer): { top: number; bottom: number } {
  const bitmap = decodePng(png)
  const background = bitmap.at(0, 0)
  let top = bitmap.height
  let bottom = -1
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const pixel = bitmap.at(x, y)
      if (!pixel.some((value, index) => Math.abs(value - background[index]) > 40)) continue
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
      break
    }
  }
  return { top, bottom }
}

test.describe('sitat', () => {
  test('har ett stort innledende gåseøye til venstre, felles innrykk og ingen avsluttende gåseøyne', { tag: '@pr' }, async ({ page }) => {
    const guard = watchForErrors(page)
    const field = await quoteCard(page, 'Sitat')

    // Største skrift er det vanskeligste tilfellet: innrykket må fortsatt gi
    // plass til tegnet. Innrykket følger skriften, så det holder på alle trinn.
    const largest = FONT_SCALE_PRESETS[FONT_SCALE_PRESETS.length - 1].value
    for (const scale of [1, largest]) {
      if (scale !== 1) {
        await chooseFromToolbarMenu(page, 'presentation', 'open-theme')
        await page.getByTestId(`theme-font-scale-${scale}`).click()
        await page.getByTestId('theme-done').click()
        await expect(page.getByTestId('theme-modal')).toHaveCount(0)
      }
      const layout = await quoteLayout(field)
      const slideScale = await stage(page).evaluate((slide) => slide.getBoundingClientRect().width / 1600)

      expect(layout.opening).toBe('"“"')
      expect(layout.closing).toBe('none')
      // Stort: tydelig større enn teksten det står ved.
      expect(layout.markFontSize).toBeGreaterThan(layout.bodyFontSize * 2)
      // Innrykket er bare til venstre.
      expect(layout.paddingRight).toBe(0)
      // Tegnet får plass i innrykket, så det aldri stikker ut av feltet.
      expect(layout.markWidth).toBeLessThan(layout.indent)

      // Sitatet går over flere linjer, og alle står mot innrykket.
      expect(layout.lineLefts.length).toBeGreaterThan(1)
      for (const left of layout.lineLefts) {
        expect(Math.abs(left - (layout.quoteLeft + layout.indent * slideScale))).toBeLessThan(1.5)
      }
    }
    expect(guard.errors).toEqual([])
  })

  test('sitattegnet står i vater med bokstavene i første linje', { tag: '@pr' }, async ({ page }) => {
    // «I vater»: midten av tegnet står på høyde med midten av de store
    // bokstavene ved siden av det. Tegnet er høyere enn en stor bokstav, så det
    // rekker like langt over dem som under. Det måles i presentasjonen, der
    // verken markør eller stavekontroll tegner noe ved siden av teksten.
    const guard = watchForErrors(page)
    await quoteCard(page, 'Sitat i vater')
    await page.getByTestId('present').click()
    const quote = page.getByTestId('present-view').locator('.rd-quote')
    await expect(quote).toHaveCount(1)
    await page.waitForTimeout(300)

    // Første linjes linjeboks: avsnittets overkant og én linjehøyde ned,
    // regnet om til skjermpiksler. Tegnets boks er nøyaktig så høy.
    const { box, line } = await quote.evaluate((element: HTMLElement) => {
      const first = element.firstElementChild as HTMLElement
      const range = document.createRange()
      range.selectNodeContents(first)
      const text = [...range.getClientRects()].find((candidate) => candidate.width > 1) as DOMRect
      const outer = element.getBoundingClientRect()
      const scale = outer.width / element.offsetWidth
      return {
        box: { left: outer.left },
        line: {
          left: text.left,
          top: first.getBoundingClientRect().top,
          height: Number.parseFloat(getComputedStyle(first).lineHeight) * scale,
          em: Number.parseFloat(getComputedStyle(first).fontSize) * scale,
        },
      }
    })
    // Tegnet henger i innrykket, til venstre for linjen; «E» i «Et» er linjens
    // første bokstav, og den er stor.
    const markShot = await page.screenshot({
      clip: { x: box.left, y: line.top, width: line.left - box.left - 1, height: line.height },
    })
    const capitalShot = await page.screenshot({
      clip: { x: line.left, y: line.top, width: line.em * 0.5, height: line.height },
    })
    const mark = inkRows(markShot)
    const capital = inkRows(capitalShot)
    expect(mark.bottom).toBeGreaterThan(mark.top)
    // Hele tegnet er med: boksen klipper ved linjens kanter, og blekket når
    // ingen av dem.
    expect(mark.top).toBeGreaterThan(0)
    expect(mark.bottom).toBeLessThan(Math.floor(line.height) - 1)
    expect(capital.bottom).toBeGreaterThan(capital.top)
    // Tegnet er stort: høyere enn bokstaven det står ved.
    expect(mark.bottom - mark.top).toBeGreaterThan(capital.bottom - capital.top)
    const centre = (rows: { top: number; bottom: number }) => (rows.top + rows.bottom) / 2
    expect(Math.abs(centre(mark) - centre(capital))).toBeLessThanOrEqual(1.5)
    expect(guard.errors).toEqual([])
  })

  test('sitattegnet gjør aldri sitatet høyere enn teksten i det', async ({ page }) => {
    // Tegnet er mye større enn teksten. Rakk boksen det står i under første
    // linje, ville et kort sitat sist i et felt som akkurat har plass, sett ut
    // til å flyte over – og hele feltet blitt tegnet mindre bare på grunn av
    // pynten. Målingen som avgjør det, leser hvor høyt innholdet i en
    // klippende boks er, så det er det som sjekkes: sitatet gjøres klippende
    // et øyeblikk, og det som er inni, skal ikke være høyere enn det selv.
    const guard = watchForErrors(page)
    await createPresentation(page, 'Sitat på én linje')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    const field = stage(page).locator('.subfield .tiptap').first()
    await field.click()
    await page.keyboard.type('> Kort sitat.')
    await expect(field.locator('blockquote')).toHaveCount(1)

    const overflow = (quote: Locator) =>
      quote.evaluate((element: HTMLElement) => {
        element.style.overflow = 'hidden'
        const extra = element.scrollHeight - element.clientHeight
        element.style.overflow = ''
        return extra
      })
    expect(await overflow(field.locator('blockquote'))).toBe(0)

    await page.getByTestId('present').click()
    const presented = page.getByTestId('present-view').locator('.rd-quote')
    await expect(presented).toHaveCount(1)
    expect(await overflow(presented)).toBe(0)
    expect(guard.errors).toEqual([])
  })
})
