import { expect, type Locator, type Page } from '@playwright/test'
import {
  PROGRESS_BAR_HEIGHT,
  SLIDE_HEIGHT as LOGICAL_SLIDE_HEIGHT,
  SLIDE_WIDTH as LOGICAL_SLIDE_WIDTH,
} from '../src/domain/constants'
import { themeMetrics } from '../src/domain/metrics'
import { defaultTheme } from '../src/domain/presentation'

export const SLIDE_WIDTH = LOGICAL_SLIDE_WIDTH
export const SLIDE_HEIGHT = LOGICAL_SLIDE_HEIGHT

/**
 * The gap a new deck is actually drawn with.
 *
 * Read from the domain rather than written out here: the base token is one
 * number and the theme scales it, so a suite that restated `24` would be
 * asserting a distance no deck has had since the theme's «Normal» stopped
 * meaning «unscaled».
 */
export const G = themeMetrics(defaultTheme()).gap

/** The strip the progress indicator takes along the bottom edge of every slide. */
export const PROGRESS_HEIGHT = PROGRESS_BAR_HEIGHT

export interface ZoneRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** Collects console errors and page errors so a test can assert the app is clean. */
export function watchForErrors(page: Page): { errors: string[] } {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  return { errors }
}

/**
 * Wait until every CSS transition and animation inside `scope` has run out.
 *
 * A box read while something is still easing towards its place is a frame of
 * the motion, not the layout — and which frame depends on how busy the machine
 * is. Transitions are part of `getAnimations()`, so this waits for exactly the
 * ones in flight, however long the stylesheet makes them.
 */
export async function motionSettled(scope: Locator): Promise<void> {
  await scope.evaluate(async (element) => {
    // A transition retargeted half-way is cancelled and replaced, so its
    // promise rejects and a new one is running: ask again until none is.
    // Anything endless (a spinner) is not motion towards a layout.
    for (let round = 0; round < 10; round += 1) {
      const running = element
        .getAnimations({ subtree: true })
        .filter((motion) => motion.effect?.getComputedTiming().endTime !== Infinity)
      if (running.length === 0) return
      await Promise.all(running.map((motion) => motion.finished.catch(() => undefined)))
    }
  })
}

/**
 * Wait until a scroll box has stopped moving.
 *
 * The slide overview follows the shown page with a smooth scroll, so a test
 * that scrolls it by hand straight after it opens is racing that motion — and
 * a smooth scroll still in flight carries on past the hand's, leaving the box
 * somewhere neither asked for. Settled means the same position on two frames
 * a little apart.
 */
export async function scrollSettled(box: Locator): Promise<void> {
  let last = Number.NaN
  await expect
    .poll(async () => {
      const now = await box.evaluate(
        (element) =>
          new Promise<number>((resolve) =>
            setTimeout(() => requestAnimationFrame(() => resolve(element.scrollTop)), 60),
          ),
      )
      const still = now === last
      last = now
      return still
    })
    .toBe(true)
}

/** The slide stage. Scope stage assertions to this — filmstrip thumbnails render the same markup. */
export function stage(page: Page) {
  return page.getByTestId('stage-slide')
}

/**
 * Leave the editor and wait until the library is actually showing.
 *
 * Going back flushes autosave first, so the transition is asynchronous: a test
 * that navigates straight afterwards would still be in the editor, and a reload
 * would reopen the deck it thought it had left.
 */
export async function backToLibrary(page: Page): Promise<void> {
  await page.getByTestId('back-to-library').click()
  await expect(page.getByTestId('presentation-grid')).toBeVisible()
}

export async function createPresentation(page: Page, title: string): Promise<void> {
  await page.goto('/')
  await page.getByTestId('new-presentation').click()
  await page.getByTestId('presentation-title-input').fill(title)
  await page.getByTestId('create-presentation').click()
  await expect(page.getByTestId('editor')).toBeVisible()
  await expect(page.getByTestId('stage-slide')).toBeVisible()
}

/** Convert a point in slide coordinates into viewport coordinates. */
export async function slidePoint(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([sx, sy]) => {
      const element = document.querySelector('[data-testid="stage-slide"]') as HTMLElement
      const rect = element.getBoundingClientRect()
      const scale = Number(element.dataset.scale)
      return { x: rect.left + sx * scale, y: rect.top + sy * scale }
    },
    [x, y],
  )
}

export async function clickSlide(page: Page, x: number, y: number): Promise<void> {
  const point = await slidePoint(page, x, y)
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(120)
}

/**
 * Click the centre of a zone. Use this rather than a corner: in zone mode the
 * selected node's action toolbar sits at its top-left and deliberately swallows
 * clicks so it cannot re-select what is underneath it.
 */
export async function clickZone(page: Page, zone: ZoneRect): Promise<void> {
  await clickSlide(page, zone.x + zone.w / 2, zone.y + zone.h / 2)
}

/** All leaf-zone rects on the stage, in slide coordinates, measured from the DOM. */
export async function zoneRects(page: Page): Promise<ZoneRect[]> {
  const rects = await page.evaluate(() => {
    const element = document.querySelector('[data-testid="stage-slide"]') as HTMLElement
    const stage = element.getBoundingClientRect()
    const scale = Number(element.dataset.scale)
    return [...element.querySelectorAll('.slide-zone')].map((zone) => {
      const rect = zone.getBoundingClientRect()
      return {
        id: (zone as HTMLElement).dataset.nodeId as string,
        x: (rect.left - stage.left) / scale,
        y: (rect.top - stage.top) / scale,
        w: rect.width / scale,
        h: rect.height / scale,
      }
    })
  })
  return rects.sort((a, b) => a.x - b.x || a.y - b.y)
}

export async function titleRect(page: Page): Promise<ZoneRect> {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid="stage-slide"]') as HTMLElement
    const stage = element.getBoundingClientRect()
    const scale = Number(element.dataset.scale)
    const rect = (
      element.querySelector('[data-testid="slide-title"]') as HTMLElement
    ).getBoundingClientRect()
    return {
      id: 'title',
      x: (rect.left - stage.left) / scale,
      y: (rect.top - stage.top) / scale,
      w: rect.width / scale,
      h: rect.height / scale,
    }
  })
}

/** Split the currently selected zone through the split dialog. */
export async function splitSelected(
  page: Page,
  weights: number[],
  axis?: 'x' | 'y',
): Promise<void> {
  await page.getByTestId('inspector-action-split').click()
  await expect(page.getByTestId('split-modal')).toBeVisible()
  if (axis) await page.getByTestId(`split-axis-${axis}`).click()
  // The weight inputs only exist once the child count matches.
  await page.getByTestId('split-count').fill(String(weights.length))
  await expect(page.getByTestId(`split-weight-${weights.length - 1}`)).toBeVisible()
  for (let i = 0; i < weights.length; i += 1) {
    await page.getByTestId(`split-weight-${i}`).fill(String(weights[i]))
  }
  await page.getByTestId('split-apply').click()
  await expect(page.getByTestId('split-modal')).toBeHidden()
  await page.waitForTimeout(150)
}

export async function enterZoneMode(page: Page): Promise<void> {
  await page.getByTestId('mode-zone').click()
  await expect(page.getByTestId('zone-overlay')).toBeVisible()
}

export async function enterContentMode(page: Page): Promise<void> {
  await page.getByTestId('mode-content').click()
  await expect(page.getByTestId('zone-overlay')).toBeHidden()
}

/**
 * Choose a tool from one of the toolbar's menus: «Presentasjon» for what
 * belongs to the whole deck, «Verktøy» for ideas, the sandbox and the shortcut
 * list. Each entry keeps the test id its button had before it moved into a
 * menu, so a test names the tool, and this opens the menu that holds it.
 */
export async function chooseFromToolbarMenu(
  page: Page,
  menu: 'presentation' | 'tools',
  entryTestId: string,
): Promise<void> {
  await page.getByTestId(`toolbar-menu-${menu}`).click()
  await page.getByTestId('context-menu').getByTestId(entryTestId).click()
  await expect(page.getByTestId('context-menu')).toBeHidden()
}

/**
 * Choose from a menu the text toolbar opens — «Tabell» or «Bilde», the same
 * menu a right-click on the table or the picture opens — through any
 * submenus on the way, by their entry ids.
 */
export async function chooseFromTextMenu(
  page: Page,
  button: 'table-tools' | 'image-tools',
  ...path: string[]
): Promise<void> {
  await page.getByTestId(button).click()
  const through = path.slice(0, -1)
  const last = path[path.length - 1]
  for (const id of through) {
    await page.getByTestId(`menu-${id}`).click()
    await enterSubmenu(page, id)
  }
  // A submenu opens beside the menu, not inside it, so entries are found on the page.
  if (through.length > 0) {
    await page.getByTestId(`menu-${last}`).focus()
    await page.keyboard.press('Enter')
  } else {
    await page.getByTestId(`menu-${last}`).click()
  }
  await expect(page.getByTestId('context-menu')).toBeHidden()
}

/**
 * Go into a submenu that has just opened, from the keyboard: a pointer that
 * leaves the trigger for where the submenu is still on its way to closes it
 * again, as it should, so a test that moved the mouse there would be testing
 * its own timing.
 */
export async function enterSubmenu(page: Page, id: string): Promise<void> {
  await page.keyboard.press('ArrowRight')
  const submenu = page.getByTestId(`menu-${id}-content`)
  await expect(submenu).toBeVisible()
  await expect(submenu).toHaveAttribute('data-state', 'open')
}

/**
 * Open the inspector's «Innholdstype» menu for the selected zone. It is the
 * same menu the toolbar and the zone menu open, so its entries are named
 * `menu-kind-<kind>` there too.
 */
export async function openInspectorKindMenu(page: Page): Promise<Locator> {
  await page.getByTestId('inspector-content-kind').click()
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  return menu
}

/** Give the selected zone a content kind from the inspector. */
export async function chooseKindInInspector(page: Page, kind: string): Promise<void> {
  const menu = await openInspectorKindMenu(page)
  await menu.getByTestId(`menu-kind-${kind}`).click()
  await expect(menu).toBeHidden()
}

export async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', {
    timeout: 10_000,
  })
}

/**
 * Close the upload dialog without choosing a file.
 *
 * Filling an empty zone with a picture opens the dialog by itself, so a test
 * about anything other than the file — the caption, the selection, the crop —
 * closes it first and is left with the empty panel, exactly as a person who
 * changed their mind is.
 */
export async function dismissImageModal(page: Page): Promise<void> {
  await expect(page.getByTestId('image-modal')).toBeVisible()
  await page.getByTestId('image-modal').getByRole('button', { name: 'Avbryt' }).click()
  await expect(page.getByTestId('image-modal')).toBeHidden()
}

/** Adds content of the given kind to a specific zone via the empty-zone buttons. */
export async function addContentToZone(
  page: Page,
  nodeId: string,
  kind: 'container' | 'untitled-card' | 'titled-card',
): Promise<void> {
  await stage(page)
    .locator(`.slide-zone[data-node-id="${nodeId}"] [data-testid="empty-zone-${kind}"]`)
    .click()
  await page.waitForTimeout(200)
}

/**
 * Which page of the deck is on screen, and how many there are.
 *
 * Presentation mode draws no counter — the progress indicator is what says this
 * to an audience — so the numbers are read from the view's own data instead.
 */
export async function presentedPage(page: Page): Promise<{ index: number; count: number }> {
  const view = page.getByTestId('present-view')
  return {
    index: Number(await view.getAttribute('data-page')),
    count: Number(await view.getAttribute('data-page-count')),
  }
}

export function expectGap(actual: number, message: string): void {
  expect(actual, message).toBeGreaterThan(G - 0.2)
  expect(actual, message).toBeLessThan(G + 0.2)
}

/**
 * Put the caret in a text field without pressing what is in it.
 *
 * Never the middle. A field is centred on both axes unless somebody aligned it
 * otherwise, so the middle of the box is exactly where its content sits — and
 * content is not always inert: a citation pill is a button in the editor, and
 * clicking one opens the reference modal over the very field the test was
 * about to type in. The corner is text, or the empty run before it.
 */
export async function caretInto(field: Locator): Promise<void> {
  await field.click({ position: { x: 4, y: 4 } })
}

/**
 * Wait until the editor has taken the text the browser has marked.
 *
 * The editor reads a keyboard selection (Shift+Home, Shift+arrow) from the
 * browser on its next turn, not in the keypress. A test that moves the focus to
 * a toolbar or menu before then hands it the selection from before the press —
 * on a slow machine an empty one, so the formatting lands on nothing.
 */
export async function selectionTaken(field: Locator): Promise<void> {
  await field.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        const { editor } = element as HTMLElement & {
          editor: {
            state: {
              selection: { from: number; to: number }
              doc: { textBetween: (from: number, to: number) => string }
            }
          }
        }
        const check = () => {
          const marked = window.getSelection()?.toString() ?? ''
          const { from, to } = editor.state.selection
          if (marked && editor.state.doc.textBetween(from, to) === marked) resolve()
          else requestAnimationFrame(check)
        }
        check()
      }),
  )
}

/**
 * Fill a zone's body field until the editor stops accepting more — the text is
 * then close to the zone's capacity for the current font and numbering.
 *
 * Self-calibrating on purpose: a test that says "one more character no longer
 * fits" means nothing unless the zone was actually full first, and hard-coded
 * text lengths stop being full the moment a token changes.
 */
export async function fillZoneToCapacity(
  page: Page,
  nodeId: string,
  options: { chunks?: number; topUp?: boolean } = {},
): Promise<void> {
  const field = stage(page).locator(`.slide-zone[data-node-id="${nodeId}"] .tiptap`).first()
  await caretInto(field)
  for (let i = 0; i < (options.chunks ?? 40); i += 1) {
    await page.keyboard.insertText('Dette er en setning som fyller sonen. '.repeat(3))
  }
  // A test that has to finish inside a deadline the app is counting can trade
  // the last few characters of slack for the seconds the top-up costs.
  if (options.topUp !== false) await topUpToCapacity(page, field)
}

/**
 * Insert one character at a time until the editor stops accepting them.
 *
 * The coarse fill above leaves as much slack as its last rejected chunk, which
 * can be a hundred characters — enough to swallow the effect a test is trying
 * to observe. This closes that gap to a character or two. The small pause is
 * what lets the deferred validation run between attempts.
 *
 * It stops when the editor says no, not after a fixed count: a narrow glyph
 * fills a chunk's worth of slack only after a couple of hundred tries, and a
 * fixed forty left the zone visibly short of full — so a later «one more thing
 * no longer fits» was really «one more thing fits», and the test failed on
 * something the product did right. A refusal is a press that did not make the
 * text longer, seen twice running so a rollback landing late is not mistaken
 * for room.
 */
export async function topUpToCapacity(page: Page, field: Locator, attempts = 400): Promise<void> {
  await caretInto(field)
  const length = () => field.evaluate((element) => element.textContent?.length ?? 0)
  let before = await length()
  let refused = 0
  // A narrow glyph on purpose: the slack this leaves behind is the smallest
  // effect a test can hope to observe afterwards, and 'i' is a third of 'm'.
  for (let i = 0; i < attempts && refused < 2; i += 1) {
    await page.keyboard.insertText('i')
    await page.waitForTimeout(20)
    const now = await length()
    refused = now > before ? 0 : refused + 1
    before = now
  }
  await page.waitForTimeout(250)
}

/** The body font the slide content is actually rendered with right now. */
export async function renderedBodyFont(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      getComputedStyle(document.querySelector('[data-testid="stage-slide"] .slide') as HTMLElement)
        .fontFamily,
  )
}

/** The heading font the slide is actually rendered with right now. */
export async function renderedHeadingFont(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid="stage-slide"] .slide') as HTMLElement
    return getComputedStyle(element).getPropertyValue('--slaids-heading-font-family')
  })
}

/** A toast carrying this text. Several can be on screen at once. */
export function toast(page: Page, text: string) {
  return page.getByTestId('toast').filter({ hasText: text })
}

/**
 * How far the slide title's text reaches past the zone it was given, in logical
 * pixels.
 *
 * The glyphs, not a box: the title zone clips its content and so does the
 * title's own box, so a scroll measurement only ever reports the overflow of
 * whichever of them happens to be sized to the text. A range around the text is
 * neither, and the stage's CSS scale is divided back out so the number means
 * the same thing at any zoom.
 */
export async function titleTextOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const host = document.querySelector(
      '[data-testid="stage-slide"] .slide-title',
    ) as HTMLElement | null
    if (!host) return 0
    const block = host.querySelector('p, .rd-p')
    if (!block) return 0
    const range = document.createRange()
    range.selectNodeContents(block)
    const scale = host.getBoundingClientRect().width / host.clientWidth
    return range.getBoundingClientRect().width / scale - host.clientWidth
  })
}

/** The worst clipped overflow anywhere on the stage, in logical pixels. */
export async function worstOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const slide = document.querySelector('[data-testid="stage-slide"]') as HTMLElement
    let worst = 0
    for (const element of slide.querySelectorAll<HTMLElement>('[data-fit-scroll]')) {
      worst = Math.max(
        worst,
        element.scrollHeight - element.clientHeight,
        element.scrollWidth - element.clientWidth,
      )
    }
    return worst
  })
}

/**
 * The menu of one page in the slide overview — «Flere handlinger» on its
 * entry — opened and left open, so a test can read it before choosing.
 */
export async function openSlideMenu(page: Page, index: number): Promise<Locator> {
  await page.getByTestId('filmstrip-item').nth(index).getByTestId('slide-more').click()
  const menu = page.getByTestId('context-menu')
  await expect(menu).toBeVisible()
  return menu
}

/**
 * Do something to one page from its menu in the slide overview: move it
 * (`move-slide-up`, `move-slide-down`), copy it (`duplicate-slide`) or ask to
 * delete it (`delete-slide`).
 */
export async function chooseSlideAction(page: Page, index: number, entryTestId: string): Promise<void> {
  const menu = await openSlideMenu(page, index)
  await menu.getByTestId(entryTestId).click()
  await expect(menu).toBeHidden()
}

/**
 * Ask for a new page from the strip's footer: «Ny slide» is its own button,
 * a section and a miniapp are in the menu beside it.
 */
export async function addPage(page: Page, kind: 'slide' | 'section' | 'interactive'): Promise<void> {
  if (kind !== 'slide') await page.getByTestId('add-page-menu').click()
  await page.getByTestId(`add-${kind}`).click()
}

/** Do something to a presentation from its card's «Flere handlinger» menu. */
export async function choosePresentationAction(
  page: Page,
  entryTestId: string,
  card: Locator = page.getByTestId('presentation-card').first(),
): Promise<void> {
  await card.getByTestId('presentation-more').click()
  const menu = page.getByTestId('context-menu')
  await menu.getByTestId(entryTestId).click()
  await expect(menu).toBeHidden()
}

/** Do something to a folder from its «Flere handlinger» menu in the sidebar. */
export async function chooseFolderAction(page: Page, folderName: string, entryTestId: string): Promise<void> {
  await page.getByRole('button', { name: `Flere handlinger for mappen ${folderName}` }).click()
  const menu = page.getByTestId('context-menu')
  await menu.getByTestId(entryTestId).click()
  await expect(menu).toBeHidden()
}
