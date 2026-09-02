/**
 * Publishing, from an agent.
 *
 * Sharing is the one agent operation whose effect is visible outside the
 * owner's account, so the claims worth pinning are about what is published and
 * what is not: the saved document rather than a draft, a snapshot that lists
 * what goes in rather than deleting what must not, a new token every time, and
 * an honest refusal where there is no public backend to publish to.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { newShareToken } from '../domain/ids'
import { SlaidsDatabase } from '../persistence/db'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import { RepositoryError, type ShareState, type SharingRepository } from '../persistence/repository'
import type { SharedPresentationSnapshot } from '../domain/sharing'
import { runOperation } from './registry'
import type { AgentContext, AgentResult } from './types'
import type { SharingView } from './operations/sharing'

let counter = 0
const databases: SlaidsDatabase[] = []

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

/** The public backend, in memory, remembering what it was handed. */
class MemorySharing implements SharingRepository {
  private state = new Map<string, ShareState>()
  readonly published: SharedPresentationSnapshot[] = []

  readShareState(presentationId: string): Promise<ShareState> {
    return Promise.resolve(this.state.get(presentationId) ?? { shared: false, token: null })
  }

  enableSharing(presentationId: string, snapshot: SharedPresentationSnapshot): Promise<ShareState> {
    this.published.push(snapshot)
    const next: ShareState = { shared: true, token: newShareToken() }
    this.state.set(presentationId, next)
    return Promise.resolve(next)
  }

  disableSharing(presentationId: string): Promise<ShareState> {
    // Rotated on the way out, exactly as the real one does.
    this.state.set(presentationId, { shared: false, token: newShareToken() })
    return Promise.resolve({ shared: false, token: null })
  }
}

function freshContext(sharing?: SharingRepository): AgentContext {
  counter += 1
  const database = new SlaidsDatabase(`slaids-agent-sharing-${counter}`)
  databases.push(database)
  return { repository: new DexieSlaidsRepository(database), ...(sharing ? { sharing } : {}) }
}

async function call<T>(context: AgentContext, name: string, input: Record<string, unknown> = {}) {
  return (await runOperation(context, name, input)) as AgentResult<T>
}

async function presentationIn(context: AgentContext): Promise<string> {
  const created = await call<{ presentationId: string }>(context, 'create_presentation', {
    title: 'Til publisering',
  })
  if (!created.ok) throw new Error(created.error.message)
  return created.value.presentationId
}

describe('set_sharing', () => {
  it('publiserer det lagrede dokumentet og svarer med lenken', async () => {
    const sharing = new MemorySharing()
    const context = freshContext(sharing)
    const presentationId = await presentationIn(context)

    const shared = await call<SharingView>(context, 'set_sharing', { presentationId, shared: true })
    expect(shared.ok).toBe(true)
    if (!shared.ok) return

    expect(shared.value.shared).toBe(true)
    expect(shared.value.token).toBeTruthy()
    expect(shared.value.path).toBe(`/s/${shared.value.token}`)
    // The snapshot is the sanitised one the editor publishes — same builder,
    // same rule about what is listed rather than deleted.
    expect(sharing.published).toHaveLength(1)
    expect(sharing.published[0]).not.toHaveProperty('sandbox')
    expect(sharing.published[0]).not.toHaveProperty('ideas')
    expect(sharing.published[0]).not.toHaveProperty('folderId')
  })

  it('leser statusen tilbake, og slår delingen av igjen', async () => {
    const context = freshContext(new MemorySharing())
    const presentationId = await presentationIn(context)
    await call(context, 'set_sharing', { presentationId, shared: true })

    const read = await call<SharingView>(context, 'get_sharing', { presentationId })
    expect(read.ok && read.value.shared).toBe(true)

    const off = await call<SharingView>(context, 'set_sharing', { presentationId, shared: false })
    expect(off.ok && off.value).toMatchObject({ shared: false, token: null, path: null })

    const after = await call<SharingView>(context, 'get_sharing', { presentationId })
    expect(after.ok && after.value.token).toBeNull()
  })

  it('nekter å publisere en lesing som er blitt gammel', async () => {
    const context = freshContext(new MemorySharing())
    const presentationId = await presentationIn(context)

    const conflict = await call(context, 'set_sharing', {
      presentationId,
      shared: true,
      expectedRevision: 'noe-annet',
    })
    expect(conflict).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  })

  it('sier fra når det ikke finnes noe å publisere til', async () => {
    // Local mode has no anonymous reader. A pretend answer here would be a link
    // that looks live and cannot work.
    const result = await call(freshContext(), 'set_sharing', { presentationId: 'p1', shared: true })
    expect(result).toMatchObject({ ok: false, error: { code: 'SHARING_UNAVAILABLE' } })
  })

  it('lar en feilet publisering være en feil, ikke en halv deling', async () => {
    const failing: SharingRepository = {
      readShareState: () => Promise.reject(new RepositoryError('nede')),
      enableSharing: () => Promise.reject(new RepositoryError('nede')),
      disableSharing: () => Promise.reject(new RepositoryError('nede')),
    }
    const context = freshContext(failing)
    const presentationId = await presentationIn(context)
    const result = await call(context, 'set_sharing', { presentationId, shared: true })
    expect(result).toMatchObject({ ok: false, error: { code: 'STORAGE_FAILED' } })
  })

  it('finner ikke en presentasjon som ikke finnes', async () => {
    const context = freshContext(new MemorySharing())
    const result = await call(context, 'set_sharing', { presentationId: 'p_borte', shared: true })
    expect(result).toMatchObject({ ok: false, error: { code: 'PRESENTATION_NOT_FOUND' } })
  })
})
