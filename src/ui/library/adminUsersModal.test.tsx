/**
 * The admin screen: what it shows, what it sends, and that a server refusal
 * reaches the administrator as the server's own sentence.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AdminRequestError, type AdminUser, type MemberChange } from '../../persistence/adminUsers'
import type { SlaidsRole } from '../../persistence/slaidsUsers'
import { notify } from '../../state/toast'
import { AdminUsersModal } from './AdminUsersModal'

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ANNA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

class RecordingClient {
  users: AdminUser[] = [
    { userId: ME, email: 'meg@example.no', role: 'admin', active: true, createdAt: '', lastSignInAt: null },
    { userId: ANNA, email: 'anna@example.no', role: 'user', active: true, createdAt: '', lastSignInAt: null },
  ]
  readonly added: { email: string; role: SlaidsRole }[] = []
  readonly updates: { userId: string; change: MemberChange }[] = []
  refuseUpdate: AdminRequestError | null = null

  list = async () => this.users.map((user) => ({ ...user }))

  add = async (email: string, role: SlaidsRole) => {
    this.added.push({ email, role })
    const user: AdminUser = { userId: 'new', email, role, active: true, createdAt: '', lastSignInAt: null }
    this.users.push(user)
    return user
  }

  update = async (userId: string, change: MemberChange) => {
    if (this.refuseUpdate) throw this.refuseUpdate
    this.updates.push({ userId, change })
    const user = this.users.find((entry) => entry.userId === userId)!
    Object.assign(user, change)
    return user
  }
}

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
  vi.restoreAllMocks()
})

async function mount(client: RecordingClient): Promise<void> {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<AdminUsersModal open onOpenChange={() => {}} currentUserId={ME} client={client} />)
  })
  await settle()
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

function all(testId: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)]
}

function rowFor(email: string): HTMLElement {
  const row = all('admin-user-row').find((entry) => entry.textContent?.includes(email))
  if (!row) throw new Error(`Fant ikke raden for ${email}`)
  return row
}

async function click(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error('Fant ikke knappen')
  await act(async () => {
    ;(element as HTMLElement).click()
  })
  await settle()
}

function type(testId: string, value: string): void {
  const field = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Administrasjon → Brukere', () => {
  it('viser hver bruker med rolle, og markerer deg selv', async () => {
    await mount(new RecordingClient())
    expect(all('admin-user-row')).toHaveLength(2)
    expect(rowFor('meg@example.no').textContent).toContain('(deg)')
    expect(rowFor('meg@example.no').textContent).toContain('Administrator')
    expect(rowFor('anna@example.no').textContent).toContain('Bruker')
  })

  it('legger til en bruker med valgt rolle', async () => {
    const client = new RecordingClient()
    await mount(client)
    const addButton = document.querySelector<HTMLButtonElement>('[data-testid="admin-user-add"]')!
    expect(addButton.disabled).toBe(true)
    type('admin-user-email', 'ny@example.no')
    const select = document.querySelector<HTMLSelectElement>('[data-testid="admin-user-role"]')!
    act(() => {
      select.value = 'admin'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(addButton)
    expect(client.added).toEqual([{ email: 'ny@example.no', role: 'admin' }])
    expect(all('admin-user-row')).toHaveLength(3)
  })

  it('gir og fjerner administratorrollen', async () => {
    const client = new RecordingClient()
    await mount(client)
    await click(rowFor('anna@example.no').querySelector('[data-testid="admin-user-promote"]'))
    expect(client.updates).toEqual([{ userId: ANNA, change: { role: 'admin' } }])
    await click(rowFor('anna@example.no').querySelector('[data-testid="admin-user-demote"]'))
    expect(client.updates.at(-1)).toEqual({ userId: ANNA, change: { role: 'user' } })
  })

  it('deaktiverer først etter bekreftelse, og kan reaktivere', async () => {
    const client = new RecordingClient()
    await mount(client)
    await click(rowFor('anna@example.no').querySelector('[data-testid="admin-user-deactivate"]'))
    expect(client.updates).toEqual([])
    // The dialog's own button, rendered after the rows.
    const confirm = [...document.querySelectorAll('button')].filter((button) => button.textContent === 'Deaktiver').at(-1)
    await click(confirm)
    expect(client.updates).toEqual([{ userId: ANNA, change: { active: false } }])
    expect(rowFor('anna@example.no').textContent).toContain('Deaktivert')
    await click(rowFor('anna@example.no').querySelector('[data-testid="admin-user-reactivate"]'))
    expect(client.updates.at(-1)).toEqual({ userId: ANNA, change: { active: true } })
  })

  it('viser serverens begrunnelse når den sier nei', async () => {
    const client = new RecordingClient()
    client.refuseUpdate = new AdminRequestError('LAST_ACTIVE_ADMIN', 'Slaids må ha minst én aktiv administrator.')
    const error = vi.spyOn(notify, 'error')
    await mount(client)
    await click(rowFor('meg@example.no').querySelector('[data-testid="admin-user-demote"]'))
    expect(error).toHaveBeenCalledWith('Slaids må ha minst én aktiv administrator.')
  })

  it('viser en feil i stedet for en tom liste når listen ikke kan hentes', async () => {
    const client = new RecordingClient()
    client.list = async () => {
      throw new AdminRequestError('FORBIDDEN', 'Bare aktive administratorer kan administrere brukere.')
    }
    await mount(client)
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'Bare aktive administratorer kan administrere brukere.',
    )
  })
})
