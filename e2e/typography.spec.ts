/**
 * Typing substitutions, in every field a person can type in.
 *
 * The claim is deliberately made in a real browser through real keystrokes.
 * An input rule fires from ProseMirror's `handleTextInput`, and that hook is
 * only reached along the DOM path a keyboard takes — a test that inserts the
 * same characters through `insertContent` exercises a different code path and
 * says nothing about whether typing works. That is exactly how a title field
 * could be reported as covered while nothing had ever been typed into one.
 */

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { addContentToZone, createPresentation, stage, zoneRects } from './helpers'

const SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">` +
  `<rect width="200" height="120" fill="#4d6680"/></svg>`

/**
 * Type three of the default autoerstatt rules into a field and read back what
 * it holds.
 *
 * One phrase carrying all three, so a field is either right about every rule
 * or visibly wrong about one of them. It stays short: a title is one line, and
 * a phrase that did not fit would be set smaller — a change that has nothing
 * to do with what is under test.
 */
const TYPED = 'A - b -> c * d'
const WRITTEN = 'A – b → c · d'

async function typeAndRead(page: Page, field: ReturnType<Page['locator']>): Promise<string> {
  await field.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(TYPED)
  await page.waitForTimeout(150)
  return (await field.innerText()).trim()
}

test.describe('autoerstatning', () => {
  test('brukerens egne regler gjelder med en gang, også etter omlasting', async ({ page }) => {
    await createPresentation(page, 'Egne regler')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'container')
    const field = stage(page).locator('.tiptap').last()

    await page.getByTestId('toolbar-menu-tools').click()
    await page.getByTestId('context-menu').getByTestId('menu-autocorrect').click()
    const dialog = page.getByTestId('autocorrect-modal')
    await expect(dialog.getByTestId('autocorrect-rule')).toHaveCount(8)
    await expect(dialog.locator('.dialog__description')).toHaveText(
      'Reglene gjelder på tvers av presentasjoner.␣ er mellomrom (space).',
    )
    // The defaults are mdeditz's eight; a new rule is typed straight into its row.
    await dialog.getByTestId('autocorrect-add').click()
    await page.keyboard.type('...')
    await dialog.getByTestId('autocorrect-to').last().fill('…')
    await dialog.getByTestId('autocorrect-remove').first().click()
    await dialog.getByTestId('autocorrect-save').click()
    await expect(dialog).toBeHidden()

    await field.click()
    await page.keyboard.type('Og så videre... A - b')
    await expect(field).toHaveText('Og så videre… A - b')

    await page.reload()
    await page.getByTestId('toolbar-menu-tools').click()
    await page.getByTestId('context-menu').getByTestId('menu-autocorrect').click()
    await expect(dialog.getByTestId('autocorrect-from').last()).toHaveValue('...')
    await expect(dialog.getByTestId('autocorrect-from').first()).toHaveValue('␣*␣')
    // There is no way back to the defaults: the list is the user's own.
    await expect(dialog.getByTestId('autocorrect-defaults')).toHaveCount(0)
    await dialog.getByTestId('autocorrect-save').click()
    await expect(dialog).toBeHidden()
  })

  test('reglene settes i rekkefølge ved å dra dem, eller med tastaturet, og rekkefølgen lagres', async ({
    page,
  }) => {
    await createPresentation(page, 'Regelrekkefølge')
    const openRules = async (): Promise<void> => {
      await page.getByTestId('toolbar-menu-tools').click()
      await page.getByTestId('context-menu').getByTestId('menu-autocorrect').click()
    }
    const dialog = page.getByTestId('autocorrect-modal')
    const sources = dialog.getByTestId('autocorrect-from')
    const grips = dialog.getByTestId('autocorrect-grip')
    const order = (): Promise<string[]> =>
      sources.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))
    await openRules()
    await expect(sources).toHaveCount(8)
    const before = await order()

    // The last rule, dragged by its grip to the top of the list.
    const from = (await grips.last().boundingBox())!
    const to = (await grips.first().boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2, from.y - 10, { steps: 4 })
    await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 15 })
    await page.mouse.up()
    const dragged = [before[7], ...before.slice(0, 7)]
    await expect.poll(order).toEqual(dragged)

    // The keyboard does the same: lift with space, move with an arrow, drop
    // with space. Escape while a rule is lifted puts it back and keeps the
    // dialog open.
    const announced = page.getByRole('status').filter({ hasText: /plass 2/ })
    /** Lift the first rule and carry it one place down, as a keyboard user would. */
    const liftAndLower = async (): Promise<void> => {
      await grips.first().focus()
      await page.keyboard.press('Space')
      await expect(grips.first()).toHaveAttribute('aria-pressed', 'true')
      // dnd-kit starts listening for the arrows in the task after the lift, so
      // that the key that lifted is not read as a move as well.
      await page.waitForTimeout(100)
      await page.keyboard.press('ArrowDown')
      await expect(announced).toHaveCount(1)
    }
    await liftAndLower()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect.poll(order).toEqual(dragged)
    await liftAndLower()
    await page.keyboard.press('Space')
    const moved = [dragged[1], dragged[0], ...dragged.slice(2)]
    await expect.poll(order).toEqual(moved)

    await dialog.getByTestId('autocorrect-save').click()
    await expect(dialog).toBeHidden()
    await page.reload()
    await openRules()
    await expect.poll(order).toEqual(moved)
  })


  test('en regel som dras stopper ved første og siste plass i lista', async ({ page }) => {
    await createPresentation(page, 'Regelgrenser')
    await page.getByTestId('toolbar-menu-tools').click()
    await page.getByTestId('context-menu').getByTestId('menu-autocorrect').click()
    const dialog = page.getByTestId('autocorrect-modal')
    const grip = dialog.getByTestId('autocorrect-grip').nth(3)
    await expect(grip.locator('svg')).toBeVisible()

    /** Where the lifted row and the list are, and how far the dialog can scroll. */
    const bounds = () =>
      dialog.locator('.dialog__body').evaluate((body) => {
        const list = body.querySelector('.autocorrect-rules')!.getBoundingClientRect()
        const lifted = body.querySelector('.autocorrect-rule--dragging')!.getBoundingClientRect()
        return {
          above: list.top - lifted.top,
          below: lifted.bottom - list.bottom,
          room: body.scrollHeight - body.clientHeight,
        }
      })
    const room = await dialog
      .locator('.dialog__body')
      .evaluate((body) => body.scrollHeight - body.clientHeight)

    const box = (await grip.boundingBox())!
    const x = box.x + box.width / 2
    await page.mouse.move(x, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(x, box.y + 30, { steps: 3 })
    // Far past the end of the list and the window: the row stops at the last
    // place, and the dialog does not grow room to scroll into.
    await page.mouse.move(x, box.y + 2000, { steps: 20 })
    await page.waitForTimeout(600)
    let now = await bounds()
    expect(now.below).toBeLessThanOrEqual(1)
    expect(now.room).toBeLessThanOrEqual(room + 1)
    // And far above it: the row stops at the first place, not under the heading.
    await page.mouse.move(x, box.y - 2000, { steps: 20 })
    await page.waitForTimeout(600)
    now = await bounds()
    expect(now.above).toBeLessThanOrEqual(1)
    await page.mouse.up()
    await expect(dialog.getByTestId('autocorrect-from').first()).toHaveValue('--')
  })

  test('erstatter mens man skriver i innhold, korttittel og slidetittel', async ({ page }) => {
    await createPresentation(page, 'Autoerstatning')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-with-title').click()

    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'titled-card')

    expect(await typeAndRead(page, stage(page).locator('.subfield .tiptap').first())).toBe(WRITTEN)
    expect(await typeAndRead(page, stage(page).locator('.card-header .tiptap').first())).toBe(
      WRITTEN,
    )
    expect(
      await typeAndRead(page, stage(page).locator('[data-testid="slide-title"] .tiptap')),
    ).toBe(WRITTEN)
  })

  test('erstatter mens man skriver i en seksjons to linjer', async ({ page }) => {
    await createPresentation(page, 'Autoerstatning forside')
    await page.getByTestId('filmstrip-item').nth(0).getByTestId('filmstrip-thumb').click()
    await expect(stage(page).getByTestId('section-page')).toBeVisible()

    expect(
      await typeAndRead(page, stage(page).locator('[data-section-line="title"] .tiptap')),
    ).toBe(WRITTEN)
    expect(
      await typeAndRead(page, stage(page).locator('[data-section-line="subtitle"] .tiptap')),
    ).toBe(WRITTEN)
  })

  test('erstatter mens man skriver i en bildetekst', async ({ page }) => {
    await createPresentation(page, 'Autoerstatning bildetekst')
    await page.getByTestId('add-slide').click()
    await page.getByTestId('new-slide-without-title').click()

    await page.getByTestId('empty-zone-image').click()
    await expect(page.getByTestId('image-modal')).toBeVisible()
    await page.getByTestId('image-input').setInputFiles({
      name: 'flate.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })
    await expect(page.getByTestId('image-modal')).toBeHidden()
    await page.getByTestId('caption-position-bottom').click()
    await expect(stage(page).locator('.image-caption .tiptap')).toBeFocused()

    expect(await typeAndRead(page, stage(page).locator('.image-caption .tiptap'))).toBe(WRITTEN)
  })
})
