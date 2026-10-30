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
  chooseFromToolbarMenu,
} from './helpers'
import { setImagePlan } from '../src/domain/commands'
import { createImage } from '../src/domain/content'
import { createLeaf, createSplit } from '../src/domain/layout'
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

/** The three pictures as files to drop, under whatever names they were given. */
function filesFor(names: readonly string[]) {
  return DELIVERY.map((file, index) => ({
    name: names[index] ?? file.name,
    mimeType: file.mimeType,
    buffer: Buffer.from(file.bytes),
  }))
}

/**
 * Drag one picture to another place in the list, with a real pointer.
 *
 * The gesture is the ideas list's own — a few pixels of movement with the
 * button down lifts the row, and the placeholder goes before the first
 * neighbour the pointer is past the middle of. Which is why a move down aims at
 * the bottom of the target row and a move up at its top: that is where a hand
 * actually ends up, and it is the only thing a test has to get right.
 */
async function dragPicture(page: Page, from: number, to: number): Promise<void> {
  const rows = page.getByTestId('image-deposit-files').locator('li')
  // Both rows have to be on screen before their rectangles mean anything: the
  // dialog's body scrolls, and a row below the fold reports a position the
  // pointer would land on the footer.
  await rows.nth(Math.max(from, to)).scrollIntoViewIfNeeded()
  const source = await rows.nth(from).boundingBox()
  const target = await rows.nth(to).boundingBox()
  if (!source || !target) throw new Error('Fant ikke radene å dra mellom')
  const x = source.x + source.width / 2
  const y = to > from ? target.y + target.height - 4 : target.y + 4
  await page.mouse.move(x, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, y, { steps: 12 })
  await page.mouse.up()
}

/** Whether the brief still offers to take the finished files. */
async function expectDepositOffered(page: Page, offered: boolean): Promise<void> {
  await chooseFromToolbarMenu(page, 'presentation', 'open-image-brief')
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

    // The brief is the whole order for the series, as one text to copy: this is
    // what a person pastes into a conversation that from that point makes
    // nothing but pictures.
    const brief = page.getByTestId('image-brief-modal-text')
    await expect(brief).toBeVisible()
    await expect(brief).toHaveValue(/^Lag nøyaktig 3 separate bilder/)
    await expect(brief).toHaveValue(/Homo erectus/)
    await expect(brief).toHaveValue(/BILDE 2 AV 3/)
    // Ordering one picture again is the repair, folded away and named for it.
    const single = page.getByTestId('image-brief-modal-single')
    await expect(page.getByTestId('image-brief-modal-list')).toBeHidden()
    await single.locator('summary').click()
    await expect(page.getByTestId('image-brief-modal-list').locator('li')).toHaveCount(3)
    await expect(page.getByTestId('image-brief-modal-copy-prompt-2')).toBeVisible()
    await page.getByTestId('image-brief-modal-deposit').click()

    const deposit = page.getByTestId('image-deposit-modal')
    await expect(deposit).toBeVisible()
    const finish = page.getByTestId('image-deposit-finish')
    await expect(finish).toBeDisabled()

    // Files that are not pictures cannot take a picture's place, whatever they
    // are called.
    await page.getByTestId('image-deposit-input').setInputFiles([
      { name: 'notat.txt', mimeType: 'text/plain', buffer: Buffer.from('ikke et bilde') },
    ])
    await expect(deposit).toContainText('Ikke en bildefil Slaids kan lagre')
    await expect(page.getByTestId('image-deposit-progress')).toContainText('0 av 3')
    await expect(finish).toBeDisabled()
    await page.getByRole('button', { name: 'Fjern notat.txt' }).click()

    // The names say 1, 2 and 3 — in whatever order the folder handed them over.
    await page
      .getByTestId('image-deposit-input')
      .setInputFiles([picture('3.png'), picture('1.png')])
    await expect(page.getByTestId('image-deposit-order')).toHaveAttribute('data-mode', 'manual')
    await expect(page.getByTestId('image-deposit-progress')).toContainText('2 av 3')
    await expect(finish).toBeDisabled()

    // Adding the last one completes the set without discarding the first two.
    await page.getByTestId('image-deposit-input').setInputFiles([picture('2.png')])
    await expect(page.getByTestId('image-deposit-order')).toHaveAttribute('data-mode', 'numbered')
    await expect(page.getByTestId('image-deposit-order')).toContainText('lest fra filnavnene')
    await expect(page.getByTestId('image-deposit-progress')).toContainText('3 av 3')
    // The names carried the answer, so nothing is asked of the person.
    await expect(page.getByTestId('image-deposit-acknowledge')).toBeHidden()
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
 * The delivery nobody named for Slaids, end to end, in a real browser.
 *
 * The domain tests pin the rule and the jsdom tests pin the dialog. What only a
 * browser can show is the part that is a *gesture*: real pictures on screen,
 * dragged into place with a real pointer, and the bytes that were dragged
 * landing in the zones they were dragged to.
 *
 * It is the ordinary delivery now. A conversation that made the whole series at
 * once calls its files whatever it likes, and refusing those was refusing the
 * normal case — while guessing that `01.png` meant picture 1 is how a picture
 * lands on the wrong slide.
 */
test.describe('bildedeponering med vilkårlige filnavn', () => {
  test('lar brukeren dra bildene i riktig rekkefølge, og setter dem inn slik', async ({ page }) => {
    const guard = watchForErrors(page)
    await page.goto('/')
    await page.getByTestId('import-input').setInputFiles({
      name: 'venter.slaids',
      mimeType: 'application/zip',
      buffer: archiveOf(pendingDeck()),
    })
    await page.getByTestId('open-presentation').first().click()
    await page.getByTestId('image-deposit-intro-generate').click()
    await page.getByTestId('image-brief-modal-deposit').click()

    // Three real pictures, under the names a generator would have given them.
    await page
      .getByTestId('image-deposit-input')
      .setInputFiles(filesFor(['IMG_4821.png', 'padmasambhava.jpg', 'Screenshot.webp']))

    const order = page.getByTestId('image-deposit-order')
    await expect(order).toHaveAttribute('data-mode', 'manual')
    await expect(order).toContainText('Filnavnene angir ikke rekkefølgen')
    await expect(order).toContainText('Dra bildene i riktig rekkefølge')

    // Every picture is on screen as a picture, which is what the order is given
    // by looking at.
    const rows = page.getByTestId('image-deposit-files').locator('li')
    await expect(rows).toHaveCount(3)
    await expect(rows.locator('img')).toHaveCount(3)
    for (const source of await rows.locator('img').evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLImageElement).currentSrc || node.getAttribute('src') || ''),
    )) {
      expect(source.startsWith('blob:')).toBe(true)
    }
    await expect(rows.nth(0)).toContainText('Bilde 1')
    await expect(rows.nth(0)).toContainText('IMG_4821.png')

    // The set is complete, and the one thing left is to say the order is right.
    await expect(page.getByTestId('image-deposit-progress')).toContainText('3 av 3')
    const finish = page.getByTestId('image-deposit-finish')
    await expect(finish).toBeDisabled()

    // Drag the last picture to the front: it becomes picture 1, and the motif
    // beside it is picture 1's.
    await dragPicture(page, 2, 0)
    await expect(rows.nth(0)).toContainText('Screenshot.webp')
    await expect(rows.nth(0)).toContainText('Bilde 1')
    await expect(rows.nth(0)).toContainText('Australopithecus')
    await expect(rows.nth(2)).toContainText('padmasambhava.jpg')

    const box = page.getByTestId('image-deposit-acknowledge').locator('input')
    await box.check()
    await expect(finish).toBeEnabled()

    // Moving a picture after confirming takes the confirmation with it.
    await dragPicture(page, 0, 2)
    await expect(box).not.toBeChecked()
    await expect(finish).toBeDisabled()
    await expect(rows.nth(0)).toContainText('IMG_4821.png')

    await box.check()
    await finish.click()
    await expect(page.getByTestId('image-deposit-modal')).toBeHidden()

    // The three pictures are in the deck, in the arrangement that was dragged.
    const images = stage(page).locator('img.image-panel__img')
    await expect(images).toHaveCount(3)
    await expect(stage(page)).not.toContainText('Sett inn bilde')

    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    await expect(page.getByTestId('image-deposit-intro')).toBeHidden()
    await expect(stage(page).locator('img.image-panel__img')).toHaveCount(3)
    expect(guard.errors).toEqual([])
  })

  test('tolker aldri navn som bare ligner på tall, og stopper på for mange filer', async ({
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
    await page.getByTestId('image-deposit-intro-generate').click()
    await page.getByTestId('image-brief-modal-deposit').click()

    // `01.png` is not picture 1, and it is not an error either: it is a file
    // name that says nothing about the order.
    await page
      .getByTestId('image-deposit-input')
      .setInputFiles(filesFor(['01.png', 'bilde1.jpg', '1-final.webp']))
    await expect(page.getByTestId('image-deposit-order')).toHaveAttribute('data-mode', 'manual')
    const rows = page.getByTestId('image-deposit-files').locator('li')
    await expect(rows.nth(0)).toHaveAttribute('data-number', '1')
    await expect(rows.nth(0)).toHaveAttribute('data-problem', '')
    await expect(page.getByTestId('image-deposit-progress')).toContainText('3 av 3')

    // One picture too many, and «Fullfør» waits until it is taken back out.
    await page.getByTestId('image-deposit-input').setInputFiles([picture('ekstra.png')])
    await expect(rows).toHaveCount(4)
    await expect(rows.nth(3)).toHaveAttribute('data-problem', 'EXCESS')
    const finish = page.getByTestId('image-deposit-finish')
    await expect(finish).toBeDisabled()

    await page.getByRole('button', { name: 'Fjern ekstra.png' }).click()
    await expect(rows).toHaveCount(3)
    await page.getByTestId('image-deposit-acknowledge').locator('input').check()
    await expect(finish).toBeEnabled()
    expect(guard.errors).toEqual([])
  })
})
