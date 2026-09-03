/**
 * The token screen.
 *
 * Two claims are worth pinning in a real DOM, because both are about something
 * the owner cannot recover from if it is wrong:
 *
 *  - the secret is shown once, and only the hash is sent anywhere. If this
 *    screen ever posted the token itself, nothing downstream would notice;
 *  - publishing is not a default. A token minted without thinking must not come
 *    with the right to hand a presentation to the internet.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { hashAgentToken, looksLikeAgentToken, type AgentTokenRecord, type CreatedAgentToken, type NewAgentToken, type SupabaseAgentTokens } from '../../persistence/agentTokens'
import { AgentTokensModal } from './AgentTokensModal'

/** The store, recording what the screen actually asked it to store. */
class RecordingTokens {
  readonly records: AgentTokenRecord[] = []
  readonly created: { input: NewAgentToken; hash: string }[] = []
  readonly revoked: string[] = []

  list(): Promise<AgentTokenRecord[]> {
    return Promise.resolve([...this.records])
  }

  async create(input: NewAgentToken): Promise<CreatedAgentToken> {
    const token = `slaids_at_${'a'.repeat(43)}`
    this.created.push({ input, hash: await hashAgentToken(token) })
    const record: AgentTokenRecord = {
      id: `token-${this.records.length + 1}`,
      ownerId: 'owner-1',
      name: input.name.trim(),
      scopes: [...input.scopes],
      createdAt: '2026-09-02T10:00:00.000Z',
      expiresAt: input.expiresAt,
      lastUsedAt: null,
      revokedAt: null,
    }
    this.records.push(record)
    return { token, record }
  }

  revoke(id: string): Promise<void> {
    this.revoked.push(id)
    const record = this.records.find((entry) => entry.id === id)
    if (record) record.revokedAt = '2026-09-02T11:00:00.000Z'
    return Promise.resolve()
  }

  remove(id: string): Promise<void> {
    const index = this.records.findIndex((entry) => entry.id === id)
    if (index >= 0) this.records.splice(index, 1)
    return Promise.resolve()
  }
}

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
})

function mount(store: RecordingTokens): void {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <AgentTokensModal
        open
        onOpenChange={() => {}}
        tokens={store as unknown as SupabaseAgentTokens}
      />,
    )
  })
}

/** Radix renders the dialog in a portal, so queries go through the document. */
function find<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Fant ikke ${selector}`)
  return element
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function typeName(value: string): void {
  const field = find<HTMLInputElement>('[data-testid="agent-token-name"]')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('AgentTokensModal', () => {
  it('publisering er ikke forhåndsvalgt', async () => {
    mount(new RecordingTokens())
    await settle()

    expect(find<HTMLInputElement>('[data-testid="agent-scope-presentations:read"]').checked).toBe(true)
    expect(find<HTMLInputElement>('[data-testid="agent-scope-presentations:write"]').checked).toBe(true)
    expect(find<HTMLInputElement>('[data-testid="agent-scope-assets:write"]').checked).toBe(true)
    // The one that is not. Publishing has to be asked for.
    expect(find<HTMLInputElement>('[data-testid="agent-scope-sharing:write"]').checked).toBe(false)
  })

  it('viser tokenet én gang, og lagrer bare hashen', async () => {
    const store = new RecordingTokens()
    mount(store)
    await settle()

    typeName('Byggeagenten')
    await act(async () => {
      find<HTMLButtonElement>('[data-testid="create-agent-token"]').click()
      await Promise.resolve()
    })
    await settle()

    const shown = find<HTMLInputElement>('[data-testid="agent-token-value"]').value
    expect(looksLikeAgentToken(shown)).toBe(true)

    // What the screen handed the store: a hash, and the name and scopes the
    // owner chose. Never the secret.
    expect(store.created).toHaveLength(1)
    expect(store.created[0].hash).toMatch(/^[0-9a-f]{64}$/)
    expect(store.created[0].hash).not.toContain(shown)
    expect(store.created[0].input.scopes).not.toContain('sharing:write')
    expect(store.created[0].input.expiresAt).toBeNull()
  })

  it('lar seg ikke sende uten navn', async () => {
    mount(new RecordingTokens())
    await settle()
    expect(find<HTMLButtonElement>('[data-testid="create-agent-token"]').disabled).toBe(true)
    typeName('Noe')
    expect(find<HTMLButtonElement>('[data-testid="create-agent-token"]').disabled).toBe(false)
  })

  it('lister tokens med status, og tilbyr tilbakekalling bare for de levende', async () => {
    const store = new RecordingTokens()
    store.records.push(
      {
        id: 'a',
        ownerId: 'owner-1',
        name: 'Aktivt',
        scopes: ['presentations:read'],
        createdAt: '2026-09-01T10:00:00.000Z',
        expiresAt: null,
        lastUsedAt: '2026-09-02T09:00:00.000Z',
        revokedAt: null,
      },
      {
        id: 'b',
        ownerId: 'owner-1',
        name: 'Tilbakekalt',
        scopes: ['presentations:read'],
        createdAt: '2026-09-01T10:00:00.000Z',
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: '2026-09-02T08:00:00.000Z',
      },
    )
    mount(store)
    await settle()

    expect(document.querySelectorAll('[data-testid="agent-token-row"]')).toHaveLength(2)
    // One button, for the one token that can still be taken away.
    expect(document.querySelectorAll('[data-testid="revoke-agent-token"]')).toHaveLength(1)
    expect(document.body.textContent).toContain('Trukket tilbake')
    expect(document.body.textContent).toContain('Aktivt')
  })
})
