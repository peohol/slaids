import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test, type Page } from './fixtures'
import {
  addContentToZone,
  backToLibrary,
  createPresentation,
  enterZoneMode,
  stage,
  zoneRects,
} from './helpers'
import { openPanel, type CompactPanel } from './compactHelpers'

/**
 * The chrome, checked as assistive technology and the operating system see it.
 *
 * Four kinds of check, each a rule rather than an example:
 *  - an automated WCAG audit (axe-core) of the chrome in the states a person
 *    actually passes through, on the desktop and on a phone;
 *  - the keyboard: every toolbar control is reached in reading order and shows
 *    where the focus is;
 *  - a disabled control says why, in the same words on every surface;
 *  - the operating system's own requests — reduced motion and forced colours —
 *    are honoured everywhere, not in the one component someone remembered.
 *
 * The slide itself is left out of the audit on purpose: its colours and type
 * are the presentation's theme, chosen by the author, and the slide is not app
 * chrome (UX_IMPROVEMENT_PLAN.md § 3).
 */

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

/**
 * WCAG 2.2 A and AA, and axe's best practices, minus one.
 *
 * `region` asks for every piece of content to sit in a landmark. The text
 * toolbar (`role="toolbar"`, named for its field) sits between the banner and
 * the main landmark, and the menus are portalled to the end of the document
 * like every Radix popup; neither is content a reader navigates *to* by
 * landmark. The landmarks themselves — banner, main, the two named
 * complementary panels — are checked by `landmark-*`, which stay on.
 */
async function audit(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE_SOURCE })
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (...args: unknown[]) => Promise<AxeResult> } })
      .axe
    interface AxeResult {
      violations: Array<{ id: string; nodes: Array<{ target: string[] }> }>
    }
    const result = await axe.run(
      { include: [document.body], exclude: [['[data-testid="stage-slide"]']] },
      {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
        },
        rules: { region: { enabled: false } },
      },
    )
    /*
     * A thumbnail is a picture of a page inside a button named after the page
     * («Slide 3»). Its words are the slide's, drawn at a sixth of their size
     * and hidden from assistive technology; they are not the button's label,
     * which is what WCAG 2.5.3 (label in name) is about.
     */
    const pictureOfAPage = (target: string[]) =>
      document.querySelector(target.join(' '))?.matches('.filmstrip__thumb') ?? false
    return result.violations
      .map((violation) => ({
        ...violation,
        nodes: violation.nodes.filter(
          (node) => !(violation.id === 'label-content-name-mismatch' && pictureOfAPage(node.target)),
        ),
      }))
      .filter((violation) => violation.nodes.length > 0)
      .map(
        (violation) =>
          `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
      )
  })
}

/** A deck with a card, so the inspector and the text toolbar have something to show. */
async function deckWithCard(page: Page): Promise<void> {
  await createPresentation(page, 'Tilgjengelighet')
  const [zone] = await zoneRects(page)
  await addContentToZone(page, zone.id, 'titled-card')
}

test.describe('tilgjengelighet på desktop', () => {
  test('biblioteket og editorens tilstander har ingen WCAG-brudd', async ({ page }) => {
    await deckWithCard(page)
    const states: Array<[string, () => Promise<void>]> = [
      ['innholdsmodus med valgt sone', async () => {}],
      [
        'tekstfelt i arbeid',
        async () => {
          await stage(page).locator('.card-header .tiptap').click()
          await page.keyboard.type('Overskrift')
          await expect(page.getByTestId('text-toolbar')).toBeVisible()
        },
      ],
      [
        'presentasjonsmenyen åpen',
        async () => {
          await page.getByTestId('toolbar-menu-presentation').click()
          await expect(page.getByTestId('context-menu')).toBeVisible()
        },
      ],
      [
        'innholdstypemenyen åpen',
        async () => {
          await page.keyboard.press('Escape')
          await page.getByTestId('toolbar-menu-content-kind').click()
          await expect(page.getByTestId('context-menu')).toBeVisible()
        },
      ],
      [
        'sonemodus',
        async () => {
          await page.keyboard.press('Escape')
          await enterZoneMode(page)
        },
      ],
      [
        'en dialog',
        async () => {
          await page.getByTestId('add-slide').click()
          await expect(page.getByTestId('new-slide-modal')).toBeVisible()
        },
      ],
      [
        'forsiden, der det meste er utilgjengelig',
        async () => {
          await page.keyboard.press('Escape')
          await expect(page.getByTestId('new-slide-modal')).toBeHidden()
          await page.getByTestId('filmstrip-thumb').first().click()
          await expect(page.getByTestId('mode-zone')).toBeDisabled()
        },
      ],
      [
        'biblioteket',
        async () => {
          await backToLibrary(page)
        },
      ],
    ]
    const found: string[] = []
    for (const [name, reach] of states) {
      await reach()
      for (const violation of await audit(page)) found.push(`${name} — ${violation}`)
    }
    expect(found).toEqual([])
  })

  test('tastaturet når hver kontroll i hovedlinjen i leserekkefølge, med synlig fokus', async ({
    page,
  }) => {
    await deckWithCard(page)
    // Into the toolbar by the keyboard, so the focus is the keyboard's own and
    // `:focus-visible` is what a keyboard user would actually see.
    await page.getByTestId('back-to-library').focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByTestId('back-to-library')).toBeFocused()
    const toolbar = page.getByTestId('top-toolbar')
    const visited: Array<{ name: string; x: number; ring: boolean }> = []
    for (let step = 0; step < 40; step += 1) {
      const inside = await toolbar.evaluate((element) => element.contains(document.activeElement))
      if (!inside) break
      visited.push(
        await page.evaluate(() => {
          const element = document.activeElement as HTMLElement
          const style = getComputedStyle(element)
          return {
            name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
            x: element.getBoundingClientRect().left,
            ring: style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2,
          }
        }),
      )
      await page.keyboard.press('Tab')
    }
    // Every control the toolbar has, which is more than a handful.
    expect(visited.length).toBeGreaterThan(10)
    expect(visited.filter((entry) => !entry.ring).map((entry) => entry.name)).toEqual([])
    // Left to right, as it reads: a focus that jumped back would be a control
    // out of place in the tab order.
    const xs = visited.map((entry) => entry.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })

  test('en utilgjengelig kontroll i hovedlinjen sier hvorfor, med mus og tastatur, med samme ord som kompaktpanelet', async ({
    page,
  }) => {
    await createPresentation(page, 'Grunner')
    await page.getByTestId('filmstrip-thumb').first().click()
    const reasons: Record<string, string> = {
      'mode-zone': 'Denne siden har ingen soner å redigere.',
      'toggle-title': 'Denne siden har ingen overskriftssone å slå av eller på.',
      'open-image': 'Denne siden har ingen soner å sette et bilde i.',
      // Local mode has no backend to publish to.
      'toggle-share': 'Deling krever Supabase',
    }
    const tooltip = (reason: string) => page.locator('.tooltip').filter({ hasText: reason })

    // The mouse: the reason opens over the control itself.
    for (const [testId, reason] of Object.entries(reasons)) {
      const control = page.getByTestId(testId)
      await expect(control).toBeDisabled()
      await control.hover()
      await expect(tooltip(reason)).toBeVisible()
      // Away the way a hand goes, so the tooltip closes before the next one.
      await page.mouse.move(800, 600, { steps: 8 })
      await expect(page.locator('.tooltip')).toHaveCount(0)
    }

    // The keyboard: each is a tab stop, says why on focus — to the eye and as
    // its accessible description — and refuses Enter as it refuses a click.
    await page.getByTestId('back-to-library').focus()
    const pending = new Map(Object.entries(reasons))
    for (let step = 0; step < 40 && pending.size > 0; step += 1) {
      await page.keyboard.press('Tab')
      const testId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '')
      const reason = pending.get(testId)
      if (!reason) continue
      await expect(tooltip(reason)).toBeVisible()
      await expect(page.getByTestId(testId)).toHaveAccessibleDescription(reason)
      await page.keyboard.press('Enter')
      pending.delete(testId)
    }
    expect([...pending.keys()], 'ikke nådd med Tab').toEqual([])
    await expect(page.getByTestId('mode-content')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('zone-overlay')).toBeHidden()
    await expect(page.getByTestId('image-modal')).toHaveCount(0)
    await expect(page.getByTestId('toggle-share')).toHaveAttribute('data-state', 'unsupported')
  })

  test('en lenke i en slide er ikke et tabstopp i miniatyren, og miniatyren heter som siden', async ({
    page,
  }) => {
    await deckWithCard(page)
    await stage(page).locator('.subfield .tiptap').first().click()
    await page.keyboard.type('Kilden ligger her')
    await page.keyboard.press('Control+a')
    page.once('dialog', (dialog) => dialog.accept('https://example.invalid/kilde'))
    await page.getByTestId('format-link').click()
    await expect(stage(page).locator('a')).toHaveCount(1)

    const thumb = page.getByTestId('filmstrip-item').nth(1).getByTestId('filmstrip-thumb')
    // The thumbnail draws the page, link and all…
    await expect(thumb.locator('a')).toHaveCount(1)
    await expect(thumb).toHaveAccessibleName('Slide 2')
    // …but Tab goes from the slide's button past it, and back again.
    await thumb.focus()
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.closest('.filmstrip__thumb') ?? null)).toBeNull()
    await page.keyboard.press('Shift+Tab')
    await expect(thumb).toBeFocused()
    expect(await audit(page)).toEqual([])
  })

  test('valgt tilstand er semantisk overalt der den er synlig', async ({ page }) => {
    await deckWithCard(page)
    await stage(page).locator('.card-header .tiptap').click()
    // The selected look comes from `aria-pressed` (UX_DESIGN_SYSTEM.md § 3), so
    // a control that looks selected without saying so has bypassed it.
    const unspoken = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.btn--active:not([aria-pressed="true"])')].map(
          (element) => element.getAttribute('data-testid') ?? element.outerHTML.slice(0, 80),
        ),
      )
    expect(await unspoken()).toEqual([])
    await enterZoneMode(page)
    expect(await unspoken()).toEqual([])
    await expect(page.getByTestId('mode-zone')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('mode-content')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('filmstrip-thumb').nth(1)).toHaveAttribute('aria-current', 'true')
  })
})

test.describe('operativsystemets egne ønsker', () => {
  test('redusert bevegelse gjelder hele grensesnittet', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await deckWithCard(page)
    await page.getByTestId('toolbar-menu-presentation').click()
    await expect(page.getByTestId('context-menu')).toBeVisible()
    // Every element in the document, open menu included: the longest
    // transition or animation anything is allowed.
    const longest = await page.evaluate(() => {
      const seconds = (value: string) =>
        Math.max(...value.split(',').map((part) => Number.parseFloat(part) * (part.trim().endsWith('ms') ? 0.001 : 1)))
      let worst = { seconds: 0, what: '' }
      for (const element of document.querySelectorAll('*')) {
        const style = getComputedStyle(element)
        const own = Math.max(seconds(style.transitionDuration), seconds(style.animationDuration))
        if (own > worst.seconds) worst = { seconds: own, what: element.className.toString() }
      }
      return worst
    })
    expect(longest.seconds, longest.what).toBeLessThanOrEqual(0.001)
  })

  test('tvungne farger beholder valgt tilstand og menyens markør', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await deckWithCard(page)
    // In this mode the system replaces every background, so state has to be
    // an edge. Selected first: the mode in force.
    const pressed = page.getByTestId('mode-content')
    await expect(pressed).toHaveAttribute('aria-pressed', 'true')
    expect(await pressed.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid')
    expect(
      await page.getByTestId('mode-zone').evaluate((element) => getComputedStyle(element).outlineStyle),
    ).toBe('none')

    // Then where the keyboard is in a menu.
    await page.getByTestId('toolbar-menu-presentation').focus()
    await page.keyboard.press('Enter')
    const highlighted = page.locator('[data-testid="context-menu"] [data-highlighted]')
    await expect(highlighted).toHaveCount(1)
    expect(await highlighted.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
      'solid',
    )
  })
})

test.describe('tilgjengelighet på telefon', () => {
  test.use({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true })

  test('verktøypanelet gir samme grunner som hovedlinjen på desktop', async ({ page }) => {
    await createPresentation(page, 'Grunner')
    await openPanel(page, 'slides')
    await page.getByTestId('filmstrip-thumb').first().click()
    await openPanel(page, 'tools')
    await expect(page.getByTestId('compact-tool-reason-image')).toHaveText(
      'Denne siden har ingen soner å sette et bilde i.',
    )
    await expect(page.getByTestId('compact-tool-reason-title')).toHaveText(
      'Denne siden har ingen overskriftssone å slå av eller på.',
    )
  })

  test('scenen og hvert panel har ingen WCAG-brudd', async ({ page }) => {
    await createPresentation(page, 'Tilgjengelighet')
    const found: string[] = []
    for (const violation of await audit(page)) found.push(`scenen — ${violation}`)
    const panels: CompactPanel[] = ['slides', 'content', 'zone', 'tools']
    for (const panel of panels) {
      await openPanel(page, panel)
      for (const violation of await audit(page)) found.push(`${panel} — ${violation}`)
    }
    expect(found).toEqual([])
  })
})
