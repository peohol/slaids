import { expect, test } from './fixtures'
import { chooseFolderAction, choosePresentationAction, createPresentation, toast, watchForErrors } from './helpers'

test.describe('presentation library', () => {
  test('runs in local mode without a sign-in gate, and says so', async ({ page }) => {
    // No Supabase configuration in this build: the library is reachable straight
    // away, and the footer describes the browser storage it actually uses.
    await page.goto('/')
    await expect(page.getByTestId('presentation-grid')).toBeVisible()
    await expect(page.getByTestId('sign-in')).toHaveCount(0)
    await expect(page.getByTestId('sign-out')).toHaveCount(0)
    await expect(page.getByTestId('library-footer')).toContainText(/lokalt|nettleseren/i)
  })

  test('creates, opens and lists a presentation', async ({ page }) => {
    const guard = watchForErrors(page)
    await page.goto('/')
    await expect(page.getByTestId('presentation-grid')).toBeVisible()
    await expect(page.getByTestId('presentation-card')).toHaveCount(0)

    await page.getByTestId('new-presentation').click()
    await expect(page.getByTestId('new-presentation-modal')).toBeVisible()
    await expect(page.getByTestId('create-presentation')).toBeDisabled()
    await page.getByTestId('presentation-title-input').fill('Første presentasjon')
    await page.getByTestId('create-presentation').click()

    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(page.getByTestId('presentation-title')).toHaveText('Første presentasjon')

    await page.getByTestId('back-to-library').click()
    await expect(page.getByTestId('presentation-card')).toHaveCount(1)
    expect(guard.errors).toEqual([])
  })

  test('refuses a name too long for the forside it becomes', async ({ page }) => {
    // Navnet er også forsidens første linje, så det måles som en hvilken som
    // helst annen linje på en side. Dialogen blir stående med navnet i seg.
    await page.goto('/')
    await page.getByTestId('new-presentation').click()
    await page
      .getByTestId('presentation-title-input')
      .fill('Et navn som er altfor langt til å stå på én linje på forsiden av dette dekket, uansett hvilken font det settes i')
    await page.getByTestId('create-presentation').click()

    await expect(toast(page, 'får ikke plass på forsiden')).toHaveCount(1)
    await expect(page.getByTestId('new-presentation-modal')).toBeVisible()
    await expect(page.getByTestId('editor')).toHaveCount(0)

    // Kortet ned, og den blir opprettet.
    await page.getByTestId('presentation-title-input').fill('Kort nok')
    await page.getByTestId('create-presentation').click()
    await expect(page.getByTestId('editor')).toBeVisible()
  })

  test('renames, duplicates and deletes into the trash', async ({ page }) => {
    await createPresentation(page, 'Original')
    await page.getByTestId('back-to-library').click()

    // Opening is the card's own action; everything else is in its menu.
    await expect(page.getByTestId('open-presentation')).toContainText('Åpne')
    await choosePresentationAction(page, 'rename-presentation')
    await page.getByTestId('rename-input').fill('Nytt navn')
    await page.getByTestId('rename-confirm').click()
    await expect(page.getByText('Nytt navn')).toBeVisible()

    await choosePresentationAction(page, 'duplicate-presentation')
    await expect(page.getByTestId('presentation-card')).toHaveCount(2)
    await expect(page.getByText('Nytt navn (kopi)')).toBeVisible()

    // Deleting is a move to the trash: the card leaves the library, and the
    // trash in the sidebar counts it.
    await expect(page.getByTestId('trash-view')).toHaveText(/Søppelkasse \(0\)/)
    await choosePresentationAction(page, 'delete-presentation')
    await expect(page.getByTestId('confirm-dialog')).toBeVisible()
    await expect(page.getByTestId('confirm-dialog')).toContainText('søppelkassen')
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('presentation-card')).toHaveCount(1)
    await expect(page.getByTestId('trash-view')).toHaveText(/Søppelkasse \(1\)/)
  })

  test('copies the presentation id without opening the presentation', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://127.0.0.1:4173',
    })
    await createPresentation(page, 'ID-kopi')

    const presentationId = await page.evaluate(() => {
      const raw = localStorage.getItem('slaids.ui.lastOpenPresentation')
      return raw ? (JSON.parse(raw) as string | null) : null
    })
    expect(presentationId).not.toBeNull()

    await page.getByTestId('back-to-library').click()
    // The card's «Flere handlinger» is a real, named button with a menu: it is
    // reached and opened from the keyboard, and choosing in it must not hit
    // the card's separate open button.
    const more = page.getByTestId('presentation-more')
    await expect(more).toHaveAccessibleName('Flere handlinger for ID-kopi')
    await expect(more).toHaveAttribute('aria-haspopup', 'menu')
    await more.focus()
    await more.press('Enter')
    const menu = page.getByTestId('context-menu')
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Gi nytt navn …',
      'Dupliser',
      'Kopier presentasjons-ID',
      'Last ned sikkerhetskopi',
      'Flytt til søppelkassen …',
    ])
    await expect(menu.getByTestId('rename-presentation')).toBeFocused()
    await menu.getByTestId('copy-presentation-id').press('Enter')
    await expect(menu).toBeHidden()
    // The focus comes back to the button the menu was opened from.
    await expect(more).toBeFocused()

    await expect(toast(page, 'Presentasjons-ID kopiert')).toHaveCount(1)
    await expect(page.getByTestId('presentation-grid')).toBeVisible()
    await expect(page.getByTestId('editor')).toHaveCount(0)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(presentationId)
  })

  test('restores from the trash, deletes for good, and empties it', async ({ page }) => {
    const guard = watchForErrors(page)
    await createPresentation(page, 'Angret')
    await page.getByTestId('back-to-library').click()
    await choosePresentationAction(page, 'duplicate-presentation')
    await expect(page.getByTestId('presentation-card')).toHaveCount(2)

    // Both into the trash.
    for (let i = 0; i < 2; i += 1) {
      await choosePresentationAction(page, 'delete-presentation')
      await page.getByTestId('confirm-accept').click()
      await expect(page.getByTestId('presentation-card')).toHaveCount(1 - i)
    }

    await page.getByTestId('trash-view').click()
    await expect(page.getByTestId('trashed-card')).toHaveCount(2)
    // Each entry says when it went in and when it goes for good.
    await expect(page.getByTestId('trash-dates').first()).toContainText(/Slettet .* slettes for godt/)
    await expect(page.getByTestId('trash-head')).toContainText('30 dager')

    // Back to the library, as it was.
    await page.getByTestId('trashed-card').filter({ hasText: 'Angret (kopi)' })
      .getByTestId('restore-presentation')
      .click()
    await expect(page.getByTestId('trashed-card')).toHaveCount(1)
    await expect(page.getByTestId('trash-view')).toHaveText(/Søppelkasse \(1\)/)
    await page.getByRole('button', { name: /^Alle/ }).click()
    await expect(page.getByTestId('presentation-card')).toHaveCount(1)
    await expect(page.getByTestId('presentation-card')).toContainText('Angret (kopi)')

    // Deleting from the trash is the permanent one, and it asks again.
    await choosePresentationAction(page, 'delete-presentation')
    await page.getByTestId('confirm-accept').click()
    await page.getByTestId('trash-view').click()
    await expect(page.getByTestId('trashed-card')).toHaveCount(2)
    await page.getByTestId('purge-presentation').first().click()
    await expect(page.getByTestId('confirm-dialog')).toContainText('for godt')
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('trashed-card')).toHaveCount(1)

    // And the button that empties it.
    await page.getByTestId('empty-trash').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('trashed-card')).toHaveCount(0)
    await expect(page.getByText('Søppelkassen er tom.')).toBeVisible()
    await expect(page.getByTestId('empty-trash')).toBeDisabled()
    await expect(page.getByTestId('trash-view')).toHaveText(/Søppelkasse \(0\)/)

    // Gone from the store too, not only from the view.
    await page.reload()
    await expect(page.getByTestId('presentation-grid')).toBeVisible()
    await expect(page.getByTestId('presentation-card')).toHaveCount(0)
    await expect(page.getByTestId('trash-view')).toHaveText(/Søppelkasse \(0\)/)
    expect(guard.errors).toEqual([])
  })

  test('says how much room each presentation takes', async ({ page }) => {
    await createPresentation(page, 'Størrelse')
    await page.getByTestId('back-to-library').click()

    // A new deck is under a kilobyte of document and no files: a number with a
    // unit, on the line with the slide count and the date.
    const size = page.getByTestId('presentation-card').getByTestId('presentation-size')
    await expect(size).toHaveText(/^\d+(\.\d+)? (B|kB)$/)
    await expect(
      page.getByTestId('presentation-card').getByTestId('open-presentation').locator('.presentation-card__meta'),
    ).toHaveText(/slides · .* · \d+(\.\d+)? (B|kB)$/)
  })

  test('remembers the open presentation across a reload', async ({ page }) => {
    await createPresentation(page, 'Husk meg')
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(page.getByTestId('presentation-title')).toHaveText('Husk meg')
  })

  test('organises presentations in folders', async ({ page }) => {
    await createPresentation(page, 'I mappe')
    await page.getByTestId('back-to-library').click()

    page.once('dialog', (dialog) => void dialog.accept('Kundemøter'))
    await page.getByTestId('new-folder').click()
    const folder = page.getByTestId('folder-item')
    await expect(folder).toHaveText(/Kundemøter \(0\)/)

    await page.getByTestId('folder-select').selectOption({ label: 'Kundemøter' })
    await expect(folder).toHaveText(/Kundemøter \(1\)/)

    await folder.click()
    await expect(page.getByTestId('presentation-card')).toHaveCount(1)

    // Renaming keeps the folder, its contents and the selection; it survives a
    // reload because it is stored, not just drawn.
    await chooseFolderAction(page, 'Kundemøter', 'rename-folder')
    await expect(page.getByTestId('rename-input')).toHaveValue('Kundemøter')
    await page.getByTestId('rename-input').fill('  Kunder  ')
    await page.getByTestId('rename-input').press('Enter')
    await expect(folder).toHaveText(/Kunder \(1\)/)
    await expect(page.getByTestId('presentation-card')).toHaveCount(1)
    await expect(page.getByTestId('folder-select').locator('option:checked')).toHaveText('Kunder')
    await page.reload()
    await expect(page.getByTestId('folder-item')).toHaveText(/Kunder \(1\)/)

    // An emptied field is not a rename: the old name stays.
    await chooseFolderAction(page, 'Kunder', 'rename-folder')
    await page.getByTestId('rename-input').fill('   ')
    await page.getByTestId('rename-confirm').click()
    await expect(page.getByTestId('folder-item')).toHaveText(/Kunder \(1\)/)

    // Deleting the folder keeps the presentation, just without a folder.
    await chooseFolderAction(page, 'Kunder', 'delete-folder')
    await expect(page.getByTestId('confirm-dialog')).toContainText('Presentasjonene i den blir liggende')
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('presentation-card')).toHaveCount(1)
    await expect(page.getByTestId('folder-item')).toHaveCount(0)
  })

  test('exports a presentation to a .slaids file', async ({ page }) => {
    await createPresentation(page, 'Eksport')
    await page.getByTestId('back-to-library').click()
    const download = page.waitForEvent('download')
    await choosePresentationAction(page, 'export-presentation')
    const file = await download
    expect(file.suggestedFilename()).toBe('eksport.slaids')
  })
})
