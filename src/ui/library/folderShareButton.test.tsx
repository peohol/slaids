/**
 * Sharing a folder, from the owner's side.
 *
 * The switch only ever shows what the server confirmed, the link exists only
 * while the folder is shared, and local mode says why it cannot share instead
 * of pretending to.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { setFolderSharingOverride } from '../../persistence/activeRepository'
import type { FolderSharingRepository, ShareState } from '../../persistence/repository'
import { folderShareLink, useFolderSharing } from '../../state/folderSharing'
import { TooltipProvider } from '../components/Tooltip'
import { FolderShareButton, type FolderShareButtonProps } from './FolderShareButton'

const TOKEN = '9a8b7c6d-1111-4222-8333-444455556666'
const FOLDER = 'fl_kurs'

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
  setFolderSharingOverride(null)
})

async function render(node: React.ReactNode): Promise<HTMLElement> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(<TooltipProvider>{node}</TooltipProvider>))
  return container
}

/** The popover is portalled to `document.body`, so that is where it is looked for. */
function inPopover(testid: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${testid}"]`)
}

async function openPopover(host: HTMLElement): Promise<void> {
  const trigger = host.querySelector<HTMLButtonElement>('[data-testid="share-folder"]')
  expect(trigger).not.toBeNull()
  await act(async () => {
    trigger!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    trigger!.click()
  })
}

function button(props: Partial<FolderShareButtonProps>) {
  return (
    <FolderShareButton
      folderName="Kurs"
      status="ready"
      state={{ shared: false, token: null }}
      busy={false}
      onSetShared={() => {}}
      {...props}
    />
  )
}

describe('FolderShareButton', () => {
  it('er av, uten lenke, når mappen ikke er delt', async () => {
    const onSetShared = vi.fn()
    const host = await render(button({ onSetShared }))
    await openPopover(host)

    const toggle = inPopover('toggle-folder-share') as HTMLButtonElement
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.disabled).toBe(false)
    expect(inPopover('folder-share-link')).toBeNull()

    await act(async () => toggle.click())
    expect(onSetShared).toHaveBeenCalledWith(true)
  })

  it('er på og viser lenken og kopiknappen når mappen er delt', async () => {
    const onSetShared = vi.fn()
    const host = await render(button({ state: { shared: true, token: TOKEN }, onSetShared }))
    expect(host.querySelector('[data-testid="share-folder"]')?.getAttribute('data-state')).toBe('on')
    await openPopover(host)

    const link = inPopover('folder-share-link') as HTMLInputElement
    expect(link.value).toBe(`${window.location.origin}/s/f/${TOKEN}`)
    expect(link.readOnly).toBe(true)
    expect(inPopover('copy-folder-share-link')).not.toBeNull()

    await act(async () => (inPopover('toggle-folder-share') as HTMLButtonElement).click())
    expect(onSetShared).toHaveBeenCalledWith(false)
  })

  it('lar seg ikke trykke før statusen er lest, mens noe pågår, eller i lokal modus', async () => {
    for (const props of [{ status: 'loading' as const }, { busy: true }, { status: 'unsupported' as const }]) {
      const host = await render(button(props))
      await openPopover(host)
      expect((inPopover('toggle-folder-share') as HTMLButtonElement).disabled).toBe(true)
      act(() => root!.unmount())
      container?.remove()
      root = null
    }
  })
})

describe('folderShareLink', () => {
  it('finnes bare mens delingen er aktiv', () => {
    expect(folderShareLink({ shared: true, token: TOKEN })).toBe(`${window.location.origin}/s/f/${TOKEN}`)
    expect(folderShareLink({ shared: false, token: TOKEN })).toBeNull()
    expect(folderShareLink({ shared: true, token: null })).toBeNull()
  })
})

describe('useFolderSharing', () => {
  /** A stand-in whose answers are the only truth the hook may show. */
  function fakeFolderSharing(initial: Record<string, ShareState>): FolderSharingRepository & {
    calls: string[]
  } {
    const calls: string[] = []
    return {
      calls,
      listFolderShareStates: () => Promise.resolve(initial),
      enableFolderSharing: (folderId) => {
        calls.push(`on:${folderId}`)
        return Promise.resolve({ shared: true, token: TOKEN })
      },
      disableFolderSharing: (folderId) => {
        calls.push(`off:${folderId}`)
        return Promise.resolve({ shared: false, token: null })
      },
    }
  }

  function Harness() {
    const [reload] = useState(0)
    const sharing = useFolderSharing(reload)
    const state = sharing.stateOf(FOLDER)
    return (
      <button
        type="button"
        data-testid="harness"
        data-status={sharing.status}
        data-shared={String(state.shared)}
        onClick={() => void sharing.setShared(FOLDER, !state.shared)}
      />
    )
  }

  it('leser hvilke mapper som er delt, og viser bare det serveren bekreftet', async () => {
    const fake = fakeFolderSharing({})
    setFolderSharingOverride(fake)
    const host = await render(<Harness />)
    const harness = host.querySelector<HTMLButtonElement>('[data-testid="harness"]')!
    expect(harness.dataset.status).toBe('ready')
    expect(harness.dataset.shared).toBe('false')

    await act(async () => harness.click())
    expect(fake.calls).toEqual([`on:${FOLDER}`])
    expect(harness.dataset.shared).toBe('true')

    await act(async () => harness.click())
    expect(fake.calls).toEqual([`on:${FOLDER}`, `off:${FOLDER}`])
    expect(harness.dataset.shared).toBe('false')
  })

  it('står av når publiseringen feiler', async () => {
    const fake = fakeFolderSharing({})
    fake.enableFolderSharing = () => Promise.reject(new Error('nede'))
    setFolderSharingOverride(fake)
    const host = await render(<Harness />)
    const harness = host.querySelector<HTMLButtonElement>('[data-testid="harness"]')!

    await act(async () => harness.click())
    expect(harness.dataset.shared).toBe('false')
  })
})
