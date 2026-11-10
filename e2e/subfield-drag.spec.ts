/**
 * Delestrekene mellom delfelt kan dras i vanlig innholdsredigering, med de
 * delene av sonedraget som gir mening inni ett kort: trinn i hele
 * forholdstall, Shift, Escape og den myke grensen der teksten tegnes mindre.
 * Se `ui/editor/subfieldDrag.ts` og `ui/editor/useSubfieldDrag.tsx`.
 */

import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addContentToZone,
  caretInto,
  clickZone,
  createPresentation,
  drawnSmaller,
  enterContentMode,
  enterZoneMode,
  stage,
  waitForSaved,
  watchForErrors,
  zoneRects,
} from './helpers'

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function fieldBoxes(page: Page, scope = stage(page)): Promise<Box[]> {
  return scope.locator('.subfield').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }),
  )
}

/** Hvert felts andel av bredden feltene deler, avrundet nok til å sammenligne visninger. */
function shares(boxes: Box[]): number[] {
  const total = boxes.reduce((sum, box) => sum + box.width, 0)
  return boxes.map((box) => Math.round((box.width / total) * 1000) / 1000)
}

/** Et kort i hele sliden med `count` delfelt side om side, i innholdsmodus. */
async function cardWithColumns(page: Page, title: string, count: number): Promise<void> {
  await createPresentation(page, title)
  await enterContentMode(page)
  const [zone] = await zoneRects(page)
  await addContentToZone(page, zone.id, 'untitled-card')
  await enterZoneMode(page)
  await clickZone(page, zone)
  await page.getByTestId('subfield-count').fill(String(count))
  await page.getByTestId('subfield-axis-x').click()
  await expect(stage(page).locator('.subfield')).toHaveCount(count)
  await enterContentMode(page)
}

/** Dra delestrek `boundary` sidelengs med `dx` skjermpiksler, i små steg slik en hånd gjør. */
async function dragDivider(
  page: Page,
  boundary: number,
  dx: number,
  { shift = false, release = true }: { shift?: boolean; release?: boolean } = {},
): Promise<void> {
  const handle = stage(page).getByTestId(`subfield-divider-${boundary}`)
  const box = await handle.boundingBox()
  if (!box) throw new Error('fant ikke delestreken')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.down()
  const steps = Math.max(1, Math.round(Math.abs(dx) / 4))
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(x + (dx * step) / steps, y)
  }
  if (!release) return
  await page.mouse.up()
  if (shift) await page.keyboard.up('Shift')
}

test.describe('delestreker mellom delfelt', () => {
  test('dras i innholdsmodus, lagres i hele trinn og presenteres likt', { tag: '@pr' }, async ({ page }) => {
    const guard = watchForErrors(page)
    await cardWithColumns(page, 'Delestrek', 2)
    const before = shares(await fieldBoxes(page))
    expect(before[0]).toBeCloseTo(0.5, 2)

    const width = (await fieldBoxes(page)).reduce((sum, box) => sum + box.width, 0)
    await dragDivider(page, 0, width / 6)

    // Halvparten pluss en sjettedel er to tredjedeler: trinnet 2 : 1.
    await expect.poll(async () => shares(await fieldBoxes(page))[0]).toBeCloseTo(2 / 3, 2)
    const edited = shares(await fieldBoxes(page))

    // Det som er lagret, er det som ble vist: samme inndeling etter en ny innlasting …
    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    expect(shares(await fieldBoxes(page))).toEqual(edited)

    // … og i presentasjonen.
    await page.getByTestId('present').click()
    const presented = page.getByTestId('present-view')
    await expect(presented).toBeVisible()
    expect(shares(await fieldBoxes(page, presented))).toEqual(edited)
    expect(guard.errors).toEqual([])
  })

  test('Escape slipper draget uten å lagre noe', async ({ page }) => {
    await cardWithColumns(page, 'Delestrek angret', 2)
    const width = (await fieldBoxes(page)).reduce((sum, box) => sum + box.width, 0)
    await dragDivider(page, 0, width / 6, { release: false })
    await expect.poll(async () => shares(await fieldBoxes(page))[0]).toBeGreaterThan(0.6)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await page.waitForTimeout(200)
    expect(shares(await fieldBoxes(page))[0]).toBeCloseTo(0.5, 2)
  })

  test('flytter bare de to feltene ved streken, og med Shift beholder blokkene sine forhold', async ({
    page,
  }) => {
    await cardWithColumns(page, 'Delestrek med Shift', 3)
    const width = (await fieldBoxes(page)).reduce((sum, box) => sum + box.width, 0)

    // Uten Shift: det tredje feltet står stille.
    await dragDivider(page, 0, width / 9)
    await expect.poll(async () => shares(await fieldBoxes(page))[0]).toBeGreaterThan(0.38)
    const plain = shares(await fieldBoxes(page))
    expect(plain[2]).toBeCloseTo(1 / 3, 1)

    // Med Shift: de to første skaleres sammen og beholder forholdet seg imellom.
    await dragDivider(page, 1, -width / 6, { shift: true })
    await expect.poll(async () => shares(await fieldBoxes(page))[2]).toBeGreaterThan(0.4)
    const shifted = shares(await fieldBoxes(page))
    expect(shifted[0] / shifted[1]).toBeCloseTo(plain[0] / plain[1], 1)
  })

  test('et felt kan dras smalere enn teksten trenger, og da tegnes teksten mindre', async ({ page }) => {
    await cardWithColumns(page, 'Delestrek under myk grense', 2)
    const field = stage(page).locator('.subfield .tiptap').first()
    await caretInto(field)
    await page.keyboard.insertText('Dette er en setning med noen helt vanlige ord i seg. '.repeat(12))
    await page.waitForTimeout(300)
    expect(await drawnSmaller(field)).toBe(false)

    const width = (await fieldBoxes(page)).reduce((sum, box) => sum + box.width, 0)
    await dragDivider(page, 0, -width * 0.38)
    await expect.poll(async () => shares(await fieldBoxes(page))[0]).toBeLessThan(0.2)
    expect(await drawnSmaller(field)).toBe(true)

    // Tilbake til likt fjerner forminskningen igjen.
    await dragDivider(page, 0, width * 0.38)
    await expect.poll(async () => shares(await fieldBoxes(page))[0]).toBeCloseTo(0.5, 1)
    expect(await drawnSmaller(field)).toBe(false)
  })
})
