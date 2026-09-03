// @vitest-environment node
/**
 * One contract, published twice.
 *
 * §44 asks for MCP to be an adapter over Agent Core rather than a second
 * implementation, and the way that promise usually breaks is quiet: someone
 * writes the tool list out by hand to add a description, an operation is added
 * six months later, and the MCP surface is silently one tool short of the REST
 * one. So this file checks the property directly rather than checking a sample
 * of it:
 *
 *  - every tool is an operation, every operation is a tool, in the same order;
 *  - every schema is the *same object* the REST catalogue publishes;
 *  - and no operation name appears as a literal anywhere in this directory, so
 *    there is nowhere for a second list to be hiding.
 *
 * The last one is the load-bearing one. The first two would still pass if the
 * catalogue were hand-written and happened to be right today.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENT_TOOL_PREFIX, describeOperations, operations } from '../../agent/registry'
import { AGENT_SCOPES } from '../../agent/types'
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO } from './instructions'
import {
  MCP_PROTOCOL_VERSION,
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  mcpTools,
  negotiateProtocolVersion,
  operationNameForTool,
} from './tools'

const MCP_DIR = join(process.cwd(), 'src', 'server', 'mcp')

/** The files this directory actually ships. Tests and their helpers are not it. */
function shippedSources(): string[] {
  return readdirSync(MCP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name) === '.ts')
    .filter((entry) => !/(^test|\.test\.)/i.test(basename(entry.name)))
    .map((entry) => join(MCP_DIR, entry.name))
}

describe('verktøykatalogen er operasjonskatalogen', () => {
  it('har nøyaktig én tool per operasjon, i samme rekkefølge', () => {
    expect(mcpTools().map((tool) => tool.name)).toEqual(
      operations.map((operation) => `${AGENT_TOOL_PREFIX}${operation.name}`),
    )
  })

  it('publiserer nøyaktig de samme skjemaene som REST-katalogen', () => {
    const catalogue = describeOperations()
    for (const [index, tool] of mcpTools().entries()) {
      expect(tool.inputSchema).toEqual(catalogue[index].inputSchema)
    }
  })

  it('har et objektskjema for hvert verktøy, som MCP krever', () => {
    for (const tool of mcpTools()) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.properties ?? {}).toBeTypeOf('object')
    }
  })

  it('sier hvilke scopes som kreves, fra operasjonens eget felt', () => {
    for (const [index, tool] of mcpTools().entries()) {
      const required = [...operations[index].scopes]
      expect(tool._meta['slaids/requiredScopes']).toEqual(required)
      expect(tool._meta['slaids/operation']).toBe(operations[index].name)
      // And in the prose too, since that is the half a model actually reads.
      for (const scope of required) expect(tool.description).toContain(scope)
      expect(required.every((scope) => AGENT_SCOPES.includes(scope))).toBe(true)
    }
  })

  it('starter hver beskrivelse med operasjonens eget sammendrag', () => {
    for (const [index, tool] of mcpTools().entries()) {
      expect(tool.description.startsWith(operations[index].summary)).toBe(true)
    }
  })

  it('utleder annotasjonene, i stedet for å erklære dem på nytt', () => {
    for (const [index, tool] of mcpTools().entries()) {
      expect(tool.annotations.readOnlyHint).toBe(!operations[index].mutates)
      // Slaids acts on the owner's own decks and nothing else on the internet.
      expect(tool.annotations.openWorldHint).toBe(false)
    }
  })

  it('eksponerer de to dørene bilder kommer inn gjennom, og ingen bildegenerering', () => {
    const names = mcpTools().map((tool) => tool.name)
    expect(names).toContain(`${AGENT_TOOL_PREFIX}upload_asset`)
    expect(names).toContain(`${AGENT_TOOL_PREFIX}create_svg_asset`)
    expect(names.some((name) => /generate.*image|image.*generate/.test(name))).toBe(false)
  })
})

describe('ingen håndholdt liste over operasjoner i MCP-laget', () => {
  it('nevner ikke et eneste operasjonsnavn som streng', () => {
    const names = operations.map((operation) => operation.name)
    const offenders = shippedSources().flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return names
        .filter((name) => source.includes(name))
        .map((name) => `${relative(process.cwd(), file)}: ${name}`)
    })

    expect(offenders).toEqual([])
  })

  it('leter i filer som faktisk finnes, så testen over ikke er tom', () => {
    expect(shippedSources().length).toBeGreaterThan(3)
  })

  it('har heller ingen liste over scopes å bli uenig med registeret om', () => {
    const offenders = shippedSources().flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return AGENT_SCOPES.filter((scope) => source.includes(`'${scope}'`)).map(
        (scope) => `${relative(process.cwd(), file)}: ${scope}`,
      )
    })

    expect(offenders).toEqual([])
  })
})

describe('navnerommet', () => {
  it('er et prefiks, ikke en del av navnet', () => {
    expect(operationNameForTool(`${AGENT_TOOL_PREFIX}split_zone`)).toBe('split_zone')
    // An agent that read the REST catalogue is not wrong about which operation
    // it means, so the bare name resolves too.
    expect(operationNameForTool('split_zone')).toBe('split_zone')
  })

  it('lar et ukjent navn være ukjent, i stedet for å gjette', () => {
    expect(operationNameForTool(`${AGENT_TOOL_PREFIX}finnes_ikke`)).toBe('finnes_ikke')
  })
})

describe('protokollversjonen', () => {
  it('svarer med den klienten ba om når vi kan den', () => {
    for (const version of SUPPORTED_MCP_PROTOCOL_VERSIONS) {
      expect(negotiateProtocolVersion(version)).toBe(version)
    }
  })

  it('svarer med den nyeste vi har når klienten ber om noe annet', () => {
    expect(negotiateProtocolVersion('1999-01-01')).toBe(MCP_PROTOCOL_VERSION)
    expect(negotiateProtocolVersion(undefined)).toBe(MCP_PROTOCOL_VERSION)
    expect(negotiateProtocolVersion(42)).toBe(MCP_PROTOCOL_VERSION)
  })

  it('foretrekker den nyeste', () => {
    expect(SUPPORTED_MCP_PROTOCOL_VERSIONS[0]).toBe(MCP_PROTOCOL_VERSION)
  })
})

describe('instruksjonene klienten får ved initialize', () => {
  it('sier at Slaids aldri lager bilder', () => {
    expect(MCP_INSTRUCTIONS).toMatch(/lager ikke bilder/i)
    expect(MCP_INSTRUCTIONS).not.toMatch(/generer\w* bilde/i)
  })

  it('sier hva en agent må gjøre med de to feilene den faktisk vil møte', () => {
    expect(MCP_INSTRUCTIONS).toContain('CONTENT_DOES_NOT_FIT')
    expect(MCP_INSTRUCTIONS).toContain('CONFLICT')
  })

  it('navngir seg selv likt REST-indeksen', () => {
    expect(MCP_SERVER_INFO.name).toBe('slaids-agent')
  })
})
