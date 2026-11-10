/**
 * The main toolbar fits the window while the presentation is shared.
 *
 * `e2e/toolbar.spec.ts` checks the widths in the app itself, but the browser
 * suite runs in local mode, where sharing is off and cannot be turned on. The
 * states that make the right-hand end widest — shared, with «Kopier lenke», and
 * the manual link field a refused clipboard brings out — are reached here
 * instead: the real `TopToolbar` is rendered with the sharing state set and the
 * copy actually failing, and the DOM it produced is laid out by a real Chromium
 * under the app's own stylesheets. The rule checked is the one U2 exists for:
 * nothing in the bar leaves the window or covers another control, and «Del» and
 * «Vis» stay whole.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import puppeteer, { type Browser } from 'puppeteer-core'
import { resolveExecutable } from '../../render/chromium'
import { useSharingStore } from '../../state/sharing'
import globalCss from '../../styles/global.css?inline'
import editorCss from '../../styles/editor.css?inline'
import { TooltipProvider } from '../components/Tooltip'
import { contentKindOptions } from './contentKinds'
import { TopToolbar } from './TopToolbar'

/** The narrowest desktop width and the steps up through every label breakpoint. */
const WIDTHS = [1025, 1060, 1120, 1121, 1180, 1260, 1261, 1300, 1366, 1440, 1441, 1500, 1600]

/** A browser launch is seconds; every state is measured in the one browser. */
const BROWSER_TIMEOUT_MS = 180_000

const noop = (): void => {}

let browser: Browser | null = null
let container: HTMLDivElement | null = null
let root: Root | null = null

beforeAll(async () => {
  const resolved = await resolveExecutable(process.env as Record<string, string | undefined>)
  browser = await puppeteer.launch({ executablePath: resolved.executablePath, args: resolved.args, headless: true })
}, BROWSER_TIMEOUT_MS)

afterAll(async () => {
  await browser?.close()
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
  useSharingStore.getState().reset()
  vi.unstubAllGlobals()
})

/** The toolbar as the editor draws it on a shared deck, with the widest kind selected. */
function mountShared(): HTMLElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useSharingStore.setState({
    presentationId: 'deck',
    status: 'ready',
    shared: true,
    token: '3f2a1b0c-1111-4222-8333-444455556666',
    busy: false,
    error: null,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <TooltipProvider>
        <TopToolbar
          title="Kvartalsrapport for tredje kvartal 2026"
          hasTitleZone
          canToggleTitle
          canEditZones
          selectionIsLeaf
          selectionHasContent
          selectedKind="titled-image-card"
          contentKinds={contentKindOptions(null)}
          sandboxCount={3}
          ideasOpen={false}
          sandboxOpen={false}
          onShowShortcuts={noop}
          onEditAutocorrect={noop}
          onBack={noop}
          onRename={noop}
          onToggleTitle={noop}
          onSetContentKind={noop}
          onOpenReferences={noop}
          onOpenTemplates={noop}
          onOpenImage={noop}
          onToggleIdeas={noop}
          onToggleSandbox={noop}
          onPresent={noop}
          onOpenTheme={noop}
          onOpenImageBrief={noop}
          onOptimizeImages={noop}
          onToggleShare={noop}
        />
      </TooltipProvider>,
    )
  })
  return container
}

/** Press «Kopier lenke» with neither clipboard route working. */
async function refuseCopy(host: HTMLElement): Promise<void> {
  vi.stubGlobal('navigator', {
    ...navigator,
    clipboard: { writeText: () => Promise.reject(new Error('nektet')) },
  })
  document.execCommand = () => false
  const copy = host.querySelector<HTMLButtonElement>('[data-testid="copy-share-link"]')
  expect(copy).not.toBeNull()
  act(() => copy!.click())
  await act(async () => {})
  expect(host.querySelector('[data-testid="share-link-manual"]')).not.toBeNull()
}

interface Layout {
  overflow: number
  outside: string[]
  overlaps: string[]
  whole: Record<string, boolean>
}

/** Lay the markup out at each width and report what does not fit. */
async function layoutAt(markup: string, width: number): Promise<Layout> {
  const tab = await browser!.newPage()
  try {
    await tab.setViewport({ width, height: 400, deviceScaleFactor: 1 })
    await tab.setContent(
      `<!doctype html><html><head><style>${globalCss}\n${editorCss}</style></head><body>${markup}</body></html>`,
      { waitUntil: 'load' },
    )
    return await tab.evaluate(() => {
      const bar = document.querySelector('[data-testid="top-toolbar"]') as HTMLElement
      const name = (element: Element): string =>
        element.getAttribute('data-testid') ?? element.getAttribute('aria-label') ?? element.className
      const controls = [...bar.querySelectorAll('button, input')].filter(
        (element) => element.getBoundingClientRect().width > 0,
      )
      const boxes = controls.map((element) => element.getBoundingClientRect())
      const outside = controls
        .filter((_, index) => boxes[index].left < 0 || boxes[index].right > window.innerWidth)
        .map(name)
      const overlaps: string[] = []
      for (let i = 0; i < controls.length; i += 1) {
        for (let j = i + 1; j < controls.length; j += 1) {
          const a = boxes[i]
          const b = boxes[j]
          const crossed = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
          if (crossed) overlaps.push(`${name(controls[i])} × ${name(controls[j])}`)
        }
      }
      const whole: Record<string, boolean> = {}
      for (const id of ['toggle-share', 'present']) {
        const box = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect()
        whole[id] = box.width > 0 && box.left >= 0 && box.right <= window.innerWidth
      }
      return { overflow: bar.scrollWidth - bar.clientWidth, outside, overlaps, whole }
    })
  } finally {
    await tab.close()
  }
}

async function expectFitsEverywhere(markup: string): Promise<void> {
  for (const width of WIDTHS) {
    const layout = await layoutAt(markup, width)
    expect(layout, `${width} px`).toEqual({
      overflow: 0,
      outside: [],
      overlaps: [],
      whole: { 'toggle-share': true, present: true },
    })
  }
}

describe('verktøylinjen mens presentasjonen er delt', () => {
  it(
    'holder «Del», «Kopier lenke» og «Vis» innenfor vinduet',
    async () => {
      const host = mountShared()
      expect(host.querySelector('[data-testid="copy-share-link"]')).not.toBeNull()
      await expectFitsEverywhere(host.innerHTML)
    },
    BROWSER_TIMEOUT_MS,
  )

  it(
    'holder også plass når kopieringen feilet og lenkefeltet vises',
    async () => {
      const host = mountShared()
      await refuseCopy(host)
      await expectFitsEverywhere(host.innerHTML)
    },
    BROWSER_TIMEOUT_MS,
  )
})
