/** Authoring examples must fit the real v1 stylesheet, not browser defaults.
 * This is a layout harness. The existing interactive/security specs cover the
 * full editor/player flow and host security; this spec does not replace them.
 *
 * The skeleton `get_interactive_contract` hands an agent is mounted here too:
 * it is what an agent with no checkout starts from, so it has to lay out under
 * the same stylesheet and the same theme extremes as the worked examples.
 */
import { readFileSync } from 'node:fs'
import { test, expect, type FrameLocator, type Page } from '@playwright/test'
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../src/domain/constants'
import { defaultTheme } from '../src/domain/presentation'
import { FONT_SCALE_RANGE, SPACING_RANGE, DEFAULT_SPACING, DEFAULT_FONT_SCALE } from '../src/domain/metrics'
import { INTERACTIVE_STARTER_SKELETON, interactiveBaseStylesheet, interactiveThemeCss } from '../src/domain/interactiveStyle'
import { buildInteractiveWrapperDocument, escapeHtmlAttribute, INTERACTIVE_SANDBOX_FLAGS } from '../src/ui/interactive/sandboxDocument'

const examples = ['starter.html', 'system-test.html'] as const
const sources: Record<string, string> = {
  ...Object.fromEntries(examples.map(file => [file, readFileSync(new URL(`../examples/interactive-miniapps/${file}`, import.meta.url), 'utf8')])),
  'agent-startskall': INTERACTIVE_STARTER_SKELETON,
}
const variants = [
  { name: 'normal-light', spacing: DEFAULT_SPACING, fontScale: DEFAULT_FONT_SCALE, dark: false, font: 'Arial, sans-serif', scale: 1 },
  { name: 'normal-dark-serif', spacing: DEFAULT_SPACING, fontScale: DEFAULT_FONT_SCALE, dark: true, font: 'Georgia, serif', scale: 1 },
  { name: 'minimum-scaled', spacing: SPACING_RANGE.min, fontScale: FONT_SCALE_RANGE.min, dark: false, font: 'Georgia, serif', scale: 0.625 },
  { name: 'maximum-dark', spacing: SPACING_RANGE.max, fontScale: FONT_SCALE_RANGE.max, dark: true, font: 'Arial, sans-serif', scale: 1 },
  { name: 'maximum-scaled-serif', spacing: SPACING_RANGE.max, fontScale: FONT_SCALE_RANGE.max, dark: false, font: 'Georgia, serif', scale: 0.75 },
]

async function mount(page: Page, file: string, variant = variants[0]): Promise<FrameLocator> {
  const html = sources[file]
  const theme = { ...defaultTheme(), spacing: variant.spacing, fontScale: variant.fontScale, headingFontFamily: variant.font, bodyFontFamily: variant.font }
  const colors = variant.dark ? { background: '#192737', accent: '#ebc277' } : { background: '#eff2f5', accent: '#33475b' }
  const styleCss = `${interactiveThemeCss({ theme, colors })}\n${interactiveBaseStylesheet(1)}`
  const wrapper = buildInteractiveWrapperDocument({ html, title: file, styleCss })
  await page.setViewportSize({ width: Math.round(SLIDE_WIDTH * variant.scale), height: Math.round(SLIDE_HEIGHT * variant.scale) })
  await page.setContent(`<body style="margin:0;overflow:hidden"><iframe id="wrapper" sandbox="${INTERACTIVE_SANDBOX_FLAGS}" style="display:block;border:0;width:${SLIDE_WIDTH}px;height:${SLIDE_HEIGHT}px;transform-origin:top left;transform:scale(${variant.scale})" srcdoc="${escapeHtmlAttribute(wrapper)}"></iframe></body>`)
  const app = page.frameLocator('#wrapper').frameLocator('#app')
  await expect(app.locator('#miniapp')).toBeVisible()
  return app
}

async function layout(app: FrameLocator, fits: boolean) {
  const geometry = await app.locator('#miniapp').evaluate(root => {
    const visible = (el: Element) => el.getClientRects().length > 0
    const scroll = root.querySelector<HTMLElement>('.app-content')!
    const containers = root.querySelectorAll('.view-grid,.panel,.stack,.counter-row,.field-actions,.app-nav,.scroll-list')
    const overlaps: string[] = []
    for (const container of containers) {
      const children = [...container.children].filter(visible)
      for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) {
        const a = children[i].getBoundingClientRect(), b = children[j].getBoundingClientRect()
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push(`${children[i].tagName}/${children[j].tagName}`)
      }
    }
    const clipped = [...root.querySelectorAll<HTMLElement>('button,input,output,h1,h2,h3,p,label')]
      .filter(visible).filter(el => getComputedStyle(el).display !== 'inline' && el.scrollWidth > el.clientWidth + 2)
      .map(el => el.id || el.tagName)
    return { overlaps, clipped, client: scroll.clientHeight, scroll: scroll.scrollHeight, width: scroll.clientWidth, scrollWidth: scroll.scrollWidth, rootHeight: document.documentElement.scrollHeight, height: innerHeight }
  })
  expect(geometry.overlaps).toEqual([])
  expect(geometry.clipped).toEqual([])
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1)
  expect(geometry.rootHeight).toBeLessThanOrEqual(geometry.height + 1)
  if (fits) expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1)
}

for (const variant of variants) {
  for (const file of Object.keys(sources)) test(`${file}: ${variant.name}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const app = await mount(page, file, variant)
    await layout(app, true)
    if (file === 'system-test.html') {
      for (const view of ['controls', 'theme', 'scrolling']) {
        await app.locator(`[data-view="${view}"]`).click()
        await expect(app.locator('[data-screen]:visible')).toHaveCount(1)
        await layout(app, view === 'controls')
      }
      const scroll = app.locator('.app-content')
      const top = await app.locator('.app-header').evaluate(el => el.getBoundingClientRect().top)
      await scroll.hover()
      await page.mouse.wheel(0, 500)
      await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
      await scroll.focus()
      const previous = await scroll.evaluate(el => el.scrollTop)
      await page.keyboard.press('PageDown')
      await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(previous)
      expect(await app.locator('.app-header').evaluate(el => el.getBoundingClientRect().top)).toBe(top)
      await app.locator('#scroll-end').focus()
      await page.keyboard.press('Enter')
      await expect(app.locator('#scroll-status')).not.toHaveText('Bunnen er ikke bekreftet.')
      await app.locator('[data-view="interaction"]').click()
      expect(await scroll.evaluate(el => el.scrollTop)).toBe(0)
    }
    expect(errors).toEqual([])
  })
}

test('native controls keep their keyboard behavior; a fresh activation resets state', async ({ page }) => {
  let app = await mount(page, 'system-test.html')
  await app.locator('#plus').focus()
  await page.keyboard.press('Space')
  await expect(app.locator('#counter')).toHaveText('1')
  await app.locator('[data-view="controls"]').click()
  await app.locator('#note').fill('To ord')
  await app.locator('#note').press('End')
  await app.locator('#note').press('Space')
  await expect(app.locator('#note')).toHaveValue('To ord ')
  await app.locator('#level').focus()
  await page.keyboard.press('ArrowRight')
  await expect(app.locator('#level')).toHaveValue('51')
  await expect(app.locator('#counter')).toHaveText('1')
  await app.locator('[data-view="interaction"]').click()
  await app.locator('#keyboard').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Space')
  await page.keyboard.press('Escape')
  await expect(app.locator('#counter')).toHaveText('3')
  await expect(app.locator('#key-status')).toContainText('Escape')
  app = await mount(page, 'system-test.html')
  await expect(app.locator('#counter')).toHaveText('0')
  await app.locator('[data-view="controls"]').click()
  await expect(app.locator('#note')).toHaveValue('')
  await expect(app.locator('#level')).toHaveValue('50')
})
