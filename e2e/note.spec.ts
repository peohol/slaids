/**
 * The note workflow, the way a person meets it.
 *
 * One scenario carries the whole feature, because the feature *is* a sequence:
 * compose the slide, reserve the zone the picture will occupy, write the prompt
 * into it, take the prompt away to make the picture, and bring the picture back
 * into the very same rectangle. The claim worth checking in a browser is that
 * the geometry the agent planned is the geometry the picture ends up with, and
 * that nothing in between was ever visible to an audience.
 *
 * The rest of the file is the two properties that make that safe: a note draws
 * nothing outside the editor, and a note zone small enough to be a sliver does
 * not drag the layout into being invalid.
 */

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  createPresentation,
  enterContentMode,
  enterZoneMode,
  splitSelected,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'

const PROMPT =
  'Fotorealistisk vitenskapelig rekonstruksjon av en voksen neandertaler i et paleolittisk europeisk landskap. ' +
  'Halvfigur, kroppen lett vendt mot kamera. Personen skal ligge hovedsakelig i venstre tredjedel. ' +
  'Stående komposisjon tilpasset denne sonens aspektforhold. Ingen tekst eller grafiske elementer.'

const BRIEF =
  'Alle bildene skal være fotorealistiske vitenskapelige rekonstruksjoner med naturlig dagslys, ' +
  'dokumentarisk uttrykk, dempet jordfargepalett og uten tekst, rammer eller infografiske elementer.'

/** A picture file small enough to paste into a test and obviously not a photo. */
const TEST_IMAGE =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 400">` +
  `<rect width="200" height="400" fill="#7a5c3e"/>` +
  `<circle cx="100" cy="140" r="52" fill="#c8a882"/>` +
  `</svg>`

function zone(page: Page, nodeId: string) {
  return stage(page).locator(`.slide-zone[data-node-id="${nodeId}"]`)
}

/** The handle a note zone shows in the editor, and nowhere else. */
function noteButton(page: Page, nodeId: string) {
  return zone(page, nodeId).getByTestId('open-note')
}

async function rectOf(page: Page, nodeId: string) {
  const rects = await zoneRects(page)
  const found = rects.find((entry) => entry.id === nodeId)
  if (!found) throw new Error(`Fant ikke sonen ${nodeId}`)
  return found
}

test.describe('notat og bildebrief', () => {
  test('reserves a picture’s rectangle, hides the prompt from the audience, and hands the zone over', async ({
    page,
  }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Menneskets evolusjon')

    /* 1. The deck's shared visual premise, written once and copied once. */
    await page.getByTestId('open-image-brief').click()
    await expect(page.getByTestId('image-brief-modal')).toBeVisible()
    /* Typed a character at a time rather than filled in one go. The field is
       controlled by what the command stored, so a command that normalised the
       value would eat every space as it was typed — and `fill` sets the whole
       string at once, which is exactly the gesture that cannot see it. */
    await page.getByTestId('image-brief-modal-text').pressSequentially(BRIEF)
    await expect(page.getByTestId('image-brief-modal-text')).toHaveValue(BRIEF)
    await page.getByTestId('image-brief-modal-copy').click()
    await expect(page.getByTestId('image-brief-modal-copy')).toContainText('Kopiert')
    await page.getByTestId('image-brief-modal').getByRole('button', { name: 'Lukk' }).click()
    await expect(page.getByTestId('image-brief-modal')).toBeHidden()

    /* 2. Compose the slide: text beside the rectangle the picture will occupy. */
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'x')
    await enterContentMode(page)
    const [textZone, pictureZone] = await zoneRects(page)
    await zone(page, textZone.id).getByTestId('empty-zone-untitled-card').click()

    /* 3. The picture's zone becomes a note rather than a bad placeholder. */
    await zone(page, pictureZone.id).getByTestId('empty-zone-note').click()
    await expect(noteButton(page, pictureZone.id)).toBeVisible()

    /* 4. The prompt goes in, and the note says what it is. */
    await noteButton(page, pictureZone.id).click()
    await expect(page.getByTestId('note-modal')).toBeVisible()
    await page.getByTestId('note-purpose-image-prompt').click()
    // Typed, for the reason the brief above is.
    await page.getByTestId('note-modal-text').pressSequentially(PROMPT)
    await expect(page.getByTestId('note-modal-text')).toHaveValue(PROMPT)
    await page.getByTestId('note-modal-copy').click()
    await expect(page.getByTestId('note-modal-copy')).toContainText('Kopiert')
    await page.getByTestId('note-modal').getByRole('button', { name: 'Lukk' }).click()
    await expect(noteButton(page, pictureZone.id)).toContainText('Bildeprompt')

    /* The rectangle the picture is supposed to get, measured before it exists. */
    const planned = await rectOf(page, pictureZone.id)

    /* 5. The audience sees a blank rectangle — no handle, no label, no text. */
    await page.getByTestId('present').click()
    await expect(page.getByTestId('present-view')).toBeVisible()
    const presentedNote = page
      .getByTestId('present-view')
      .locator('[data-content-kind="note"]')
    await expect(presentedNote).toHaveCount(1)
    await expect(presentedNote.locator('*')).toHaveCount(0)
    await expect(page.getByTestId('present-view')).not.toContainText('Bildeprompt')
    await expect(page.getByTestId('present-view')).not.toContainText('neandertaler')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('present-view')).toBeHidden()

    /* 6. The picture arrives and takes the zone the note was holding. */
    await enterZoneMode(page)
    await stage(page).locator(`.slide-zone[data-node-id="${pictureZone.id}"]`).click()
    await enterContentMode(page)
    await page.getByTestId('open-image').click()
    await expect(page.getByTestId('image-modal')).toBeVisible()
    await page.getByTestId('image-placement-zone').click()
    await page.getByTestId('image-input').setInputFiles({
      name: 'rekonstruksjon.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(TEST_IMAGE),
    })
    await expect(page.getByTestId('image-modal')).toBeHidden()

    /* 7. The zone tree is untouched and the picture has the planned rectangle. */
    await expect(zone(page, pictureZone.id).locator('img.image-panel__img')).toBeVisible()
    await expect(noteButton(page, pictureZone.id)).toHaveCount(0)
    expect(await rectOf(page, pictureZone.id)).toEqual(planned)

    /* And the prompt is not destroyed — it is parked, ready to be used again. */
    await page.getByTestId('open-sandbox').click()
    await expect(page.getByTestId('sandbox-item')).toHaveCount(1)
    await expect(page.getByTestId('sandbox-item')).toContainText('Bildeprompt')

    await waitForSaved(page)
    expect(guard.errors).toEqual([])
  })

  test('keeps the prompt across a reload, and keeps it out of the presented slide', async ({
    page,
  }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Notatet overlever')
    const [only] = await zoneRects(page)
    await zone(page, only.id).getByTestId('empty-zone-note').click()
    await noteButton(page, only.id).click()
    await page.getByTestId('note-modal-text').fill(PROMPT)
    await page.getByTestId('note-modal').getByRole('button', { name: 'Lukk' }).click()

    await page.getByTestId('open-image-brief').click()
    await page.getByTestId('image-brief-modal-text').fill(BRIEF)
    await page.getByTestId('image-brief-modal').getByRole('button', { name: 'Lukk' }).click()
    await waitForSaved(page)

    await page.reload()
    await expect(noteButton(page, only.id)).toBeVisible()
    await noteButton(page, only.id).click()
    await expect(page.getByTestId('note-modal-text')).toHaveValue(PROMPT)
    await page.getByTestId('note-modal').getByRole('button', { name: 'Lukk' }).click()

    await page.getByTestId('open-image-brief').click()
    await expect(page.getByTestId('image-brief-modal-text')).toHaveValue(BRIEF)
    await page.getByTestId('image-brief-modal').getByRole('button', { name: 'Lukk' }).click()

    expect(guard.errors).toEqual([])
  })

  test('a note in a sliver keeps the layout valid', async ({ page }) => {
    // A note has no minimum size, and the handle the editor draws must never
    // become one: it is chrome over the zone, not content laid out inside it.
    const guard = watchForErrors(page)
    await createPresentation(page, 'Smal notatsone')
    await enterZoneMode(page)
    await splitSelected(page, [1, 10, 1], 'y')
    await enterContentMode(page)

    const zones = await zoneRects(page)
    const sliver = zones[0]
    await zone(page, sliver.id).getByTestId('empty-zone-note').click()
    await expect(noteButton(page, sliver.id)).toBeVisible()

    // The zone did not grow to fit the button, and nothing scrolls out of it.
    expect(await rectOf(page, sliver.id)).toEqual(sliver)
    const spill = await zone(page, sliver.id)
      .locator('[data-content-kind="note"]')
      .evaluate((element: HTMLElement) => element.scrollHeight - element.clientHeight)
    expect(spill).toBeLessThanOrEqual(1)

    expect(guard.errors).toEqual([])
  })
})
