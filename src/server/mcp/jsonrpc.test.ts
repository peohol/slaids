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

  it('avviser id: null, i stedet for å behandle den som en notifikasjon', () => {
    // MCP forbids `null` as a request id. Reading it as "ingen id" ville
    // kvittert med 202 og latt en klient som venter på svar vente for alltid.
    expect(readJsonRpcMessage({ jsonrpc: '2.0', id: null, method: 'ping' })).toMatchObject({
      kind: 'invalid',
      code: JSON_RPC_ERROR.INVALID_REQUEST,
      id: null,
    })
  })

  it.each([
    ['boolsk', true],
    ['objekt', { a: 1 }],
    ['liste', [1]],
  ])('avviser en id som er %s', (_name, id) => {
    expect(readJsonRpcMessage({ jsonrpc: '2.0', id, method: 'ping' })).toMatchObject({
      kind: 'invalid',
      code: JSON_RPC_ERROR.INVALID_REQUEST,
    })
  })

  it('lar et svar bære id: null, som er det et svar på en uleselig melding gjør', () => {
    // Checked before the id is judged: `{"id":null,"error":{…}}` is a valid
    // JSON-RPC *response*, and refusing it would be refusing the protocol.
    expect(readJsonRpcMessage({ jsonrpc: '2.0', id: null, error: { code: -32700 } })).toEqual({
      kind: 'response',
      id: null,
    })
  })

  it('godtar den tomme strengen som id, som JSON-RPC gjør', () => {
    // A client that numbers its requests from `''` is conforming. Folding that
    // into "ingen id" would gjøre kallene dens til notifikasjoner: kvittert med
    // 202, aldri kjørt.
    expect(readJsonRpcMessage({ jsonrpc: '2.0', id: '', method: 'ping' })).toEqual({
      kind: 'request',
      id: '',
      method: 'ping',
      params: {},
    })
  })

  it('godtar id 0, som er like mye en id som 1', () => {
    expect(readJsonRpcMessage({ jsonrpc: '2.0', id: 0, method: 'ping' })).toMatchObject({
      kind: 'request',
      id: 0,
    })
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
