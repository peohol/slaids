import { expect, test } from './fixtures'
import { createPresentation, watchForErrors } from './helpers'

/**
 * The E2E suite runs in local mode: no `VITE_SUPABASE_*`, so Dexie, no sign-in
 * and — deliberately — no public backend to publish to.
 *
 * What is worth proving here is exactly that: the control is honest about it.
 * It is present, so nobody has to guess whether Slaids can share; it refuses to
 * be pressed, so no link is ever handed out that could not work; and no QR page
 * appears, because there is no address for it to point at. Sharing's happy path
 * needs a Supabase project and is verified against one.
 */
test.describe('deling i lokal modus', () => {
  test('viser Del rett før Vis, men avslått', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Uten Supabase')

    const toggle = page.getByTestId('toggle-share')
    await expect(toggle).toBeVisible()
    await expect(toggle).toBeDisabled()
    await expect(toggle).toHaveAttribute('data-state', 'unsupported')

    // Del hører hjemme rett før Vis i verktøylinjen.
    const order = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll('[data-testid="top-toolbar"] [data-testid]'),
      ).map((element) => element.getAttribute('data-testid'))
      return buttons.filter((id) => id === 'share-toggle' || id === 'present')
    })
    expect(order).toEqual(['share-toggle', 'present'])

    // Ingen lenke å kopiere, og ingen avledet QR-side.
    await expect(page.getByTestId('copy-share-link')).toHaveCount(0)
    await expect(page.getByTestId('filmstrip-qr')).toHaveCount(0)

    await page.getByTestId('present').click()
    await expect(page.getByTestId('present-counter')).toHaveText('1 / 1')
    await page.keyboard.press('Escape')

    expect(guard.errors).toEqual([])
  })

  test('en delingsadresse som ikke finnes gir ingen presentasjon', async ({ page }) => {
    // Direkte navigasjon til /s/<token>: SPA-ruten svarer, og svaret er at
    // lenken ikke er aktiv — aldri en presentasjon, og aldri editoren.
    await page.goto('/s/3f2a1b0c-1111-4222-8333-444455556666')

    await expect(page.getByTestId('shared-unavailable')).toBeVisible()
    await expect(page.getByTestId('editor')).toHaveCount(0)
    await expect(page.getByTestId('top-toolbar')).toHaveCount(0)
    await expect(page.getByTestId('filmstrip')).toHaveCount(0)
    await expect(page.getByTestId('presentation-grid')).toHaveCount(0)
  })
})
