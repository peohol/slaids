/**
 * The `Del` control.
 *
 * The rule under test is that the switch only ever shows what the server has
 * confirmed: it is inert until the stored state has been read, it does not flip
 * while a publish is in flight, and in local mode it says why it cannot be used
 * instead of quietly pretending to work.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { currentShareUrl } from '../../state/sharing'
import { TooltipProvider } from '../components/Tooltip'
import { ShareToggle, type ShareToggleProps } from './ShareToggle'

const TOKEN = '3f2a1b0c-1111-4222-8333-444455556666'
const LINK = `https://slaids.example/s/${TOKEN}`

function renderWith(props: Partial<ShareToggleProps>): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ShareToggle
        status="ready"
        shared={false}
        busy={false}
        error={null}
        link={null}
        onToggle={() => {}}
        {...props}
      />
    </TooltipProvider>,
  )
}

describe('ShareToggle', () => {
  it('er av og trykkbar når presentasjonen ikke er delt', () => {
    const markup = renderWith({ status: 'ready', shared: false, link: null })
    expect(markup).toContain('data-state="off"')
    expect(markup).not.toContain('aria-disabled')
    expect(markup).not.toContain('copy-share-link')
  })

  it('er på og tilbyr lenken når presentasjonen er delt', () => {
    const markup = renderWith({ status: 'ready', shared: true, link: `/s/${TOKEN}` })
    expect(markup).toContain('data-state="on"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('data-testid="copy-share-link"')
  })

  it('beholder navnet på kopiknappen når ordene viker i en smal verktøylinje', () => {
    const markup = renderWith({ status: 'ready', shared: true, link: `/s/${TOKEN}` })
    const doc = new DOMParser().parseFromString(markup, 'text/html')
    const copy = doc.querySelector('[data-testid="copy-share-link"]')
    expect(copy?.getAttribute('aria-label')).toBe('Kopier lenke')
    // Det er ordene, ikke knappen, verktøylinjen skjuler når den blir smal.
    expect(copy?.querySelector('.toolbar__label')?.textContent).toBe('Kopier lenke')
  })

  it('viser ingen påstand før servertilstanden er lest', () => {
    const markup = renderWith({ status: 'loading' })
    expect(markup).toContain('data-state="off"')
    expect(markup).toContain('aria-disabled="true"')
    // Og ingen lenke å kopiere, siden det ikke finnes noen ennå.
    expect(markup).not.toContain('copy-share-link')
  })

  it('lar seg ikke trykke mens en publisering pågår', () => {
    const markup = renderWith({ status: 'ready', shared: false, busy: true })
    expect(markup).toContain('data-state="busy"')
    expect(markup).toContain('aria-disabled="true"')
    expect(markup).toContain('aria-busy="true"')
  })

  it('er avslått og forklart i lokal modus', () => {
    const markup = renderWith({ status: 'unsupported' })
    expect(markup).toContain('data-state="unsupported"')
    expect(markup).toContain('aria-disabled="true"')
    expect(markup).not.toContain('copy-share-link')
  })
})

describe('delingslenken', () => {
  it('finnes bare mens delingen er aktiv', () => {
    expect(currentShareUrl({ shared: true, token: TOKEN })).toBe(
      `${window.location.origin}/s/${TOKEN}`,
    )
    expect(currentShareUrl({ shared: false, token: TOKEN })).toBeNull()
    expect(currentShareUrl({ shared: true, token: null })).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * The failure path, in a real DOM
 *
 * Copying can be refused — an insecure context, a browser that will not hand a
 * page the clipboard, a permission the user declined. What matters then is that
 * the user still gets the link, because there is nowhere else to find it: the
 * address bar holds the editor's URL, not the share link.
 * ------------------------------------------------------------------ */

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
})

function mount(props: Partial<ShareToggleProps>): HTMLElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <TooltipProvider>
        <ShareToggle
          status="ready"
          shared
          busy={false}
          error={null}
          link={LINK}
          onToggle={() => {}}
          {...props}
        />
      </TooltipProvider>,
    )
  })
  return container
}

function clickCopy(host: HTMLElement): void {
  const button = host.querySelector<HTMLButtonElement>('[data-testid="copy-share-link"]')
  expect(button).not.toBeNull()
  act(() => button!.click())
}

/** Neither clipboard route works — the case the fallback exists for. */
function refuseClipboard(): void {
  vi.stubGlobal('navigator', {
    ...navigator,
    clipboard: { writeText: () => Promise.reject(new Error('nektet')) },
  })
  document.execCommand = () => false
}

describe('kopiering som feiler', () => {
  it('gir brukeren lenken i et markerbart felt i stedet for et blindspor', async () => {
    refuseClipboard()
    const host = mount({})
    expect(host.querySelector('[data-testid="share-link-manual"]')).toBeNull()

    clickCopy(host)
    await act(async () => {})

    const field = host.querySelector<HTMLInputElement>('[data-testid="share-link-manual"]')
    expect(field).not.toBeNull()
    // Selve lenken, ikke en beskjed om å lete etter den et sted den ikke er.
    expect(field!.value).toBe(LINK)
    expect(field!.readOnly).toBe(true)
    // Markert og klar for Ctrl+C.
    expect(document.activeElement).toBe(field)
    expect(field!.selectionStart).toBe(0)
    expect(field!.selectionEnd).toBe(LINK.length)
    // Og knappen påstår ikke at det gikk bra.
    expect(host.textContent).not.toContain('Kopiert')
  })

  it('sier ikke lenger at lenken finnes i adressefeltet', async () => {
    refuseClipboard()
    const host = mount({})
    clickCopy(host)
    await act(async () => {})

    const { useToasts } = await import('../../state/toast')
    const messages = useToasts.getState().toasts.map((toast) => toast.message)
    expect(messages.join(' ')).not.toMatch(/adressefelt/i)
    expect(messages.join(' ')).toMatch(/merk den og kopier/i)
  })
})

describe('kopiering som lykkes', () => {
  it('bekrefter, og viser ikke reservefeltet', async () => {
    const written: string[] = []
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText: (text: string) => {
          written.push(text)
          return Promise.resolve()
        },
      },
    })

    const host = mount({})
    clickCopy(host)
    await act(async () => {})

    expect(written).toEqual([LINK])
    expect(host.textContent).toContain('Kopiert')
    expect(host.querySelector('[data-testid="share-link-manual"]')).toBeNull()
  })
})
