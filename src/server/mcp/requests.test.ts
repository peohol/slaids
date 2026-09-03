// @vitest-environment node
/**
 * Per-method parameter validation, checked against the specification's own
 * schemas.
 *
 * The readers in `requests.ts` are hand-written, which is the right trade for a
 * runtime that should carry no dependency it does not need — but it means they
 * are validated against *our reading* of MCP, and that is exactly the thing that
 * can be wrong. So the SDK is the oracle here: for every message a reader
 * accepts, the specification's schema must accept it too, and for the shapes we
 * refuse, it must refuse them as well.
 *
 * `@modelcontextprotocol/sdk` stays a development dependency. It is imported by
 * this file and by `interop.test.ts`, and by nothing that ships.
 */

import { describe, expect, it } from 'vitest'
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { JSON_RPC_ERROR } from './jsonrpc'
import {
  readCallToolParams,
  readInitializeParams,
  readListToolsParams,
  type Validated,
} from './requests'

/** What the specification's own schema says about the same message. */
function specAccepts(
  schema: { safeParse(value: unknown): { success: boolean } },
  method: string,
  params: Record<string, unknown>,
): boolean {
  return schema.safeParse({ method, params }).success
}

function accepted<T>(read: Validated<T>): T {
  if (!read.ok) throw new Error(`Forventet at dette ble godtatt, fikk «${read.message}»`)
  return read.value
}

function refused<T>(read: Validated<T>): { code: number; message: string } {
  if (read.ok) throw new Error('Forventet at dette ble avvist, men det gikk gjennom.')
  return { code: read.code, message: read.message }
}

const VALID_INITIALIZE = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'testklient', version: '1.0.0' },
}

describe('initialize', () => {
  it('godtar en fullstendig håndhilsning, og leser den ut', () => {
    const value = accepted(readInitializeParams(VALID_INITIALIZE))
    expect(value.protocolVersion).toBe('2025-06-18')
    expect(value.clientInfo).toEqual({ name: 'testklient', version: '1.0.0' })
  })

  it.each([
    ['uten protocolVersion', { capabilities: {}, clientInfo: VALID_INITIALIZE.clientInfo }],
    ['med numerisk protocolVersion', { ...VALID_INITIALIZE, protocolVersion: 1 }],
    ['uten capabilities', { protocolVersion: '2025-06-18', clientInfo: VALID_INITIALIZE.clientInfo }],
    ['med capabilities som liste', { ...VALID_INITIALIZE, capabilities: [] }],
    ['uten clientInfo', { protocolVersion: '2025-06-18', capabilities: {} }],
    ['med clientInfo uten version', { ...VALID_INITIALIZE, clientInfo: { name: 'x' } }],
    ['med clientInfo som streng', { ...VALID_INITIALIZE, clientInfo: 'testklient' }],
  ])('avviser en håndhilsning %s', (_name, params) => {
    expect(refused(readInitializeParams(params)).code).toBe(JSON_RPC_ERROR.INVALID_PARAMS)
    // And the specification agrees that this was never a valid handshake.
    expect(specAccepts(InitializeRequestSchema, 'initialize', params)).toBe(false)
  })

  it('godtar ukjente felter, siden MCP er uttrykkelig utvidbar', () => {
    const params = { ...VALID_INITIALIZE, _meta: { sporing: 'abc' } }
    expect(accepted(readInitializeParams(params)).protocolVersion).toBe('2025-06-18')
    expect(specAccepts(InitializeRequestSchema, 'initialize', params)).toBe(true)
  })
})

describe('tools/list', () => {
  it('godtar ingen parametre', () => {
    expect(accepted(readListToolsParams({}))).toEqual({})
  })

  it.each([
    ['et tall', 5],
    ['en liste', ['a']],
    ['et objekt', { side: 2 }],
    ['null', null],
  ])('avviser en cursor som er %s', (_name, cursor) => {
    expect(refused(readListToolsParams({ cursor })).code).toBe(JSON_RPC_ERROR.INVALID_PARAMS)
    expect(specAccepts(ListToolsRequestSchema, 'tools/list', { cursor })).toBe(false)
  })

  it('avviser en cursor den aldri delte ut, i stedet for å svare med den første siden', () => {
    // The specification's own answer to a cursor a server did not mint. Ignoring
    // it would answer page one to a client that asked for page two.
    const refusal = refused(readListToolsParams({ cursor: 'noe' }))
    expect(refusal.code).toBe(JSON_RPC_ERROR.INVALID_PARAMS)
    expect(refusal.message).toMatch(/cursor/i)
    // Well-formed as far as the protocol goes — this refusal is Slaids'.
    expect(specAccepts(ListToolsRequestSchema, 'tools/list', { cursor: 'noe' })).toBe(true)
  })
})

describe('tools/call', () => {
  it('leser navn og argumenter', () => {
    const value = accepted(readCallToolParams({ name: 'slaids_x', arguments: { a: 1 } }))
    expect(value).toEqual({ name: 'slaids_x', arguments: { a: 1 } })
  })

  it('leser manglende argumenter som det tomme objektet', () => {
    // The same reading REST gives an empty body: an operation without arguments
    // wants to receive `{}`.
    expect(accepted(readCallToolParams({ name: 'slaids_x' })).arguments).toEqual({})
    expect(specAccepts(CallToolRequestSchema, 'tools/call', { name: 'slaids_x' })).toBe(true)
  })

  it.each([
    ['uten navn', {}],
    ['med numerisk navn', { name: 7 }],
    ['med argumenter som liste', { name: 'slaids_x', arguments: [1, 2] }],
    ['med argumenter som streng', { name: 'slaids_x', arguments: 'tittel=Dekk' }],
    ['med argumenter som null', { name: 'slaids_x', arguments: null }],
  ])('avviser et kall %s', (_name, params) => {
    expect(refused(readCallToolParams(params)).code).toBe(JSON_RPC_ERROR.INVALID_PARAMS)
    expect(specAccepts(CallToolRequestSchema, 'tools/call', params)).toBe(false)
  })

  it('overlater til registeret å avgjøre om navnet finnes', () => {
    // An empty name is a well-formed call to no tool, which is the registry's
    // answer to give — being stricter here would be a second not-found.
    expect(accepted(readCallToolParams({ name: '' })).name).toBe('')
    expect(specAccepts(CallToolRequestSchema, 'tools/call', { name: '' })).toBe(true)
  })
})
