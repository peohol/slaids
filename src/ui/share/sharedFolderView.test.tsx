/**
 * A shared folder, from the outside.
 *
 * The rules under test: the folder's address stays on the public side even
 * when it is broken, a viewer can do nothing but open a deck, a deck opens in
 * presentation mode through the folder's own address, and leaving the
 * presentation comes back to the folder.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root as ReactRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { Root } from '../../Root'
import { createPresentation } from '../../domain/presentation'
import { buildSharedSnapshot } from '../../domain/sharing'
import { SharedFolderView } from './SharedFolderView'

const FOLDER_TOKEN = '9a8b7c6d-1111-4222-8333-444455556666'
const PROJECT_URL = 'https://project.supabase.co'

const LISTING = {
  format: 'slaids-shared-folder',
  folderVersion: 1,
  name: 'Kurs i Slaids',
  presentations: [
    { id: 'p_forste', title: 'Første time', slideCount: 3 },
    { id: 'p_andre', title: 'Andre time', slideCount: 1 },
  ],
}

/** Everything a viewer of a shared folder must never be offered. */
const OWNER_TESTIDS = [
  'top-toolbar',
  'editor',
  'library',
  'presentation-grid',
  'new-presentation',
  'new-folder',
  'share-folder',
  'delete-presentation',
  'rename-presentation',
  'presentation-more',
  'folder-more',
]

describe('Root', () => {
  it('monterer mappevisningen for /s/f/<token>, ikke arbeidsområdet', () => {
    expect(Root({ pathname: `/s/f/${FOLDER_TOKEN}` }).type).toBe(SharedFolderView)
    expect(Root({ pathname: '/s/f/ikke-et-token' }).type).toBe(SharedFolderView)
  })

  it('svarer lokalt på en ødelagt mappeadresse, uten å spørre serveren', () => {
    const fetch = vi.fn(() => Promise.reject(new Error('skal ikke kalles')))
    vi.stubGlobal('fetch', fetch)
    const markup = renderToStaticMarkup(<Root pathname="/s/f/ikke-et-token" />)
    expect(markup).toContain('data-testid="shared-not-found"')
    expect(markup).toContain('den som eier mappen')
    expect(markup).not.toContain('auth-')
    expect(fetch).not.toHaveBeenCalled()
  })
})

let container: HTMLDivElement | null = null
let root: ReactRoot | null = null

beforeEach(() => {
  // The player fits itself to its host with a ResizeObserver, which jsdom does
  // not have; a silent one keeps the scale at its initial value.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubEnv('VITE_SUPABASE_URL', PROJECT_URL)
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  window.history.replaceState(null, '')
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** Answers the share endpoint the way it answers for a shared folder. */
function serveFolder(listing: unknown = LISTING): string[] {
  const asked: string[] = []
  const snapshot = JSON.parse(
    JSON.stringify(buildSharedSnapshot(createPresentation({ title: 'Første time' }))),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      asked.push(url)
      const body = url.includes('presentation=') ? snapshot : listing
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)
    }),
  )
  return asked
}

async function mount(): Promise<HTMLElement> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root!.render(<SharedFolderView token={FOLDER_TOKEN} />))
  return container
}

describe('mappevisningen', () => {
  it('viser mappens navn og én knapp per publisert presentasjon, og ingenting annet', async () => {
    const asked = serveFolder()
    const host = await mount()

    expect(host.querySelector('[data-testid="shared-folder-name"]')?.textContent).toContain(
      'Kurs i Slaids',
    )
    const cards = host.querySelectorAll('[data-testid="open-shared-presentation"]')
    expect([...cards].map((card) => card.textContent)).toEqual([
      expect.stringContaining('Første time'),
      expect.stringContaining('Andre time'),
    ])
    // Det eneste en seer kan gjøre er å åpne en presentasjon.
    expect(host.querySelectorAll('button')).toHaveLength(cards.length)
    expect(host.querySelectorAll('input, textarea, select, [contenteditable]')).toHaveLength(0)
    for (const testid of OWNER_TESTIDS) {
      expect(host.querySelector(`[data-testid="${testid}"]`)).toBeNull()
    }
    expect(asked).toEqual([`${PROJECT_URL}/functions/v1/slaids-share?folder=${FOLDER_TOKEN}`])
  })

  it('åpner en presentasjon i presentasjonsmodus og kommer tilbake til mappen etterpå', async () => {
    const asked = serveFolder()
    const host = await mount()

    const first = host.querySelector<HTMLButtonElement>('[data-testid="open-shared-presentation"]')
    await act(async () => first!.click())

    expect(host.querySelector('[data-testid="present-view"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="shared-folder"]')).toBeNull()
    // Hentet gjennom mappens adresse, aldri en egen lenke til presentasjonen.
    expect(asked.at(-1)).toBe(
      `${PROJECT_URL}/functions/v1/slaids-share?folder=${FOLDER_TOKEN}&presentation=p_forste`,
    )
    // Ingen QR-side: den hører til en presentasjon som er delt alene.
    expect(host.querySelector('[data-testid="present-view"]')?.getAttribute('data-page-count')).toBe(
      '2',
    )

    // Escape avslutter, gjennom historikken, og mappen spørres på nytt.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      // jsdom fyrer popstate asynkront etter history.back().
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(host.querySelector('[data-testid="present-view"]')).toBeNull()
    expect(host.querySelector('[data-testid="shared-folder"]')).not.toBeNull()
    expect(asked.filter((url) => !url.includes('presentation='))).toHaveLength(2)
  })

  it('sier fra om en tom mappe i stedet for å vise et tomt rutenett', async () => {
    serveFolder({ ...LISTING, presentations: [] })
    const host = await mount()
    expect(host.textContent).toContain('ingen presentasjoner i denne mappen')
  })

  it('behandler en avslått eller ukjent mappe som en død lenke', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response),
      ),
    )
    const host = await mount()
    expect(host.querySelector('[data-testid="shared-not-found"]')).not.toBeNull()
  })
})
