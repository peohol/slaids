/**
 * Signing in with an emailed code, against a stubbed Supabase project.
 *
 * Runs in the `supabase-auth` project: the app built in Supabase mode, with
 * every request to Supabase answered by `supabaseStub.ts`. No email is sent;
 * the test reads the code from the stub's outbox.
 */

import type { Browser, BrowserContext, Page } from '@playwright/test'
import { expect, routeLocalFonts, test as base } from './fixtures'
import { waitForSaved, watchForErrors } from './helpers'
import { SESSION_STORAGE_KEY, SupabaseStub, type StubUser } from './supabaseStub'

const PEDER = 'peder@example.com'

const test = base.extend<{ supabase: SupabaseStub; peder: StubUser }>({
  supabase: async ({ context }, provide) => {
    const stub = new SupabaseStub()
    await stub.install(context)
    await provide(stub)
  },
  peder: async ({ supabase }, provide) => {
    await provide(supabase.addUser(PEDER, { role: 'admin' }))
  },
})

async function requestCode(page: Page, email: string, { remember = false } = {}): Promise<void> {
  await expect(page.getByTestId('sign-in')).toBeVisible()
  await page.getByTestId('sign-in-email').fill(email)
  if (remember) await page.getByTestId('sign-in-remember').check()
  await page.getByTestId('sign-in-send').click()
  await expect(page.getByTestId('sign-in-code')).toBeVisible()
}

/** The whole flow, from the email field to the library. */
async function signIn(
  page: Page,
  supabase: SupabaseStub,
  email: string,
  options: { remember?: boolean } = {},
): Promise<void> {
  await requestCode(page, email, options)
  await page.getByTestId('sign-in-code').fill(supabase.latestCode(email))
  await expect(page.getByTestId('presentation-grid')).toBeVisible()
}

/**
 * A browser opened again after being closed: what was kept on the device
 * (cookies, `localStorage`) carries over, `sessionStorage` does not.
 */
async function reopenBrowser(
  browser: Browser,
  previous: BrowserContext,
  supabase: SupabaseStub,
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: await previous.storageState(),
  })
  await routeLocalFonts(context)
  await supabase.install(context)
  const page = await context.newPage()
  await page.goto('/')
  return page
}

test.describe('innlogging med engangskode', () => {
  test('logger inn med koden fra e-posten, uten passord', { tag: '@pr' }, async ({ page, supabase, peder }) => {
    const guard = watchForErrors(page)
    await page.goto('/')

    await expect(page.getByTestId('sign-in')).toBeVisible()
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await requestCode(page, ` ${peder.email.toUpperCase()} `)
    await expect(page.getByTestId('sign-in-address')).toHaveText(peder.email.toUpperCase().trim())
    expect(supabase.outbox).toHaveLength(1)

    // Den siste sifferen sender inn skjemaet selv.
    await page.getByTestId('sign-in-code').pressSequentially(supabase.latestCode(peder.email))

    await expect(page.getByTestId('presentation-grid')).toBeVisible()
    await expect(page.getByTestId('library-footer')).toContainText(peder.email)
    expect(guard.errors).toEqual([])
  })

  test('sier fra om en adresse uten konto, og oppretter ingen', async ({ page, supabase }) => {
    await page.goto('/')
    await page.getByTestId('sign-in-email').fill('ukjent@example.com')
    await page.getByTestId('sign-in-send').click()

    await expect(page.getByTestId('sign-in-error')).toContainText('har ikke en Slaids-konto')
    await expect(page.getByTestId('sign-in-error')).toContainText('administrator')
    await expect(page.getByTestId('sign-in-code')).toHaveCount(0)
    expect(supabase.users).toHaveLength(0)
    expect(supabase.outbox).toHaveLength(0)
  })

  test('avviser feil kode og lar brukeren prøve igjen', { tag: '@pr' }, async ({ page, supabase, peder }) => {
    await page.goto('/')
    await requestCode(page, peder.email)
    const code = supabase.latestCode(peder.email)
    const wrong = code === '000000' ? '111111' : '000000'

    await page.getByTestId('sign-in-code').fill(wrong)

    await expect(page.getByTestId('sign-in-error')).toContainText('stemmer ikke')
    await expect(page.getByTestId('sign-in-code')).toHaveValue('')
    await expect(page.getByTestId('sign-in-code')).toBeFocused()

    await page.getByTestId('sign-in-code').fill(code)
    await expect(page.getByTestId('presentation-grid')).toBeVisible()
  })

  test('tar imot en kode limt inn med mellomrom', async ({ page, supabase, peder }) => {
    await page.goto('/')
    await requestCode(page, peder.email)
    const code = supabase.latestCode(peder.email)

    await page.getByTestId('sign-in-code').fill(`${code.slice(0, 3)} ${code.slice(3)}`)

    await expect(page.getByTestId('presentation-grid')).toBeVisible()
  })

  test('utløpt kode: venter, sender ny kode og logger inn med den', async ({ page, supabase, peder }) => {
    await page.clock.install()
    await page.goto('/')
    await requestCode(page, peder.email)
    const first = supabase.latestCode(peder.email)
    supabase.expireCodes()

    await page.getByTestId('sign-in-code').fill(first)
    await expect(page.getByTestId('sign-in-error')).toContainText('utløpt')

    // Ny kode først etter ventetiden.
    const resend = page.getByTestId('sign-in-resend')
    await expect(resend).toBeDisabled()
    await expect(resend).toHaveText(/Send ny kode om \d+ s/)
    await page.clock.fastForward('00:30')
    await expect(resend).toBeDisabled()
    await page.clock.fastForward('00:31')
    await expect(resend).toBeEnabled()
    await expect(resend).toHaveText('Send ny kode')

    supabase.cooldownSeconds = 0
    await resend.click()
    await expect(page.getByTestId('sign-in-notice')).toContainText('nyeste e-posten')
    expect(supabase.outbox).toHaveLength(2)
    await expect(resend).toBeDisabled()

    await page.getByTestId('sign-in-code').fill(supabase.latestCode(peder.email))
    await expect(page.getByTestId('presentation-grid')).toBeVisible()
  })

  test('følger ventetiden Supabase oppgir, og lar en nylig sendt kode brukes', async ({ page, supabase, peder }) => {
    await page.goto('/')
    await requestCode(page, peder.email)
    const code = supabase.latestCode(peder.email)

    // Siden lastes på nytt før koden er skrevet inn, og brukeren ber om en kode igjen.
    await page.reload()
    await page.getByTestId('sign-in-email').fill(peder.email)
    await page.getByTestId('sign-in-send').click()

    await expect(page.getByTestId('sign-in-notice')).toContainText('nettopp sendt en kode')
    await expect(page.getByTestId('sign-in-resend')).toBeDisabled()
    expect(supabase.outbox).toHaveLength(1)

    await page.getByTestId('sign-in-code').fill(code)
    await expect(page.getByTestId('presentation-grid')).toBeVisible()
  })

  test('kan gå tilbake og bruke en annen adresse', async ({ page, peder }) => {
    await page.goto('/')
    await requestCode(page, peder.email)

    await page.getByTestId('sign-in-change-email').click()

    await expect(page.getByTestId('sign-in-email')).toHaveValue(peder.email)
    await expect(page.getByTestId('sign-in-code')).toHaveCount(0)
  })
})

test.describe('hold meg innlogget', () => {
  test('husket innlogging overlever at nettleseren lukkes', { tag: '@pr' }, async ({ browser, context, page, supabase, peder }) => {
    await page.goto('/')
    await signIn(page, supabase, peder.email, { remember: true })

    const reopened = await reopenBrowser(browser, context, supabase)

    await expect(reopened.getByTestId('presentation-grid')).toBeVisible()
    await expect(reopened.getByTestId('sign-in')).toHaveCount(0)
    await reopened.context().close()
  })

  test('uten valget varer innloggingen bare nettleserøkten', { tag: '@pr' }, async ({ browser, context, page, supabase, peder }) => {
    await page.goto('/')
    await signIn(page, supabase, peder.email)
    expect(await page.evaluate((key) => localStorage.getItem(key), SESSION_STORAGE_KEY)).toBeNull()

    // En omlasting i samme fane er fortsatt samme nettleserøkt …
    await page.reload()
    await expect(page.getByTestId('presentation-grid')).toBeVisible()

    // … men en nettleser som er lukket og åpnet igjen, må logge inn på nytt.
    const reopened = await reopenBrowser(browser, context, supabase)
    await expect(reopened.getByTestId('sign-in')).toBeVisible()
    await reopened.context().close()
  })

  test('en ny innlogging uten valget fjerner en tidligere husket økt', async ({ browser, context, page, supabase, peder }) => {
    const other = supabase.addUser('annen@example.com')
    await page.goto('/')
    await signIn(page, supabase, peder.email, { remember: true })
    await page.getByTestId('sign-out').click()

    await signIn(page, supabase, other.email)

    // Ingen økt – verken Peders eller den nye – ligger igjen på enheten.
    expect(await page.evaluate((key) => localStorage.getItem(key), SESSION_STORAGE_KEY)).toBeNull()
    const reopened = await reopenBrowser(browser, context, supabase)
    await expect(reopened.getByTestId('sign-in')).toBeVisible()
    await reopened.context().close()
  })
})

test.describe('ut og inn', () => {
  test('logger ut og inn igjen uten at noe går tapt', { tag: '@pr' }, async ({ page, supabase, peder }) => {
    const guard = watchForErrors(page)
    await page.goto('/')
    await signIn(page, supabase, peder.email)

    await page.getByTestId('new-presentation').click()
    await page.getByTestId('presentation-title-input').fill('Lagret i skyen')
    await page.getByTestId('create-presentation').click()
    await expect(page.getByTestId('editor')).toBeVisible()
    await waitForSaved(page)
    await page.getByTestId('back-to-library').click()
    await expect(page.getByTestId('presentation-card')).toHaveCount(1)

    await page.getByTestId('sign-out').click()
    await expect(page.getByTestId('sign-in')).toBeVisible()
    await expect(page.getByTestId('sign-in-email')).toHaveValue('')

    supabase.cooldownSeconds = 0
    await signIn(page, supabase, peder.email)
    await expect(page.getByTestId('presentation-card')).toHaveCount(1)
    await expect(page.getByTestId('presentation-card')).toContainText('Lagret i skyen')
    expect(guard.errors).toEqual([])
  })
})

test.describe('tilgangslisten', () => {
  test('en Auth-bruker som ikke er Slaids-bruker kommer ikke inn', async ({ page, supabase }) => {
    const outsider = supabase.addUser('annen-app@example.com', { member: false })
    await page.goto('/')
    await requestCode(page, outsider.email)
    await page.getByTestId('sign-in-code').fill(supabase.latestCode(outsider.email))

    await expect(page.getByTestId('auth-no-access')).toBeVisible()
    await expect(page.getByTestId('auth-no-access')).toContainText(outsider.email)
    await expect(page.getByTestId('presentation-grid')).toHaveCount(0)

    await page.getByTestId('auth-sign-out').click()
    await expect(page.getByTestId('sign-in')).toBeVisible()
  })

  test('en deaktivert konto kommer ikke inn', async ({ page, supabase }) => {
    const user = supabase.addUser('deaktivert@example.com', { active: false })
    await page.goto('/')
    await requestCode(page, user.email)
    await page.getByTestId('sign-in-code').fill(supabase.latestCode(user.email))

    await expect(page.getByTestId('auth-deactivated')).toBeVisible()
    await expect(page.getByTestId('presentation-grid')).toHaveCount(0)

    // Reaktivert: en ny sjekk slipper brukeren inn uten ny innlogging.
    supabase.setActive(user, true)
    await page.getByTestId('auth-recheck').click()
    await expect(page.getByTestId('presentation-grid')).toBeVisible()
  })

  test('deaktivering stenger en økt som allerede er åpen', { tag: '@pr' }, async ({ page, supabase, peder }) => {
    await page.clock.install()
    await page.goto('/')
    await signIn(page, supabase, peder.email)

    supabase.setActive(peder, false)
    // Når brukeren kommer tilbake til fanen.
    await page.clock.fastForward('00:20')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))

    await expect(page.getByTestId('auth-deactivated')).toBeVisible()
    await expect(page.getByTestId('presentation-grid')).toHaveCount(0)
  })
})

test.describe('OAuth-samtykke', () => {
  test('logger inn på stedet og viser samtykket på samme adresse', async ({ page, supabase, peder }) => {
    const address = '/oauth/consent?authorization_id=auth-123'
    await page.goto(address)

    await signInWithoutLibrary(page, supabase, peder.email)

    await expect(page.getByTestId('oauth-consent')).toBeVisible()
    await expect(page.getByTestId('oauth-consent-client')).toHaveText('Testklient')
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(address)
  })
})

/** Sign in where the page behind the gate is not the library. */
async function signInWithoutLibrary(page: Page, supabase: SupabaseStub, email: string): Promise<void> {
  await requestCode(page, email)
  await page.getByTestId('sign-in-code').fill(supabase.latestCode(email))
  await expect(page.getByTestId('sign-in')).toHaveCount(0)
}

test.describe('administrasjon', () => {
  test('en administrator legger til en bruker som får sitt eget, tomme bibliotek', { tag: '@pr' }, async ({ page, supabase, peder }) => {
    const guard = watchForErrors(page)
    await page.goto('/')
    await signIn(page, supabase, peder.email)
    await page.getByTestId('new-presentation').click()
    await page.getByTestId('presentation-title-input').fill('Bare min')
    await page.getByTestId('create-presentation').click()
    await waitForSaved(page)
    await page.getByTestId('back-to-library').click()

    await page.getByTestId('library-administration').click()
    await page.getByTestId('open-admin-users').click()
    const modal = page.getByTestId('admin-users-modal')
    await expect(modal.getByTestId('admin-user-row')).toHaveCount(1)
    await expect(modal.getByTestId('admin-user-row')).toContainText(`${peder.email} (deg)`)

    await modal.getByTestId('admin-user-email').fill('ny@example.com')
    await modal.getByTestId('admin-user-add').click()
    await expect(modal.getByTestId('admin-user-row')).toHaveCount(2)
    await expect(modal.getByTestId('admin-user-row').filter({ hasText: 'ny@example.com' })).toContainText('Bruker')
    await modal.getByRole('button', { name: 'Lukk' }).click()

    await page.getByTestId('sign-out').click()
    supabase.cooldownSeconds = 0
    await signIn(page, supabase, 'ny@example.com')
    await expect(page.getByTestId('presentation-card')).toHaveCount(0)
    // Bare administratorer ser menyen.
    await expect(page.getByTestId('library-administration')).toHaveCount(0)
    expect(guard.errors).toEqual([])
  })

  test('gir administratorrollen og deaktiverer etter bekreftelse', async ({ page, supabase, peder }) => {
    const anna = supabase.addUser('anna@example.com')
    await page.goto('/')
    await signIn(page, supabase, peder.email)
    await page.getByTestId('library-administration').click()
    await page.getByTestId('open-admin-users').click()
    const row = page.getByTestId('admin-users-modal').getByTestId('admin-user-row').filter({ hasText: anna.email })

    await row.getByTestId('admin-user-promote').click()
    await expect(row).toContainText('Administrator')
    expect(supabase.access.get(anna.id)?.role).toBe('admin')

    await row.getByTestId('admin-user-deactivate').click()
    await page.getByTestId('confirm-dialog').getByTestId('confirm-accept').click()
    await expect(row).toContainText('Deaktivert')
    expect(supabase.access.get(anna.id)?.active).toBe(false)
  })
})
