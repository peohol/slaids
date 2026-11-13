/**
 * Temamaler (§ 15.4): gjeldende tema lagres som mal med logo og farger, en mal
 * brukes på et annet dekk i ett angrebart steg med sin egen kopi av logoen,
 * en mal kan være standard for nye presentasjoner, og egne maler kan endres
 * og slettes.
 */

import { expect, test, type Locator, type Page } from './fixtures'
import { PALETTE } from '../src/domain/color'
import { backToLibrary, createFromLibrary, stage, waitForSaved, watchForErrors } from './helpers'

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect width="300" height="100" rx="16" fill="#1f6feb"/></svg>`

const BACKGROUND = PALETTE[2][0]
const ACCENT = PALETTE[4][2]

function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`
}

async function backgroundOf(element: Locator): Promise<string> {
  return element.evaluate((node) => getComputedStyle(node).backgroundColor)
}

function frontThumb(page: Page): Locator {
  return page.getByTestId('filmstrip-item').first().locator('.slide').first()
}

async function newDeck(page: Page, title: string): Promise<void> {
  await page.getByTestId('new-presentation').click()
  await page.getByTestId('presentation-title-input').fill(title)
  await page.getByTestId('create-presentation').click()
  await expect(page.getByTestId('theme-modal')).toBeVisible()
}

async function pickThemeColor(page: Page, testId: string, color: string): Promise<void> {
  await page.getByTestId(testId).click()
  const popover = page.locator('.popover').getByTestId('palette')
  await popover.locator(`[data-color="${color}"]`).click()
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
}

/** Gi dekket som er åpent i temaeditoren, logo, egne farger og skygger av. */
async function styleDeck(page: Page): Promise<void> {
  await page.getByTestId('theme-logo-file').setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(LOGO_SVG),
  })
  await expect(page.getByTestId('theme-logo-thumb').locator('img')).toBeVisible()
  await pickThemeColor(page, 'theme-front-background', BACKGROUND)
  await pickThemeColor(page, 'theme-front-accent', ACCENT)
  await page.getByTestId('theme-shadows').click()
  await expect(page.getByTestId('theme-shadows')).toHaveAttribute('aria-checked', 'false')
}

async function saveAsTemplate(
  page: Page,
  name: string,
  options: { shared?: boolean; asDefault?: boolean } = {},
): Promise<void> {
  await page.getByTestId('theme-template-save').click()
  await page.getByTestId('theme-template-name').fill(name)
  if (options.shared) await page.getByTestId('theme-template-visibility-shared').click()
  if (options.asDefault) await page.getByTestId('theme-template-as-default').check()
  await page.getByTestId('theme-template-submit').click()
  await expect(page.getByTestId('theme-template-form')).toHaveCount(0)
}

function templateNamed(page: Page, name: string): Locator {
  return page.getByTestId('theme-template').filter({ hasText: name })
}

async function closeTheme(page: Page): Promise<void> {
  await page.getByTestId('theme-done').click()
  await expect(page.getByTestId('theme-modal')).toHaveCount(0)
}

test.describe('temamaler', () => {
  test(
    'lagres med logo og farger, og brukes på et annet dekk i ett angrebart steg',
    { tag: '@pr' },
    async ({ page }) => {
      const guard = watchForErrors(page)
      await page.goto('/')
      await newDeck(page, 'Kilde')
      await styleDeck(page)
      await saveAsTemplate(page, 'Firma')
      const mine = templateNamed(page, 'Firma')
      await expect(mine).toBeVisible()
      await expect(mine.locator('.theme-template__logo')).toBeVisible()
      await closeTheme(page)

      await backToLibrary(page)
      await newDeck(page, 'Mål')
      await expect(page.getByTestId('theme-logo-thumb')).toHaveCount(0)
      await templateNamed(page, 'Firma').getByTestId('theme-template-apply').click()
      await expect(page.getByTestId('theme-logo-thumb').locator('img')).toBeVisible()
      await expect(page.getByTestId('theme-shadows')).toHaveAttribute('aria-checked', 'false')
      await closeTheme(page)

      await expect(stage(page).getByTestId('slide-logo')).toBeVisible()
      await expect.poll(() => backgroundOf(frontThumb(page))).toBe(rgb(BACKGROUND))

      // Ett steg: én angring tar tema, farger og logo.
      await page.keyboard.press('Control+z')
      await expect(stage(page).getByTestId('slide-logo')).toHaveCount(0)
      await expect.poll(() => backgroundOf(frontThumb(page))).not.toBe(rgb(BACKGROUND))
      await page.keyboard.press('Control+Shift+z')
      await expect(stage(page).getByTestId('slide-logo')).toBeVisible()
      expect(guard.errors).toEqual([])
    },
  )

  test('presentasjonen beholder logoen når malen slettes', async ({ page }) => {
    await page.goto('/')
    await newDeck(page, 'Kilde')
    await styleDeck(page)
    await saveAsTemplate(page, 'Kortlivet', { shared: true })
    await page.getByTestId('theme-templates-shared').click()
    const shared = templateNamed(page, 'Kortlivet')
    await expect(shared).toContainText('Din')
    await closeTheme(page)

    await backToLibrary(page)
    await newDeck(page, 'Bruker malen')
    await page.getByTestId('theme-templates-shared').click()
    await templateNamed(page, 'Kortlivet').getByTestId('theme-template-apply').click()
    await expect(page.getByTestId('theme-logo-thumb').locator('img')).toBeVisible()

    await templateNamed(page, 'Kortlivet').getByTestId('theme-template-delete').click()
    await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Slett' }).click()
    await expect(templateNamed(page, 'Kortlivet')).toHaveCount(0)
    await expect(page.getByTestId('theme-templates-empty')).toBeVisible()
    await closeTheme(page)
    await expect(stage(page).getByTestId('slide-logo')).toBeVisible()
    await waitForSaved(page)

    // Etter en omlasting står logoen fortsatt: den er presentasjonens egen fil.
    await page.reload()
    await expect.poll(() => backgroundOf(frontThumb(page))).toBe(rgb(BACKGROUND))
    await expect(stage(page).getByTestId('slide-logo')).toBeVisible()
    await expect
      .poll(() => stage(page).getByTestId('slide-logo').evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
  })

  test('en mal valgt som standard brukes av nye presentasjoner, og kan velges bort', async ({ page }) => {
    await page.goto('/')
    await newDeck(page, 'Kilde')
    await styleDeck(page)
    await saveAsTemplate(page, 'Standard', { asDefault: true })
    await expect(templateNamed(page, 'Standard').getByTestId('theme-template-default')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await closeTheme(page)

    await backToLibrary(page)
    await newDeck(page, 'Starter i malen')
    await expect(page.getByTestId('theme-logo-thumb').locator('img')).toBeVisible()
    await expect(page.getByTestId('theme-shadows')).toHaveAttribute('aria-checked', 'false')
    await templateNamed(page, 'Standard').getByTestId('theme-template-default').click()
    await expect(templateNamed(page, 'Standard').getByTestId('theme-template-default')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await closeTheme(page)
    await expect.poll(() => backgroundOf(frontThumb(page))).toBe(rgb(BACKGROUND))

    await backToLibrary(page)
    await createFromLibrary(page, 'Uten mal')
    await expect(stage(page).getByTestId('slide-logo')).toHaveCount(0)
    await expect.poll(() => backgroundOf(frontThumb(page))).not.toBe(rgb(BACKGROUND))
  })

  test.describe('endre en egen mal', () => {
    const shadows = (page: Page) => page.getByTestId('theme-shadows')

    /** Malen «Firma» med logo og skygger av, og et nytt dekk med skygger på. */
    async function templateAndFreshDeck(page: Page): Promise<void> {
      await page.goto('/')
      await newDeck(page, 'Kilde')
      await styleDeck(page)
      await saveAsTemplate(page, 'Firma')
      await closeTheme(page)
      await backToLibrary(page)
      await newDeck(page, 'Mål')
      await expect(shadows(page)).toHaveAttribute('aria-checked', 'true')
    }

    test(
      'tar malen i bruk, og lagrer nytt navn, ny synlighet og nytt tema over den',
      { tag: '@pr' },
      async ({ page }) => {
        const guard = watchForErrors(page)
        await templateAndFreshDeck(page)

        await templateNamed(page, 'Firma').getByTestId('theme-template-edit').click()
        await expect(page.getByTestId('theme-template-edit-form')).toBeVisible()
        await expect(templateNamed(page, 'Firma')).toHaveAttribute('data-editing', 'true')
        // Malen er tatt i bruk, så temaeditoren viser den.
        await expect(shadows(page)).toHaveAttribute('aria-checked', 'false')
        await expect(page.getByTestId('theme-logo-thumb').locator('img')).toBeVisible()
        await expect(page.getByTestId('theme-template-save')).toBeDisabled()
        await expect(page.getByTestId('theme-done')).toHaveCount(0)

        await page.getByTestId('theme-template-name').fill('Firma 2')
        await page.getByTestId('theme-template-visibility-shared').click()
        await shadows(page).click()
        await page.getByTestId('theme-logo-remove').click()
        await page.getByTestId('theme-template-edit-save').click()
        await expect(page.getByTestId('theme-template-edit-form')).toHaveCount(0)
        await expect(page.getByTestId('theme-done')).toBeVisible()

        // Malen står nå under Delte maler, med nytt navn og uten logo – fortsatt bare én.
        await expect(page.getByTestId('theme-templates-shared')).toHaveAttribute('aria-pressed', 'true')
        await expect(page.getByTestId('theme-template')).toHaveCount(1)
        const edited = templateNamed(page, 'Firma 2')
        await expect(edited).toBeVisible()
        await expect(edited.locator('.theme-template__logo')).toHaveCount(0)
        await closeTheme(page)

        // Et nytt dekk som bruker malen, får det nye temaet.
        await backToLibrary(page)
        await newDeck(page, 'Tredje')
        await shadows(page).click()
        await expect(shadows(page)).toHaveAttribute('aria-checked', 'false')
        await page.getByTestId('theme-templates-shared').click()
        await templateNamed(page, 'Firma 2').getByTestId('theme-template-apply').click()
        await expect(shadows(page)).toHaveAttribute('aria-checked', 'true')
        await expect(page.getByTestId('theme-logo-thumb')).toHaveCount(0)
        await expect.poll(() => backgroundOf(page.locator('.theme-template__swatch').first())).toBe(rgb(BACKGROUND))
        expect(guard.errors).toEqual([])
      },
    )

    test('«Avbryt» setter presentasjonen tilbake og lar malen være', async ({ page }) => {
      await templateAndFreshDeck(page)
      await templateNamed(page, 'Firma').getByTestId('theme-template-edit').click()
      await expect(shadows(page)).toHaveAttribute('aria-checked', 'false')
      await page.getByTestId('theme-template-name').fill('Glemt')
      await page.getByTestId('theme-template-edit-cancel').click()

      await expect(page.getByTestId('theme-template-edit-form')).toHaveCount(0)
      await expect(shadows(page)).toHaveAttribute('aria-checked', 'true')
      await expect(page.getByTestId('theme-logo-thumb')).toHaveCount(0)
      await expect(templateNamed(page, 'Firma')).toBeVisible()
      await expect(templateNamed(page, 'Glemt')).toHaveCount(0)
      await closeTheme(page)
      await expect(stage(page).getByTestId('slide-logo')).toHaveCount(0)
    })

    test('venter med «Lagre i malen» og «Avbryt» til en font er ferdig lastet', async ({ page }) => {
      let release = (): void => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route('https://fonts.googleapis.com/**', async (route) => {
        await held
        await route.abort('failed')
      })
      await templateAndFreshDeck(page)
      await templateNamed(page, 'Firma').getByTestId('theme-template-edit').click()
      await expect(page.getByTestId('theme-template-edit-form')).toBeVisible()

      await page.getByTestId('theme-body-font').selectOption({ label: 'Inter' })
      await expect(page.getByTestId('font-loading')).toBeVisible()
      await expect(page.getByTestId('theme-template-edit-save')).toBeDisabled()
      await expect(page.getByTestId('theme-template-edit-cancel')).toBeDisabled()

      release()
      await expect(page.getByTestId('font-loading')).toBeHidden()
      await expect(page.getByTestId('theme-template-edit-save')).toBeEnabled()
      await expect(page.getByTestId('theme-template-edit-cancel')).toBeEnabled()
    })

    test('spør før temaeditoren lukkes midt i en endring', async ({ page }) => {
      await templateAndFreshDeck(page)
      await templateNamed(page, 'Firma').getByTestId('theme-template-edit').click()
      await expect(page.getByTestId('theme-template-edit-form')).toBeVisible()
      await shadows(page).click()

      await page.keyboard.press('Escape')
      const dialog = page.getByTestId('confirm-dialog')
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Fortsett å endre' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.getByTestId('theme-template-edit-form')).toBeVisible()

      await page.keyboard.press('Escape')
      await dialog.getByRole('button', { name: 'Lagre i malen' }).click()
      await expect(page.getByTestId('theme-modal')).toHaveCount(0)

      // Lagret: et nytt dekk i malen får skyggene som ble slått på.
      await backToLibrary(page)
      await newDeck(page, 'Sjekk')
      await shadows(page).click()
      await templateNamed(page, 'Firma').getByTestId('theme-template-apply').click()
      await expect(shadows(page)).toHaveAttribute('aria-checked', 'true')
      await expect(page.getByTestId('theme-logo-thumb').locator('img')).toBeVisible()
    })
  })

  test.describe('på telefon', () => {
    test.use({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true })

    test('lagres og brukes med fingeren', async ({ page }) => {
      await page.goto('/')
      await newDeck(page, 'Kilde')
      await styleDeck(page)
      await saveAsTemplate(page, 'Lomme')
      await closeTheme(page)
      await backToLibrary(page)
      await newDeck(page, 'Mål')
      const apply = templateNamed(page, 'Lomme').getByTestId('theme-template-apply')
      await apply.scrollIntoViewIfNeeded()
      const box = (await apply.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(412)
      await apply.tap()
      await expect(page.getByTestId('theme-logo-thumb').locator('img')).toBeVisible()
      await closeTheme(page)
      await expect(stage(page).getByTestId('slide-logo')).toBeVisible()
    })
  })
})
