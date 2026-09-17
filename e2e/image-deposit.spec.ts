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

import { createHash } from 'node:crypto'
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
import {
  composeImageGenerationManifest,
  IMAGE_MANIFEST_FILE_NAME,
} from '../src/domain/imageGeneration'
import { resolveImagePlan } from '../src/domain/imagePlan'
import { createPresentation } from '../src/domain/presentation'
import { titleDoc } from '../src/domain/richdoc'
import { realImages } from '../src/domain/testImages'
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
function pendingDeck(): Presentation {
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
  return planned.value
}

/** That deck as the archive the import accepts. */
function archiveOf(deck: Presentation): Buffer {
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
    [`presentations/${deck.id}.json`]: strToU8(JSON.stringify(deck)),
  }
  return Buffer.from(zipSync(files, { level: 0 }))
}

/**
 * Three genuinely different pictures, with the names the plan gives them.
 *
 * Real encoder output from `testImages.ts` rather than one PNG three times: the
 * delivery under test is two files whose *contents* were exchanged, and three
 * copies of one picture cannot be exchanged in any way a digest would notice.
 */
const DELIVERY = [
  { name: '1.png', mimeType: 'image/png', bytes: realImages.png() },
  { name: '2.jpg', mimeType: 'image/jpeg', bytes: realImages.jpeg() },
  { name: '3.webp', mimeType: 'image/webp', bytes: realImages.webp() },
]

/** The bindings an agent would record, over the bytes it actually returned. */
function manifestFor(deck: Presentation, bytesFor: (index: number) => Uint8Array): string {
  const images = resolveImagePlan(deck).map((image, index) => ({
    imagePlanItemId: image.id,
    number: image.number,
    slideId: image.plan.slideId,
    nodeId: image.plan.nodeId,
    fileName: DELIVERY[index].name,
    contentHash: createHash('sha256').update(bytesFor(index)).digest('hex'),
  }))
  return composeImageGenerationManifest({ presentationId: deck.id, images })
}

/** The files to drop: the three pictures, plus the manifest beside them. */
function filesFor(manifest: string, bytesFor: (index: number) => Uint8Array) {
  return [
    ...DELIVERY.map((file, index) => ({
      name: file.name,
      mimeType: file.mimeType,
      buffer: Buffer.from(bytesFor(index)),
    })),
    {
      name: IMAGE_MANIFEST_FILE_NAME,
      mimeType: 'application/json',
      buffer: Buffer.from(manifest, 'utf8'),
    },
  ]
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
      buffer: archiveOf(pendingDeck()),
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
      buffer: archiveOf(pendingDeck()),
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

/**
 * The agent delivery, end to end, against the real deposit.
 *
 * The domain tests pin the rule and the jsdom tests pin the dialog. What only a
 * real browser can show is the rest of the chain actually working: a manifest
 * read off disk, every dropped file hashed by WebCrypto, and the comparison
 * deciding whether anything at all is written. The refusal is the more
 * important of the two — a delivery that is wrong about which picture is which
 * must leave the deck exactly as it was, not three-fifths filled.
 */
test.describe('bildedeponering med manifest', () => {
  test('setter bildene inn når koblingen stemmer mot filenes innhold', async ({ page }) => {
    const guard = watchForErrors(page)
    const deck = pendingDeck()
    await page.goto('/')
    await page.getByTestId('import-input').setInputFiles({
      name: 'venter.slaids',
      mimeType: 'application/zip',
      buffer: archiveOf(deck),
    })
    await page.getByTestId('open-presentation').first().click()
    await page.getByTestId('image-deposit-intro-generate').click()
    await page.getByTestId('image-brief-modal-deposit').click()

    const bytesFor = (index: number) => DELIVERY[index].bytes
    await page
      .getByTestId('image-deposit-input')
      .setInputFiles(filesFor(manifestFor(deck, bytesFor), bytesFor))

    // The manifest was read, the files were hashed, and the two agree.
    await expect(page.getByTestId('image-deposit-assurance')).toHaveAttribute(
      'data-assurance',
      'file-checked',
    )
    await expect(page.getByTestId('image-deposit-binding')).toBeHidden()
    // Nothing extra is asked of the person when the bytes themselves check out.
    await expect(page.getByTestId('image-deposit-acknowledge')).toBeHidden()

    const finish = page.getByTestId('image-deposit-finish')
    await expect(finish).toBeEnabled()
    await finish.click()
    await expect(page.getByTestId('image-deposit-modal')).toBeHidden()

    await expect(stage(page).locator('img.image-panel__img')).toHaveCount(3)
    await expect(stage(page)).not.toContainText('Sett inn bilde')
    await waitForSaved(page)
    expect(guard.errors).toEqual([])
  })

  test('setter ingenting inn når to filer har byttet innhold', async ({ page }) => {
    const guard = watchForErrors(page)
    const deck = pendingDeck()
    await page.goto('/')
    await page.getByTestId('import-input').setInputFiles({
      name: 'venter.slaids',
      mimeType: 'application/zip',
      buffer: archiveOf(deck),
    })
    await page.getByTestId('open-presentation').first().click()
    await page.getByTestId('image-deposit-intro-generate').click()
    await page.getByTestId('image-brief-modal-deposit').click()

    // The manifest is built over the bytes the generator returned, and the files
    // are then dropped with the first two exchanged. Every name, number and id
    // still agrees — which is exactly the delivery that used to be accepted.
    const manifest = manifestFor(deck, (index) => DELIVERY[index].bytes)
    const swapped = (index: number) =>
      index === 0 ? DELIVERY[1].bytes : index === 1 ? DELIVERY[0].bytes : DELIVERY[2].bytes
    await page.getByTestId('image-deposit-input').setInputFiles(filesFor(manifest, swapped))

    // Three files on place by name, and the binding refuses all three.
    await expect(page.getByTestId('image-deposit-progress')).toContainText('3 av 3')
    await expect(page.getByTestId('image-deposit-problems')).toBeHidden()
    const binding = page.getByTestId('image-deposit-binding')
    await expect(binding).toContainText('inneholder ikke de bytene')
    await expect(binding.locator('li')).toHaveCount(2)
    await expect(page.getByTestId('image-deposit-finish')).toBeDisabled()

    // And the deck is untouched: not one picture, not a partial deposit.
    await page.getByRole('button', { name: 'Avbryt' }).click()
    await expect(page.getByTestId('image-deposit-modal')).toBeHidden()
    await expect(stage(page).locator('img.image-panel__img')).toHaveCount(0)
    await expect(stage(page)).toContainText('Sett inn bilde 1 her')

    // Including after a reload: nothing was written on the way past either.
    await page.reload()
    await expect(page.getByTestId('image-deposit-intro')).toBeVisible()
    await page.getByTestId('image-deposit-intro-edit').click()
    await expect(stage(page).locator('img.image-panel__img')).toHaveCount(0)
    expect(guard.errors).toEqual([])
  })

  test('krever manuell bekreftelse når manifestet mangler avtrykk', async ({ page }) => {
    const guard = watchForErrors(page)
    const deck = pendingDeck()
    await page.goto('/')
    await page.getByTestId('import-input').setInputFiles({
      name: 'venter.slaids',
      mimeType: 'application/zip',
      buffer: archiveOf(deck),
    })
    await page.getByTestId('open-presentation').first().click()
    await page.getByTestId('image-deposit-intro-generate').click()
    await page.getByTestId('image-brief-modal-deposit').click()

    // A host that could not reach the bytes of what its image tool produced.
    // Not refused — unverified, and said so, with the one check a person can
    // still make asked for explicitly.
    const bare = JSON.parse(manifestFor(deck, (index) => DELIVERY[index].bytes)) as {
      images: Record<string, unknown>[]
    }
    for (const image of bare.images) delete image.contentHash
    await page
      .getByTestId('image-deposit-input')
      .setInputFiles(filesFor(JSON.stringify(bare), (index) => DELIVERY[index].bytes))

    await expect(page.getByTestId('image-deposit-assurance')).toHaveAttribute(
      'data-assurance',
      'unchecked',
    )
    await expect(page.getByTestId('image-deposit-assurance')).toContainText('ikke verifisert')
    const finish = page.getByTestId('image-deposit-finish')
    await expect(finish).toBeDisabled()

    await page.getByTestId('image-deposit-acknowledge').locator('input').check()
    await expect(finish).toBeEnabled()
    await finish.click()
    await expect(page.getByTestId('image-deposit-modal')).toBeHidden()
    await expect(stage(page).locator('img.image-panel__img')).toHaveCount(3)
    expect(guard.errors).toEqual([])
  })
})
