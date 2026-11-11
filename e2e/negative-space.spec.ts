/**
 * Deliberate air, and the picker that knows what a zone can hold.
 *
 * Two halves of one rule, exercised the way a person meets them: a zone made
 * small enough stops offering the content it could not draw, and says why; and
 * the one kind that has no minimum — negative space — is what is left, and
 * draws nothing once it is chosen.
 *
 * A zone that holds something is the other side of the same rule: air has no
 * payload, so it is not offered until the zone is emptied.
 *
 * The last test is the overflow half: a card title that is too wide for its
 * header is set smaller where it is typed, which is the case the browser used
 * to report as fitting perfectly.
 */

import { expect, test } from './fixtures'
import {
  addContentToZone,
  clickZone,
  createPresentation,
  enterZoneMode,
  slidePoint,
  splitSelected,
  stage,
  watchForErrors,
  zoneRects,
  openInspectorKindMenu,
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

  test('empties air again, from the panel and from the menu, without a detour through the sandbox', async ({
    page,
  }) => {
    // A sliver has room for air and nothing else, so converting it is no way
    // back to the picker; and the root cannot be deleted. «Tøm sone» is the way.
    const guard = watchForErrors(page)
    await createPresentation(page, 'Luft tilbake')
    await enterZoneMode(page)
    await splitSelected(page, [1, 10, 1], 'y')
    await page.getByTestId('mode-content').click()
    const [sliver] = await zoneRects(page)
    await choice(page, sliver.id, 'negative-space').click()
    const air = (nodeId: string) =>
      stage(page).locator(`.slide-zone[data-node-id="${nodeId}"] [data-content-kind="negative-space"]`)
    await expect(air(sliver.id)).toHaveCount(1)

    await enterZoneMode(page)
    await clickZone(page, sliver)
    await page.getByTestId('inspector-action-clear').click()
    const dialog = page.getByTestId('confirm-dialog')
    await expect(dialog).toContainText('Sonen blir tom.')
    await expect(page.getByTestId('confirm-alternative')).toHaveCount(0)
    await page.getByTestId('confirm-accept').click()
    await expect(air(sliver.id)).toHaveCount(0)
    await page.getByTestId('mode-content').click()
    await expect(choice(page, sliver.id, 'negative-space')).toBeEnabled()

    // A split of nothing but empty zones and air: nothing to rescue either.
    await enterZoneMode(page)
    await page.getByTestId('zone-breadcrumb').getByRole('button', { name: 'Rot' }).click()
    await page.getByTestId('inspector-action-clear').click()
    await expect(dialog).toContainText('Delingen fjernes, og sonen blir tom.')
    await expect(page.getByTestId('confirm-alternative')).toHaveCount(0)
    await page.getByTestId('confirm-accept').click()

    // Now the root itself is air, which has no «Slett sone»: the zone menu empties it.
    await page.getByTestId('mode-content').click()
    const [root] = await zoneRects(page)
    await choice(page, root.id, 'negative-space').click()
    await expect(air(root.id)).toHaveCount(1)
    await enterZoneMode(page)
    const centre = await slidePoint(page, root.x + root.w / 2, root.y + root.h / 2)
    await page.mouse.click(centre.x, centre.y, { button: 'right' })
    await page.getByTestId('menu-clear').click()
    await page.getByTestId('confirm-accept').click()
    await expect(air(root.id)).toHaveCount(0)

    // Air had nothing in it, so nothing was parked anywhere.
    await expect(page.getByTestId('sandbox-count')).toHaveCount(0)
    expect(guard.errors).toEqual([])
  })

  test('will not offer air for a zone that has something to lose', async ({ page }) => {
    // The other half of «the picker knows what fits»: air has no payload, so a
    // zone with text in it cannot become one until it is emptied. The picker
    // says so instead of offering a click that fails.
    const guard = watchForErrors(page)
    await createPresentation(page, 'Luft med innhold')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'untitled-card')

    const field = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .subfield .tiptap`)
    await field.click()
    await page.keyboard.insertText('Noe som ikke skal forsvinne i stillhet')

    await enterZoneMode(page)
    const kinds = await openInspectorKindMenu(page)
    await expect(kinds.getByTestId('menu-kind-negative-space')).toHaveAttribute('aria-disabled', 'true')
    // Everything the zone has room for is still on offer, including the kind
    // it already is — only the one that would throw the text away is not.
    await expect(kinds.getByTestId('menu-kind-titled-card')).not.toHaveAttribute('aria-disabled', 'true')
    await expect(kinds.getByTestId('menu-kind-untitled-card')).not.toHaveAttribute('aria-disabled', 'true')
    expect(guard.errors).toEqual([])
  })

  test('draws a card title that runs out of its header smaller', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Korttittel')
    const zones = await zoneRects(page)
    await addContentToZone(page, zones[0].id, 'titled-card')

    const header = stage(page).locator(`.slide-zone[data-node-id="${zones[0].id}"] .card-header`)
    await header.locator('.tiptap').click()
    await page.keyboard.insertText('En korttittel som er alt for lang for headeren sin. '.repeat(6))

    // Tatt imot, og bare tittelen tegnes mindre i stedet for at den avvises.
    await expect(stage(page).locator('.zone-fit[data-title-fit]')).toHaveCount(1)
    await expect(stage(page).locator('.zone-fit[data-fit-scale]')).toHaveCount(0)
    await expect(page.getByTestId('toast')).toHaveCount(0)
    // Measured the way the fit gate measures it: the header is the box that
    // clips, and nothing inside it keeps its overflow to itself any more.
    const overflow = await header.evaluate(
      (element: HTMLElement) => element.scrollWidth - element.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
    expect(guard.errors).toEqual([])
  })
})
