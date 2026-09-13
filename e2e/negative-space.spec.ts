/**
 * Deliberate air, and the picker that knows what a zone can hold.
 *
 * Two halves of one rule, exercised the way a person meets them: a zone made
 * small enough stops offering the content it could not draw, and says why; and
 * the one kind that has no minimum — negative space — is what is left, and
 * draws nothing once it is chosen.
 *
 * The third test is the overflow half: a card title that is too wide for its
 * header is rolled back where it is typed, which is the case the browser used
 * to report as fitting perfectly.
 */

import { expect, test } from './fixtures'
import {
  addContentToZone,
  createPresentation,
  enterZoneMode,
  splitSelected,
  stage,
  toast,
  watchForErrors,
  zoneRects,
} from './helpers'

/** The picker's button for one kind, inside one zone. */
function choice(page: Parameters<typeof stage>[0], nodeId: string, kind: string) {
  return stage(page).locator(`.slide-zone[data-node-id="${nodeId}"] [data-testid="empty-zone-${kind}"]`)
}

test.describe('negativt rom', () => {
  test('the picker drops what cannot be drawn as the zone shrinks', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Luft')
    await enterZoneMode(page)
    // Air, the point, air: the outer zones end up far too small for a card or
    // a line of text, which is exactly the composition the rule exists for.
    await splitSelected(page, [1, 10, 1], 'y')
    await page.getByTestId('mode-content').click()

    const zones = await zoneRects(page)
    const sliver = zones[0].id
    const middle = zones[1].id

    // The middle zone has room for everything.
    await expect(choice(page, middle, 'titled-card')).toBeEnabled()
    await expect(choice(page, middle, 'negative-space')).toBeEnabled()

    // The sliver has room for nothing that draws.
    for (const kind of ['container', 'untitled-card', 'titled-card', 'image', 'titled-image-card']) {
      await expect(choice(page, sliver, kind), kind).toBeDisabled()
    }
    await expect(choice(page, sliver, 'negative-space')).toBeEnabled()

    // And it says why, in the domain's own words.
    await expect(choice(page, sliver, 'titled-card')).toHaveAttribute(
      'title',
      /for liten for denne innholdstypen/,
    )

    expect(guard.errors).toEqual([])
  })

  test('air draws nothing and keeps the slide valid', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Luft som tegner ingenting')
    await enterZoneMode(page)
    await splitSelected(page, [1, 10, 1], 'y')
    await page.getByTestId('mode-content').click()

    const zones = await zoneRects(page)
    await choice(page, zones[0].id, 'negative-space').click()
    await page.waitForTimeout(200)

    const air = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] [data-content-kind]`)
    await expect(air).toHaveAttribute('data-content-kind', 'negative-space')
    // Nothing inside it: no fields, no picker, no placeholder.
    await expect(air.locator('*')).toHaveCount(0)
    // The picker is gone from that zone, because the zone is no longer empty.
    await expect(
      stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] [data-testid="empty-zone"]`),
    ).toHaveCount(0)

    expect(guard.errors).toEqual([])
  })

  test('rolls back a card title that runs out of its header', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Korttittel')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'titled-card')

    const header = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .card-header`)
    await header.locator('.tiptap').click()
    await page.keyboard.insertText('En korttittel som er alt for lang for headeren sin. '.repeat(6))

    await expect(toast(page, 'Tittelen får ikke plass')).toBeVisible()
    // Measured the way the fit gate measures it: the header is the box that
    // clips, and nothing inside it keeps its overflow to itself any more.
    const overflow = await header.evaluate(
      (element: HTMLElement) => element.scrollWidth - element.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
    expect(guard.errors).toEqual([])
  })
})
