import { expect, test, type Page } from './fixtures'
import { G as BASE_G } from '../src/domain/constants'
import { computeMainRect, splitRect } from '../src/domain/geometry'
import { geometryForTheme } from '../src/domain/metrics'
import { defaultTheme } from '../src/domain/presentation'
import {
  G,
  SLIDE_WIDTH,
  chooseFromToolbarMenu,
  clickZone,
  closeSplitDialog,
  createPresentation,
  enterZoneMode,
  nestedDeck,
  openSplitDialog,
  splitSelected,
  watchForErrors,
  zoneRects,
  type ZoneRect,
} from './helpers'

/**
 * The split dialog's preview (zone-editing plan, Z1).
 *
 * What is measured here is the drawing in a real browser at a real viewport,
 * not the model behind it (that is `splitPreviewModel.test.ts`):
 *
 *  - the zones being edited are solid and numbered, kept structure is dashed,
 *    and a split child is not framed a second time;
 *  - the whole target is visible inside a bounded box that never scrolls, with
 *    all four outer edges inside it and the target's true aspect ratio;
 *  - the preview is what «Bruk» commits, in the slide editor and in the
 *    template editor alike, in the gap of the deck it measures.
 */

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

interface PreviewMeasure {
  /** The preview box's inside (its border excluded). */
  inner: Box
  scroll: { width: number; height: number; clientWidth: number; clientHeight: number }
  frame: Box
  zones: { label: string; box: Box; dashed: boolean; tooSmall: boolean }[]
  dividers: { depth: number; dashed: boolean }[]
  context: string[]
}

async function measurePreview(page: Page): Promise<PreviewMeasure> {
  const preview = page.getByTestId('split-preview')
  await expect(preview.locator('[data-preview-frame]')).toBeVisible()
  return preview.evaluate((element) => {
    const toBox = (rect: DOMRect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    })
    const outer = element.getBoundingClientRect()
    const styles = getComputedStyle(element)
    const dashed = (node: Element) => getComputedStyle(node).strokeDasharray !== 'none'
    return {
      inner: {
        left: outer.left + parseFloat(styles.borderLeftWidth),
        top: outer.top + parseFloat(styles.borderTopWidth),
        right: outer.right - parseFloat(styles.borderRightWidth),
        bottom: outer.bottom - parseFloat(styles.borderBottomWidth),
      },
      scroll: {
        width: element.scrollWidth,
        height: element.scrollHeight,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
      },
      frame: toBox(element.querySelector('[data-preview-frame]')!.getBoundingClientRect()),
      zones: [...element.querySelectorAll('[data-preview-zone]')].map((zone) => ({
        label: zone.getAttribute('data-preview-zone') ?? '',
        box: toBox(zone.getBoundingClientRect()),
        dashed: dashed(zone),
        tooSmall: zone.hasAttribute('data-too-small'),
      })),
      dividers: [...element.querySelectorAll('[data-preview-divider]')].map((line) => ({
        depth: Number(line.getAttribute('data-preview-divider')),
        dashed: dashed(line),
      })),
      context: [...element.querySelectorAll('[data-preview-context]')].map(
        (label) => label.textContent ?? '',
      ),
    }
  })
}

const width = (box: Box): number => box.right - box.left
const height = (box: Box): number => box.bottom - box.top

/** The zones' outline together: the drawn target, give or take the strokes inset into it. */
function drawing(measure: PreviewMeasure): Box {
  const boxes = measure.zones.map((zone) => zone.box)
  return {
    left: Math.min(...boxes.map((box) => box.left)),
    top: Math.min(...boxes.map((box) => box.top)),
    right: Math.max(...boxes.map((box) => box.right)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  }
}

/**
 * The preview's contract, whatever the target's shape: no scrolling, the frame
 * and so all four outer edges inside the box, and the target's aspect ratio.
 */
function expectBounded(measure: PreviewMeasure, target: { w: number; h: number }): void {
  expect(measure.scroll.width).toBeLessThanOrEqual(measure.scroll.clientWidth)
  expect(measure.scroll.height).toBeLessThanOrEqual(measure.scroll.clientHeight)
  const { inner, frame } = measure
  expect(frame.left, 'left edge').toBeGreaterThanOrEqual(inner.left)
  expect(frame.top, 'top edge').toBeGreaterThanOrEqual(inner.top)
  expect(frame.right, 'right edge').toBeLessThanOrEqual(inner.right)
  expect(frame.bottom, 'bottom edge').toBeLessThanOrEqual(inner.bottom)
  const drawn = drawing(measure)
  for (const side of ['left', 'top'] as const) expect(drawn[side]).toBeGreaterThan(frame[side])
  for (const side of ['right', 'bottom'] as const) expect(drawn[side]).toBeLessThan(frame[side])
  // Each zone's stroke is drawn inside it, which takes up to a pixel per side
  // off the measured outline — so the tolerance is those pixels, relatively.
  const aspect = (width(drawn) + 2) / (height(drawn) + 2)
  const slack = 3 / width(drawn) + 3 / height(drawn)
  expect(Math.abs(aspect / (target.w / target.h) - 1)).toBeLessThanOrEqual(slack + 0.005)
}

function union(zones: ZoneRect[]): { w: number; h: number } {
  const left = Math.min(...zones.map((zone) => zone.x))
  const top = Math.min(...zones.map((zone) => zone.y))
  const right = Math.max(...zones.map((zone) => zone.x + zone.w))
  const bottom = Math.max(...zones.map((zone) => zone.y + zone.h))
  return { w: right - left, h: bottom - top }
}

test.describe('split preview', () => {
  test('shows two zones being edited and the three kept inside the second', { tag: '@pr' }, async ({ page }) => {
    const guard = watchForErrors(page)
    await nestedDeck(page)
    const target = union(await zoneRects(page))
    await openSplitDialog(page)

    await expect(page.getByTestId('split-target')).toHaveText('Du redigerer: Rot')
    const measure = await measurePreview(page)
    // Exactly two solid, numbered zones — zone 2 is not framed a second time
    // with a dashed line because it happens to be split.
    expect(measure.zones.map((zone) => [zone.label, zone.dashed])).toEqual([
      ['1', false],
      ['2', false],
    ])
    // Its three subzones show as two dashed boundaries and their paths.
    expect(measure.dividers).toEqual([
      { depth: 2, dashed: true },
      { depth: 2, dashed: true },
    ])
    expect(measure.context).toEqual(['2.1', '2.2', '2.3'])
    await expect(page.getByTestId('split-legend')).toHaveText(
      'Heltrukket: sonene du endrer. Stiplet: underinndelinger som beholdes.',
    )
    await expect(page.getByTestId('split-kept')).toHaveText(
      'Sone 2 inneholder 3 underordnede soner; disse beholdes.',
    )
    expectBounded(measure, target)

    // One gap between the zones, at the deck's gap and the preview's scale.
    const [first, second] = measure.zones
    const scale = (height(drawing(measure)) + 2) / target.h
    expect(Math.abs(second.box.top - first.box.bottom - 2 - G * scale)).toBeLessThanOrEqual(1.5)
    expect(guard.errors).toEqual([])
  })

  test('commits what it shows', async ({ page }) => {
    await nestedDeck(page, 'Som vist')
    const target = union(await zoneRects(page))
    await openSplitDialog(page)
    await page.getByTestId('split-weight-0').fill('1')
    await page.getByTestId('split-weight-1').fill('3')
    const measure = await measurePreview(page)
    const drawn = drawing(measure)
    const shown = (height(measure.zones[0].box) + 2) / (height(drawn) + 2)
    await page.getByTestId('split-apply').click()
    await expect(page.getByTestId('split-modal')).toBeHidden()

    const zones = await zoneRects(page)
    const top = zones.reduce((a, b) => (a.y <= b.y ? a : b))
    expect(Math.abs(shown - top.h / target.h)).toBeLessThan(0.01)
  })

  for (const [name, axis, weights] of [
    ['a tall, narrow zone', 'x', [1, 10]],
    ['a wide, short zone', 'y', [1, 10]],
  ] as const) {
    test(`keeps ${name} whole, small and unscrolled`, async ({ page }) => {
      await createPresentation(page, name)
      await enterZoneMode(page)
      await splitSelected(page, [...weights], axis)
      const [zone] = await zoneRects(page)
      await clickZone(page, zone)
      await openSplitDialog(page)
      await page.getByTestId('split-axis-y').click()
      await page.getByTestId('split-count').fill('3')
      await expect(page.getByTestId('split-target')).toHaveText('Du redigerer: Rot › 1')
      const measure = await measurePreview(page)
      expect(measure.zones).toHaveLength(3)
      expectBounded(measure, zone)
    })
  }

  test('keeps a narrow zone with nested subzones whole', async ({ page }) => {
    await createPresentation(page, 'Smal og nøstet')
    await enterZoneMode(page)
    await splitSelected(page, [1, 6], 'x')
    const [narrow] = await zoneRects(page)
    await clickZone(page, narrow)
    await splitSelected(page, [1, 1], 'y')
    const [, lower] = await zoneRects(page)
    await clickZone(page, lower)
    await splitSelected(page, [1, 1], 'y')
    await page.getByTestId('zone-breadcrumb').getByRole('button', { name: '1', exact: true }).first().click()

    await openSplitDialog(page)
    const measure = await measurePreview(page)
    expect(measure.zones.map((zone) => zone.dashed)).toEqual([false, false])
    expect(measure.dividers.map((divider) => divider.depth)).toEqual([2])
    expectBounded(measure, narrow)
  })

  test('draws a refused proposal with the zones that are too small marked', async ({ page }) => {
    await createPresentation(page, 'For liten')
    const [zone] = await zoneRects(page)
    await page.locator(`[data-testid="stage-slide"] .slide-zone[data-node-id="${zone.id}"] [data-testid="empty-zone-titled-card"]`).click()
    await enterZoneMode(page)
    await openSplitDialog(page)
    await page.getByTestId('split-weight-1').fill('60')

    await expect(page.getByTestId('split-invalid')).toHaveText('Sone 1 blir for liten (skravert).')
    await expect(page.getByTestId('split-apply')).toBeDisabled()
    const measure = await measurePreview(page)
    expect(measure.zones.map((entry) => entry.tooSmall)).toEqual([true, false])

    // Unreadable numbers are named as such, and no proposal is drawn for them.
    await page.getByTestId('split-weight-1').fill('abc')
    await expect(page.getByTestId('split-invalid')).toHaveText('Alle forholdstall må være tall større enn 0.')
    await expect(page.getByTestId('split-preview').locator('[data-preview-zone]')).toHaveCount(0)
    await expect(page.getByTestId('split-preview').locator('[data-preview-frame]')).toBeVisible()
  })

  test('fits the dialog and the preview at every size the plan names', async ({ page }) => {
    await nestedDeck(page, 'Skjermstørrelser')
    const target = union(await zoneRects(page))
    for (const size of [
      { width: 1600, height: 1000 },
      { width: 1366, height: 768 },
      { width: 1025, height: 768 },
      { width: 900, height: 760 },
      { width: 412, height: 892 },
      { width: 892, height: 412 },
    ]) {
      await page.setViewportSize(size)
      await openSplitDialog(page)
      const dialog = page.getByTestId('split-modal')
      const box = await dialog.boundingBox()
      expect(box, `${size.width}×${size.height}`).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width)
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.height)
      const body = dialog.locator('.dialog__body')
      const overflowX = await body.evaluate((element) => element.scrollWidth - element.clientWidth)
      expect(overflowX, `horizontal overflow at ${size.width}×${size.height}`).toBeLessThanOrEqual(0)
      await expect(page.getByTestId('split-apply')).toBeInViewport()

      await page.getByTestId('split-preview').scrollIntoViewIfNeeded()
      const measure = await measurePreview(page)
      expectBounded(measure, target)
      // Bounded by the visible height too, so the controls are never pushed away:
      // never more than a third of the screen, however tall the target is.
      expect(height(measure.inner)).toBeLessThanOrEqual(Math.max(96, size.height / 3))
      await closeSplitDialog(page)
      const close = page.getByTestId('compact-panel-close')
      if (await close.isVisible()) await close.click()
    }
  })

  test('measures the template editor in the theme its commands use', async ({ page }) => {
    // A deck in another gap than the default: the template editor works on a
    // scratch deck in the default theme, so that — not this deck's air — is
    // what its preview and its commit must agree on.
    await createPresentation(page, 'Mal i annen luft')
    await chooseFromToolbarMenu(page, 'presentation', 'open-theme')
    await page.getByTestId('theme-spacing-2.4').click()
    await page.getByTestId('theme-modal').getByRole('button', { name: 'Ferdig' }).click()
    await enterZoneMode(page)
    await splitSelected(page, [1, 1], 'y')

    page.once('dialog', (dialog) => void dialog.accept('To rader'))
    await chooseFromToolbarMenu(page, 'presentation', 'open-templates')
    await page.getByTestId('save-template').click()
    await page.getByTestId('template-item').getByRole('button', { name: 'Rediger' }).click()
    const editor = page.getByTestId('template-editor')
    await expect(editor).toBeVisible()
    const hasTitle = await editor.getByRole('checkbox', { name: 'Overskriftssone' }).isChecked()
    await editor.getByTestId('template-split').click()
    await expect(page.getByTestId('split-modal')).toBeVisible()
    await expect(page.getByTestId('split-target')).toHaveText('Du redigerer: Rot')
    await page.getByTestId('split-weight-1').fill('3')

    const geometry = geometryForTheme(defaultTheme())
    const main = computeMainRect(hasTitle, geometry)
    const expected = splitRect(main, 'y', [1, 3], geometry.gap)
    const measure = await measurePreview(page)
    expectBounded(measure, { w: main.width, h: main.height })
    const drawn = drawing(measure)
    const scale = (height(drawn) + 2) / main.height
    const shown = (height(measure.zones[0].box) + 2) / scale
    expect(Math.abs(shown - expected[0].height)).toBeLessThanOrEqual(3)
    const gap = (measure.zones[1].box.top - measure.zones[0].box.bottom - 2) / scale
    expect(Math.abs(gap - geometry.gap)).toBeLessThanOrEqual(3)
    // And not the deck's own, wider gap.
    expect(Math.abs(gap - Math.round(BASE_G * 2.4))).toBeGreaterThan(3)

    await page.getByTestId('split-apply').click()
    await expect(page.getByTestId('split-modal')).toBeHidden()
    // The template's own picture now shows the committed split, drawn in the
    // same theme: the same first zone and the same single gap.
    const picture = editor.getByTestId('template-preview')
    const pictureScale = (await picture.evaluate((element) => element.clientWidth)) / SLIDE_WIDTH
    const cells = await picture
      .locator('.template-preview__cell:not(.template-preview__cell--split)')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect()
          return { top: rect.top, bottom: rect.bottom }
        }),
      )
    expect(cells).toHaveLength(2)
    const [upper, lower] = cells
    expect(Math.abs((upper.bottom - upper.top) / pictureScale - expected[0].height)).toBeLessThanOrEqual(3)
    expect(Math.abs((lower.top - upper.bottom) / pictureScale - geometry.gap)).toBeLessThanOrEqual(3)
  })
})
