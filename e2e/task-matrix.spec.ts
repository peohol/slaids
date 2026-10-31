/**
 * The task matrix (docs/UX_BASELINE.md § 2), walked and counted.
 *
 * U0 counted how many presses each everyday task took before the UX work;
 * this does the same tasks in the current interface, the shortest way a
 * person would find, and counts the presses the page actually receives. So the
 * before/after in docs/UX_QA_REPORT.md is a measurement, not an estimate, and a
 * later change that makes a common task longer fails here instead of passing
 * unnoticed.
 *
 * Counted as in the baseline: a press of a pointer on a control. Typing and
 * choosing a file in the system dialog are not counted. Each task's budget is
 * what it takes now; where that is more than the baseline, the row says why
 * the extra press was accepted.
 */

import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { backToLibrary, clickZone, stage, zoneRects } from './helpers'

declare global {
  interface Window {
    __presses?: number
  }
}

interface Task {
  /** The row in UX_BASELINE.md § 2. */
  name: string
  baseline: string
  budget: number
  /** Why the budget is above the baseline, when it is. */
  accepted?: string
  /** Getting to where the task starts, not counted. */
  setup?: (page: Page) => Promise<void>
  run: (page: Page) => Promise<void>
}

const PICTURE = {
  name: 'bilde.svg',
  mimeType: 'image/svg+xml',
  buffer: Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200" fill="#4070d0"/></svg>',
  ),
}

const presses = (page: Page) => page.evaluate(() => window.__presses ?? 0)

async function chooseFile(page: Page): Promise<void> {
  await expect(page.getByTestId('image-modal')).toBeVisible()
  await page.getByTestId('image-input').setInputFiles(PICTURE)
  await expect(page.getByTestId('image-modal')).toBeHidden()
}

/** The tasks in the baseline's order, each starting where the one before left off. */
const TASKS: Task[] = [
  {
    name: 'Ny presentasjon',
    baseline: '2',
    budget: 2,
    run: async (page) => {
      await page.getByTestId('new-presentation').click()
      await page.getByTestId('presentation-title-input').fill('Oppgavematrise')
      await page.getByTestId('create-presentation').click()
      await expect(page.getByTestId('stage-slide')).toBeVisible()
    },
  },
  {
    name: 'Ny slide',
    baseline: '2',
    budget: 2,
    run: async (page) => {
      const before = await page.getByTestId('filmstrip-item').count()
      await page.getByTestId('add-slide').click()
      await page.getByTestId('new-slide-with-title').click()
      await expect(page.getByTestId('filmstrip-item')).toHaveCount(before + 1)
    },
  },
  {
    name: 'Kort med tittel',
    baseline: '2',
    budget: 1,
    run: async (page) => {
      await stage(page).getByTestId('empty-zone-titled-card').click()
      await expect(stage(page).locator('.card-header')).toBeVisible()
    },
  },
  {
    name: 'Rediger tekst',
    baseline: '1',
    budget: 1,
    run: async (page) => {
      await stage(page).locator('.subfield .tiptap').first().click()
      await page.keyboard.type('Omsetningen økte.')
      await expect(stage(page).locator('.subfield')).toContainText('Omsetningen økte.')
    },
  },
  {
    name: 'Angre / gjør om',
    baseline: '1',
    budget: 1,
    run: async (page) => {
      const field = stage(page).locator('.subfield').first()
      await page.getByTestId('undo').click()
      await expect(field).not.toContainText('Omsetningen økte.')
      await page.keyboard.press('Control+Shift+Z')
      await expect(field).toContainText('Omsetningen økte.')
    },
  },
  {
    name: 'Del en sone',
    baseline: '4',
    budget: 4,
    setup: async (page) => {
      await page.getByTestId('add-slide').click()
      await page.getByTestId('new-slide-without-title').click()
    },
    run: async (page) => {
      await page.getByTestId('mode-zone').click()
      const [zone] = await zoneRects(page)
      await clickZone(page, zone)
      await page.getByTestId('inspector-action-split').click()
      await page.getByTestId('split-count').fill('2')
      await page.getByTestId('split-apply').click()
      await expect(page.getByTestId('split-modal')).toBeHidden()
      await expect.poll(async () => (await zoneRects(page)).length).toBe(2)
    },
  },
  {
    name: 'Endre størrelse',
    baseline: '2',
    budget: 2,
    run: async (page) => {
      const [first] = await zoneRects(page)
      await clickZone(page, first)
      await page.getByTestId('zone-size-grow').click()
      await expect(page.getByTestId('zone-ratios')).toHaveText('2 : 1')
    },
  },
  {
    name: 'Avansert sonestørrelse (tallfelt)',
    baseline: '1–2',
    budget: 2,
    run: async (page) => {
      const [, second] = await zoneRects(page)
      await clickZone(page, second)
      await page.getByText('Juster hver sone').click()
      await page.getByTestId('zone-weight-1').fill('3')
      await expect(page.getByTestId('zone-ratios')).toHaveText('2 : 3')
    },
  },
  {
    name: 'Sett inn bilde og erstatt fil',
    baseline: '3–4',
    budget: 2,
    setup: (page) => page.getByTestId('mode-content').click(),
    run: async (page) => {
      await stage(page).getByTestId('empty-zone-image').first().click()
      await chooseFile(page)
      await expect(stage(page).locator('img.image-panel__img')).toHaveCount(1)
      await page.getByTestId('open-image').click()
      await chooseFile(page)
      await expect(stage(page).locator('img.image-panel__img')).toHaveCount(1)
    },
  },
  {
    name: 'Flytt / dupliser slide',
    baseline: '1',
    budget: 2,
    accepted:
      'Fire permanente ikonknapper per miniatyr ble én «Flere handlinger»-meny (U5); flytting kan også gjøres med dra og slipp.',
    run: async (page) => {
      const before = await page.getByTestId('filmstrip-item').count()
      await page.getByTestId('filmstrip-item').nth(1).getByTestId('slide-more').click()
      await page.getByTestId('context-menu').getByTestId('duplicate-slide').click()
      await expect(page.getByTestId('filmstrip-item')).toHaveCount(before + 1)
    },
  },
  {
    name: 'Finn bildebrief',
    baseline: '1',
    budget: 2,
    accepted: 'Et ikon blant sju like ble en navngitt oppføring i menyen «Presentasjon» (U2).',
    run: async (page) => {
      await page.getByTestId('toolbar-menu-presentation').click()
      await page.getByTestId('context-menu').getByTestId('open-image-brief').click()
      await expect(page.getByTestId('image-brief-modal')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('image-brief-modal')).toBeHidden()
    },
  },
  {
    name: 'Vis',
    baseline: '1 (utenfor vinduet ved 1025–1180 px)',
    budget: 1,
    run: async (page) => {
      await page.getByTestId('present').click()
      await expect(page.getByTestId('present-view')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('editor')).toBeVisible()
    },
  },
  {
    name: 'Finn «kopier presentasjons-ID»',
    baseline: '1',
    budget: 2,
    accepted: 'Et `<>`-ikon som ikke sa hva det gjorde ble en navngitt oppføring i kortets «Flere handlinger» (U5).',
    setup: backToLibrary,
    run: async (page) => {
      await page.getByTestId('presentation-card').first().getByTestId('presentation-more').click()
      await page.getByTestId('context-menu').getByTestId('copy-presentation-id').click()
      await expect(page.getByText('Presentasjons-ID kopiert')).toBeVisible()
    },
  },
]

test('oppgavematrisen holder seg innenfor antall trykk fra baseline eller en begrunnet økning', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://localhost:4173',
  })
  await page.addInitScript(() => {
    window.__presses = 0
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (event.isTrusted) window.__presses = (window.__presses ?? 0) + 1
      },
      true,
    )
  })
  await page.goto('/')

  const rows: string[] = []
  for (const task of TASKS) {
    await task.setup?.(page)
    await page.evaluate(() => {
      window.__presses = 0
    })
    await test.step(task.name, () => task.run(page))
    const count = await presses(page)
    rows.push(`${task.name}: ${count} (baseline ${task.baseline})`)
    expect.soft(count, `${task.name}${task.accepted ? ` – ${task.accepted}` : ''}`).toBeLessThanOrEqual(task.budget)
  }
  test.info().annotations.push({ type: 'oppgavematrise', description: rows.join('\n') })
})
