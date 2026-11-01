import { expect, test, type Locator, type Page } from './fixtures'
import { closeKeyboard, isCompact, isOnScreen, openKeyboard, openPanel } from './compactHelpers'
import {
  chooseFromToolbarMenu,
  enterSubmenu,
  closeSplitDialog,
  createPresentation,
  enterZoneMode,
  nestedDeck,
  openSplitDialog,
  waitForSaved,
  watchForErrors,
  zoneRects,
  type ZoneRect,
} from './helpers'

/**
 * Zone editing as one tool rather than several (zone-editing plan, Z3).
 *
 * The rules under test, each across every surface that has it:
 *  - every way into the split dialog names the same zone, with the same path
 *    and the same action, and closing it leaves the focus where it was;
 *  - a split's own distribution and its size among its siblings are two
 *    questions with two names and two sets of numbers, in the inspector as in
 *    the menu, and each changes only what it says;
 *  - the template editor speaks the same words, marks «valgt» the same way and
 *    can be walked with the keyboard;
 *  - the dialogs hold at 200 % zoom, with an on-screen keyboard, with fingers
 *    and in forced colours.
 */

/** The nested split of `nestedDeck`: the lower half, «Rot › 2», three zones side by side. */
async function selectLowerSplit(page: Page): Promise<void> {
  await page.getByTestId('inspector-child-1').click()
  await expect(page.getByTestId('inspector-breadcrumb').locator('[aria-current]')).toHaveText('2')
}

/** The upper zone, and the lower zone's three, each sorted along its row. */
function rows(zones: ZoneRect[]): { upper: ZoneRect; lower: ZoneRect[] } {
  const top = Math.min(...zones.map((zone) => zone.y))
  const upper = zones.find((zone) => Math.abs(zone.y - top) < 1) as ZoneRect
  const lower = zones.filter((zone) => zone !== upper).sort((a, b) => a.x - b.x)
  return { upper, lower }
}

/** An entry of the selected zone's menu, through a submenu when `submenu` is given. */
async function openZoneMenuEntry(page: Page, entry: string, submenu?: string): Promise<void> {
  await page.getByTestId('inspector-action-more').click()
  await expect(page.getByTestId('context-menu')).toBeVisible()
  if (submenu) {
    await page.getByTestId(`menu-${submenu}`).click()
    await enterSubmenu(page, submenu)
  }
  // By the keyboard: a pointer crossing into a submenu is a race (e2e-ci notes).
  await page.getByTestId(`menu-${entry}`).focus()
  await page.keyboard.press('Enter')
}

/** «Maler …», from the toolbar's menu or — on a compact workspace — from the tools panel. */
async function openTemplates(page: Page): Promise<void> {
  if (await isCompact(page)) {
    await openPanel(page, 'tools')
    await page.getByTestId('compact-tool-templates').click()
  } else {
    await chooseFromToolbarMenu(page, 'presentation', 'open-templates')
  }
  await expect(page.getByTestId('template-modal')).toBeVisible()
}

/** How far the page and the dialog reach past their own width, and whether its ends are on screen. */
async function dialogFits(dialog: Locator) {
  return dialog.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const header = element.querySelector('.dialog__title')?.getBoundingClientRect()
    const footer = element.querySelector('.dialog__footer')?.getBoundingClientRect()
    return {
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      bodyOverflow: (() => {
        const body = element.querySelector('.dialog__body') as HTMLElement
        return body.scrollWidth - body.clientWidth
      })(),
      inside: box.left >= -0.5 && box.right <= window.innerWidth + 0.5,
      header: header ? header.top >= -0.5 && header.bottom <= window.innerHeight + 0.5 : false,
      footer: footer ? footer.top >= -0.5 && footer.bottom <= window.innerHeight + 0.5 : false,
    }
  })
}

/** The preview box: not scrolling, and the drawing inside it. */
async function previewHolds(preview: Locator) {
  return preview.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const drawing = element.querySelector('svg')?.getBoundingClientRect()
    return {
      scrolls: element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1,
      contained: drawing
        ? drawing.left >= box.left - 0.5 &&
          drawing.top >= box.top - 0.5 &&
          drawing.right <= box.right + 0.5 &&
          drawing.bottom <= box.bottom + 0.5
        : false,
    }
  })
}

test.describe('soneredigering som ett verktøy', () => {
  test(
    'every way into the split dialog names the same zone and action, and gives the focus back',
    { tag: '@pr' },
    async ({ page }) => {
      const guard = watchForErrors(page)
      await nestedDeck(page)
      await selectLowerSplit(page)

      // With the opener the focus goes back to: for a menu entry, which is
      // gone by then, the button the menu was opened from.
      const split: Array<[string, () => Promise<void>, string]> = [
        ['inspektøren', () => page.getByTestId('inspector-action-split').click(), 'inspector-action-split'],
        ['ikonraden over sonen', () => page.getByTestId('zone-action-split').click(), 'zone-action-split'],
        ['sonemenyen', () => openZoneMenuEntry(page, 'edit-split'), 'inspector-action-more'],
        ['forholdstallene i sonemenyen', () => openZoneMenuEntry(page, 'ratios-custom', 'ratios'), 'inspector-action-more'],
      ]
      for (const [name, open, opener] of split) {
        await open()
        await expect(page.getByRole('dialog', { name: 'Rediger deling' }), name).toBeVisible()
        await expect(page.getByTestId('split-target'), name).toHaveText('Du redigerer: Rot › 2')
        await expect(page.getByTestId('split-count'), name).toHaveValue('3')
        await expect(page.getByTestId('split-legend'), name).toContainText('Heltrukket: sonene du endrer.')
        await closeSplitDialog(page)
        // Nothing changed, the selection is where it was, and the focus is
        // back on the control that opened the dialog.
        await expect(page.getByTestId('inspector-breadcrumb').locator('[aria-current]'), name).toHaveText('2')
        await expect(page.getByTestId(opener), name).toBeFocused()
      }

      // A leaf: «Del sone» from each entrance, for «Rot › 2 › 3».
      await page.getByTestId('inspector-child-2').click()
      const leaf: Array<[string, () => Promise<void>]> = [
        ['inspektøren', () => page.getByTestId('inspector-action-split').click()],
        ['ikonraden over sonen', () => page.getByTestId('zone-action-split').click()],
        ['sonemenyen', () => openZoneMenuEntry(page, 'split-advanced', 'split')],
      ]
      for (const [name, open] of leaf) {
        await open()
        await expect(page.getByRole('dialog', { name: 'Del sone' }), name).toBeVisible()
        await expect(page.getByTestId('split-target'), name).toHaveText('Du redigerer: Rot › 2 › 3')
        await expect(page.getByTestId('split-count'), name).toHaveValue('2')
        await closeSplitDialog(page)
      }
      // The inspector and the icon row offer it under the zone menu's name.
      await expect(page.getByTestId('inspector-action-split')).toContainText('Del sone …')
      await expect(page.getByTestId('zone-action-split')).toHaveAttribute('aria-label', 'Del sone …')
      expect(await zoneRects(page)).toHaveLength(4)
      expect(guard.errors).toEqual([])
    },
  )

  test('the split dialog is used from the keyboard alone, start to finish', async ({ page }) => {
    await createPresentation(page, 'Tastaturdeling')
    await enterZoneMode(page)
    await page.getByTestId('inspector-action-split').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Del sone' })).toBeVisible()

    // The direction is one group: the arrows move between its two choices.
    await page.getByTestId('split-axis-x').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('split-axis-y')).toBeFocused()
    await page.keyboard.press('Space')
    await expect(page.getByTestId('split-axis-y')).toHaveAttribute('data-state', 'on')

    // Then on through the fields in reading order, to «Bruk».
    const order: string[] = []
    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press('Tab')
      const id = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid ?? '')
      if (id) order.push(id)
      if (id === 'split-weight-1') await page.keyboard.type('3')
      if (id === 'split-apply') break
    }
    const reading = ['split-count', 'split-weight-0', 'split-weight-1', 'split-apply']
    expect(order.filter((id) => reading.includes(id))).toEqual(reading)
    await expect(page.getByTestId('split-quantized')).toContainText('1 : 3')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('split-modal')).toBeHidden()
    expect(await zoneRects(page)).toHaveLength(2)
    // Back on the control it was opened from, now named for what the zone is.
    await expect(page.getByTestId('inspector-action-split')).toBeFocused()
    await expect(page.getByTestId('inspector-action-split')).toContainText('Rediger deling …')
  })

  test('keeps a split’s own distribution apart from its size among its siblings', async ({ page }) => {
    const guard = watchForErrors(page)
    await nestedDeck(page)
    await selectLowerSplit(page)

    const inside = page.getByTestId('inspector-distribution')
    const among = page.getByTestId('inspector-size-section')
    await expect(inside.getByRole('heading', { level: 2 })).toHaveText('Fordeling inni denne sonen')
    await expect(among.getByRole('heading', { level: 2 })).toHaveText('Størrelse blant søskensonene')
    await expect(inside.getByTestId('zone-size-scope')).toHaveText(
      'Forholdet mellom de 3 direkte subsonene i Rot › 2.',
    )
    await expect(among.getByTestId('zone-size-scope')).toHaveText('Denne sonen er sone 2 av 2 i Rot.')
    await expect(inside.getByTestId('zone-ratios')).toHaveText('1 : 1 : 1')
    await expect(among.getByTestId('zone-ratios')).toHaveText('1 : 1')
    const before = rows(await zoneRects(page))

    // Inside: the first of the three widens; the row they share stays put.
    await inside.getByTestId('zone-weight-up-0').click()
    await expect(inside.getByTestId('zone-ratios')).toHaveText('2 : 1 : 1')
    await expect(among.getByTestId('zone-ratios')).toHaveText('1 : 1')
    const widened = rows(await zoneRects(page))
    expect(widened.lower[0].w).toBeGreaterThan(before.lower[0].w + 50)
    expect(widened.lower[0].h).toBeCloseTo(before.lower[0].h, 0)
    expect(widened.upper.h).toBeCloseTo(before.upper.h, 0)

    // Among its siblings: the whole lower zone grows, keeping its own distribution.
    await among.getByTestId('zone-size-grow').click()
    await expect(among.getByTestId('zone-ratios')).toHaveText('1 : 2')
    await expect(inside.getByTestId('zone-ratios')).toHaveText('2 : 1 : 1')
    const taller = rows(await zoneRects(page))
    expect(taller.lower[0].h).toBeGreaterThan(widened.lower[0].h + 50)
    expect(taller.lower[0].w / taller.lower[1].w).toBeCloseTo(widened.lower[0].w / widened.lower[1].w, 1)

    // The menu says the same two things, under the same names.
    await page.getByTestId('inspector-action-more').click()
    await expect(page.getByTestId('menu-ratios')).toContainText('Fordeling inni denne sonen')
    await expect(page.getByTestId('menu-equalize')).toContainText('Fordel subsonene likt')
    await expect(page.getByTestId('menu-equalize-siblings')).toContainText('Fordel søskensonene likt')
    await page.keyboard.press('Escape')

    // Each one undoable on its own, newest first; both stored.
    await page.keyboard.press('Control+z')
    await expect(among.getByTestId('zone-ratios')).toHaveText('1 : 1')
    await expect(inside.getByTestId('zone-ratios')).toHaveText('2 : 1 : 1')
    await page.keyboard.press('Control+Shift+z')
    await expect(among.getByTestId('zone-ratios')).toHaveText('1 : 2')
    await waitForSaved(page)
    await page.reload()
    await expect(page.getByTestId('editor')).toBeVisible()
    const stored = rows(await zoneRects(page))
    expect(stored.lower[0].h).toBeCloseTo(taller.lower[0].h, 0)
    expect(stored.lower[0].w).toBeCloseTo(taller.lower[0].w, 0)
    expect(guard.errors).toEqual([])
  })

  test('the template editor uses the same words and marks, and is walked with the keyboard', async ({ page }) => {
    const guard = watchForErrors(page)
    await nestedDeck(page, 'Mal')
    page.once('dialog', (dialog) => void dialog.accept('To rader'))
    await openTemplates(page)
    await page.getByTestId('save-template').click()
    await expect(page.getByTestId('template-item')).toHaveCount(1)
    // The list's picture is the bounded one too: the whole slide, no transform.
    const thumb = page.getByTestId('template-item').getByTestId('template-preview')
    expect(await previewHolds(thumb)).toEqual({ scrolls: false, contained: true })
    await expect(thumb.locator('.template-preview__cell')).toHaveCount(4)

    await page.getByTestId('template-item').getByRole('button', { name: 'Rediger' }).click()
    const editor = page.getByTestId('template-editor')
    await expect(editor).toBeVisible()
    const picture = editor.getByTestId('template-preview')
    expect(await previewHolds(picture)).toEqual({ scrolls: false, contained: true })
    // One solid «valgt» edge, around the root; every zone dashed, no frame per split.
    await expect(picture.locator('.template-preview__cell')).toHaveCount(4)
    await expect(picture.locator('.template-preview__selected')).toHaveCount(1)
    const strokes = await picture.evaluate((element) => ({
      cell: getComputedStyle(element.querySelector('.template-preview__cell') as Element).strokeDasharray,
      selected: getComputedStyle(element.querySelector('.template-preview__selected') as Element)
        .strokeDasharray,
    }))
    expect(strokes.cell).not.toBe('none')
    expect(strokes.selected).toBe('none')
    await expect(picture.locator('svg')).toHaveAttribute('aria-label', /Valgt sone: Rot\./)

    // Down the tree by the keyboard alone: the child list, then the path back up.
    await editor.getByTestId('template-child-1').focus()
    await page.keyboard.press('Enter')
    await expect(editor.getByTestId('template-breadcrumb').locator('[aria-current]')).toHaveText('2')
    await expect(picture.locator('svg')).toHaveAttribute('aria-label', /Valgt sone: Rot › 2\./)
    await expect(editor.getByTestId('template-split')).toHaveText('Rediger deling …')
    await editor.getByTestId('template-child-0').focus()
    await page.keyboard.press('Enter')
    await expect(editor.getByTestId('template-breadcrumb').locator('[aria-current]')).toHaveText('1')
    await expect(editor.getByTestId('template-split')).toHaveText('Del sone …')

    // The same dialog, the same path.
    await editor.getByTestId('template-split').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Del sone' })).toBeVisible()
    await expect(page.getByTestId('split-target')).toHaveText('Du redigerer: Rot › 2 › 1')
    await closeSplitDialog(page)
    await expect(editor.getByTestId('template-split')).toBeFocused()

    // The root cannot be removed, and says why in the words the inspector uses.
    await editor.getByTestId('template-breadcrumb').getByRole('button', { name: 'Rot' }).click()
    await expect(editor.getByTestId('template-delete')).toHaveAttribute('aria-disabled', 'true')
    await editor.getByTestId('template-delete').focus()
    await expect(page.getByRole('tooltip')).toContainText('Hovedsonen kan ikke slettes')

    // Deleting a zone keeps the selection where it was: on its parent, or —
    // when the parent collapses into the one sibling left — on that sibling.
    const current = editor.getByTestId('template-breadcrumb').locator('[aria-current]')
    await editor.getByTestId('template-child-1').click()
    await editor.getByTestId('template-child-0').click()
    await editor.getByTestId('template-delete').click()
    await expect(current).toHaveText('2')
    await expect(editor.getByTestId('template-split')).toHaveText('Rediger deling …')
    await editor.getByTestId('template-child-0').click()
    await editor.getByTestId('template-delete').click()
    await expect(current).toHaveText('2')
    await expect(editor.getByTestId('template-split')).toHaveText('Del sone …')
    await expect(picture.locator('.template-preview__cell')).toHaveCount(2)
    expect(guard.errors).toEqual([])
  })
})

test.describe('nettleserzoom 200 % og skjermtastatur', () => {
  /*
   * 200 % zoom is a CSS viewport half the window's size at twice the pixel
   * density: a 1366 × 768 and a 1600 × 1000 window, zoomed.
   */
  for (const viewport of [
    { width: 683, height: 384 },
    { width: 800, height: 500 },
  ]) {
    test.describe(`${viewport.width} × ${viewport.height} css px`, () => {
      test.use({ viewport, deviceScaleFactor: 2 })

      test('the split dialog and the template editor hold', async ({ page }) => {
        await createPresentation(page, 'Zoom')
        await openSplitDialog(page)
        const fits = await dialogFits(page.getByTestId('split-modal'))
        expect(fits).toEqual({ pageOverflow: 0, bodyOverflow: 0, inside: true, header: true, footer: true })
        expect(await previewHolds(page.getByTestId('split-preview'))).toEqual({ scrolls: false, contained: true })
        await expect(page.getByTestId('split-apply')).toBeInViewport()
        await closeSplitDialog(page)

        page.once('dialog', (dialog) => void dialog.accept('Zoomet'))
        await openTemplates(page)
        await page.getByTestId('save-template').click()
        await page.getByTestId('template-item').getByRole('button', { name: 'Rediger' }).click()
        const editor = page.getByTestId('template-editor')
        await expect(editor).toBeVisible()
        expect(await dialogFits(editor)).toEqual({
          pageOverflow: 0,
          bodyOverflow: 0,
          inside: true,
          header: true,
          footer: true,
        })
        expect(await previewHolds(editor.getByTestId('template-preview'))).toEqual({
          scrolls: false,
          contained: true,
        })
      })
    })
  }

  test.describe('telefon med skjermtastatur', () => {
    test.use({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true })

  test('an on-screen keyboard shrinks the preview and keeps the field and «Bruk» in reach', async ({ page }) => {
      await createPresentation(page, 'Tastatur')
      await openSplitDialog(page)
      const preview = page.getByTestId('split-preview')
      const open = (await preview.boundingBox())?.height ?? 0
      await page.getByTestId('split-weight-1').focus()
      await openKeyboard(page)
      await expect.poll(async () => (await preview.boundingBox())?.height ?? 0).toBeLessThan(open)
      expect(await previewHolds(preview)).toEqual({ scrolls: false, contained: true })
      await page.getByTestId('split-weight-1').fill('3')
      await expect(page.getByTestId('split-quantized')).toContainText('1 : 3')
      expect(await isOnScreen(page, 'split-weight-1')).toBe(true)
      expect(await isOnScreen(page, 'split-apply')).toBe(true)
      await closeKeyboard(page)
    })
  })
})

test.describe('berøring på stort nettbrett, 1180 × 820', () => {
  test.use({ viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true })

  test('every control in the size sections and the split dialog is finger-sized', async ({ page }) => {
    await nestedDeck(page, 'Fingre')
    await selectLowerSplit(page)
    await page.getByTestId('inspector-fold-zone-ratios').locator('summary').click()
    const small = async (scope: Locator) =>
      scope.evaluate((element) =>
        [...element.querySelectorAll('button, input, summary')]
          .filter((control) => (control as HTMLElement).offsetParent !== null)
          .map((control) => {
            const box = control.getBoundingClientRect()
            return { name: control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '', w: box.width, h: box.height }
          })
          .filter((control) => control.h < 44 || (control.w < 44 && control.name !== '')),
      )
    expect(await small(page.getByTestId('inspector-distribution'))).toEqual([])
    expect(await small(page.getByTestId('inspector-size-section'))).toEqual([])
    await page.getByTestId('inspector-action-split').click()
    expect(await small(page.getByTestId('split-modal'))).toEqual([])
  })
})

test.describe('tvungne farger og redusert bevegelse', () => {
  test('reduced motion holds in the split dialog and the template editor', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await nestedDeck(page, 'Rolig')
    const longest = () =>
      page.evaluate(() => {
        const seconds = (value: string) =>
          Math.max(...value.split(',').map((part) => Number.parseFloat(part) * (part.trim().endsWith('ms') ? 0.001 : 1)))
        let worst = 0
        for (const element of document.querySelectorAll('*')) {
          const style = getComputedStyle(element)
          worst = Math.max(worst, seconds(style.transitionDuration), seconds(style.animationDuration))
        }
        return worst
      })
    await page.getByTestId('inspector-action-split').click()
    await expect(page.getByTestId('split-modal')).toBeVisible()
    expect(await longest()).toBeLessThanOrEqual(0.001)
    await closeSplitDialog(page)
    page.once('dialog', (dialog) => void dialog.accept('Rolig mal'))
    await openTemplates(page)
    await page.getByTestId('save-template').click()
    await page.getByTestId('template-item').getByRole('button', { name: 'Rediger' }).click()
    await expect(page.getByTestId('template-editor')).toBeVisible()
    expect(await longest()).toBeLessThanOrEqual(0.001)
  })


  test('forced colours keep the zones being edited apart from the structure that is kept', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await nestedDeck(page, 'Høy kontrast')
    // On the stage: the selected zone is the one solid edge.
    const outlines = await page.evaluate(() =>
      [...document.querySelectorAll('[data-node-outline]')].map((element) => ({
        selected: element.classList.contains('zone-outline--selected'),
        hovered: element.classList.contains('zone-outline--hover'),
        style: getComputedStyle(element).borderTopStyle,
      })),
    )
    expect(outlines.filter((outline) => outline.selected).map((outline) => outline.style)).toEqual(['solid'])
    const rest = outlines.filter((outline) => !outline.selected && !outline.hovered)
    expect(new Set(rest.map((outline) => outline.style))).toEqual(
      new Set(['dashed']),
    )

    // In the dialog: solid, numbered zones; dashed kept structure; different system colours.
    await page.getByTestId('inspector-action-split').click()
    const drawn = await page.getByTestId('split-preview').evaluate((element) => {
      const style = (selector: string) => getComputedStyle(element.querySelector(selector) as Element)
      return {
        zone: { dash: style('[data-preview-zone]').strokeDasharray, stroke: style('[data-preview-zone]').stroke },
        divider: {
          dash: style('[data-preview-divider]').strokeDasharray,
          stroke: style('[data-preview-divider]').stroke,
        },
        labels: [...element.querySelectorAll('.split-preview__label')].map((label) => label.textContent),
      }
    })
    expect(drawn.zone.dash).toBe('none')
    expect(drawn.divider.dash).not.toBe('none')
    expect(drawn.zone.stroke).not.toBe(drawn.divider.stroke)
    expect(drawn.labels).toEqual(['1', '2'])
  })
})
