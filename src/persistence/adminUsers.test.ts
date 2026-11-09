import { describe, expect, it, vi } from 'vitest'
import { ADMIN_USERS_PATH } from '../routing'
import { AdminRequestError, AdminUsersClient } from './adminUsers'

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('klienten for brukeradministrasjon', () => {
  it('sender den innloggede brukerens token og leser svaret', async () => {
    const fetch = vi.fn(async () => respond(200, { ok: true, data: { users: [] } }))
    const client = new AdminUsersClient({ accessToken: async () => 'jwt', fetch })
    expect(await client.list()).toEqual([])
    expect(fetch).toHaveBeenCalledWith(ADMIN_USERS_PATH, expect.objectContaining({
      method: 'GET',
      headers: { Authorization: 'Bearer jwt' },
    }))
  })

  it('sender endringer som JSON til brukerens egen adresse', async () => {
    const fetch = vi.fn(async () => respond(200, { ok: true, data: { user: { userId: 'u' } } }))
    const client = new AdminUsersClient({ accessToken: async () => 'jwt', fetch })
    await client.update('u', { active: false })
    expect(fetch).toHaveBeenCalledWith(`${ADMIN_USERS_PATH}/u`, expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
    }))
  })

  it('gir serverens kode og setning videre når den sier nei', async () => {
    const fetch = vi.fn(async () => respond(409, { ok: false, error: { code: 'LAST_ACTIVE_ADMIN', message: 'Minst én.' } }))
    const client = new AdminUsersClient({ accessToken: async () => 'jwt', fetch })
    await expect(client.update('u', { role: 'user' })).rejects.toEqual(new AdminRequestError('LAST_ACTIVE_ADMIN', 'Minst én.'))
  })

  it('spør ikke serveren uten innlogging, og sier fra om nettverksfeil', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('offline')
    })
    await expect(new AdminUsersClient({ accessToken: async () => null, fetch }).list()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    expect(fetch).not.toHaveBeenCalled()
    await expect(new AdminUsersClient({ accessToken: async () => 'jwt', fetch }).list()).rejects.toMatchObject({ code: 'NETWORK' })
  })
})
