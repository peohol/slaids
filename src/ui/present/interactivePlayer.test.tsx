/**
 * The player with an interactive slide in it — which is the shared view too.
 *
 * The shared view mounts `PresentationPlayer` with no `onExit`, and that is
 * the only difference from the owner's own presentation mode. So what is
 * proven here on the player holds on `/s/<token>` as well: the cover's button
 * is real, a running app owns every key and click the player would otherwise
 * turn a page on, and closing hands the page back exactly where it was.
 *
 * In jsdom, so the keys are dispatched rather than pressed and the frame is
 * drawn rather than run. The Playwright flow spec presses real keys in a
 * real browser; this one is about the player's own handlers.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createInteractiveSlide, createPresentation } from '../../domain/presentation'
import { buildSharedSnapshot } from '../../domain/sharing'
import { sectionAt } from '../../domain/testDecks'
import type { Presentation } from '../../domain/types'
import { isInteractiveRuntimeActive } from '../../state/interactiveRuntime'
import { INTERACTIVE_SANDBOX_FLAGS } from '../interactive/sandboxDocument'
import { PresentationPlayer } from './PresentationPlayer'

const APP = '<!doctype html><html><body><p>Teller</p></body></html>'

function deck(): Presentation {
  const presentation = createPresentation({ title: 'Delt dekk' })
  return {
    ...presentation,
    slides: [
      sectionAt(presentation, 0),
      createInteractiveSlide({ name: 'Teller', fileName: 'teller.html', html: APP }),
      presentation.slides[1],
    ],
  }
}

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeAll(() => {
  // The player fits itself to its host with a ResizeObserver, which jsdom
  // does not have; a silent one keeps the scale at its initial value.
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
  expect(isInteractiveRuntimeActive()).toBe(false)
})

function mount(onExit: ((slideId: string) => void) | null): HTMLElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // The shared view's deck is a snapshot, not the private document.
  const shared = buildSharedSnapshot(deck())
  act(() => root!.render(<PresentationPlayer deck={shared} shareUrl={null} onExit={onExit} />))
  return container
}

function pageOf(host: HTMLElement): number {
  return Number(host.querySelector('[data-testid="present-view"]')?.getAttribute('data-page'))
}

function press(key: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

function click(host: HTMLElement, testId: string): void {
  const element = host.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  expect(element, testId).not.toBeNull()
  act(() => element!.click())
}

describe('en interaktiv slide i spilleren, uten vei ut (den delte visningen)', () => {
  it('kan startes fra forsidens knapp, og eier tastaturet og klikkene mens den kjører', () => {
    const host = mount(null)
    expect(pageOf(host)).toBe(1)
    press('ArrowRight')
    expect(pageOf(host)).toBe(2)

    // On the player the cover's button is real, and nothing runs before it.
    expect(host.querySelector('[data-testid="activate-interactive"]')?.tagName).toBe('BUTTON')
    expect(host.querySelector('[data-testid="interactive-frame"]')).toBeNull()

    click(host, 'activate-interactive')
    const frame = host.querySelector('[data-testid="interactive-frame"]')
    expect(frame?.getAttribute('sandbox')).toBe(INTERACTIVE_SANDBOX_FLAGS)
    expect(isInteractiveRuntimeActive()).toBe(true)

    // Every key the player turns pages on, and the one it leaves on.
    for (const key of ['ArrowRight', 'PageDown', ' ', 'ArrowLeft', 'PageUp', 'Home', 'End', 'Escape']) {
      press(key)
      expect(pageOf(host), key).toBe(2)
    }
    // A click on the page itself, which would otherwise advance the deck.
    act(() => host.querySelector<HTMLElement>('[data-testid="present-view"]')!.click())
    expect(pageOf(host)).toBe(2)
    expect(host.querySelector('[data-testid="interactive-frame"]')).toBe(frame)

    click(host, 'exit-interactive')
    expect(host.querySelector('[data-testid="interactive-frame"]')).toBeNull()
    expect(isInteractiveRuntimeActive()).toBe(false)
    // The same page, with the button focused, and the keys are the player's again.
    expect(pageOf(host)).toBe(2)
    expect(document.activeElement?.getAttribute('data-testid')).toBe('activate-interactive')
    press('ArrowRight')
    expect(pageOf(host)).toBe(3)
  })

  it('kan startes på nytt etter avslutning, som en ny kjøring', () => {
    const host = mount(null)
    press('ArrowRight')
    click(host, 'activate-interactive')
    const first = host.querySelector('[data-testid="interactive-frame"]')
    click(host, 'exit-interactive')
    click(host, 'activate-interactive')
    const second = host.querySelector('[data-testid="interactive-frame"]')
    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
    click(host, 'exit-interactive')
  })
})

describe('en interaktiv slide i spilleren, med vei ut (presentasjonsmodus)', () => {
  it('lar ikke Escape avslutte presentasjonen mens appen kjører', () => {
    const exits: string[] = []
    const host = mount((slideId) => exits.push(slideId))
    press('ArrowRight')
    click(host, 'activate-interactive')

    press('Escape')
    expect(exits).toEqual([])
    expect(host.querySelector('[data-testid="present-view"]')).not.toBeNull()

    click(host, 'exit-interactive')
    press('Escape')
    // Now it is the player's Escape again, handing back the slide on screen.
    expect(exits).toHaveLength(1)
  })
})
