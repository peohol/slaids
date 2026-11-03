/**
 * Compressing zones into negative space, with the pointer.
 *
 * The arithmetic is tested in `zoneGesture.test.ts`; this is the part only a
 * browser can show: which handle a press lands on, that Shift can be pressed
 * and let go while the pointer is down, that the live layout follows the
 * hand, and that one drag is one undo step that brings back sizes and
 * structure alike.
 */

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addContentToZone,
  caretInto,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  fillZoneToCapacity,
  slidePoint,
  splitSelected,
  stage,
  watchForErrors,
  worstOverflow,
  zoneRects,
  type ZoneRect,
} from './helpers'

/** The leaves on the slide, `n` for air and `c` for anything else, left to right / top to bottom. */
async function leafShape(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="stage-slide"] .slide-zone')]
      .filter((zone) => (zone as HTMLElement).getBoundingClientRect().width > 1)
      .map((zone) => (zone.querySelector('[data-content-kind="negative-space"]') ? 'n' : 'c'))
      .join(''),
  )
}

/** Content zones only, measured from the DOM. */
async function contentRects(page: Page): Promise<ZoneRect[]> {
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="stage-slide"] .slide-zone')]
      .filter((zone) => !zone.querySelector('[data-content-kind="negative-space"]'))
      .map((zone) => (zone as HTMLElement).dataset.nodeId),
  )
  return (await zoneRects(page)).filter((zone) => ids.includes(zone.id))
}

async function scaleOf(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number((document.querySelector('[data-testid="stage-slide"]') as HTMLElement).dataset.scale),
  )
}

interface Point {
  x: number
  y: number
}

/** The middle of an element's box on screen. */
function centreOf(box: { x: number; y: number; width: number; height: number }): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** The middle of a zone, on screen. */
async function insideOf(page: Page, zone: ZoneRect): Promise<Point> {
  return slidePoint(page, zone.x + zone.w / 2, zone.y + zone.h / 2)
}

/**
 * Press at `point`, move by design-space `dx`/`dy`, optionally holding Shift
 * the whole way. Without `release` the pointer — and Shift — stay down, and
 * `letGo` lets go of both.
 */
async function dragFrom(
  page: Page,
  { x, y }: Point,
  dx: number,
  dy: number,
  { shift = false, release = true }: { shift?: boolean; release?: boolean } = {},
): Promise<void> {
  const scale = await scaleOf(page)
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx * scale, y + dy * scale, { steps: 10 })
  if (release) await letGo(page)
}

/** Let go of the pointer, then of Shift. */
async function letGo(page: Page): Promise<void> {
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await page.waitForTimeout(250)
}

async function handleBox(page: Page, index: number) {
  const box = await page.getByTestId('ratio-handle').nth(index).boundingBox()
  if (!box) throw new Error('no handle')
  return box
}

async function gripBox(page: Page, axis: 'x' | 'y', side: 'start' | 'end') {
  const box = await page.locator(`[data-testid="edge-grip"][data-axis="${axis}"][data-side="${side}"]`).boundingBox()
  if (!box) throw new Error('no grip')
  return box
}

/** Select a zone by clicking in it. */
async function select(page: Page, zone: ZoneRect): Promise<void> {
  const point = await insideOf(page, zone)
  await page.mouse.click(point.x, point.y)
}

test.describe('compressing zones into air', () => {
  test(
    'a divider dragged across its row compresses the whole row, and undo brings it back',
    { tag: '@pr' },
    async ({ page }) => {
      const guard = watchForErrors(page)
      await createPresentation(page, 'Komprimering')
      await enterZoneMode(page)
      await splitSelected(page, [1, 2, 1], 'x')
      const before = await contentRects(page)

      // Down is smaller in a row: the divider pressed and pulled down.
      await dragFrom(page, centreOf(await handleBox(page, 0)), 0, 240)
      expect(await leafShape(page)).toBe('ncccn')
      const after = await contentRects(page)
      // Centred, smaller, and in the same proportions.
      const row = (rects: ZoneRect[]) => rects[2].x + rects[2].w - rects[0].x
      expect(row(after)).toBeLessThan(row(before))
      expect(after[0].x - before[0].x).toBeCloseTo(before[2].x + before[2].w - (after[2].x + after[2].w), 0)
      expect(after[1].w / after[0].w).toBeCloseTo(2, 1)

      // A second compression from the other divider reuses the same air.
      await dragFrom(page, centreOf(await handleBox(page, 2)), 0, 100)
      expect(await leafShape(page)).toBe('ncccn')

      await page.getByTestId('undo').click()
      await page.getByTestId('undo').click()
      expect(await leafShape(page)).toBe('ccc')
      for (const [index, zone] of (await contentRects(page)).entries()) {
        expect(zone.w).toBeCloseTo(before[index].w, 0)
      }
      await page.getByTestId('redo').click()
      expect(await leafShape(page)).toBe('ncccn')
      expect(guard.errors).toEqual([])
    },
  )

  test(
    'a zone with nowhere to slide is compressed across its split from inside, and keeps going',
    { tag: '@pr' },
    async ({ page }) => {
      const guard = watchForErrors(page)
      await createPresentation(page, 'Innenfra')
      await enterZoneMode(page)
      await splitSelected(page, [1, 1], 'y')
      const [top, bottom] = await zoneRects(page)

      // Pressed inside the top zone and pulled down: along the column, where
      // it has nowhere to slide, so it is narrowed from both sides instead.
      await dragFrom(page, await insideOf(page, top), 0, 300)
      expect(await leafShape(page)).toBe('ncnc')
      const byId = async (zone: ZoneRect): Promise<ZoneRect> => {
        const found = (await contentRects(page)).find((rect) => rect.id === zone.id)
        if (!found) throw new Error(`zone ${zone.id} is gone`)
        return found
      }
      const narrowed = await byId(top)
      const untouched = await byId(bottom)
      expect(narrowed.w).toBeLessThan(top.w - 100)
      expect(narrowed.x - top.x).toBeCloseTo(top.x + top.w - (narrowed.x + narrowed.w), 0)
      expect(untouched.w).toBeCloseTo(bottom.w, 0)

      // The same movement again narrows it further, reusing the air.
      await dragFrom(page, await insideOf(page, narrowed), 0, 200)
      expect(await leafShape(page)).toBe('ncnc')
      const further = await byId(top)
      expect(further.w).toBeLessThan(narrowed.w)

      await page.getByTestId('undo').click()
      await page.getByTestId('undo').click()
      expect(await leafShape(page)).toBe('cc')
      expect(guard.errors).toEqual([])
    },
  )

  test(
    'a release stores what was shown just before it, small drags included',
    { tag: '@pr' },
    async ({ page }) => {
      const guard = watchForErrors(page)
      await createPresentation(page, 'Slipp')
      await enterZoneMode(page)
      await splitSelected(page, [1, 1], 'y')
      const [top] = await zoneRects(page)
      const byId = async (): Promise<ZoneRect> => {
        const found = (await contentRects(page)).find((rect) => rect.id === top.id)
        if (!found) throw new Error('the zone is gone')
        return found
      }

      let stepped = false
      for (const way of [
        { side: 'start', sign: 1, shift: true },
        { side: 'end', sign: -1, shift: false },
      ] as const) {
        for (const amount of [40, 80, 120, 160]) {
          await select(page, top)
          await dragFrom(page, centreOf(await gripBox(page, 'x', way.side)), way.sign * amount, 0, {
            shift: way.shift,
            release: false,
          })
          // The outline follows the hand; the zone shows the step it will keep.
          await expect(stage(page).getByTestId('drag-block')).toBeVisible()
          const shown = await byId()
          const shape = await leafShape(page)
          await letGo(page)
          const stored = await byId()
          const label = `${way.shift ? 'Shift' : way.side} ${amount} px`
          expect(await leafShape(page), label).toBe(shape)
          expect(Math.abs(stored.x - shown.x), label).toBeLessThan(1)
          expect(Math.abs(stored.w - shown.w), label).toBeLessThan(1)
          if (shape !== 'cc') {
            stepped = true
            await page.getByTestId('undo').click()
          }
          expect(await leafShape(page)).toBe('cc')
        }
      }
      expect(stepped).toBe(true)
      expect(guard.errors).toEqual([])
    },
  )

  test(
    'text close to filling its zone is never cut off by a step, and what is shown is stored',
    { tag: '@pr' },
    async ({ page }) => {
      test.setTimeout(180_000)
      const guard = watchForErrors(page)
      await createPresentation(page, 'Nær grensen')
      await enterZoneMode(page)
      await splitSelected(page, [1, 1], 'y')
      const [top] = await zoneRects(page)
      await enterContentMode(page)
      await addContentToZone(page, top.id, 'container')
      await fillZoneToCapacity(page, top.id)
      // A seventh of it taken off again: the text now fits in somewhat less
      // room than the whole width — as narrow as the hand gets before the
      // first step of air is nearer than none — but not in that step.
      const field = stage(page).locator(`.slide-zone[data-node-id="${top.id}"] .tiptap`).first()
      await caretInto(field)
      // Read off the zone, which shows the text in either mode.
      const zoneText = stage(page).locator(`.slide-zone[data-node-id="${top.id}"]`).first()
      const length = () => zoneText.evaluate((element) => element.textContent?.length ?? 0)
      const full = await length()
      await page.keyboard.press('Control+End')
      for (let i = 0; i < Math.round(full / 7); i += 1) await page.keyboard.press('Backspace')
      const kept = await length()
      expect(kept).toBeLessThan(full)
      expect(await worstOverflow(page)).toBeLessThanOrEqual(1)
      await enterZoneMode(page)

      const byId = async (): Promise<ZoneRect> => {
        const found = (await contentRects(page)).find((rect) => rect.id === top.id)
        if (!found) throw new Error('the zone is gone')
        return found
      }
      for (const way of [
        { side: 'start', sign: 1, shift: true },
        { side: 'end', sign: -1, shift: false },
      ] as const) {
        for (const amount of [40, 70, 80, 90, 100, 110, 120, 160]) {
          await select(page, top)
          await dragFrom(page, centreOf(await gripBox(page, 'x', way.side)), way.sign * amount, 0, {
            shift: way.shift,
            release: false,
          })
          const label = `${way.shift ? 'Shift' : way.side} ${amount} px`
          // Whatever step is on screen, the text in it is all there.
          expect(await worstOverflow(page), label).toBeLessThanOrEqual(1)
          const shown = await byId()
          const shape = await leafShape(page)
          await letGo(page)
          const stored = await byId()
          expect(await leafShape(page), label).toBe(shape)
          expect(Math.abs(stored.x - shown.x), label).toBeLessThan(1)
          expect(Math.abs(stored.w - shown.w), label).toBeLessThan(1)
          expect(await worstOverflow(page), label).toBeLessThanOrEqual(1)
          if (shape !== 'cc') {
            await page.getByTestId('undo').click()
            expect(await leafShape(page), label).toBe('cc')
          }
          expect(await length(), label).toBe(kept)
        }
      }

      // With room to spare, a compression still goes through: an empty zone.
      const [, bottom] = await zoneRects(page)
      await select(page, bottom)
      await dragFrom(page, centreOf(await gripBox(page, 'x', 'start')), 200, 0, { shift: true })
      expect(await leafShape(page)).toBe('cncn')
      expect(guard.errors).toEqual([])
    },
  )

  test(
    'a zone resized from inside between its air shows and stores the same steps, both ways',
    { tag: '@pr' },
    async ({ page }) => {
      const guard = watchForErrors(page)
      await createPresentation(page, 'Mellom luft')
      await enterZoneMode(page)
      await splitSelected(page, [1, 1], 'y')
      const [top] = await zoneRects(page)
      await select(page, top)
      await dragFrom(page, centreOf(await gripBox(page, 'x', 'start')), 200, 0, { shift: true })
      expect(await leafShape(page)).toBe('ncnc')
      const byId = async (): Promise<ZoneRect> => {
        const found = (await contentRects(page)).find((rect) => rect.id === top.id)
        if (!found) throw new Error('the zone is gone')
        return found
      }

      let changed = 0
      for (const amount of [40, 80, 120, -40, -80, -120]) {
        const start = await byId()
        // Inside the zone, across its row: a resize, which grows or shrinks
        // the air on both sides of it.
        await dragFrom(page, await insideOf(page, start), 0, amount, { release: false })
        const label = `${amount} px`
        expect(await worstOverflow(page), label).toBeLessThanOrEqual(1)
        const shown = await byId()
        const shape = await leafShape(page)
        await page.mouse.up()
        await page.waitForTimeout(250)
        const stored = await byId()
        expect(await leafShape(page), label).toBe(shape)
        expect(Math.abs(stored.x - shown.x), label).toBeLessThan(1)
        expect(Math.abs(stored.w - shown.w), label).toBeLessThan(1)
        if (Math.abs(stored.w - start.w) > 1) {
          changed += 1
          await page.getByTestId('undo').click()
          expect(Math.abs((await byId()).w - start.w), label).toBeLessThan(1)
        }
      }
      expect(changed).toBeGreaterThan(0)
      expect(guard.errors).toEqual([])
    },
  )

  test(
    'a group already compressed to air on both sides reuses that air when it is compressed again',
    { tag: '@pr' },
    async ({ page }) => {
      const guard = watchForErrors(page)
      await createPresentation(page, 'Gruppe med luft')
      await enterZoneMode(page)
      await splitSelected(page, [1, 1], 'y')
      const [top] = await zoneRects(page)
      await select(page, top)
      await dragFrom(page, centreOf(await gripBox(page, 'x', 'start')), 160, 0, { shift: true })
      expect(await leafShape(page)).toBe('ncnc')
      const zoneOnly = (await contentRects(page)).find((rect) => rect.id === top.id)
      if (!zoneOnly) throw new Error('the zone is gone')

      // One level up: the row the zone and its air make.
      await select(page, zoneOnly)
      await page.keyboard.press('ArrowUp')
      await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot › 1')
      const pieces = async (): Promise<number> =>
        page.evaluate(
          () =>
            [...document.querySelectorAll('[data-testid="stage-slide"] [data-content-kind="negative-space"]')].filter(
              (element) => (element as HTMLElement).getBoundingClientRect().width > 1,
            ).length,
        )
      expect(await pieces()).toBe(2)

      for (const way of [
        { side: 'start', sign: 1, shift: true },
        { side: 'end', sign: -1, shift: false },
      ] as const) {
        const grip = centreOf(await gripBox(page, 'x', way.side))
        await dragFrom(page, grip, way.sign * 120, 0, { shift: way.shift, release: false })
        // Still one piece of air on each side while the pointer is down…
        expect(await pieces(), way.side).toBe(2)
        await letGo(page)
        // …and once it is stored, with the zone narrower than before.
        expect(await leafShape(page), way.side).toBe('ncnc')
        expect(await pieces(), way.side).toBe(2)
        const narrower = (await contentRects(page)).find((rect) => rect.id === top.id)
        expect(narrower && narrower.w < zoneOnly.w - 50, way.side).toBe(true)

        await page.getByTestId('undo').click()
        expect(await leafShape(page)).toBe('ncnc')
        const back = (await contentRects(page)).find((rect) => rect.id === top.id)
        expect(Math.abs((back?.w ?? 0) - zoneOnly.w)).toBeLessThan(1)
        await page.getByTestId('redo').click()
        expect(await pieces()).toBe(2)
        await page.getByTestId('undo').click()
        await select(page, zoneOnly)
        await page.keyboard.press('ArrowUp')
        await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot › 1')
      }

      // Back the other way: the group grown into its air until it is gone.
      await dragFrom(page, centreOf(await gripBox(page, 'x', 'start')), -400, 0, { shift: true })
      expect(await leafShape(page)).toBe('cc')
      expect(guard.errors).toEqual([])
    },
  )

  test('an outer edge compresses from its own side, and Shift from both', async ({ page }) => {
    await createPresentation(page, 'Ytterkant')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'y')
    const [top] = await zoneRects(page)
    await select(page, top)

    // The top zone's left edge, across its column: air beside it alone.
    await dragFrom(page, centreOf(await gripBox(page, 'x', 'start')), 200, 0)
    expect(await leafShape(page)).toBe('ncc')
    await page.getByTestId('undo').click()
    expect(await leafShape(page)).toBe('cc')

    await select(page, top)
    await dragFrom(page, centreOf(await gripBox(page, 'x', 'start')), 150, 0, { shift: true })
    expect(await leafShape(page)).toBe('ncnc')
    const [compressed] = await contentRects(page)
    expect(compressed.x - top.x).toBeCloseTo(top.x + top.w - (compressed.x + compressed.w), 0)
  })

  test(
    'Shift pressed or let go while the pointer is down switches between both sides and one',
    { tag: '@pr' },
    async ({ page }) => {
      const guard = watchForErrors(page)
      await createPresentation(page, 'Shift underveis')
      await enterZoneMode(page)
      await splitSelected(page, [1, 1], 'y')
      const [top] = await zoneRects(page)
      const zone = async (): Promise<ZoneRect> => {
        const found = (await contentRects(page)).find((rect) => rect.id === top.id)
        if (!found) throw new Error('the zone is gone')
        return found
      }
      /** Air left of the zone minus air right of it, on screen. */
      const lopsided = async (): Promise<number> => {
        const now = await zone()
        return now.x - top.x - (top.x + top.w - (now.x + now.w))
      }

      // An edge, pressed without Shift: air on its own side only.
      await select(page, top)
      await dragFrom(page, centreOf(await gripBox(page, 'x', 'start')), 150, 0, { release: false })
      expect(await leafShape(page)).toBe('ncc')
      // Shift down, the pointer still: the same press now compresses from both sides.
      await page.keyboard.down('Shift')
      await expect.poll(() => leafShape(page)).toBe('ncnc')
      expect(Math.abs(await lopsided())).toBeLessThan(1)
      // Shift up again: back to one side, as if it had never been pressed.
      await page.keyboard.up('Shift')
      await expect.poll(() => leafShape(page)).toBe('ncc')
      // And down once more before letting go: what is stored is what is shown.
      await page.keyboard.down('Shift')
      await expect.poll(() => leafShape(page)).toBe('ncnc')
      const shown = await zone()
      await letGo(page)
      expect(await leafShape(page)).toBe('ncnc')
      const stored = await zone()
      expect(Math.abs(stored.x - shown.x)).toBeLessThan(1)
      expect(Math.abs(stored.w - shown.w)).toBeLessThan(1)
      expect(Math.abs(await lopsided())).toBeLessThan(1)
      // One drag, one undo step, whatever Shift did on the way.
      await page.getByTestId('undo').click()
      expect(await leafShape(page)).toBe('cc')

      // A divider, the other way round: pressed with Shift, let go of it mid-drag.
      await page.getByTestId('undo').click()
      await select(page, (await zoneRects(page))[0])
      await splitSelected(page, [2, 3, 4, 3, 2], 'x')
      const before = await contentRects(page)
      await dragFrom(page, centreOf(await handleBox(page, 2)), -80, 0, { shift: true, release: false })
      // Shift: the halves scale, and the left one keeps its insides.
      const scaled = await contentRects(page)
      expect(scaled[0].w).toBeLessThan(before[0].w - 10)
      expect(scaled[1].w / scaled[0].w).toBeCloseTo(before[1].w / before[0].w, 1)
      // Without it: the two zones beside the divider take the change. The
      // others move at most by the step the drag is shown — and stored — in,
      // which is far less than the scaling took from them.
      await page.keyboard.up('Shift')
      const scaledBy = before[0].w - scaled[0].w
      await expect
        .poll(async () => Math.abs((await contentRects(page))[0].w - before[0].w))
        .toBeLessThan(scaledBy / 2)
      const moved = await contentRects(page)
      expect(moved[2].w).toBeLessThan(before[2].w - 30)
      await letGo(page)
      const after = await contentRects(page)
      // Stored as the same drag pressed without Shift would store it.
      await page.getByTestId('undo').click()
      await dragFrom(page, centreOf(await handleBox(page, 2)), -80, 0)
      const plain = await contentRects(page)
      for (const [index, rect] of after.entries()) expect(rect.w).toBeCloseTo(plain[index].w, 0)
      expect(guard.errors).toEqual([])
    },
  )

  test('the air comes and goes while the pointer is down, and Escape leaves everything as it was', async ({
    page,
  }) => {
    await createPresentation(page, 'Reversering')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1, 1], 'x')
    const before = await contentRects(page)
    const handle = await handleBox(page, 1)
    const scale = await scaleOf(page)
    const x = handle.x + handle.width / 2
    const y = handle.y + handle.height / 2

    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 200 * scale, { steps: 8 })
    expect(await leafShape(page)).toBe('ncccn')
    await expect(stage(page).getByTestId('drag-block')).toBeVisible()
    // Back to the start: the air has no room and is not drawn.
    await page.mouse.move(x, y, { steps: 8 })
    expect(await leafShape(page)).toBe('ccc')
    await page.mouse.move(x, y + 120 * scale, { steps: 8 })
    expect(await leafShape(page)).toBe('ncccn')
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(await leafShape(page)).toBe('ccc')
    for (const [index, zone] of (await contentRects(page)).entries()) {
      expect(zone.x).toBeCloseTo(before[index].x, 1)
      expect(zone.w).toBeCloseTo(before[index].w, 1)
    }
    // Nothing was recorded: one undo takes back the split itself.
    await page.getByTestId('undo').click()
    expect(await leafShape(page)).toBe('c')
  })

  test('Shift on a divider rescales the two halves and keeps each one’s insides', async ({ page }) => {
    await createPresentation(page, 'Shift-skille')
    await enterZoneMode(page)
    await splitSelected(page, [2, 3, 4, 3, 2], 'x')
    const before = await contentRects(page)
    await dragFrom(page, centreOf(await handleBox(page, 2)), -80, 0, { shift: true })
    const after = await contentRects(page)
    expect(after[2].x + after[2].w).toBeLessThan(before[2].x + before[2].w - 30)
    expect(after[1].w / after[0].w).toBeCloseTo(before[1].w / before[0].w, 1)
    expect(after[2].w / after[0].w).toBeCloseTo(before[2].w / before[0].w, 1)
    expect(after[4].w / after[3].w).toBeCloseTo(before[4].w / before[3].w, 1)
  })
})
