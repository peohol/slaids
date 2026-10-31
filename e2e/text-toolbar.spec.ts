/**
 * The text toolbar (docs/UX_IMPROVEMENT_PLAN.md, U4).
 *
 * What only a browser can tell: that the bar names the field it works on and
 * shows what is in force there, that it refuses what the editor would refuse
 * without hiding it, that a press formats the text that was marked and leaves
 * the caret where it was — from the mouse and the keyboard — and that it fits
 * the window. Which actions are available where is checked against the editor
 * itself in `textActions.test.ts`; that each format still works is checked by
 * the specs that use it.
 */

import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import {
  addContentToZone,
  caretInto,
  createPresentation,
  splitSelected,
  stage,
  watchForErrors,
  zoneRects,
} from './helpers'

const bar = (page: Page) => page.getByTestId('text-toolbar')
const body = (page: Page) => stage(page).locator('.subfield .tiptap').first()

/** A deck whose first zone holds a card of `kind`, with the caret in its body. */
async function typeInCard(page: Page, title: string, kind: 'untitled-card' | 'titled-card' = 'untitled-card') {
  await createPresentation(page, title)
  const [zone] = await zoneRects(page)
  await addContentToZone(page, zone.id, kind)
  await caretInto(body(page))
  return zone
}

/** What is marked in the page right now, as text. */
const marked = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? '')

test.describe('what is in force', () => {
  test('names the field and marks the formatting and both alignments in force', async ({ page }) => {
    const guard = watchForErrors(page)
    await typeInCard(page, 'Gjeldende')
    await expect(bar(page)).toHaveAttribute('role', 'toolbar')
    await expect(page.getByTestId('text-toolbar-field')).toHaveText('Brødtekst')

    await page.keyboard.type('Vanlig ')
    await page.keyboard.press('Control+B')
    await page.keyboard.type('fet')
    await expect(page.getByTestId('format-bold')).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Home')
    await expect(page.getByTestId('format-bold')).toHaveAttribute('aria-pressed', 'false')

    // One alignment across the line and one up the box are in force, always —
    // pressed, and only that one of each.
    const horizontal = page.getByTestId('align-tools')
    const vertical = page.getByTestId('vertical-align-tools')
    await expect(horizontal.locator('[aria-pressed="true"]')).toHaveCount(1)
    await expect(vertical.locator('[aria-pressed="true"]')).toHaveCount(1)
    await expect(page.getByTestId('valign-middle')).toHaveAttribute('aria-pressed', 'true')

    await page.getByTestId('valign-bottom').click()
    await expect(page.getByTestId('valign-bottom')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('valign-middle')).toHaveAttribute('aria-pressed', 'false')
    await page.getByTestId('align-right').click()
    await expect(page.getByTestId('align-right')).toHaveAttribute('aria-pressed', 'true')
    await expect(horizontal.locator('[aria-pressed="true"]')).toHaveCount(1)

    // The paragraph kind in force is pressed, and so is the list.
    await page.getByTestId('format-bullet').click()
    await expect(page.getByTestId('format-bullet')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('format-ordered')).toHaveAttribute('aria-pressed', 'false')

    // A command that is not a state is never announced as one.
    await expect(page.getByTestId('format-table')).not.toHaveAttribute('aria-pressed')
    await expect(page.getByTestId('insert-reference')).not.toHaveAttribute('aria-pressed')
    expect(guard.errors).toEqual([])
  })

  test('names each kind of field by its own name, and offers a title only what a title can take', async ({ page }) => {
    await createPresentation(page, 'Felter')
    const [zone] = await zoneRects(page)
    await addContentToZone(page, zone.id, 'titled-card')

    await stage(page).locator('.card-header .tiptap').click()
    await expect(page.getByTestId('text-toolbar-field')).toHaveText('Korttittel')
    await expect(page.getByTestId('format-subscript')).toBeVisible()
    await expect(page.getByTestId('format-bold')).toHaveCount(0)

    await stage(page).locator('.slide-title .tiptap').click()
    await expect(page.getByTestId('text-toolbar-field')).toHaveText('Slidetittel')
    await expect(page.getByTestId('format-heading')).toHaveCount(0)

    await caretInto(body(page))
    await expect(page.getByTestId('text-toolbar-field')).toHaveText('Brødtekst')
    await expect(page.getByTestId('format-heading')).toHaveAttribute('aria-label', 'Aksent')
  })
})

test.describe('what cannot be done', () => {
  test('is disabled where the editor would refuse it, and still in its place', async ({ page }) => {
    const guard = watchForErrors(page)
    await typeInCard(page, 'Utilgjengelig')
    await page.keyboard.type('kode')
    await page.getByTestId('format-code').click()
    await expect(stage(page).locator('.subfield pre')).toHaveCount(1)

    // Marks cannot go into code: the buttons stay where they were, disabled,
    // and say why.
    for (const id of ['bold', 'italic', 'underline', 'subscript', 'superscript']) {
      await expect(page.getByTestId(`format-${id}`)).toBeVisible()
      await expect(page.getByTestId(`format-${id}`)).toBeDisabled()
    }
    await page.getByTestId('format-bold').hover()
    await expect(page.locator('.tooltip')).toContainText('Ikke mulig der markøren står')
    await expect(page.getByTestId('format-bold')).toHaveAccessibleDescription(/Ikke mulig der markøren står/)

    // A list *can* be made from it, though the editor's own quick check says
    // otherwise — so it is offered, and does it.
    await expect(page.getByTestId('format-bullet')).toBeEnabled()
    await page.getByTestId('format-bullet').click()
    await expect(stage(page).locator('.subfield ul li')).toHaveText('kode')
    await expect(page.getByTestId('format-bold')).toBeEnabled()
    expect(guard.errors).toEqual([])
  })

  test('opens the table menu a right-click opens, and gives the caret back to the cell', async ({ page }) => {
    await typeInCard(page, 'Tabellmeny')
    await page.getByTestId('format-table').click()
    const table = stage(page).locator('table')
    await expect(table.locator('tr')).toHaveCount(3)

    await page.getByTestId('table-tools').click()
    const menu = page.getByTestId('context-menu')
    await expect(menu.getByTestId('menu-header')).toHaveAttribute('aria-checked', 'true')
    await expect(menu.getByTestId('menu-del-row')).not.toHaveAttribute('data-disabled')
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    // The caret is back in the text it was in, not on the button.
    await expect(body(page)).toBeFocused()
  })
})

test.describe('the text it acts on', () => {
  test('formats what was marked and leaves the marking and the caret where they were', async ({ page }) => {
    const guard = watchForErrors(page)
    await typeInCard(page, 'Markering')
    await page.keyboard.type('Første andre tredje')
    for (let i = 0; i < 'tredje'.length; i += 1) await page.keyboard.press('Shift+ArrowLeft')
    expect(await marked(page)).toBe('tredje')

    await page.getByTestId('format-bold').click()
    await page.getByTestId('format-italic').click()
    await expect(body(page)).toBeFocused()
    expect(await marked(page)).toBe('tredje')
    await expect(stage(page).locator('.subfield strong')).toHaveText('tredje')
    await expect(stage(page).locator('.subfield em')).toHaveText('tredje')

    // Typing goes on where it was: the marking is replaced, nothing else moved.
    await page.keyboard.type('siste')
    await expect(body(page)).toContainText('Første andre siste')
    expect(guard.errors).toEqual([])
  })

  test('works from the keyboard: arrows along the bar, and the caret back in the text after a press', async ({ page }) => {
    await typeInCard(page, 'Tastatur')
    await page.keyboard.type('Ord')
    await page.keyboard.press('Shift+Home')

    await page.getByTestId('format-bold').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('format-italic')).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.getByTestId('insert-reference')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(page.getByTestId('format-bold')).toBeFocused()
    await page.keyboard.press('ArrowRight')

    await page.keyboard.press('Enter')
    await expect(stage(page).locator('.subfield em')).toHaveText('Ord')
    await expect(body(page)).toBeFocused()
    expect(await marked(page)).toBe('Ord')
  })

  test('stops aiming at a field once another zone is selected', async ({ page }) => {
    await createPresentation(page, 'To soner')
    await splitSelected(page, [1, 1])
    const [first] = await zoneRects(page)
    await addContentToZone(page, first.id, 'untitled-card')
    const field = stage(page).locator(`.slide-zone[data-node-id="${first.id}"] .subfield .tiptap`)
    await caretInto(field)
    await page.keyboard.type('Første sone')
    await expect(bar(page)).toBeVisible()

    // Up the path to the zone around it: the field's editor is still there,
    // but it is no longer what is selected, and the bar no longer aims at it.
    await page.getByRole('navigation', { name: 'Plassering i sonetreet' }).getByRole('button', { name: 'Rot' }).click()
    await expect(page.getByTestId('text-toolbar-empty')).toBeVisible()
    await expect(page.getByTestId('format-bold')).toHaveCount(0)

    await caretInto(field)
    await expect(bar(page)).toBeVisible()
    await expect(page.getByTestId('text-toolbar-field')).toHaveText('Brødtekst')
  })
})

test.describe('colour of an accent', () => {
  for (const [kind, from] of [
    ['untitled-card', 'fra gjeldende inndeling'],
    ['titled-card', 'fra korttittelen'],
  ] as const) {
    test(`says where an accent's standard colour comes from in a ${kind}, and keeps the caret`, async ({ page }) => {
      const guard = watchForErrors(page)
      await typeInCard(page, `Aksent ${kind}`, kind)
      await page.keyboard.type('Aksent')
      await page.getByTestId('format-heading').click()

      await page.getByTestId('heading-color').click()
      await expect(page.locator('.popover').getByTestId('palette-inherited')).toHaveText(`Standard (${from})`)
      await expect(page.locator('.popover')).not.toContainText('forsiden')
      await page.locator('.popover [data-color="#804d4d"]').click()
      await page.keyboard.press('Escape')
      await expect(page.locator('.popover')).toHaveCount(0)
      await expect(stage(page).locator('.subfield h1')).toHaveAttribute('data-color', '#804d4d')
      // The colour was chosen with the caret still in the accent.
      await expect(body(page)).toBeFocused()
      expect(guard.errors).toEqual([])
    })
  }
})

test.describe('the bar fits the window', () => {
  for (const width of [1025, 1180, 1366]) {
    test(`at ${width} px nothing leaves the window, with a table`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await typeInCard(page, 'Bredde')
      await page.getByTestId('format-table').click()
      await expect(page.getByTestId('table-tools')).toBeVisible()

      const toolbar = bar(page)
      expect(await toolbar.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)
      const controls = toolbar.locator('button')
      const count = await controls.count()
      for (let index = 0; index < count; index += 1) {
        const box = await controls.nth(index).boundingBox()
        expect(box, `button ${index}`).not.toBeNull()
        expect(box!.x + box!.width, `button ${index}`).toBeLessThanOrEqual(width)
      }
      await expect(page.getByTestId('insert-reference')).toBeInViewport({ ratio: 1 })
      await expect(page.getByTestId('table-tools')).toBeInViewport({ ratio: 1 })
    })
  }
})
