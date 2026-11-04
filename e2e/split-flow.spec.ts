import { expect, test, type Page } from './fixtures'
import {
  addContentToZone,
  closeSplitDialog,
  createPresentation,
  enterZoneMode,
  nestedContentDeck,
  openSplitDialog,
  splitSelected,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'

/**
 * The split dialog as a safe, legible change (zone-editing plan, Z2), in a real
 * browser against real content:
 *
 *  - a lower count says which zones go and how much content is in their whole
 *    subtrees; that content is rescued to the sandbox by default, and deleting
 *    it is asked about once more, with the count;
 *  - «Bruk» is one undoable change, and Avbryt or Escape leaves the deck as it
 *    was;
 *  - a field and its zone in the picture are named and marked together;
 *  - what the command would refuse or move is said before «Bruk», from a dry
 *    run of that command against the content on the slide.
 */

const sandboxCount = (page: Page) => page.getByTestId('sandbox-count')
const cards = (page: Page) => stage(page).locator('[data-content-kind]')

/** A titled card in the whole slide, its body `lines` paragraphs long. */
async function deckWithLongCard(page: Page, title: string, lines: number): Promise<void> {
  await createPresentation(page, title)
  const [zone] = await zoneRects(page)
  await addContentToZone(page, zone.id, 'titled-card')
  await stage(page).locator('.card-header .tiptap').click()
  await page.keyboard.type('Resultater')
  const body = stage(page).locator('.subfield .tiptap').first()
  await body.click()
  await expect(body).toBeFocused()
  for (let line = 1; line <= lines; line += 1) {
    await page.keyboard.insertText(`Linje ${line}: omsetningen økte i alle regioner dette kvartalet.`)
    if (line < lines) await page.keyboard.press('Enter')
  }
  await enterZoneMode(page)
}

test.describe('split dialog flow', () => {
  test(
    'removes zones with nested content to the sandbox in one undoable change',
    { tag: '@pr' },
    async ({ page }) => {
      const guard = watchForErrors(page)
      await nestedContentDeck(page, 'Fjerning')
      await expect(sandboxCount(page)).toHaveCount(0)
      await openSplitDialog(page)

      await page.getByTestId('split-count-decrease').click()
      await expect(page.getByTestId('split-count')).toHaveValue('2')
      const removed = page.getByTestId('split-removed')
      await expect(removed).toContainText('Sone 3 fjernes. 2 innholdselementer mister sonen sin.')
      await expect(removed).toContainText('Sone 3 inneholder 2 innholdselementer i 2 underordnede soner.')
      await expect(page.getByTestId('removed-to-sandbox')).toHaveAttribute('data-state', 'on')

      await page.getByTestId('split-apply').click()
      await expect(page.getByTestId('split-modal')).toBeHidden()
      expect(await zoneRects(page)).toHaveLength(2)
      await expect(sandboxCount(page)).toHaveText('2')
      await expect(cards(page)).toHaveCount(0)

      // One change: one undo puts the zones and the content back, one redo takes them again.
      await page.keyboard.press('Control+z')
      expect(await zoneRects(page)).toHaveLength(4)
      await expect(cards(page)).toHaveCount(2)
      await expect(sandboxCount(page)).toHaveCount(0)
      await page.keyboard.press('Control+Shift+z')
      expect(await zoneRects(page)).toHaveLength(2)
      await expect(sandboxCount(page)).toHaveText('2')

      // And that is what is stored.
      await waitForSaved(page)
      await page.reload()
      await expect(page.getByTestId('editor')).toBeVisible()
      await expect(sandboxCount(page)).toHaveText('2')
      expect(await zoneRects(page)).toHaveLength(2)
      expect(guard.errors).toEqual([])
    },
  )

  test('deletes content only after a second question that names the count', async ({ page }) => {
    await nestedContentDeck(page, 'Sletting')
    await openSplitDialog(page)
    await page.getByTestId('split-count').fill('2')
    await page.getByTestId('removed-delete').click()
    await page.getByTestId('split-apply').click()

    const confirm = page.getByTestId('confirm-dialog')
    await expect(confirm).toContainText('Slette 2 innholdselementer?')
    await expect(confirm.getByTestId('confirm-accept')).toHaveText('Slett 2 innholdselementer')
    // Saying no to the question keeps the draft and changes nothing.
    await confirm.getByRole('button', { name: 'Avbryt' }).click()
    await expect(confirm).toBeHidden()
    await expect(page.getByTestId('split-modal')).toBeVisible()
    expect(await zoneRects(page)).toHaveLength(4)
    await expect(cards(page)).toHaveCount(2)

    await page.getByTestId('split-apply').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('split-modal')).toBeHidden()
    expect(await zoneRects(page)).toHaveLength(2)
    await expect(cards(page)).toHaveCount(0)
    await expect(sandboxCount(page)).toHaveCount(0)

    await page.keyboard.press('Control+z')
    expect(await zoneRects(page)).toHaveLength(4)
    await expect(cards(page)).toHaveCount(2)
  })

  test('leaves the deck as it was on Avbryt and on Escape', async ({ page }) => {
    await nestedContentDeck(page, 'Avbryt')
    const before = await zoneRects(page)
    for (const close of ['Avbryt', 'Escape'] as const) {
      await openSplitDialog(page)
      await page.getByTestId('split-axis-y').click()
      await page.getByTestId('split-count').fill('2')
      await page.getByTestId('split-weight-0').fill('4')
      if (close === 'Escape') await closeSplitDialog(page)
      else await page.getByTestId('split-modal').getByRole('button', { name: 'Avbryt' }).click()
      await expect(page.getByTestId('split-modal')).toBeHidden()
      expect(await zoneRects(page), close).toEqual(before)
      await expect(cards(page)).toHaveCount(2)
      await expect(sandboxCount(page)).toHaveCount(0)
    }
  })

  test('marks a field and its zone together, and a click in the picture names the field', async ({ page }) => {
    await nestedContentDeck(page, 'Kobling')
    await openSplitDialog(page)
    const zone = (label: string) => page.getByTestId('split-preview').locator(`[data-preview-zone="${label}"]`)

    await page.getByTestId('split-weight-1').focus()
    await expect(zone('2')).toHaveAttribute('data-active', 'true')
    await expect(page.getByTestId('split-weight-row-1')).toHaveAttribute('data-active', 'true')
    await expect(zone('1')).not.toHaveAttribute('data-active', 'true')
    await page.getByTestId('split-weight-1').blur()

    await page.getByTestId('split-weight-row-0').hover()
    await expect(zone('1')).toHaveAttribute('data-active', 'true')

    // A click inside zone 3's kept subzone 3.2 names zone 3's field; the level
    // being edited stays the root.
    const box = (await zone('3').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.85)
    await expect(page.getByTestId('split-weight-2')).toBeFocused()
    await expect(zone('3')).toHaveAttribute('data-active', 'true')
    await expect(page.getByTestId('split-target')).toHaveText('Du redigerer: Rot')

    // Shares are of the room the zones share, and add up.
    await page.getByTestId('split-weight-2').fill('2')
    await expect(page.getByTestId('split-share-2')).toHaveText('50 %')
    await expect(page.getByTestId('split-quantized')).toContainText('Lagres som 1 : 1 : 2.')
    await page.getByTestId('split-equalize').click()
    await expect(page.getByTestId('split-share-2')).toHaveText('33 %')
  })

  test('names each unreadable field on the field, and keeps «Bruk» off', async ({ page }) => {
    await createPresentation(page, 'Feil')
    await enterZoneMode(page)
    await openSplitDialog(page)
    for (const [typed, message] of [
      ['', 'Skriv inn et forholdstall.'],
      ['abc', 'Skriv et tall, for eksempel 2 eller 1,5.'],
      ['0', 'Forholdstallet må være større enn 0.'],
      ['-2', 'Forholdstallet må være større enn 0.'],
    ] as const) {
      await page.getByTestId('split-weight-1').fill(typed)
      await expect(page.getByTestId('split-weight-error-1'), typed).toHaveText(message)
      await expect(page.getByTestId('split-weight-1')).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByTestId('split-apply')).toBeDisabled()
      await expect(page.getByTestId('split-preview').locator('[data-preview-zone]')).toHaveCount(0)
    }
    await page.getByTestId('split-weight-1').fill('1,5')
    await expect(page.getByTestId('split-weight-error-1')).toHaveCount(0)
    await expect(page.getByTestId('split-quantized')).toContainText('Lagres som 2 : 3, nærmeste hele forhold.')
    await expect(page.getByTestId('split-apply')).toBeEnabled()

    await page.getByTestId('split-count').fill('11')
    await expect(page.getByTestId('split-count-error')).toHaveText('Velg et helt tall fra 2 til 10.')
    await expect(page.getByTestId('split-apply')).toBeDisabled()
    // Leaving the field keeps what was typed, and the reason, until it is corrected.
    await page.getByTestId('split-count').blur()
    await expect(page.getByTestId('split-count')).toHaveValue('11')
    await expect(page.getByTestId('split-count-error')).toBeVisible()
    await page.getByTestId('split-count').fill('3')
    await expect(page.getByTestId('split-count-error')).toHaveCount(0)
    await expect(page.getByTestId('split-weight-2')).toBeVisible()
    await expect(page.getByTestId('split-apply')).toBeEnabled()
  })

  test('says before «Bruk» that a new structure which would hide content is refused, but not a ratio', async ({
    page,
  }) => {
    await deckWithLongCard(page, 'Avslag', 3)
    await splitSelected(page, [1, 1], 'x')
    await expect(cards(page)).toHaveCount(1)
    await page.getByTestId('zone-breadcrumb').getByRole('button', { name: 'Rot' }).first().click()
    await openSplitDialog(page)

    // Another direction is another structure, and is held to the fit rule.
    await page.getByTestId('split-axis-y').click()
    await page.getByTestId('split-weight-1').fill('2')
    await expect(page.getByTestId('split-check')).toHaveText(
      'Innholdet får ikke plass med disse forholdstallene. Gjelder sone 1 (skravert).',
    )
    await expect(page.getByTestId('split-apply')).toBeDisabled()
    await expect(
      page.getByTestId('split-preview').locator('[data-preview-zone="1"]'),
    ).toHaveAttribute('data-too-small', 'true')

    // A ratio along the split's own direction is a resize by hand, as in the
    // zone menu: the card is drawn smaller rather than refused.
    await page.getByTestId('split-axis-x').click()
    await page.getByTestId('split-weight-1').fill('5')
    await expect(page.getByTestId('split-check')).toHaveCount(0)
    await expect(page.getByTestId('split-apply')).toBeEnabled()
    await page.getByTestId('split-apply').click()
    await expect(stage(page).locator('.zone-fit[data-fit-scale]')).toHaveCount(1)
  })

  test('says before «Bruk» where the content goes, and when it goes to the sandbox', async ({ page }) => {
    await deckWithLongCard(page, 'Innholdsmål', 6)
    await openSplitDialog(page)
    const line = page.getByTestId('split-content-line')
    const marked = page.getByTestId('split-preview').locator('[data-content-target]')
    const described = page.getByTestId('split-preview').locator('svg')

    // Nearly all the height: the card fits in zone 1, and the dialog says so.
    await page.getByTestId('split-axis-y').click()
    await page.getByTestId('split-weight-0').fill('10')
    await expect(line).toHaveText('Innholdet havner i sone 1.')
    await expect(marked).toHaveAttribute('data-preview-zone', '1')
    await expect(described).toHaveAttribute('aria-label', /Innholdet havner i sone 1\./)
    await expect(page.getByTestId('split-check')).toHaveCount(0)

    // Half the height is room enough for a card, but not for this one's text.
    await page.getByTestId('split-weight-0').fill('1')
    await page.getByTestId('split-content-target-1').click()
    await expect(page.getByTestId('split-invalid')).toHaveCount(0)
    await expect(page.getByTestId('split-check')).toHaveText(
      'Innholdet får ikke plass i sone 2, så det flyttes til sandkassen når du trykker «Bruk».',
    )
    // Then nothing else may claim a zone for it: not the caption, the picture or its description.
    await expect(line).toHaveCount(0)
    await expect(marked).toHaveCount(0)
    await expect(described).not.toHaveAttribute('aria-label', /Innholdet/)

    await page.getByTestId('split-apply').click()
    await expect(page.getByTestId('split-modal')).toBeHidden()
    await expect(sandboxCount(page)).toHaveText('1')
  })
})
