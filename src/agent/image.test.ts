/**
 * Where the picture goes when the answer has to be JSON.
 *
 * `detachImage` is small, and it is load-bearing: it is the one place either
 * transport learns that an answer carries a picture, which is what makes "REST
 * and MCP say the same thing" a property of the code rather than of two
 * adapters. So what is checked is the contract both of them rely on — an answer
 * with no picture comes back untouched, an answer with one comes back
 * JSON-safe and described, and the field it came from is reported so it can be
 * put back.
 */

import { describe, expect, it } from 'vitest'
import {
  agentImage,
  attachEncodedImage,
  describeAgentImage,
  detachImage,
  isAgentImage,
} from './image'

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const image = agentImage({ mimeType: 'image/png', bytes: BYTES, width: 1600, height: 900 })

describe('en vanlig svarverdi', () => {
  it.each([
    ['et objekt uten bilde', { presentationId: 'p_1', revision: 'r1' }],
    ['en tom liste', []],
    ['null', null],
    ['et tall', 7],
  ])('kommer urørt tilbake for %s', (_case, value) => {
    // Unconditional in `performOperation`, so there is no list of which
    // operations produce a picture to keep in step.
    expect(detachImage(value)).toEqual({ json: value, image: null, field: null })
  })
})

describe('et svar med et bilde i', () => {
  const answer = { presentationId: 'p_1', revision: 'r1', image, warnings: [] }

  it('erstatter bildet med en beskrivelse av det, og sier hvor det lå', () => {
    const detached = detachImage(answer)

    expect(detached.field).toBe('image')
    expect(detached.image).toBe(image)
    expect(detached.json).toEqual({
      presentationId: 'p_1',
      revision: 'r1',
      warnings: [],
      image: { mimeType: 'image/png', width: 1600, height: 900, byteLength: BYTES.byteLength },
    })
  })

  it('etterlater noe JSON faktisk kan bære', () => {
    // The failure this prevents: `JSON.stringify` of a `Uint8Array` is an
    // object keyed by index, which is neither an image nor a usable number.
    const detached = detachImage(answer)
    expect(JSON.stringify(detached.json)).not.toContain('"0":137')
    expect(JSON.parse(JSON.stringify(detached.json))).toEqual(detached.json)
  })

  it('kan settes tilbake som base64 for den som ba om én kropp', () => {
    const detached = detachImage(answer)
    const reattached = attachEncodedImage(detached.json, 'image', image) as {
      image: { base64: string; byteLength: number; mimeType: string }
    }

    // The description survives: the size is what an agent uses to decide
    // whether to ask for a smaller one.
    expect(reattached.image).toMatchObject(describeAgentImage(image))
    expect(new Uint8Array(Buffer.from(reattached.image.base64, 'base64'))).toEqual(BYTES)
  })

  it('gjenkjennes bare som bilde når det faktisk bærer bytes', () => {
    expect(isAgentImage(image)).toBe(true)
    expect(isAgentImage({ kind: 'agent-image', mimeType: 'image/png' })).toBe(false)
    expect(isAgentImage({ mimeType: 'image/png', bytes: BYTES })).toBe(false)
    expect(isAgentImage(null)).toBe(false)
  })

  it('finner ett bilde, ikke flere', () => {
    // A deliberate limit: an answer carrying two would need a transport rule
    // for which one an MCP image block gets, and that rule would be the second
    // contract this file exists to avoid.
    const two = { first: image, second: image }
    const detached = detachImage(two)
    expect(detached.field).toBe('first')
    expect(isAgentImage((detached.json as Record<string, unknown>).second)).toBe(true)
  })
})
