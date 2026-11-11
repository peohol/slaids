/**
 * Logoen i temaet (§ 15.2): lastes opp i temaeditoren, står der temaet sier på
 * forsiden og på slidene, aldri over tittel eller innhold, og følger med i
 * miniatyrbildene og presentasjonsmodus.
 */

import { expect, test, type Locator, type Page } from './fixtures'
import {
  chooseFromToolbarMenu,
  stage,
  titleRect,
  toast,
  waitForSaved,
  watchForErrors,
  zoneRects,
  type ZoneRect,
} from './helpers'

/** En bred logo, tre ganger så bred som høy. */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect width="300" height="100" rx="16" fill="#1f6feb"/><circle cx="60" cy="50" r="30" fill="#fff"/></svg>`

const UNSAFE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><script>window.__slaidsPwned = true</script><rect width="300" height="100"/></svg>`

async function uploadLogo(page: Page, svg = LOGO_SVG): Promise<void> {
  await page.getByTestId('theme-logo-file').setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(svg),
  })
}

/** Et nytt dekk med temaeditoren åpen, slik det står rett etter at det er opprettet. */
async function newDeckWithThemeOpen(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.getByTestId('new-presentation').click()
  await page.getByTestId('presentation-title-input').fill(title)
  await page.getByTestId('create-presentation').click()
  await expect(page.getByTestId('theme-modal')).toBeVisible()
}

async function closeTheme(page: Page): Promise<void> {
  await page.getByTestId('theme-done').click()
  await expect(page.getByTestId('theme-modal')).toHaveCount(0)
}

async function openTheme(page: Page): Promise<void> {
  await chooseFromToolbarMenu(page, 'presentation', 'open-theme')
  await expect(page.getByTestId('theme-modal')).toBeVisible()
}

async function showSlide(page: Page, index: number): Promise<void> {
  await page.getByTestId('filmstrip-item').nth(index).click()
}

/** Logoen på stagen, i sidens egne koordinater. */
async function logoRect(page: Page): Promise<ZoneRect> {
  return stage(page).evaluate((element) => {
    const box = element.getBoundingClientRect()
    const scale = Number((element as HTMLElement).dataset.scale)
    const logo = element.querySelector('[data-testid="slide-logo"]')!.getBoundingClientRect()
    return {
      id: 'logo',
      x: (logo.left - box.left) / scale,
      y: (logo.top - box.top) / scale,
      w: logo.width / scale,
      h: logo.height / scale,
    }
  })
}

function overlaps(a: ZoneRect, b: ZoneRect): boolean {
  const slack = 0.5
  return (
    a.x < b.x + b.w - slack && b.x < a.x + a.w - slack && a.y < b.y + b.h - slack && b.y < a.y + a.h - slack
  )
}

function stageLogo(page: Page): Locator {
  return stage(page).getByTestId('slide-logo')
}

/** Et punkt på sliden, i sidens egne koordinater, som et punkt på skjermen. */
async function onScreen(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return stage(page).evaluate(
    (element, point) => {
      const box = element.getBoundingClientRect()
      const scale = Number((element as HTMLElement).dataset.scale)
      return { x: box.left + point.x * scale, y: box.top + point.y * scale }
    },
    { x, y },
  )
}

/** Trykk ned et sted på sliden og dra i små steg til et annet, uten å slippe. */
async function pressAndDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const start = await onScreen(page, from.x, from.y)
  const end = await onScreen(page, to.x, to.y)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 12 })
}

/** Midten av logoen på stagen. */
async function logoCentre(page: Page): Promise<{ x: number; y: number }> {
  const rect = await logoRect(page)
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

test.describe('logo i temaet', () => {
  test(
    'lastes opp i temaeditoren og står på forsiden og slidene, klar av tittel og innhold',
    { tag: '@pr' },
    async ({ page }) => {
      const guard = watchForErrors(page)
      await newDeckWithThemeOpen(page, 'Med logo')
      await uploadLogo(page)
      await expect(page.getByTestId('theme-logo-thumb').locator('img')).toBeVisible()
      // Forhåndsvisningen i dialogen tegner logoen også.
      await expect(page.getByTestId('theme-preview').getByTestId('slide-logo')).toBeVisible()
      await closeTheme(page)

      // Forsiden: logoen står over overskriften, midtstilt.
      await showSlide(page, 0)
      await expect(stageLogo(page)).toBeVisible()
      const front = await logoRect(page)
      expect(front.x + front.w / 2).toBeCloseTo(800, 0)
      expect(front.w / front.h).toBeCloseTo(3, 1)

      // En vanlig slide: nede til høyre, og aldri over tittelen eller sonene.
      await showSlide(page, 1)
      await expect(stageLogo(page)).toBeVisible()
      const logo = await logoRect(page)
      expect(logo.x + logo.w).toBeGreaterThan(1400)
      expect(logo.y + logo.h).toBeGreaterThan(780)
      for (const zone of [await titleRect(page), ...(await zoneRects(page))]) {
        expect(overlaps(logo, zone), `logoen ligger over ${zone.id}`).toBe(false)
      }

      // Miniatyrbildene viser den også.
      await expect(page.getByTestId('filmstrip-item').nth(1).getByTestId('slide-logo')).toBeVisible()

      // Og den er der etter en omlasting.
      await waitForSaved(page)
      await page.reload()
      await expect(page.getByTestId('editor')).toBeVisible()
      await showSlide(page, 1)
      await expect(stageLogo(page)).toBeVisible()
      expect(guard.errors).toEqual([])
    },
  )

  test('flyttes, slås av og fjernes fra temaeditoren, og hver endring kan angres', async ({ page }) => {
    await newDeckWithThemeOpen(page, 'Logoplass')
    await uploadLogo(page)
    await expect(page.getByTestId('theme-logo-thumb').locator('img')).toBeVisible()
    await page.getByTestId('theme-logo-position-top-left').click()
    await closeTheme(page)

    await showSlide(page, 1)
    const logo = await logoRect(page)
    const title = await titleRect(page)
    expect(logo.x).toBeLessThan(100)
    expect(logo.y).toBeLessThan(100)
    // Tittelen har flyttet seg ned under logoen.
    expect(title.y).toBeGreaterThan(logo.y + logo.h)

    await openTheme(page)
    await page.getByTestId('theme-logo-slides-visible').click()
    await closeTheme(page)
    await expect(stageLogo(page)).toHaveCount(0)
    expect((await titleRect(page)).y).toBeLessThan(logo.y + logo.h)

    await page.keyboard.press('Control+z')
    await expect(stageLogo(page)).toBeVisible()

    await openTheme(page)
    await page.getByTestId('theme-logo-remove').click()
    await expect(page.getByTestId('theme-logo-thumb')).toHaveCount(0)
    await closeTheme(page)
    await expect(stageLogo(page)).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(stageLogo(page)).toBeVisible()
  })

  test('står bare på forsiden, eller på alle inndelinger', async ({ page }) => {
    await newDeckWithThemeOpen(page, 'Inndelinger')
    await uploadLogo(page)
    await expect(page.getByTestId('theme-logo-thumb').locator('img')).toBeVisible()
    await closeTheme(page)

    await page.getByTestId('add-page-menu').click()
    await page.getByTestId('add-section').click()
    await page.getByTestId('section-title-input').fill('Del to')
    await page.getByTestId('create-section').click()
    const sections = page.getByTestId('filmstrip-item')
    await expect(sections).toHaveCount(3)
    await showSlide(page, 2)
    await expect(stageLogo(page)).toHaveCount(0)

    await openTheme(page)
    await page.getByTestId('theme-logo-sections-all').click()
    await page.getByTestId('theme-logo-placement-below').click()
    await closeTheme(page)
    await expect(stageLogo(page)).toBeVisible()
    // Under overskriften: logoen står lavere enn midten av siden.
    expect((await logoRect(page)).y).toBeGreaterThan(450)
  })

  test('vises i presentasjonsmodus', async ({ page }) => {
    await newDeckWithThemeOpen(page, 'Visning med logo')
    await uploadLogo(page)
    await expect(page.getByTestId('theme-logo-thumb').locator('img')).toBeVisible()
    await closeTheme(page)
    await page.getByTestId('present').click()
    const view = page.getByTestId('present-view')
    await expect(view).toBeVisible()
    await expect(view.getByTestId('slide-logo')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(view.getByTestId('slide-logo')).toBeVisible()
  })

  test(
    'dras til nærmeste plass og endres i størrelse på stagen, og hvert dra er ett angresteg',
    { tag: '@pr' },
    async ({ page }) => {
      const guard = watchForErrors(page)
      await newDeckWithThemeOpen(page, 'Dra logoen')
      await uploadLogo(page)
      await expect(page.getByTestId('theme-logo-thumb').locator('img')).toBeVisible()
      await closeTheme(page)
      await showSlide(page, 1)
      await expect(stageLogo(page)).toBeVisible()
      const before = await logoRect(page)
      const titleBefore = await titleRect(page)

      // Et avbrutt dra lagrer ingenting: logoen står der den sto.
      await pressAndDrag(page, await logoCentre(page), { x: 150, y: 120 })
      await expect.poll(async () => (await logoRect(page)).y).toBeLessThan(100)
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await expect.poll(async () => (await logoRect(page)).y).toBeCloseTo(before.y, 0)

      // Sluppet nær øvre venstre hjørne står logoen der, og tittelen under den.
      await pressAndDrag(page, await logoCentre(page), { x: 150, y: 120 })
      await page.mouse.up()
      await expect.poll(async () => (await logoRect(page)).x).toBeLessThan(100)
      const moved = await logoRect(page)
      expect(moved.y).toBeLessThan(100)
      expect(moved.h).toBeCloseTo(before.h, 0)
      await expect.poll(async () => (await titleRect(page)).y).toBeGreaterThan(moved.y + moved.h)
      // Det samme står i temaeditoren.
      await openTheme(page)
      await expect(page.getByTestId('theme-logo-position-top-left')).toHaveAttribute('data-checked', '')
      await closeTheme(page)

      // Et hjørne dratt bort fra sentrum gjør logoen større, med samme form.
      await pressAndDrag(page, { x: moved.x + moved.w, y: moved.y + moved.h }, {
        x: moved.x + moved.w + 60,
        y: moved.y + moved.h + 20,
      })
      await page.mouse.up()
      await expect.poll(async () => (await logoRect(page)).h).toBeGreaterThan(moved.h + 10)
      const bigger = await logoRect(page)
      expect(bigger.w / bigger.h).toBeCloseTo(3, 1)
      for (const zone of [await titleRect(page), ...(await zoneRects(page))]) {
        expect(overlaps(bigger, zone), `logoen ligger over ${zone.id}`).toBe(false)
      }

      // Hvert dra er ett angresteg: først størrelsen, så plassen.
      await page.keyboard.press('Control+z')
      await expect.poll(async () => (await logoRect(page)).h).toBeCloseTo(moved.h, 0)
      await page.keyboard.press('Control+z')
      await expect.poll(async () => (await logoRect(page)).y).toBeCloseTo(before.y, 0)
      await expect.poll(async () => (await titleRect(page)).y).toBeCloseTo(titleBefore.y, 0)
      expect(guard.errors).toEqual([])
    },
  )

  test('dras fra over til under overskriften på forsiden', async ({ page }) => {
    await newDeckWithThemeOpen(page, 'Dra på forsiden')
    await uploadLogo(page)
    await expect(page.getByTestId('theme-logo-thumb').locator('img')).toBeVisible()
    await closeTheme(page)
    await showSlide(page, 0)
    await expect(stageLogo(page)).toBeVisible()
    expect((await logoRect(page)).y).toBeLessThan(450)

    await pressAndDrag(page, await logoCentre(page), { x: 800, y: 800 })
    await page.mouse.up()
    await expect.poll(async () => (await logoRect(page)).y).toBeGreaterThan(450)
    // Fortsatt midtstilt.
    const below = await logoRect(page)
    expect(below.x + below.w / 2).toBeCloseTo(800, 0)
    await openTheme(page)
    await expect(page.getByTestId('theme-logo-placement-below')).toHaveClass(/btn--active/)
  })

  test.describe('på en telefon', () => {
    test.use({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true })

    test('viser håndtakene etter et trykk, og dras med en finger', async ({ page }) => {
      await newDeckWithThemeOpen(page, 'Logo på telefon')
      await uploadLogo(page)
      await expect(page.getByTestId('theme-logo-thumb').locator('img')).toBeVisible()
      await closeTheme(page)
      const handles = stage(page).getByTestId('logo-handles')
      await expect(handles).toBeVisible()
      await expect(handles.getByTestId('logo-handle-nw')).toHaveCSS('opacity', '0')
      await handles.tap()
      await expect(handles.getByTestId('logo-handle-nw')).toHaveCSS('opacity', '1')

      // En finger fra logoen opp mot øvre venstre hjørne.
      const from = await logoCentre(page)
      const start = await onScreen(page, from.x, from.y)
      const end = await onScreen(page, 120, 90)
      const cdp = await page.context().newCDPSession(page)
      const touch = (x: number, y: number) => [{ x, y, id: 1 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(start.x, start.y) })
      for (let step = 1; step <= 12; step += 1) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: touch(
            start.x + ((end.x - start.x) * step) / 12,
            start.y + ((end.y - start.y) * step) / 12,
          ),
        })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect.poll(async () => (await logoRect(page)).x).toBeLessThan(100)
      expect((await logoRect(page)).y).toBeLessThan(100)
    })
  })

  test('avviser en utrygg SVG uten å lagre noe', async ({ page }) => {
    await newDeckWithThemeOpen(page, 'Utrygg logo')
    await uploadLogo(page, UNSAFE_SVG)
    await expect(toast(page, 'ikke tillatt')).toBeVisible()
    await expect(page.getByTestId('theme-logo-thumb')).toHaveCount(0)
    expect(await page.evaluate(() => (window as { __slaidsPwned?: boolean }).__slaidsPwned)).toBeUndefined()
  })
})
