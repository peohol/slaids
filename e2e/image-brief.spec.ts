/**
 * The image brief, as the author meets it.
 *
 * The dialog has two halves and the split is the point: the top is the only
 * text a person writes — the visual context every picture in the deck shares —
 * and the bottom lists the planned pictures, each with its own finished prompt
 * to copy. The per-picture copy is the errand: one clean order, pasted into an
 * empty conversation, that produces exactly that picture.
 *
 * A deck with nothing planned is the state most decks are in most of the time,
 * so it is the one tested here end to end: the context still saves and survives
 * a reload, the dialog says there is nothing to generate yet, and the
 * whole-plan brief does not offer to copy nothing. What a prompt *contains*
 * once pictures are planned is `src/domain/imagePlan.test.ts` and
 * `src/ui/editor/imageDeposit.test.tsx` — the planning itself is an agent
 * operation with no editor surface, and driving it through the UI would be
 * testing a fixture rather than the product.
 */

import { expect, test } from './fixtures'
import { createPresentation, waitForSaved, watchForErrors } from './helpers'

const CONTEXT =
  'Fotorealistiske rekonstruksjoner, naturlig dagslys, dempet jordfargepalett, ingen tekst i bildene.'

test.describe('bildebrief', () => {
  test('skriver den felles bildekonteksten, og den overlever en reload', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Menneskets evolusjon')

    await page.getByTestId('open-image-brief').click()
    const dialog = page.getByTestId('image-brief-modal')
    await expect(dialog).toBeVisible()

    const field = page.getByTestId('image-brief-modal-context')
    await field.fill(CONTEXT)
    await expect(page.getByTestId('image-brief-modal-context-count')).toContainText(
      `${CONTEXT.length} /`,
    )

    // Typing is what saves, exactly as typing into a zone is.
    await page.keyboard.press('Escape')
    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()

    await page.getByTestId('open-image-brief').click()
    await expect(page.getByTestId('image-brief-modal-context')).toHaveValue(CONTEXT)
    expect(guard.errors).toEqual([])
  })

  test('sier at det ikke er planlagt bilder ennå, i stedet for å tilby en tom brief', async ({
    page,
  }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Uten bilder')

    await page.getByTestId('open-image-brief').click()
    await expect(page.getByTestId('image-brief-modal-empty')).toBeVisible()
    await expect(page.getByTestId('image-brief-modal-text')).toBeHidden()
    await expect(page.getByTestId('image-brief-modal-count')).toContainText('Ingen bilder planlagt')
    // Nothing to copy, so nothing is offered: a copy button that copies an
    // empty message is worse than one that is plainly unavailable.
    await expect(page.getByTestId('image-brief-modal-copy')).toBeDisabled()
    // And no per-picture prompt either, because there is no picture.
    await expect(page.getByTestId('image-brief-modal-list')).toHaveCount(0)
    expect(guard.errors).toEqual([])
  })
})
