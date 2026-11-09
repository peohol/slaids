import { describe, expect, it } from 'vitest'
import { isActiveAccess, isSlaidsRole, slaidsUserAccessFromRow } from './slaidsUsers'

describe('tilgangslisten, lest fra en rad', () => {
  const row = { user_id: 'u1', role: 'admin', active: true }

  it('gir bruker, rolle og status for en gyldig rad', () => {
    expect(slaidsUserAccessFromRow(row)).toEqual({ userId: 'u1', role: 'admin', active: true })
  })

  it.each([
    ['ingen rad', null],
    ['ukjent rolle', { ...row, role: 'owner' }],
    ['status som tekst', { ...row, active: 'true' }],
    ['manglende bruker', { ...row, user_id: '' }],
  ])('regner %s som «ikke en Slaids-bruker»', (_label, value) => {
    expect(slaidsUserAccessFromRow(value)).toBeNull()
  })

  it('slipper bare inn en aktiv bruker', () => {
    expect(isActiveAccess({ userId: 'u1', role: 'user', active: true })).toBe(true)
    expect(isActiveAccess({ userId: 'u1', role: 'admin', active: false })).toBe(false)
    expect(isActiveAccess(null)).toBe(false)
  })

  it('kjenner bare de to rollene', () => {
    expect(['user', 'admin', 'owner', ''].filter(isSlaidsRole)).toEqual(['user', 'admin'])
  })
})
