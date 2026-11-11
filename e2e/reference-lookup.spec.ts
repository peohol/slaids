import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { addContentToZone, createPresentation, stage, zoneRects } from './helpers'

async function openReferences(page: Page): Promise<Locator> {
  await createPresentation(page, 'Referanseoppslag')
  const [zone] = await zoneRects(page)
  await addContentToZone(page, zone.id, 'untitled-card')
  await stage(page).locator('.subfield .tiptap').first().click()
  await page.getByTestId('insert-reference').click()
  const dialog = page.getByTestId('reference-modal')
  await expect(dialog).toBeVisible()
  return dialog
}

async function pasteIdentifier(dialog: Locator, value: string): Promise<void> {
  await dialog.getByLabel('DOI eller PubMed-ID').evaluate((input, text) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', text)
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  }, value)
}

const cors = { 'access-control-allow-origin': '*' }

test('innlimt DOI fyller redigerbare felter og lagres først ved bekreftelse', async ({ page }) => {
  await page.route('https://api.crossref.org/works/**', (route) =>
    route.fulfill({
      headers: cors,
      json: {
        message: {
          title: ['<i>Studie</i> av søvn &amp; aktivitet'],
          author: [{ given: 'Anna', family: 'Hansen' }, { name: 'Studiegruppen' }],
          published: { 'date-parts': [[2023, 5, 1]] },
        },
      },
    }),
  )
  const dialog = await openReferences(page)
  await pasteIdentifier(dialog, 'https://doi.org/10.1234/studie')
  await expect(dialog.getByLabel('Tittel', { exact: true })).toHaveValue('Studie av søvn & aktivitet')
  await expect(dialog.getByLabel('Forfatter(e)')).toHaveValue('Hansen, Anna; Studiegruppen')
  await expect(dialog.getByLabel('År')).toHaveValue('2023')
  await expect(dialog.getByLabel('Hyperkobling')).toHaveValue('https://doi.org/10.1234/studie')
  await expect(dialog.getByTestId('reference-row')).toHaveCount(0)
  await dialog.getByLabel('Tittel', { exact: true }).fill('Justerte opplysninger')
  await dialog.getByTestId('save-reference').click()
  await expect(dialog.getByTestId('reference-row')).toContainText('Justerte opplysninger')
})

test('innlimt PubMed-ID bruker PubMed-posten med nøyaktig samme ID', async ({ page }) => {
  await page.route('https://www.ebi.ac.uk/europepmc/webservices/rest/search?*', (route) => {
    const search = new URL(route.request().url())
    expect(search.searchParams.get('query')).toBe('EXT_ID:12345678 AND SRC:MED')
    return route.fulfill({
      headers: cors,
      json: {
        resultList: {
          result: [
            { id: '87654321', source: 'MED', title: 'Feil artikkel' },
            { id: '12345678', source: 'OTHER', title: 'Feil kilde' },
            {
              id: '12345678',
              source: 'MED',
              title: 'En artikkel',
              pubYear: '2022',
              authorList: { author: [{ firstName: 'Ola', lastName: 'Mo' }] },
            },
          ],
        },
      },
    })
  })
  const dialog = await openReferences(page)
  await pasteIdentifier(dialog, 'PMID: 12345678')
  await expect(dialog.getByLabel('Tittel', { exact: true })).toHaveValue('En artikkel')
  await expect(dialog.getByLabel('Forfatter(e)')).toHaveValue('Mo, Ola')
  await expect(dialog.getByLabel('År')).toHaveValue('2022')
  await expect(dialog.getByLabel('Hyperkobling')).toHaveValue('https://pubmed.ncbi.nlm.nih.gov/12345678/')
})

test('DOI som Crossref ikke kjenner slås opp i DataCite', async ({ page }) => {
  await page.route('https://api.crossref.org/works/**', (route) =>
    route.fulfill({ headers: cors, status: 404 }),
  )
  await page.route('https://api.datacite.org/dois/**', (route) =>
    route.fulfill({
      headers: cors,
      json: {
        data: {
          attributes: {
            titles: [{ title: 'Et datasett' }],
            creators: [{ name: 'Lien, Eva' }],
            publicationYear: 2020,
          },
        },
      },
    }),
  )
  const dialog = await openReferences(page)
  await dialog.getByLabel('DOI eller PubMed-ID').fill('doi:10.1234/datasett')
  await dialog.getByRole('button', { name: 'Hent', exact: true }).click()
  await expect(dialog.getByLabel('Tittel', { exact: true })).toHaveValue('Et datasett')
  await expect(dialog.getByLabel('Forfatter(e)')).toHaveValue('Lien, Eva')
  await expect(dialog.getByLabel('År')).toHaveValue('2020')
  await expect(dialog.getByLabel('Hyperkobling')).toHaveValue('https://doi.org/10.1234/datasett')
})
