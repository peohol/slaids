/**
 * An interactive slide as it is drawn, and the one surface that can start it.
 *
 * Two claims. First, the cover is static markup in the deck's design and holds
 * nothing of the app — no frame, no source, no live button — wherever it is
 * drawn without an activation: thumbnails, the server preview, an export.
 * Second, on the surface that provides one, activation mounts a frame with the
 * sandbox the boundary requires, holds the navigation lock exactly as long as
 * the frame exists, and closing removes the frame, releases the lock and hands
 * focus back to the button.
 *
 * jsdom draws the frame but enforces none of its attributes, so nothing here
 * says the browser isolates the app; the Playwright security spec does.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bestTextColor } from '../../domain/color'
import { deckPages, deckProgress, deckSectionColors } from '../../domain/pages'
import { createInteractiveSlide, createPresentation } from '../../domain/presentation'
import { sectionAt } from '../../domain/testDecks'
import type { InteractiveSlide, Presentation } from '../../domain/types'
import { isInteractiveRuntimeActive, useInteractiveRuntime } from '../../state/interactiveRuntime'
import { InteractiveSlideSurface } from '../interactive/InteractiveSlideSurface'
import { EXIT_LABEL } from '../interactive/InteractiveRuntime'
import { interactiveDocumentStyle } from '../interactive/documentStyle'
import { escapeHtmlAttribute } from '../interactive/sandboxDocument'
import {
  INTERACTIVE_PERMISSIONS_POLICY,
  INTERACTIVE_REFERRER_POLICY,
  INTERACTIVE_SANDBOX_FLAGS,
  buildInteractiveWrapperDocument,
} from '../interactive/sandboxDocument'
import { DeckPageView } from './DeckPageView'
import { ACTIVATE_LABEL } from './InteractivePageView'
import { SlideRenderProvider } from './SlideRenderContext'

/**
 * No real network from a unit test.
 *
 * Mounting the surface asks for the theme's faces so they are ready before
 * anybody presses play (see `interactiveFontCss`). That is a fetch, and a test
 * that made it would be a test that depends on Google being reachable. Refusing
 * it here is the same thing an offline browser does, and the same thing the
 * code is written to survive: the app is drawn in the fallback stack.
 */
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ingen nettverk i test'))
})

afterEach(() => {
  vi.restoreAllMocks()
})

const BACKGROUND = '#101828'
const ACCENT = '#bfccd9'
// No script in the fixture: jsdom would run one, and this file is about
// what is drawn, not what runs.
const APP = '<!doctype html><html><body><p class="miniapp-hemmelig">Teller</p></body></html>'

function deck(html = APP): Presentation {
  const presentation = createPresentation({ title: 'Dekk' })
  return {
    ...presentation,
    slides: [
      { ...sectionAt(presentation, 0), accentColor: ACCENT, backgroundColor: BACKGROUND },
      createInteractiveSlide({ name: 'Teller for salen', fileName: 'teller.html', html }),
    ],
  }
}

function appSlide(presentation: Presentation): InteractiveSlide {
  const slide = presentation.slides[1]
  if (slide.kind !== 'interactive') throw new Error('Forventet en interaktiv slide.')
  return slide
}

function provider(presentation: Presentation, isStatic: boolean, node: React.ReactNode) {
  const pages = deckPages(presentation)
  return (
    <SlideRenderProvider
      value={{
        theme: presentation.theme,
        numbering: new Map(),
        sectionColors: deckSectionColors(pages),
        progress: deckProgress(pages),
        isStatic,
      }}
    >
      {node}
    </SlideRenderProvider>
  )
}

describe('forsiden, tegnet uten en aktivering', () => {
  it('viser navnet og en inert play-knapp — og ingenting av appen', () => {
    const presentation = deck()
    const [, page] = deckPages(presentation)
    const markup = renderToStaticMarkup(provider(presentation, true, <DeckPageView page={page} />))

    expect(markup).toContain('data-testid="interactive-page"')
    expect(markup).toContain('Teller for salen')
    // The play triangle is drawn, not typed: a glyph would be at the mercy of
    // whatever font the machine taking the picture happens to have.
    expect(markup).toContain('<svg')
    expect(markup).toContain('data-testid="activate-interactive-inert"')
    expect(markup).not.toContain('data-testid="activate-interactive"')
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('<iframe')
    expect(markup).not.toContain('miniapp-hemmelig')
    expect(markup).not.toContain('<script')
  })

  it('sier ikke mer enn den trenger: ingen merkelapp og ikke filnavnet', () => {
    const presentation = deck()
    const [, page] = deckPages(presentation)
    const markup = renderToStaticMarkup(provider(presentation, true, <DeckPageView page={page} />))

    // The file name belongs to whoever edits the deck, and it is in the
    // inspector. A badge saying that a play button is interactive is a label
    // on a play button.
    expect(markup).not.toContain('teller.html')
    expect(markup).not.toContain('Interaktiv miniapp')
  })

  it('tegnes i seksjonens farger, som enhver annen side i dens del av dekket', () => {
    const presentation = deck()
    const [, page] = deckPages(presentation)
    const markup = renderToStaticMarkup(provider(presentation, true, <DeckPageView page={page} />))
    expect(markup).toContain(`background:${BACKGROUND}`)
    expect(markup).toContain(`color:${bestTextColor(BACKGROUND)}`)
    expect(markup).toContain(`background:${ACCENT}`)
  })
})

/* ------------------------------------------------------------------ *
 * The surface, in a real DOM
 * ------------------------------------------------------------------ */

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
  expect(isInteractiveRuntimeActive()).toBe(false)
})

function surface(presentation: Presentation): React.ReactNode {
  const slide = appSlide(presentation)
  const [, page] = deckPages(presentation)
  return provider(
    presentation,
    false,
    <InteractiveSlideSurface slide={slide} scale={0.5}>
      <DeckPageView page={page} />
    </InteractiveSlideSurface>,
  )
}

function mount(presentation: Presentation): HTMLElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(surface(presentation)))
  return container
}

function rerender(presentation: Presentation): void {
  act(() => root!.render(surface(presentation)))
}

function click(host: HTMLElement, testId: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
  expect(button, testId).not.toBeNull()
  act(() => button!.click())
  return button!
}

function frameOf(host: HTMLElement): HTMLIFrameElement | null {
  return host.querySelector<HTMLIFrameElement>('[data-testid="interactive-frame"]')
}

describe('flaten som kan starte appen', () => {
  it('tegner forsiden med en ekte knapp, og ingen ramme før den trykkes', () => {
    const host = mount(deck())
    const button = host.querySelector('[data-testid="activate-interactive"]')
    expect(button?.tagName).toBe('BUTTON')
    // An icon-only control still has to say what it does.
    expect(button?.getAttribute('aria-label')).toBe(ACTIVATE_LABEL)
    expect(host.querySelector('[data-testid="activate-interactive-inert"]')).toBeNull()
    expect(frameOf(host)).toBeNull()
    expect(host.innerHTML).not.toContain('miniapp-hemmelig')
    expect(isInteractiveRuntimeActive()).toBe(false)
  })

  it('monterer rammen med sandkassen, holder låsen, og tar den ned igjen ved avslutning', () => {
    const presentation = deck()
    const host = mount(presentation)
    const activate = click(host, 'activate-interactive')

    const frame = frameOf(host)
    expect(frame).not.toBeNull()
    expect(frame!.getAttribute('sandbox')).toBe(INTERACTIVE_SANDBOX_FLAGS)
    expect(frame!.getAttribute('referrerpolicy')).toBe(INTERACTIVE_REFERRER_POLICY)
    expect(frame!.getAttribute('allow')).toBe(INTERACTIVE_PERMISSIONS_POLICY)
    expect(frame!.getAttribute('src')).toBeNull()
    // The document is the file plus the deck's design, and nothing else. No
    // web font is reachable in this environment, so the style is the tokens
    // and the base sheet — which is exactly what a system-font deck gets too.
    expect(frame!.getAttribute('srcdoc')).toBe(
      buildInteractiveWrapperDocument({
        html: APP,
        title: 'Teller for salen',
        styleCss: interactiveDocumentStyle({
          theme: presentation.theme,
          colors: { accent: ACCENT, background: BACKGROUND },
          contract: 1,
          fontCss: '',
        }),
      }),
    )
    expect(host.querySelector('[data-testid="interactive-surface"]')?.hasAttribute('data-active')).toBe(true)
    expect(isInteractiveRuntimeActive()).toBe(true)
    expect(useInteractiveRuntime.getState().session?.slideId).toBe(appSlide(presentation).id)

    const exit = host.querySelector<HTMLButtonElement>('[data-testid="exit-interactive"]')
    expect(exit?.textContent).toBe(EXIT_LABEL)
    // Slaids' own element, outside the frame.
    expect(frame!.contains(exit)).toBe(false)

    click(host, 'exit-interactive')
    expect(frameOf(host)).toBeNull()
    expect(host.querySelector('[data-testid="interactive-runtime"]')).toBeNull()
    expect(isInteractiveRuntimeActive()).toBe(false)
    // The cover is exactly as it was, and focus is back on its button.
    expect(host.querySelector('[data-testid="interactive-page"]')).not.toBeNull()
    expect(document.activeElement).toBe(activate)
  })

  it('starter en ny ramme for hver aktivering', () => {
    const host = mount(deck())
    click(host, 'activate-interactive')
    const first = frameOf(host)
    click(host, 'exit-interactive')
    click(host, 'activate-interactive')
    const second = frameOf(host)
    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
    expect(isInteractiveRuntimeActive()).toBe(true)
    click(host, 'exit-interactive')
  })

  it('er idempotent mens appen kjører', () => {
    const host = mount(deck())
    click(host, 'activate-interactive')
    const frame = frameOf(host)
    // A second activation of a running app — a stray Enter on the button
    // under the runtime — is not a restart.
    const surfaceElement = host.querySelector('[data-testid="interactive-surface"]')!
    act(() => {
      surfaceElement.querySelector<HTMLButtonElement>('[data-testid="activate-interactive"]')?.click()
    })
    expect(frameOf(host)).toBe(frame)
    click(host, 'exit-interactive')
  })

  it('avslutter av seg selv når filen bak sliden byttes ut', () => {
    const before = deck()
    const host = mount(before)
    click(host, 'activate-interactive')
    expect(isInteractiveRuntimeActive()).toBe(true)

    // The same slide id, a different source — a replacement or an undo.
    const replaced: Presentation = {
      ...before,
      slides: [before.slides[0], { ...appSlide(before), html: '<p>ny</p>' }],
    }
    rerender(replaced)
    expect(frameOf(host)).toBeNull()
    expect(isInteractiveRuntimeActive()).toBe(false)
    // And it can be started again, with the new source.
    click(host, 'activate-interactive')
    expect(frameOf(host)!.getAttribute('srcdoc')).toContain('&lt;p&gt;ny&lt;/p&gt;')
    click(host, 'exit-interactive')
  })

  it('gir appen dekkets design, fra seksjonen sliden ligger i', () => {
    const presentation = deck()
    const host = mount(presentation)
    click(host, 'activate-interactive')
    const srcdoc = frameOf(host)!.getAttribute('srcdoc')!

    // The section's colours, not the deck's first or a default.
    expect(srcdoc).toContain(escapeHtmlAttribute(`--slaids-background: ${BACKGROUND}`))
    expect(srcdoc).toContain(escapeHtmlAttribute(`--slaids-accent: ${ACCENT}`))
    // The theme's two font roles, as stacks.
    expect(srcdoc).toContain(escapeHtmlAttribute(`--slaids-heading-font: ${presentation.theme.headingFontFamily}`))
    expect(srcdoc).toContain(escapeHtmlAttribute(`--slaids-body-font: ${presentation.theme.bodyFontFamily}`))
    // And Slaids' base stylesheet, so an app with no CSS is still the deck's.
    expect(srcdoc).toContain(escapeHtmlAttribute('font-family: var(--slaids-body-font)'))
    click(host, 'exit-interactive')
  })

  it('slår gjennom en temaendring ved neste kjøring, uten å røre den lagrede filen', () => {
    const before = deck()
    const host = mount(before)
    click(host, 'activate-interactive')
    expect(frameOf(host)!.getAttribute('srcdoc')).toContain(escapeHtmlAttribute(ACCENT))
    click(host, 'exit-interactive')

    // The section is recoloured — an ordinary edit to the *deck*, which does
    // not touch the interactive slide at all.
    const recoloured: Presentation = {
      ...before,
      slides: [{ ...sectionAt(before, 0), accentColor: '#7d3cff' }, before.slides[1]],
    }
    expect(appSlide(recoloured)).toEqual(appSlide(before))
    rerender(recoloured)

    click(host, 'activate-interactive')
    const srcdoc = frameOf(host)!.getAttribute('srcdoc')!
    expect(srcdoc).toContain(escapeHtmlAttribute('--slaids-accent: #7d3cff'))
    expect(srcdoc).not.toContain(escapeHtmlAttribute(`--slaids-accent: ${ACCENT}`))
    // The file itself is byte for byte what it was: the design is injected,
    // never written in.
    expect(srcdoc).toContain(escapeHtmlAttribute(APP))
    click(host, 'exit-interactive')
  })

  it('bygger ikke dokumentet på nytt under en app som kjører', () => {
    // A theme change while the app runs must not restart it: the design is
    // captured with the run and picked up by the next one.
    const before = deck()
    const host = mount(before)
    click(host, 'activate-interactive')
    const running = frameOf(host)
    const srcdoc = running!.getAttribute('srcdoc')

    rerender({
      ...before,
      slides: [{ ...sectionAt(before, 0), accentColor: '#7d3cff' }, before.slides[1]],
    })

    expect(frameOf(host)).toBe(running)
    expect(frameOf(host)!.getAttribute('srcdoc')).toBe(srcdoc)
    click(host, 'exit-interactive')
  })

  it('slipper låsen når flaten forsvinner mens appen kjører', () => {
    const host = mount(deck())
    click(host, 'activate-interactive')
    expect(isInteractiveRuntimeActive()).toBe(true)
    act(() => root!.unmount())
    root = null
    expect(isInteractiveRuntimeActive()).toBe(false)
  })
})
