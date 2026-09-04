import { expect, test } from './fixtures'
import {
  G,
  PROGRESS_HEIGHT,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  addContentToZone,
  clickZone,
  createPresentation,
  enterContentMode,
  enterZoneMode,
  expectGap,
  splitSelected,
  stage,
  titleRect,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'

/**
 * The golden path from the implementation plan: title, main x-split 2:3, right
 * column y-split 1:2, titled card with two subfields on the left, free text in
 * a transparent container top-right and an untitled card bottom-right.
 */
test('golden path slide keeps exactly one gap everywhere', async ({ page }, testInfo) => {
  const guard = watchForErrors(page)
  await createPresentation(page, 'Golden path')

  await page.locator('[data-testid="slide-title"] .tiptap').click()
  await page.keyboard.type('Golden path')

  await enterZoneMode(page)
  await splitSelected(page, [2, 3], 'x')
  const afterFirst = await zoneRects(page)
  await clickZone(page, afterFirst[1])
  await splitSelected(page, [1, 2], 'y')

  const [left, topRight, bottomRight] = await zoneRects(page)

  await enterContentMode(page)
  await addContentToZone(page, left.id, 'titled-card')
  await addContentToZone(page, topRight.id, 'container')
  await addContentToZone(page, bottomRight.id, 'untitled-card')

  // Two subfields in the left card.
  await enterZoneMode(page)
  await clickZone(page, left)
  await page.getByTestId('subfield-count').fill('2')
  await page.waitForTimeout(200)

  await enterContentMode(page)
  await stage(page).locator(`.slide-zone[data-node-id="${topRight.id}"] .tiptap`).click()
  await page.keyboard.type('Fritekst i beholderen.')
  await stage(page).locator(`.slide-zone[data-node-id="${left.id}"] .card-header .tiptap`).click()
  await page.keyboard.type('Venstre kort')
  const subfields = stage(page).locator(`.slide-zone[data-node-id="${left.id}"] .subfield .tiptap`)
  await expect(subfields).toHaveCount(2)
  await subfields.nth(0).click()
  await page.keyboard.type('Første bolk.')
  await subfields.nth(1).click()
  await page.keyboard.type('Andre bolk.')
  await stage(page)
    .locator(`.slide-zone[data-node-id="${bottomRight.id}"] .subfield .tiptap`)
    .click()
  await page.keyboard.type('Beskrivelse av innholdet.')

  // Geometry asserts against the real DOM.
  const title = await titleRect(page)
  const zones = await zoneRects(page)
  const [l, tr, br] = zones

  expect(title.x).toBeCloseTo(G, 0)
  expect(title.y).toBeCloseTo(G, 0)
  expectGap(l.x, 'slide edge to content (left)')
  expectGap(SLIDE_WIDTH - (tr.x + tr.w), 'slide edge to content (right)')
  // The bottom distance is one gap too — to the progress indicator, which is
  // flush with the slide edge on every slide.
  expectGap(SLIDE_HEIGHT - PROGRESS_HEIGHT - (l.y + l.h), 'content to progress bar (bottom)')
  expectGap(l.y - (title.y + title.h), 'title to main')
  expectGap(tr.x - (l.x + l.w), 'left to right')
  expectGap(br.x - (l.x + l.w), 'left to bottom-right (nesting adds no gap)')
  expectGap(br.y - (tr.y + tr.h), 'top-right to bottom-right')

  expect(tr.w / l.w).toBeCloseTo(1.5, 1)
  expect(br.h / tr.h).toBeCloseTo(2, 1)

  // Nothing escapes the slide and nothing overflows its zone.
  for (const zone of zones) {
    expect(zone.x).toBeGreaterThanOrEqual(-0.5)
    expect(zone.y).toBeGreaterThanOrEqual(-0.5)
    expect(zone.x + zone.w).toBeLessThanOrEqual(SLIDE_WIDTH + 0.5)
    expect(zone.y + zone.h).toBeLessThanOrEqual(SLIDE_HEIGHT + 0.5)
  }

  const overflow = await page.evaluate(() => {
    const stage = document.querySelector('[data-testid="stage-slide"]') as HTMLElement
    let worst = 0
    for (const element of stage.querySelectorAll<HTMLElement>('[data-fit-scroll]')) {
      worst = Math.max(
        worst,
        element.scrollHeight - element.clientHeight,
        element.scrollWidth - element.clientWidth,
      )
    }
    return worst
  })
  expect(overflow).toBeLessThanOrEqual(1)

  await waitForSaved(page)
  // Attached as an artifact rather than diffed: pixel baselines are only
  // meaningful in a fixed environment. See visual.spec.ts.
  await testInfo.attach('golden-path', {
    body: await stage(page).screenshot(),
    contentType: 'image/png',
  })
  expect(guard.errors).toEqual([])
})
