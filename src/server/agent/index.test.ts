// @vitest-environment node
/**
 * What a deployment without Supabase answers.
 *
 * Slaids has two storage modes and no fallback between them, and the REST layer
 * has only one of them: a server has no IndexedDB to serve from. So the answer
 * to a missing configuration has to be a refusal that says which variable is
 * missing — not a module that throws while loading (which becomes a platform
 * error page an agent cannot parse) and certainly not an API that appears to
 * work against nothing.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_API_BASE_PATH } from '../../routing'
import { resetAgentApi, serveAgentApi } from './index'

afterEach(() => resetAgentApi())

describe('serveAgentApi', () => {
  it('svarer 503 og navngir variabelen som mangler', async () => {
    const response = await serveAgentApi(
      new Request(`https://slaids.example${AGENT_API_BASE_PATH}/operations`, {
        method: 'GET',
        headers: { Authorization: 'Bearer slaids_at_0123456789012345678901234567890123456789012' },
      }),
      {},
    )
    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('SERVER_NOT_CONFIGURED')
    expect(body.error.message).toContain('SLAIDS_SUPABASE_URL')
  })

  it('svarer 503 i stedet for å starte med en nøkkel som ligger i nettleserbundelen', async () => {
    const response = await serveAgentApi(
      new Request(`https://slaids.example${AGENT_API_BASE_PATH}`, { method: 'GET' }),
      {
        SLAIDS_SUPABASE_URL: 'https://project.supabase.co',
        SLAIDS_SUPABASE_SECRET_KEY: 'lekket',
        VITE_ET_ELLER_ANNET: 'lekket',
      },
    )
    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: { message: string } }
    expect(body.error.message).toContain('VITE_ET_ELLER_ANNET')
  })
})
