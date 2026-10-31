import { expect, test } from './fixtures'
import { createPresentation, presentedPage, watchForErrors } from './helpers'

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
  test('viser Del rett før Vis, men avslått', { tag: '@pr' }, async ({ page }) => {
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

    // Forsiden og den ene sliden — og ingen QR-side, som er poenget her.
    await page.getByTestId('present').click()
    await expect.poll(() => presentedPage(page)).toEqual({ index: 2, count: 2 })
    await page.keyboard.press('Escape')

    expect(guard.errors).toEqual([])
  })

  test('en delingsadresse som ikke finnes gir ingen presentasjon', { tag: '@pr' }, async ({ page }) => {
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

/**
 * En avkortet eller feilskrevet delingslenke tilhører fortsatt den som fikk
 * den. Den skal aldri lande på eierens innlogging, og den skal besvares uten å
 * spørre delings-endepunktet om en adresse som umulig kan være et token.
 */
test.describe('ødelagte delingsadresser', () => {
  for (const path of ['/s/abc', '/s/3f2a1b0c-1111', '/s/', '/s']) {
    test(`«${path}» blir på den offentlige siden`, async ({ page }) => {
      const shareCalls: string[] = []
      page.on('request', (request) => {
        if (request.url().includes('slaids-share')) shareCalls.push(request.url())
      })

      await page.goto(path)

      await expect(page.getByTestId('shared-not-found')).toBeVisible()
      await expect(page.getByTestId('shared-not-found')).toContainText(
        'Denne delingslenken er ikke aktiv',
      )
      // Ingen innlogging, ingen editor, ingen bibliotek.
      await expect(page.getByTestId('sign-in-password')).toHaveCount(0)
      await expect(page.getByTestId('auth-loading')).toHaveCount(0)
      await expect(page.getByTestId('editor')).toHaveCount(0)
      await expect(page.getByTestId('presentation-grid')).toHaveCount(0)
      // Og ingen henvendelse til delings-endepunktet.
      expect(shareCalls).toEqual([])
    })
  }
})

/**
 * Deling av en mappe, i lokal modus: knappen ligger under mappens
 * søppelkasseknapp, popoveren åpner seg og sier hvorfor den ikke kan dele, og
 * en mappeadresse – også en ødelagt – blir på den offentlige siden.
 */
test.describe('deling av mapper i lokal modus', () => {
  test('knappen står synlig på mapperaden og er avslått med en forklaring', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'I en mappe')
    await page.getByTestId('back-to-library').click()

    page.once('dialog', (dialog) => void dialog.accept('Kurs'))
    await page.getByTestId('new-folder').click()

    // Delingen er en tilstand og står derfor synlig, på samme rad som mappen og
    // foran menyen med resten.
    const more = page.getByRole('button', { name: 'Flere handlinger for mappen Kurs' })
    const share = page.getByTestId('share-folder')
    await expect(share).toBeVisible()
    const [moreBox, shareBox] = await Promise.all([more.boundingBox(), share.boundingBox()])
    if (!moreBox || !shareBox) throw new Error('Kunne ikke måle mappeknappene.')
    expect(Math.abs(shareBox.y + shareBox.height / 2 - (moreBox.y + moreBox.height / 2))).toBeLessThanOrEqual(1)
    expect(shareBox.x + shareBox.width).toBeLessThanOrEqual(moreBox.x + 1)

    await share.click()
    const toggle = page.getByTestId('toggle-folder-share')
    await expect(toggle).toBeVisible()
    await expect(toggle).toBeDisabled()
    await expect(toggle).toHaveAttribute('data-state', 'unsupported')
    await expect(page.getByTestId('folder-share-popover')).toContainText('Deling krever Supabase')
    await expect(page.getByTestId('folder-share-link')).toHaveCount(0)

    expect(guard.errors).toEqual([])
  })

  for (const path of ['/s/f/abc', '/s/f/', '/s/f']) {
    test(`«${path}» blir på den offentlige siden`, async ({ page }) => {
      const shareCalls: string[] = []
      page.on('request', (request) => {
        if (request.url().includes('slaids-share')) shareCalls.push(request.url())
      })

      await page.goto(path)

      await expect(page.getByTestId('shared-not-found')).toBeVisible()
      await expect(page.getByTestId('sign-in-password')).toHaveCount(0)
      await expect(page.getByTestId('presentation-grid')).toHaveCount(0)
      await expect(page.getByTestId('editor')).toHaveCount(0)
      expect(shareCalls).toEqual([])
    })
  }
})
