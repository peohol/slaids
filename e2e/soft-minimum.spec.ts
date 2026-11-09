/**
 * A person may make a zone smaller than its text needs; the slide then draws
 * the text smaller. See `domain/softSize.ts` for the two limits, and
 * `ui/editor/softLimitDrag.ts` for the magnet at the soft one.
 *
 * Every number here is read off the app rather than assumed: where the soft
 * limit lies depends on the text, the font and the theme, so the tests find it
 * by dragging towards it and watching for the mark — the same way a person
 * would.
 */

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addContentToZone,
  caretInto,
  createPresentation,
  drawnSmaller,
  enterContentMode,
  enterSubmenu,
  enterZoneMode,
  splitSelected,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'
import { createContainer } from '../src/domain/content'
import { minimumSizeFor } from '../src/domain/geometry'
import { createLeaf } from '../src/domain/layout'
import { geometryForTheme } from '../src/domain/metrics'
import { defaultTheme } from '../src/domain/presentation'
import { SOFT_LIMIT_RESISTANCE_PX } from '../src/ui/editor/softLimitDrag'
import { SHRUNK_ZONE_MESSAGE } from '../src/ui/editor/ShrunkZoneMarker'

/** The narrowest a text zone may ever be, whatever it says. */
const HARD_MIN_WIDTH = minimumSizeFor(createLeaf(createContainer()), geometryForTheme(defaultTheme())).width

const TEXT = 'Dette er en setning med noen helt vanlige ord i seg. '.repeat(9)

/** Screen pixels per step of a slow drag: fine enough to see the magnet hold. */
const STEP_PX = 2

/**
 * A row of two zones, the left one holding text — by default text that fits it
 * with some room to spare, in a plain container.
 */
async function rowWithText(
  page: Page,
  title: string,
  { kind = 'container', text = TEXT }: { kind?: 'container' | 'titled-card'; text?: string } = {},
): Promise<string> {
  await createPresentation(page, title)
  await enterZoneMode(page)
  await splitSelected(page, [1, 1], 'x')
  const [left] = await zoneRects(page)
  await enterContentMode(page)
  await addContentToZone(page, left.id, kind)
  if (kind === 'titled-card') {
    await caretInto(zoneLocator(page, left.id).locator('.card-header .tiptap'))
    await page.keyboard.insertText('Tittel')
  }
  // The body is the zone's last field: a card's header comes before it.
  await caretInto(zoneLocator(page, left.id).locator('.tiptap').last())
  await page.keyboard.insertText(text)
  await page.waitForTimeout(300)
  await enterZoneMode(page)
  return left.id
}

function zoneLocator(page: Page, nodeId: string) {
  return stage(page).locator(`.slide-zone[data-node-id="${nodeId}"]`)
}

async function stageScale(page: Page): Promise<number> {
  return Number(await stage(page).getAttribute('data-scale'))
}

interface Sample {
  /** Screen pixels the pointer has moved. */
  travel: number
  /** The zone's width as drawn, in slide units. */
  width: number
  /** Whether it carries the shrunk mark. */
  marked: boolean
}

async function sample(page: Page, nodeId: string, travel: number): Promise<Sample> {
  const zone = zoneLocator(page, nodeId)
  const box = await zone.boundingBox()
  if (!box) throw new Error('the zone has no box')
  return {
    travel,
    width: box.width / (await stageScale(page)),
    marked: (await zone.getByTestId('zone-shrunk-marker').count()) > 0,
  }
}

/**
 * Press on the ratio handle and move it `travel` screen pixels in `STEP_PX`
 * steps, sampling the zone after each, then let go unless told not to.
 */
async function slowDrag(
  page: Page,
  nodeId: string,
  travel: number,
  options: { release?: boolean } = {},
): Promise<Sample[]> {
  const handle = page.getByTestId('ratio-handle').first()
  const box = await handle.boundingBox()
  if (!box) throw new Error('the ratio handle has no box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  const samples: Sample[] = []
  const direction = Math.sign(travel)
  for (let moved = STEP_PX; moved <= Math.abs(travel); moved += STEP_PX) {
    await page.mouse.move(x + direction * moved, y)
    samples.push(await sample(page, nodeId, moved))
  }
  if (options.release !== false) {
    await page.mouse.up()
    await page.waitForTimeout(250)
  }
  return samples
}

/** How far the pointer travelled while the zone held the same width before the mark appeared. */
function holdBeforeMark(samples: Sample[]): { held: number; width: number } {
  const first = samples.findIndex((entry) => entry.marked)
  expect(first, 'the drag reached the soft limit').toBeGreaterThan(0)
  const width = samples[first - 1].width
  const start = samples.findIndex((entry) => Math.abs(entry.width - width) < 0.5)
  return { held: samples[first - 1].travel - samples[start].travel, width }
}

/** Whether the zone's content is drawn inside its own box, with nothing outside it. */
async function contentInside(page: Page, nodeId: string): Promise<boolean> {
  return zoneLocator(page, nodeId).evaluate((zone) => {
    const outer = zone.getBoundingClientRect()
    const text = zone.querySelector('.zone-fit__inner')
    if (!text) return false
    const range = document.createRange()
    range.selectNodeContents(text)
    const inner = range.getBoundingClientRect()
    const slack = 1
    return (
      inner.left >= outer.left - slack &&
      inner.top >= outer.top - slack &&
      inner.right <= outer.right + slack &&
      inner.bottom <= outer.bottom + slack
    )
  })
}

/** The scale the zone's content is drawn at, or 1 at normal size. */
async function fitScale(page: Page, nodeId: string): Promise<number> {
  const value = await zoneLocator(page, nodeId).locator('.zone-fit').first().getAttribute('data-fit-scale')
  return value === null ? 1 : Number(value)
}

async function rootRatios(page: Page): Promise<string> {
  await page.getByTestId('zone-breadcrumb').getByRole('button', { name: 'Rot' }).click()
  return (await page.getByTestId('zone-ratios').textContent()) ?? ''
}

test.describe('myk minstegrense', () => {
  test(
    'holder ved den myke grensen, slipper forbi, forminsker teksten og angres',
    { tag: '@pr' },
    async ({ page }) => {
      const { errors } = watchForErrors(page)
      const left = await rowWithText(page, 'Myk grense')
      const ratiosBefore = await rootRatios(page)

      // Slowly towards the left: the zone stops at the soft limit for a
      // stretch of the hand before the mark appears.
      const samples = await slowDrag(page, left, -500, { release: false })
      const { held, width: softWidth } = holdBeforeMark(samples)
      expect(held).toBeGreaterThanOrEqual(SOFT_LIMIT_RESISTANCE_PX - STEP_PX * 2)
      expect(softWidth).toBeGreaterThan(HARD_MIN_WIDTH)
      await page.mouse.up()
      await page.waitForTimeout(250)

      // Released past it, the zone is stored smaller than its text needs.
      const after = await sample(page, left, 0)
      expect(after.marked).toBe(true)
      expect(after.width).toBeLessThan(softWidth)
      // The stored geometry is the one the drag showed at release.
      expect(Math.abs(after.width - samples[samples.length - 1].width)).toBeLessThan(0.5)
      const scale = await fitScale(page, left)
      expect(scale).toBeLessThan(1)
      expect(await contentInside(page, left)).toBe(true)

      // The inspector says why, and the mark takes no pointer.
      await zoneLocator(page, left).click()
      await expect(page.getByTestId('zone-shrunk-notice')).toContainText(SHRUNK_ZONE_MESSAGE)
      await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCSS('pointer-events', 'none')

      // One undo puts the zone back at normal size, unmarked; redo returns it.
      const ratiosShrunk = await rootRatios(page)
      expect(ratiosShrunk).not.toBe(ratiosBefore)
      await page.getByTestId('undo').click()
      await expect(page.getByTestId('zone-ratios')).toHaveText(ratiosBefore)
      await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(0)
      expect(await fitScale(page, left)).toBe(1)
      await page.getByTestId('redo').click()
      await expect(page.getByTestId('zone-ratios')).toHaveText(ratiosShrunk)
      await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(1)

      // Saved and reopened: the same geometry, and the same state, from the
      // geometry alone.
      await waitForSaved(page)
      await page.reload()
      await expect(stage(page)).toBeVisible()
      await enterZoneMode(page)
      expect(await rootRatios(page)).toBe(ratiosShrunk)
      await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(1)
      expect(Math.abs((await fitScale(page, left)) - scale)).toBeLessThan(0.02)
      expect(errors).toEqual([])
    },
  )

  test('stopper ved den harde grensen, uansett hvor langt hånden drar', async ({ page }) => {
    const left = await rowWithText(page, 'Hard grense')
    const samples = await slowDrag(page, left, -1400)
    const narrowest = Math.min(...samples.map((entry) => entry.width))
    expect(narrowest).toBeGreaterThanOrEqual(HARD_MIN_WIDTH - 0.5)
    const stored = await sample(page, left, 0)
    expect(stored.width).toBeGreaterThanOrEqual(HARD_MIN_WIDTH - 0.5)
    // Small is still all there.
    expect(await contentInside(page, left)).toBe(true)
  })

  test('trekkes tilbake til den myke grensen og får normal skrift igjen', async ({ page }) => {
    const left = await rowWithText(page, 'Tilbake')
    await slowDrag(page, left, -400)
    await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(1)
    const normalFont = await stage(page)
      .locator('.slide-zone')
      .last()
      .evaluate((zone) => getComputedStyle(zone).fontSize)

    // Back towards the right: the mark goes before the pointer has quite
    // reached where the text fits — the limit reaches out and takes the zone.
    const samples = await slowDrag(page, left, 400)
    const fitted = samples.findIndex((entry) => !entry.marked)
    expect(fitted).toBeGreaterThan(0)
    expect(samples[fitted].width - samples[fitted - 1].width).toBeGreaterThan(0)
    await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(0)
    expect(await fitScale(page, left)).toBe(1)
    // Normal type again: the same size as anywhere else on the slide.
    const font = await zoneLocator(page, left).evaluate((zone) => getComputedStyle(zone).fontSize)
    expect(font).toBe(normalFont)
  })

  test('tar imot tekst som skrives eller limes inn forbi det som får plass, og forminsker den', async ({
    page,
  }) => {
    const { errors } = watchForErrors(page)
    const left = await rowWithText(page, 'Skriv forbi')
    await enterContentMode(page)
    const field = zoneLocator(page, left).locator('.tiptap').first()
    const text = () => field.evaluate((element) => element.textContent ?? '')
    const before = await text()
    expect(await fitScale(page, left)).toBe(1)

    // Typed key by key, on past what fits at normal size: every letter is
    // taken, and the zone draws the text smaller instead of refusing it.
    await caretInto(field)
    const sentence = 'Enda en setning som skrives. '
    let typed = ''
    for (let i = 0; i < 20 && !(await drawnSmaller(field)); i += 1) {
      await page.keyboard.type(sentence)
      typed += sentence
    }
    expect(await drawnSmaller(field), 'typing went past what fits').toBe(true)
    await expect.poll(text).toBe(typed + before)
    await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(1)
    expect(await contentInside(page, left)).toBe(true)
    const typedScale = await fitScale(page, left)

    // A paste far bigger than the zone: all of it, smaller still.
    const pasted = 'Limt inn tekst som ikke får plass. '.repeat(40)
    await field.evaluate((element, data) => {
      const transfer = new DataTransfer()
      transfer.setData('text/plain', data)
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      )
    }, pasted)
    await expect.poll(text).toContain(pasted.trim())
    const full = await text()
    await expect.poll(() => fitScale(page, left)).toBeLessThan(typedScale * 0.8)
    expect(await contentInside(page, left)).toBe(true)
    await expect(page.getByTestId('toast')).toHaveCount(0)

    // Undone, the text is back at its normal size, unmarked; redone, small again.
    // One step at a time, each given time to land: a press sent before the
    // last one has would undo past the typing, into the zone's creation. Not
    // every step changes the text, so a step that leaves it is let be.
    const stepUntil = async (button: 'undo' | 'redo', target: string): Promise<void> => {
      for (let i = 0; i < 10; i += 1) {
        const now = await text()
        if (now === target) return
        await page.getByTestId(button).click()
        await expect
          .poll(text, { timeout: 2_000 })
          .not.toBe(now)
          .catch(() => undefined)
      }
    }
    await stepUntil('undo', before)
    await expect.poll(text).toBe(before)
    await expect.poll(() => fitScale(page, left)).toBe(1)
    await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(0)
    await stepUntil('redo', full)
    await expect.poll(text).toBe(full)
    await expect.poll(() => fitScale(page, left)).toBeLessThan(typedScale * 0.8)

    // Saved and reopened: the same text, drawn the same.
    await waitForSaved(page)
    const savedScale = await fitScale(page, left)
    await page.reload()
    await expect.poll(text).toBe(full)
    await expect.poll(() => fitScale(page, left)).toBeCloseTo(savedScale, 2)
    expect(await contentInside(page, left)).toBe(true)
    expect(errors).toEqual([])
  })

  test('lar forholdsmenyen gjøre en forminsket sone smalere igjen, slik den var', async ({ page }) => {
    // The case as it was found: three zones at 1 : 1 : 1, the middle one
    // written past what fits and drawn smaller. The menu gives it room at
    // 1 : 2 : 1, and must give that room back at 1 : 1 : 1 — the ratio the
    // text was in a moment ago.
    const { errors } = watchForErrors(page)
    await createPresentation(page, 'Forholdsmeny')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1, 1], 'x')
    const middle = (await zoneRects(page))[1]
    await enterContentMode(page)
    await addContentToZone(page, middle.id, 'container')
    const field = zoneLocator(page, middle.id).locator('.tiptap').first()
    await caretInto(field)
    await page.keyboard.insertText(TEXT.repeat(3))
    await expect.poll(() => fitScale(page, middle.id)).toBeLessThan(1)
    const narrowScale = await fitScale(page, middle.id)
    await enterZoneMode(page)

    const chooseRatio = async (weights: string): Promise<void> => {
      await rootRatios(page)
      await page.getByTestId('inspector-action-more').click()
      await page.getByTestId('menu-ratios').focus()
      await enterSubmenu(page, 'ratios')
      const option = page.getByTestId(`menu-ratio-${weights}`)
      await expect(option).not.toHaveAttribute('data-disabled', '')
      await option.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('context-menu')).toHaveCount(0)
    }

    await chooseRatio('1-2-1')
    await expect.poll(() => rootRatios(page)).toContain('1 : 2 : 1')
    await expect.poll(() => fitScale(page, middle.id)).toBeGreaterThan(narrowScale)

    await chooseRatio('1-1-1')
    await expect.poll(() => rootRatios(page)).toContain('1 : 1 : 1')
    await expect.poll(() => fitScale(page, middle.id)).toBeLessThan(1)
    // Found again from where the search last stopped, so to within its precision.
    expect(Math.abs((await fitScale(page, middle.id)) - narrowScale)).toBeLessThan(0.02)
    expect(await contentInside(page, middle.id)).toBe(true)
    await expect(page.getByTestId('toast')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('lar en forminsket sone redigeres, forstørret, og viser den uten merke i presentasjon', async ({
    page,
  }) => {
    const { errors } = watchForErrors(page)
    const left = await rowWithText(page, 'Redigering')
    await slowDrag(page, left, -400)
    await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(1)

    // Content mode: still marked, and written in straight through the mark.
    await enterContentMode(page)
    await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(1)
    // The editor's fields are drawn at the same scale as the static drawing
    // was, with every line inside the zone.
    await expect.poll(() => contentInside(page, left)).toBe(true)
    const field = zoneLocator(page, left).locator('.tiptap').first()
    const text = () => field.evaluate((element) => element.textContent ?? '')
    const before = await text()
    // A letter for a letter is a correction, and is taken.
    await caretInto(field)
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.insertText('d')
    await expect.poll(text).toBe(`d${before.slice(1)}`)
    // More text is taken too, and drawn smaller still.
    const scaleBefore = await fitScale(page, left)
    const more = 'Mange flere ord som ikke får plass. '.repeat(6)
    await page.keyboard.insertText(more)
    const grown = `d${more}${before.slice(1)}`
    await expect.poll(text).toBe(grown)
    await expect.poll(() => fitScale(page, left)).toBeLessThan(scaleBefore)
    expect(await contentInside(page, left)).toBe(true)

    // The inspector draws just this zone large enough to write in, and back.
    await expect(page.getByTestId('zone-shrunk-notice')).toBeVisible()
    const smallBox = await zoneLocator(page, left).boundingBox()
    await page.getByTestId('zone-shrunk-enlarge').click()
    await expect(page.getByTestId('zone-shrunk-show-slide')).toBeVisible()
    const bigBox = await zoneLocator(page, left).boundingBox()
    expect(bigBox && smallBox && bigBox.width > smallBox.width * 1.5).toBe(true)
    expect(await contentInside(page, left)).toBe(true)
    // Enlarging puts the caret in the field itself, at the end of the text.
    await expect(field).toBeFocused()
    await page.keyboard.press('Backspace')
    await expect.poll(text).toBe(grown.slice(0, -1))
    await page.getByTestId('zone-shrunk-show-slide').click()
    await expect(page.getByTestId('zone-shrunk-enlarge')).toBeVisible()

    // Presentation mode: the same small text, and no mark.
    await page.getByTestId('present').click()
    const presented = page.locator('[data-testid="present-view"] .slide-zone').first()
    await expect(presented).toBeVisible()
    await expect(page.getByTestId('zone-shrunk-marker')).toHaveCount(0)
    const presentedScale = await page
      .locator('[data-testid="present-view"] .zone-fit[data-fit-scale]')
      .first()
      .getAttribute('data-fit-scale')
    expect(Number(presentedScale)).toBeLessThan(1)
    expect(errors).toEqual([])
  })

  test('tegner en forminsket sone likt i redigering og presentasjon', { tag: '@pr' }, async ({ page }) => {
    const { errors } = watchForErrors(page)
    // What the editor's fields and the static drawing must agree on: a word
    // longer than the zone is wide is broken, and runs of spaces are kept.
    const text = `${'langtordutenmellomrom'.repeat(6)} og  to   mellomrom. ${TEXT}`
    const left = await rowWithText(page, 'Likt overalt', { kind: 'titled-card', text })
    await slowDrag(page, left, -400)
    await expect(zoneLocator(page, left).getByTestId('zone-shrunk-marker')).toHaveCount(1)
    // Zone mode draws the content statically, content mode with the editor.
    const drawn = await fitScale(page, left)
    expect(drawn).toBeLessThan(1)
    await enterContentMode(page)
    await expect.poll(() => fitScale(page, left)).toBeCloseTo(drawn, 2)

    await page.getByTestId('present').click()
    const presented = page.locator(`[data-testid="present-view"] .slide-zone[data-node-id="${left}"] .zone-fit`)
    await expect(presented).toBeVisible()
    await expect
      .poll(async () => Number((await presented.getAttribute('data-fit-scale')) ?? 1))
      .toBeCloseTo(drawn, 2)
    expect(errors).toEqual([])
  })
})
