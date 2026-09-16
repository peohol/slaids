/**
 * Handing a deck its pictures, from the dialog that opens with it to the files
 * landing in the zones.
 *
 * The deck is seeded through a `.slaids` archive rather than built by clicking,
 * because an image plan is written by an agent and has no editor surface — the
 * same reason `image-brief.spec.ts` gives for not planning pictures through the
 * UI. Everything *after* the deck exists is the product, and that is what is
 * driven here: the dialog that explains the deck, the numbered brief, the file
 * names being checked rather than guessed at, and the pictures ending up in the
 * zones they were ordered for.
 *
 * What is asserted is the rendered slide rather than the stored document: a
 * deposit that is right in the store and wrong on the screen is exactly the
 * failure this workflow exists to prevent.
 */

import { zipSync, strToU8 } from 'fflate'
import { expect, test, type Page } from './fixtures'
import {
  clickZone,
  enterZoneMode,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'
import { setImagePlan } from '../src/domain/commands'
import { createImage } from '../src/domain/content'
import { createLeaf, createSplit } from '../src/domain/layout'
import { createPresentation } from '../src/domain/presentation'
import { titleDoc } from '../src/domain/richdoc'
import type { Presentation } from '../src/domain/types'

/** A one-pixel PNG, big enough to be a picture and small enough to inline. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const MOTIFS = [
  'Australopithecus afarensis som går oppreist i et savannelandskap',
  'Homo erectus som bearbeider en håndøks ved en leirplass',
  'Homo sapiens som maler dyr på en hulevegg i fakkellys',
]

/**
 * A deck of three planned, numbered, unfilled picture zones, as a `.slaids`
 * archive — exactly what the agent pipeline produces, written straight rather
 * than driven through an API the editor does not expose.
 */
function pendingArchive(): Buffer {
  const base = createPresentation({ title: 'Menneskets evolusjon' })
  const leaves = [createLeaf(createImage()), createLeaf(createImage()), createLeaf(createImage())]
  const slide = base.slides[1]
  if (slide.kind !== 'content') throw new Error('Forventet en innholdsslide')
  const deck: Presentation = {
    ...base,
    imageContext: 'Fotorealistiske rekonstruksjoner, naturlig dagslys, ingen tekst i bildene.',
    slides: [
      base.slides[0],
      {
        ...slide,
        title: titleDoc('Tre arter'),
        root: createSplit('x', [1, 1, 1], leaves),
      },
    ],
  }
  const planned = setImagePlan(
    deck,
    leaves.map((leaf, index) => ({
      slideId: slide.id,
      nodeId: leaf.id,
      subject: MOTIFS[index],
      composition: 'Motivet sentrert i bildet, rolig bakgrunn.',
      requirements: '',
      avoid: '',
    })),
  )
  if (!planned.ok) throw new Error(planned.error.message)

  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(
      JSON.stringify({
        format: 'slaids-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        presentationCount: 1,
      }),
    ),
    'assets/index.json': strToU8('[]'),
    [`presentations/${planned.value.id}.json`]: strToU8(JSON.stringify(planned.value)),
  }
  return Buffer.from(zipSync(files, { level: 0 }))
}

/** Whether the brief still offers to take the finished files. */
async function expectDepositOffered(page: Page, offered: boolean): Promise<void> {
  await page.getByTestId('open-image-brief').click()
  await expect(page.getByTestId('image-brief-modal')).toBeVisible()
  const button = page.getByTestId('image-brief-modal-deposit')
  if (offered) await expect(button).toBeVisible()
  else await expect(button).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('image-brief-modal')).toBeHidden()
}

/** The named files a deposit is made of. */
function picture(name: string) {
  return { name, mimeType: 'image/png', buffer: PNG }
}

test.describe('bildedeponering', () => {
  test('forklarer seg, gir briefen, og setter bildene inn på riktig plass', async ({ page }) => {
    const guard = watchForErrors(page)
    await page.goto('/')
    await page.getByTestId('import-input').setInputFiles({
      name: 'venter.slaids',
      mimeType: 'application/zip',
      buffer: pendingArchive(),
    })
    await expect(page.getByTestId('presentation-card')).toHaveCount(1)
    await page.getByTestId('open-presentation').first().click()

    // The deck says what it is missing, without the user having to find out.
    const intro = page.getByTestId('image-deposit-intro')
    await expect(intro).toBeVisible()
    await expect(intro).toContainText('3 bilder')
    await page.getByTestId('image-deposit-intro-generate').click()

    // The brief lists the same three pictures, numbered, so «bilde 2» can be
    // checked before two files are made.
    const list = page.getByTestId('image-brief-modal-list')
    await expect(list).toBeVisible()
    await expect(list.locator('li')).toHaveCount(3)
    await expect(list).toContainText('Homo erectus')
    await expect(page.getByTestId('image-brief-modal-text')).toContainText('Lag nøyaktig 3')
    await page.getByTestId('image-brief-modal-deposit').click()

    const deposit = page.getByTestId('image-deposit-modal')
    await expect(deposit).toBeVisible()
    const finish = page.getByTestId('image-deposit-finish')
    await expect(finish).toBeDisabled()

    // A file named after something else is refused with a reason, never matched.
    await page.getByTestId('image-deposit-input').setInputFiles([picture('01.png')])
    await expect(page.getByTestId('image-deposit-problems')).toContainText('Feil filnavn')
    await expect(page.getByTestId('image-deposit-progress')).toContainText('0 av 3')
    await expect(finish).toBeDisabled()

    // Two files for one number is a conflict, not a choice Slaids makes.
    await page.getByTestId('image-deposit-input').setInputFiles([picture('1.png'), picture('1.jpg')])
    await expect(page.getByTestId('image-deposit-problems')).toContainText('samme nummeret')
    await expect(finish).toBeDisabled()

    // Remove one of them, add the rest, and the set is complete.
    await page.getByRole('button', { name: 'Fjern 1.jpg' }).click()
    await page.getByRole('button', { name: 'Fjern 01.png' }).click()
    await page.getByTestId('image-deposit-input').setInputFiles([picture('2.png'), picture('3.png')])
    await expect(page.getByTestId('image-deposit-progress')).toContainText('3 av 3')
    await expect(finish).toBeEnabled()

    await finish.click()
    await expect(deposit).toBeHidden()

    // Three pictures, in three zones, on the slide itself.
    await expect(stage(page).locator('img.image-panel__img')).toHaveCount(3)
    // And the placeholders Slaids wrote are gone, rather than printed over the
    // finished deck.
    await expect(stage(page)).not.toContainText('Sett inn bilde')

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    // The deposit is over: opening the deck again asks nothing.
    await expect(page.getByTestId('image-deposit-intro')).toBeHidden()
    await expect(stage(page).locator('img.image-panel__img')).toHaveCount(3)

    expect(guard.errors).toEqual([])
  })

  test('en strukturell endring avslutter deponeringen først når brukeren bekrefter', async ({
    page,
  }) => {
    const guard = watchForErrors(page)
    await page.goto('/')
    await page.getByTestId('import-input').setInputFiles({
      name: 'venter.slaids',
      mimeType: 'application/zip',
      buffer: pendingArchive(),
    })
    await page.getByTestId('open-presentation').first().click()
    await expect(page.getByTestId('image-deposit-intro')).toBeVisible()

    // Going to the editor is not a decision about the deposit: the brief still
    // offers to take the files.
    await page.getByTestId('image-deposit-intro-edit').click()
    await expect(page.getByTestId('image-deposit-intro')).toBeHidden()
    await expectDepositOffered(page, true)

    // Deleting a numbered picture zone is the change that cannot be survived.
    await enterZoneMode(page)
    const zones = await zoneRects(page)
    await clickZone(page, zones[0])
    await page.getByTestId('inspector-action-delete').click()
    await page.getByTestId('confirm-accept').click()

    const warning = page.getByTestId('confirm-dialog')
    await expect(warning).toContainText('automatiske bildeinnsettingen')

    // Cancelling changes nothing at all: the zone is still there, and so is the
    // deposit.
    await warning.getByRole('button', { name: 'Avbryt' }).click()
    expect(await zoneRects(page)).toHaveLength(3)
    await expectDepositOffered(page, true)

    // Confirming ends it, and the deck becomes an ordinary deck.
    await page.getByTestId('inspector-action-delete').click()
    await page.getByTestId('confirm-accept').click()
    await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Fortsett likevel' }).click()
    expect(await zoneRects(page)).toHaveLength(2)
    await expectDepositOffered(page, false)

    // And it stays ended across a reload: nothing can put the deck back.
    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(page.getByTestId('image-deposit-intro')).toBeHidden()
    await expectDepositOffered(page, false)

    expect(guard.errors).toEqual([])
  })
})
