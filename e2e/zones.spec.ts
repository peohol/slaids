import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  G,
  addContentToZone,
  clickSlide,
  clickZone,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  expectGap,
  slidePoint,
  splitSelected,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
  type ZoneRect,
} from './helpers'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect width="100" height="60" fill="#4d6680"/></svg>`

/** What the inspector shows once a layout is committed: whole numbers only. */
const WHOLE_RATIOS = /^\d+( : \d+)*$/

/** Drag the handle after zone `index` by `deltaLogical` design-space pixels. */
async function dragHandle(page: Page, index: number, deltaLogical: number): Promise<void> {
  const handle = page.getByTestId('ratio-handle').nth(index)
  const box = await handle.boundingBox()
  if (!box) throw new Error('the ratio handle has no box')
  const scale = await page.evaluate(() =>
    Number((document.querySelector('[data-testid="stage-slide"]') as HTMLElement).dataset.scale),
  )
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + deltaLogical * scale, y, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(250)
}

/** Drag from the middle of `zone` by `dx`/`dy` design-space pixels. */
async function dragZone(page: Page, zone: ZoneRect, dx: number, dy: number): Promise<void> {
  const from = await slidePoint(page, zone.x + zone.w / 2, zone.y + zone.h / 2)
  const scale = await page.evaluate(() =>
    Number((document.querySelector('[data-testid="stage-slide"]') as HTMLElement).dataset.scale),
  )
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx * scale, from.y + dy * scale, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(250)
}

/** The ratios the inspector reports for the split the zones belong to. */
async function rootRatios(page: Page): Promise<string> {
  await page.getByTestId('zone-breadcrumb').getByRole('button', { name: 'Rot' }).click()
  return (await page.getByTestId('zone-ratios').textContent()) ?? ''
}

/**
 * How far the pointer has to travel for a gesture to ask for `weight` units of
 * a split's ratio, in design-space pixels.
 *
 * The zones share whatever is left of the split once its gaps are taken out, so
 * one unit of ratio is that length divided by the split's total.
 */
function travelFor(zones: ZoneRect[], weight: number, total: number, axis: 'x' | 'y'): number {
  const usable = zones.reduce((sum, zone) => sum + (axis === 'x' ? zone.w : zone.h), 0)
  return (weight / total) * usable
}

test.describe('zone editing', () => {
  test('splits the main zone and keeps exactly one gap', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Soner')
    await enterZoneMode(page)
    await splitSelected(page, [2, 3], 'x')

    const zones = await zoneRects(page)
    expect(zones).toHaveLength(2)
    expectGap(zones[1].x - (zones[0].x + zones[0].w), 'gap between siblings')
    expect(zones[1].w / zones[0].w).toBeCloseTo(1.5, 2)
    expect(guard.errors).toEqual([])
  })

  test('nests a split without introducing extra gap', async ({ page }) => {
    await createPresentation(page, 'Nesting')
    await enterZoneMode(page)
    await splitSelected(page, [2, 3], 'x')

    const [left, right] = await zoneRects(page)
    await clickZone(page, right)
    await splitSelected(page, [1, 2], 'y')

    const zones = await zoneRects(page)
    expect(zones).toHaveLength(3)
    const [l, topRight, bottomRight] = zones
    expectGap(topRight.x - (l.x + l.w), 'left to top-right')
    expectGap(bottomRight.x - (l.x + l.w), 'left to bottom-right')
    expectGap(bottomRight.y - (topRight.y + topRight.h), 'top-right to bottom-right')
    expect(bottomRight.h / topRight.h).toBeCloseTo(2, 1)
    expect(left.w).toBeCloseTo(l.w, 1)
  })

  test('selects the parent zone when clicking in the gap', async ({ page }) => {
    await createPresentation(page, 'Gap')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    const zones = await zoneRects(page)
    await clickZone(page, zones[0])
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot › 1')

    const gapCentre = zones[0].x + zones[0].w + G / 2
    await clickSlide(page, gapCentre, zones[0].y + 200)
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot')
  })

  test('navigates the hierarchy with the arrow keys', async ({ page }) => {
    await createPresentation(page, 'Navigasjon')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1, 1], 'x')

    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot › 1')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot › 2')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot › 3')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot › 1')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot › 3')
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot')
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('status-breadcrumb')).toHaveText('Rot')
  })

  test('allows any ratio while the zone is still empty', async ({ page }) => {
    // Nothing is drawn in either child yet, so no width is too narrow for
    // them: this is the gesture a sliver of deliberate air is made with, and
    // the dialog offers it in one step rather than making it unreachable.
    await createPresentation(page, 'Luftsone')
    await enterZoneMode(page)
    await page.getByTestId('inspector-action-split').click()
    await page.getByTestId('split-weight-0').fill('1')
    await page.getByTestId('split-weight-1').fill('60')
    await expect(page.getByTestId('split-invalid')).toHaveCount(0)
    await expect(page.getByTestId('split-apply')).toBeEnabled()

    await page.getByTestId('split-weight-1').fill('abc')
    await expect(page.getByTestId('split-apply')).toBeDisabled()
  })

  test('refuses a split that would leave the content in it too small a zone', async ({ page }) => {
    await createPresentation(page, 'For liten')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'titled-card')

    await enterZoneMode(page)
    await page.getByTestId('inspector-action-split').click()
    await page.getByTestId('split-weight-0').fill('1')
    await page.getByTestId('split-weight-1').fill('60')
    // The card travels into the first child, which at this ratio is a sliver.
    await expect(page.getByTestId('split-invalid')).toBeVisible()
    await expect(page.getByTestId('split-apply')).toBeDisabled()

    await page.getByTestId('split-weight-1').fill('2')
    await expect(page.getByTestId('split-apply')).toBeEnabled()
  })

  test('edits an existing split', async ({ page }) => {
    await createPresentation(page, 'Rediger splitting')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    // Selecting the parent again via the breadcrumb, then re-editing the split.
    await page.getByTestId('zone-breadcrumb').getByRole('button', { name: 'Rot' }).click()
    await page.getByTestId('inspector-action-split').click()
    await expect(page.getByTestId('split-modal')).toBeVisible()
    await page.getByTestId('split-count').fill('3')
    await page.getByTestId('split-apply').click()

    const zones = await zoneRects(page)
    expect(zones).toHaveLength(3)
    expectGap(zones[1].x - (zones[0].x + zones[0].w), 'first gap')
    expectGap(zones[2].x - (zones[1].x + zones[1].w), 'second gap')
  })

  test('deletes a zone and lets the sibling take the space', async ({ page }) => {
    await createPresentation(page, 'Slett sone')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    const before = await zoneRects(page)
    await clickZone(page, before[1])
    await page.getByTestId('inspector-action-delete').click()
    await page.getByTestId('confirm-accept').click()

    const after = await zoneRects(page)
    expect(after).toHaveLength(1)
    expect(after[0].w).toBeCloseTo(1600 - G * 2, 0)
  })

  test('clears a subtree back to a single empty zone', async ({ page }) => {
    await createPresentation(page, 'Tøm sone')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1, 1], 'x')
    await expect(await zoneRects(page)).toHaveLength(3)

    await page.getByTestId('zone-breadcrumb').getByRole('button', { name: 'Rot' }).click()
    await page.getByTestId('inspector-action-clear').click()
    await page.getByTestId('confirm-accept').click()

    expect(await zoneRects(page)).toHaveLength(1)
  })

  test('adjusts ratios by dragging the handle in the gap', async ({ page }) => {
    await createPresentation(page, 'Dra forhold')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    const before = await zoneRects(page)
    await dragHandle(page, 0, 160)

    const after = await zoneRects(page)
    expect(after[0].w).toBeGreaterThan(before[0].w + 100)
    expectGap(after[1].x - (after[0].x + after[0].w), 'gap after drag')
    // Released, the layout is a ratio somebody could have typed.
    await expect(page.getByTestId('zone-ratios')).toHaveText(WHOLE_RATIOS)
  })

  test('snaps a released drag to a whole ratio', async ({ page }) => {
    await createPresentation(page, 'Snapping')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    // Two thirds of the way across: 2 : 1 is on the ladder, and the pixels have
    // to agree with the number the inspector shows.
    const usable = 1600 - G * 2 - G
    await dragHandle(page, 0, usable / 6)
    await expect(page.getByTestId('zone-ratios')).toHaveText('2 : 1')
    const zones = await zoneRects(page)
    expect(zones[0].w / zones[1].w).toBeCloseTo(2, 1)
  })

  test('keeps untouched zones that shared a ratio sharing one', async ({ page }) => {
    await createPresentation(page, 'Like soner')
    await enterZoneMode(page)
    await splitSelected(page, [3, 5, 4, 4, 4], 'x')

    await dragHandle(page, 0, 60)
    await expect(page.getByTestId('zone-ratios')).toHaveText(WHOLE_RATIOS)

    const ratios = ((await page.getByTestId('zone-ratios').textContent()) ?? '')
      .split(':')
      .map((entry) => Number(entry.trim()))
    // The drag was between the first two zones; the three it never touched had
    // the same ratio before and have to have the same ratio after.
    expect(ratios[2]).toBe(ratios[3])
    expect(ratios[3]).toBe(ratios[4])
    const zones = await zoneRects(page)
    expect(zones[3].w).toBeCloseTo(zones[2].w, 1)
    expect(zones[4].w).toBeCloseTo(zones[2].w, 1)
  })

  /*
   * The ratio drag, said as a command.
   *
   * A drag on a boundary a few pixels wide is precise with a mouse and
   * impossible with a finger, so the same change has buttons — and they are
   * not a second implementation: both roads end in `setSplitWeights`, which
   * quantises the ratios and refuses a layout that would hide content.
   */
  test('changes ratios from the inspector without dragging', async ({ page }) => {
    await createPresentation(page, 'Forhold uten dra')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    await page.getByTestId('zone-weight-up-0').click()
    await expect(page.getByTestId('zone-ratios')).toHaveText('2 : 1')
    const wider = await zoneRects(page)
    expect(wider[0].w / wider[1].w).toBeCloseTo(2, 1)
    expectGap(wider[1].x - (wider[0].x + wider[0].w), 'gap after a ratio button')

    // Typed in directly, and quantised by the same rule.
    await page.getByTestId('zone-weight-1').fill('4')
    await expect(page.getByTestId('zone-ratios')).toHaveText('1 : 2')

    /*
     * A selected *child* is resized inside the split it belongs to, so the
     * controls follow the selection rather than needing the split reselected.
     *
     * One step up from 1 : 2 asks for 2 : 2, and what gets stored is 1 : 1 —
     * the quantiser is the same one the drag goes through, so a button can no
     * more write an unreduced ratio than a gesture can.
     */
    const zones = await zoneRects(page)
    await clickZone(page, zones[0])
    await expect(page.getByTestId('zone-size-grow')).toBeVisible()
    await page.getByTestId('zone-size-grow').click()
    await expect(page.getByTestId('zone-ratios')).toHaveText('1 : 1')
    const equal = await zoneRects(page)
    expect(equal[0].w).toBeCloseTo(equal[1].w, 1)
  })

  test('takes decimal ratios in the dialog and stores whole ones', async ({ page }) => {
    await createPresentation(page, 'Desimaler')
    await enterZoneMode(page)
    await page.getByTestId('inspector-action-split').click()
    await page.getByTestId('split-weight-0').fill('0.5')
    await page.getByTestId('split-weight-1').fill('1.5')
    // The dialog says what it is about to store, before it stores it.
    await expect(page.getByTestId('split-quantized')).toContainText('1 : 3')
    await page.getByTestId('split-apply').click()
    await expect(page.getByTestId('split-modal')).toBeHidden()

    await page.getByTestId('zone-breadcrumb').getByRole('button', { name: 'Rot' }).click()
    await expect(page.getByTestId('zone-ratios')).toHaveText('1 : 3')
    const zones = await zoneRects(page)
    expect(zones[1].w / zones[0].w).toBeCloseTo(3, 1)
  })

  test('resizes a zone about its own centre when dragged across its row', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Symmetrisk')
    await enterZoneMode(page)
    await splitSelected(page, [3, 2, 3], 'x')

    const before = await zoneRects(page)
    const centre = before[1].x + before[1].w / 2
    // Up is bigger: two units of an eight-unit ratio takes 3 : 2 : 3 to 1 : 2 : 1.
    await dragZone(page, before[1], 0, -travelFor(before, 2, 8, 'x'))

    const after = await zoneRects(page)
    expect(after[1].w).toBeGreaterThan(before[1].w)
    // Symmetric: both neighbours gave up the same room, so the zone has not moved.
    expect(after[1].x + after[1].w / 2).toBeCloseTo(centre, 0)
    expect(after[0].w).toBeCloseTo(after[2].w, 0)
    expect(await rootRatios(page)).toBe('1 : 2 : 1')
    expect(guard.errors).toEqual([])
  })

  test('shrinks a zone dragged the other way across its row', async ({ page }) => {
    await createPresentation(page, 'Symmetrisk mindre')
    await enterZoneMode(page)
    await splitSelected(page, [2, 4, 2], 'x')

    const before = await zoneRects(page)
    await dragZone(page, before[1], 0, travelFor(before, 2, 8, 'x'))

    const after = await zoneRects(page)
    expect(after[1].w).toBeLessThan(before[1].w)
    expect(after[0].w).toBeCloseTo(after[2].w, 0)
    expect(await rootRatios(page)).toBe('3 : 2 : 3')
  })

  test('moves a zone along its row without resizing it', async ({ page }) => {
    await createPresentation(page, 'Forskyvning')
    await enterZoneMode(page)
    await splitSelected(page, [2, 3, 3], 'x')

    const before = await zoneRects(page)
    await dragZone(page, before[1], travelFor(before, 1, 8, 'x'), 0)

    const after = await zoneRects(page)
    // The zone kept its size and took its room from the side it moved towards.
    expect(after[1].w).toBeCloseTo(before[1].w, 0)
    expect(after[1].x).toBeGreaterThan(before[1].x + 100)
    expect(after[0].w).toBeGreaterThan(before[0].w)
    expect(after[2].w).toBeLessThan(before[2].w)
    expectGap(after[1].x - (after[0].x + after[0].w), 'gap after moving a zone')
    expect(await rootRatios(page)).toBe('3 : 3 : 2')
  })

  test('resizes a zone in a column by dragging across it, a quarter turn round', async ({
    page,
  }) => {
    await createPresentation(page, 'Kolonne')
    await enterZoneMode(page)
    await splitSelected(page, [3, 2, 3], 'y')

    const before = await zoneRects(page)
    const centre = before[1].y + before[1].h / 2
    // Right is bigger in a column where up was bigger in a row.
    await dragZone(page, before[1], travelFor(before, 2, 8, 'y'), 0)

    const after = await zoneRects(page)
    expect(after[1].h).toBeGreaterThan(before[1].h)
    expect(after[1].y + after[1].h / 2).toBeCloseTo(centre, 0)
    expect(after[0].h).toBeCloseTo(after[2].h, 0)
    expect(await rootRatios(page)).toBe('1 : 2 : 1')
  })

  test('moves a zone down its column without resizing it', async ({ page }) => {
    await createPresentation(page, 'Forskyvning i kolonne')
    await enterZoneMode(page)
    await splitSelected(page, [2, 3, 3], 'y')

    const before = await zoneRects(page)
    await dragZone(page, before[1], 0, travelFor(before, 1, 8, 'y'))

    const after = await zoneRects(page)
    expect(after[1].h).toBeCloseTo(before[1].h, 0)
    expect(after[1].y).toBeGreaterThan(before[1].y + 40)
    expect(after[0].h).toBeGreaterThan(before[0].h)
    expect(after[2].h).toBeLessThan(before[2].h)
    expectGap(after[1].y - (after[0].y + after[0].h), 'gap after moving a zone in a column')
    expect(await rootRatios(page)).toBe('3 : 3 : 2')
  })

  /*
   * The regression: everything drawn on top of a zone used to swallow the press
   * that starts these gestures. The action toolbar took the pointer across its
   * whole box — padding, the space between its two rows and all — and a picture
   * handed the press to the browser's own image drag, so the zones an author
   * most wanted to arrange were the ones that would not move.
   */
  test('drags a zone from under its own toolbar', async ({ page }) => {
    await createPresentation(page, 'Under verktøylinja')
    await enterZoneMode(page)
    await splitSelected(page, [3, 2, 3], 'x')

    const before = await zoneRects(page)
    await clickZone(page, before[1])
    await expect(page.locator('.zone-actions')).toBeVisible()

    // A point the toolbar covers that is not one of its buttons: the press has
    // to reach the zone underneath it.
    const spot = await page.evaluate(() => {
      const actions = document.querySelector('.zone-actions') as HTMLElement
      const box = actions.getBoundingClientRect()
      for (let y = box.top + 2; y < box.bottom - 2; y += 3) {
        for (let x = box.left + 2; x < box.right - 2; x += 3) {
          const element = document.elementFromPoint(x, y)
          if (element && !element.closest('button')) return { x, y }
        }
      }
      return null
    })
    expect(spot, 'the toolbar has room that is not a button').not.toBeNull()
    if (!spot) return

    const scale = await page.evaluate(() =>
      Number((document.querySelector('[data-testid="stage-slide"]') as HTMLElement).dataset.scale),
    )
    await page.mouse.move(spot.x, spot.y)
    await page.mouse.down()
    await page.mouse.move(spot.x, spot.y - travelFor(before, 2, 8, 'x') * scale, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(250)

    const after = await zoneRects(page)
    expect(after[1].w).toBeGreaterThan(before[1].w)
    expect(await rootRatios(page)).toBe('1 : 2 : 1')
  })

  test('drags a zone a picture fills', async ({ page }) => {
    await createPresentation(page, 'Bildesone')
    await enterZoneMode(page)
    await splitSelected(page, [3, 2, 3], 'x')

    await enterContentMode(page)
    const zones = await zoneRects(page)
    await stage(page)
      .locator(`.slide-zone[data-node-id="${zones[1].id}"] [data-testid="empty-zone-image"]`)
      .click()
    await expect(page.getByTestId('image-modal')).toBeVisible()
    await page.getByTestId('image-input').setInputFiles({
      name: 'flate.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })
    await expect(page.getByTestId('image-modal')).toBeHidden()
    await enterZoneMode(page)

    const before = await zoneRects(page)
    // The middle of the picture, which is where a hand naturally lands.
    await dragZone(page, before[1], 0, -travelFor(before, 2, 8, 'x'))

    const after = await zoneRects(page)
    expect(after[1].w).toBeGreaterThan(before[1].w)
    expect(await rootRatios(page)).toBe('1 : 2 : 1')
  })

  test('resizes a zone at the end of its split into its one neighbour', async ({ page }) => {
    await createPresentation(page, 'Ytterste sone')
    await enterZoneMode(page)
    await splitSelected(page, [2, 3, 3], 'x')

    const before = await zoneRects(page)
    // The first zone's outer edge is the split's own, so the whole change lands
    // on the other side: 2 : 3 : 3 grown by two units is 4 : 2 : 2.
    await dragZone(page, before[0], 0, -travelFor(before, 2, 8, 'x'))

    const after = await zoneRects(page)
    expect(after[0].w).toBeGreaterThan(before[0].w)
    expect(after[1].w).toBeCloseTo(after[2].w, 0)
    expect(await rootRatios(page)).toBe('2 : 1 : 1')
  })

  test('resizes either zone of a split in two, where both are end zones', async ({ page }) => {
    await createPresentation(page, 'To soner')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')

    const before = await zoneRects(page)
    await dragZone(page, before[0], 0, -travelFor(before, 0.5, 2, 'x'))
    expect(await rootRatios(page)).toBe('3 : 1')

    const grown = await zoneRects(page)
    expect(grown[0].w).toBeGreaterThan(before[0].w)
    expectGap(grown[1].x - (grown[0].x + grown[0].w), 'gap after resizing an end zone')

    // And the same gesture the other way round on the other end zone.
    await dragZone(page, grown[1], 0, -travelFor(grown, 1, 4, 'x'))
    const shared = await zoneRects(page)
    expect(shared[1].w).toBeGreaterThan(grown[1].w)
    expect(await rootRatios(page)).toBe('1 : 1')
  })

  test('cannot move a zone the split’s own edge holds in place', async ({ page }) => {
    await createPresentation(page, 'Ingen plass bak')
    await enterZoneMode(page)
    await splitSelected(page, [2, 3, 3], 'x')

    const before = await zoneRects(page)
    // There is nothing behind a first zone to open a space, and nothing to take
    // the space it would leave, so sideways it stands still.
    await dragZone(page, before[0], travelFor(before, 1, 8, 'x'), 0)
    await dragZone(page, before[0], -travelFor(before, 1, 8, 'x'), 0)

    const after = await zoneRects(page)
    for (let index = 0; index < before.length; index += 1) {
      expect(after[index].w).toBeCloseTo(before[index].w, 1)
      expect(after[index].x).toBeCloseTo(before[index].x, 1)
    }
    expect(await rootRatios(page)).toBe('2 : 3 : 3')
  })

  test('undoes a whole zone drag in one step', async ({ page }) => {
    await createPresentation(page, 'Angre soneflytting')
    await enterZoneMode(page)
    await splitSelected(page, [3, 2, 3], 'x')

    const before = await zoneRects(page)
    await dragZone(page, before[1], 0, -travelFor(before, 2, 8, 'x'))
    expect(await rootRatios(page)).toBe('1 : 2 : 1')

    await page.getByTestId('undo').click()
    expect(await rootRatios(page)).toBe('3 : 2 : 3')
    await page.getByTestId('redo').click()
    expect(await rootRatios(page)).toBe('1 : 2 : 1')
  })

  test('rescues the text a picture displaces instead of throwing it away', async ({ page }) => {
    await createPresentation(page, 'Beholdertype')
    await enterContentMode(page)
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'container')
    await stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .tiptap`).click()
    await page.keyboard.type('Tekst som ikke skal forsvinne')

    await enterZoneMode(page)
    await clickZone(page, zones[0])

    // Filling the zone with a picture is a real replacement, and the text it
    // displaces lands in the sandbox rather than being thrown away.
    await page.getByTestId('inspector-action-image').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'figur.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(SVG),
    })
    await expect(stage(page).locator('img.image-panel__img')).toBeVisible()
    await expect(stage(page)).not.toContainText('Tekst som ikke skal forsvinne')
    await page.getByTestId('open-sandbox').click()
    await expect(
      page.getByTestId('sandbox-window').getByText('Tekst som ikke skal forsvinne'),
    ).toHaveCount(1)
  })

  test('divides a container into subfields with its own dividers', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Beholder med subfelt')
    await enterContentMode(page)
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'container')
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Første felt')

    await enterZoneMode(page)
    await clickZone(page, zones[0])
    await page.getByTestId('subfield-count').fill('3')
    await expect(stage(page).locator('.subfield')).toHaveCount(3)
    await expect(stage(page).locator('.subfield-divider')).toHaveCount(2)

    // The divider follows the text the background dictates, not a card palette.
    const divider = await stage(page)
      .locator('.subfield-divider')
      .first()
      .evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(divider).toBe('rgba(255, 255, 255, 0.28)')

    await enterContentMode(page)
    const fields = stage(page).locator('.subfield .tiptap')
    await fields.nth(2).click()
    await page.keyboard.type('Tredje felt')

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(stage(page)).toContainText('Første felt')
    await expect(stage(page)).toContainText('Tredje felt')
    expect(guard.errors).toEqual([])
  })

  test('lays subfields side by side, in the ratio the inspector asks for', async ({ page }) => {
    // The editor half of the subfield layout an agent reaches through
    // `adjust_subfields`: same commands, same guard, and here measured on the
    // real DOM rather than the estimator.
    const guard = watchForErrors(page)
    await createPresentation(page, 'Subfeltretning')
    await enterContentMode(page)
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')

    await enterZoneMode(page)
    await clickZone(page, zones[0])
    await page.getByTestId('subfield-count').fill('2')
    await expect(stage(page).locator('.subfield')).toHaveCount(2)

    // Stacked by default: one column, two rows.
    const stacked = await subfieldBoxes(page)
    expect(Math.abs(stacked[0].x - stacked[1].x)).toBeLessThan(1)
    expect(stacked[1].y).toBeGreaterThan(stacked[0].y + stacked[0].height - 1)

    await page.getByTestId('subfield-axis-x').click()
    const columns = await subfieldBoxes(page)
    expect(Math.abs(columns[0].y - columns[1].y)).toBeLessThan(1)
    expect(columns[1].x).toBeGreaterThan(columns[0].x + columns[0].width - 1)
    expect(Math.abs(columns[0].width - columns[1].width)).toBeLessThan(1)

    // Three to one, measured rather than asserted from the stored number.
    await page.getByTestId('subfield-weight-0').fill('3')
    await expect
      .poll(async () => {
        const boxes = await subfieldBoxes(page)
        return Math.round((boxes[0].width / boxes[1].width) * 10) / 10
      })
      .toBe(3)

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    const reloaded = await subfieldBoxes(page)
    expect(Math.abs(reloaded[0].y - reloaded[1].y)).toBeLessThan(1)
    expect(reloaded[0].width / reloaded[1].width).toBeGreaterThan(2.8)
    expect(guard.errors).toEqual([])
  })

  test('follows the zone being edited in content mode', async ({ page }) => {
    await createPresentation(page, 'Sonepanel')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')
    await enterContentMode(page)
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await addContentToZone(page, zones[1].id, 'untitled-card')

    // Select the right zone in zone mode, then edit the left one.
    await enterZoneMode(page)
    await clickZone(page, zones[1])
    await enterContentMode(page)
    await stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .tiptap`).first().click()

    // The panel is about the zone the caret is in, not the one selected before.
    // Compared to within a pixel: the panel rounds the geometry engine's own
    // number and the fixture rounds a measurement of the scaled DOM, so a zone
    // that lands on a half pixel can round the two different ways.
    const reported = await page.getByTestId('inspector').textContent()
    const size = /(\d+) × (\d+) px/.exec(reported ?? '')
    expect(size, 'the panel reports a size').not.toBeNull()
    expect(Math.abs(Number(size?.[1]) - zones[0].w)).toBeLessThanOrEqual(1)
    expect(Math.abs(Number(size?.[2]) - zones[0].h)).toBeLessThanOrEqual(1)
  })

  test('moves content to the sandbox and places it back', async ({ page }) => {
    await createPresentation(page, 'Sandkasse')
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')
    await enterContentMode(page)

    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')
    await stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .subfield .tiptap`).click()
    await page.keyboard.type('Innhold som skal reddes')

    await enterZoneMode(page)
    await clickZone(page, zones[0])
    await page.getByTestId('inspector-action-sandbox').click()
    await expect(page.getByTestId('sandbox-window')).toBeVisible()
    await expect(page.getByTestId('sandbox-item')).toHaveCount(1)
    await expect(page.getByTestId('sandbox-window').getByText('Innhold som skal reddes')).toHaveCount(1)
  })
})

/** Every subfield's box on the stage, in viewport pixels, in document order. */
async function subfieldBoxes(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }[]> {
  return stage(page)
    .locator('.subfield')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }),
    )
}
