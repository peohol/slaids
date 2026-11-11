import { expect, test, type Locator, type Page } from './fixtures'
import { backToLibrary, createPresentation, enterSubmenu } from './helpers'
import { openPanel } from './compactHelpers'

/**
 * «Utseende»: a dark interface, a light one, or whatever the operating system
 * says — and the slide is none of the app's business.
 *
 * The suite runs with a dark system setting (`playwright.config.ts`); each test
 * here sets the system's appearance itself, so what is checked is the rule —
 * the app follows the system until told otherwise, and a choice wins over the
 * system and survives a reload — not whichever appearance the runner reports.
 */

/** Is this surface drawn light? Read from the colour the browser actually painted. */
async function isLight(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const [r, g, b] = getComputedStyle(element)
      .backgroundColor.match(/\d+(\.\d+)?/g)!
      .map(Number)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128
  })
}

const body = (page: Page) => page.locator('body')

async function chooseInLibrary(page: Page, appearance: 'dark' | 'light' | 'system') {
  await page.getByTestId('library-appearance').click()
  await page.getByTestId(`menu-appearance-${appearance}`).click()
  await expect(page.getByTestId('context-menu')).toBeHidden()
}

test.describe('utseende', () => {
  test('følger systemet til noe er valgt, også når systemet bytter underveis', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')
    expect(await isLight(body(page))).toBe(true)
    await page.emulateMedia({ colorScheme: 'dark' })
    expect(await isLight(body(page))).toBe(false)
  })

  test('et valg i biblioteket går foran systemet og huskes etter omlasting', { tag: '@pr' }, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/')
    await chooseInLibrary(page, 'light')
    expect(await isLight(body(page))).toBe(true)

    await page.reload()
    await expect(page.getByTestId('new-presentation')).toBeVisible()
    expect(await isLight(body(page))).toBe(true)
    // The menu says which one is in force.
    await page.getByTestId('library-appearance').click()
    await expect(page.getByTestId('menu-appearance-light')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('menu-appearance-system')).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Escape')

    await chooseInLibrary(page, 'system')
    expect(await isLight(body(page))).toBe(false)
  })

  test('«Verktøy» i editoren har det samme valget, og det gjelder i biblioteket også', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await createPresentation(page, 'Utseende')
    expect(await isLight(page.getByTestId('top-toolbar'))).toBe(true)

    await page.getByTestId('toolbar-menu-tools').click()
    await page.getByTestId('menu-appearance').focus()
    await enterSubmenu(page, 'appearance')
    await page.getByTestId('menu-appearance-dark').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('context-menu')).toBeHidden()
    // Et menyvalg kjøres først når menyen har lukket seg (`afterClose`), så
    // fargen leses til den har kommet, ikke i samme øyeblikk som menyen forsvinner.
    await expect.poll(() => isLight(page.getByTestId('top-toolbar'))).toBe(false)

    await backToLibrary(page)
    expect(await isLight(body(page))).toBe(false)
  })

  test('slidens farger er presentasjonens, og visningen er mørk uansett utseende', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await createPresentation(page, 'Samme slide')
    const slide = page.getByTestId('stage-slide')
    const box = (await slide.boundingBox())!
    // Inside the slide's edge, where a fractional size lets the stage behind it
    // show through by part of a pixel. The content-kind picker in an empty zone
    // is the editor's own control drawn on the slide; it follows the appearance
    // like the rest of the chrome, so it is masked.
    const picture = () =>
      page.screenshot({
        clip: { x: Math.ceil(box.x) + 1, y: Math.ceil(box.y) + 1, width: Math.floor(box.width) - 3, height: Math.floor(box.height) - 3 },
        mask: [page.getByTestId('empty-zone')],
      })
    const inDark = await picture()

    await page.emulateMedia({ colorScheme: 'light' })
    expect(await isLight(page.getByTestId('top-toolbar'))).toBe(true)
    expect((await picture()).equals(inDark)).toBe(true)

    await page.getByTestId('present').click()
    await expect(page.getByTestId('present-view')).toBeVisible()
    expect(await isLight(page.getByTestId('present-view'))).toBe(false)
  })
})

test.describe('utseende på telefon', () => {
  test.use({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true })

  test('verktøypanelet har valget som en egen gruppe, med det gjeldende avhaket', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await createPresentation(page, 'Utseende')
    await openPanel(page, 'tools')
    await expect(page.getByTestId('compact-tool-appearance-system')).toHaveAttribute('aria-pressed', 'true')

    await page.getByTestId('compact-tool-appearance-light').click()
    await expect(page.getByTestId('compact-tool-appearance-light')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('compact-tool-appearance-system')).toHaveAttribute('aria-pressed', 'false')
    expect(await isLight(body(page))).toBe(true)
  })
})
