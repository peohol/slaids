// @vitest-environment node
/**
 * The envelope, and every way a client can get it wrong.
 *
 * Worth its own file because these are the cases that decide whether a message
 * ever becomes a call: a batch, a missing `method`, positional parameters, an id
 * that is not one. Each of them is a value here rather than an exception, which
 * is what lets the endpoint answer all of them in one shape.
 */

import { describe, expect, it } from 'vitest'
import {
  JSONRPC_VERSION,
  JSON_RPC_ERROR,
  jsonRpcError,
  jsonRpcResult,
  readJsonRpcMessage,
} from './jsonrpc'

describe('readJsonRpcMessage', () => {
  it('leser et vanlig kall', () => {
    expect(
      readJsonRpcMessage({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'x' } }),
    ).toEqual({ kind: 'request', id: 7, method: 'tools/call', params: { name: 'x' } })
  })

  it('godtar både streng-id og tall-id', () => {
    expect(readJsonRpcMessage({ jsonrpc: '2.0', id: 'a', method: 'ping' })).toMatchObject({
      kind: 'request',
      id: 'a',
    })
  })

  it('leser en melding uten id som en notifikasjon, som aldri skal besvares', () => {
    expect(readJsonRpcMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual({
      kind: 'notification',
      method: 'notifications/initialized',
      params: {},
    })
  })

  it('behandler id: null som en notifikasjon, siden MCP ikke tillater den som id', () => {
    expect(readJsonRpcMessage({ jsonrpc: '2.0', id: null, method: 'ping' }).kind).toBe(
      'notification',
    )
  })

  it('kjenner igjen et svar på noe serveren aldri spurte om', () => {
    expect(readJsonRpcMessage({ jsonrpc: '2.0', id: 1, result: {} })).toEqual({
      kind: 'response',
      id: 1,
    })
  })

  it('avviser batcher, som ikke lenger finnes i protokollen', () => {
    const message = readJsonRpcMessage([{ jsonrpc: '2.0', id: 1, method: 'ping' }])
    expect(message).toMatchObject({ kind: 'invalid', code: JSON_RPC_ERROR.INVALID_REQUEST })
    expect(message.kind === 'invalid' && message.message).toMatch(/batch/i)
  })

  it.each([
    ['ikke et objekt', 'ping'],
    ['null', null],
    ['et tall', 42],
  ])('avviser en melding som er %s', (_name, value) => {
    expect(readJsonRpcMessage(value)).toMatchObject({
      kind: 'invalid',
      code: JSON_RPC_ERROR.INVALID_REQUEST,
    })
  })

  it('krever riktig jsonrpc-versjon, og beholder id-en så svaret kan kobles', () => {
    expect(readJsonRpcMessage({ jsonrpc: '1.0', id: 3, method: 'ping' })).toMatchObject({
      kind: 'invalid',
      code: JSON_RPC_ERROR.INVALID_REQUEST,
      id: 3,
    })
  })

  it('avviser en melding uten method som verken er et svar', () => {
    expect(readJsonRpcMessage({ jsonrpc: '2.0', id: 3 })).toMatchObject({
      kind: 'invalid',
      code: JSON_RPC_ERROR.INVALID_REQUEST,
    })
  })

  it('avviser posisjonelle parametre – MCP navngir alltid', () => {
    expect(readJsonRpcMessage({ jsonrpc: '2.0', id: 3, method: 'ping', params: [1, 2] })).toMatchObject(
      { kind: 'invalid', code: JSON_RPC_ERROR.INVALID_PARAMS, id: 3 },
    )
  })

  it('lar params være utelatt, som det tomme objektet', () => {
    expect(readJsonRpcMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).toMatchObject({
      params: {},
    })
  })
})

describe('svarene', () => {
  it('bygger et resultat med versjon og id', () => {
    expect(jsonRpcResult(1, { ok: true })).toEqual({
      jsonrpc: JSONRPC_VERSION,
      id: 1,
      result: { ok: true },
    })
  })

  it('utelater data når det ikke er noe', () => {
    expect(jsonRpcError(null, JSON_RPC_ERROR.PARSE_ERROR, 'nei')).toEqual({
      jsonrpc: JSONRPC_VERSION,
      id: null,
      error: { code: JSON_RPC_ERROR.PARSE_ERROR, message: 'nei' },
    })
  })
})
