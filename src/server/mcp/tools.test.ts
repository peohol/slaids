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
import { AGENT_TOKEN_PREFIX } from '../../persistence/agentTokens'
import { MCP_INSTRUCTIONS, MCP_SERVER_INFO } from './instructions'
import {
  MCP_PROTOCOL_VERSION,
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  isSupportedProtocolVersion,
  mcpTools,
  negotiateProtocolVersion,
  operationNameForTool,
  resetMcpTools,
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

  it('sier om hvert verktøy at det krever OAuth, med operasjonens egne scopes', () => {
    // Mixed authentication: discovery here is anonymous, so a client has to be
    // able to see from the catalogue alone which calls will need a credential.
    // Every tool needs one — there is no operation without a required scope —
    // and the scopes are the operation's own rather than a second list.
    for (const [index, tool] of mcpTools().entries()) {
      expect(tool.securitySchemes).toEqual([
        { type: 'oauth2', scopes: [...operations[index].scopes] },
      ])
      // Repeated in the metadata bag, because clients disagree about where a
      // tool's security schemes live — and it is the same array either way.
      expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes)
    }
  })

  it('har ingen håndskrevet liste over hvilke verktøy som krever hva', () => {
    // The same argument the operation-name rule below makes, for the scopes: a
    // hand-written list would be discovered to be wrong on the day an operation
    // was added to one list and not the other, and the wrong direction of that
    // mistake is a tool that looks public. So no scope name is a literal in the
    // shipped sources of this directory either — the catalogue can only be
    // reading `operation.scopes`.
    for (const file of shippedSources()) {
      const source = readFileSync(file, 'utf8')
      for (const scope of AGENT_SCOPES) {
        expect(source, `${relative(process.cwd(), file)} nevner «${scope}»`).not.toContain(scope)
      }
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

/* ------------------------------------------------------------------ *
 * What may be published anonymously
 * ------------------------------------------------------------------ */

describe('katalogen er produktmetadata, ikke brukerdata', () => {
  /** Everything a client is handed before it has presented a token. */
  const published = (): string =>
    JSON.stringify({ tools: mcpTools(), instructions: MCP_INSTRUCTIONS, serverInfo: MCP_SERVER_INFO })

  it('bygges uten en kaller, en eier eller et repository', () => {
    // The strongest form of the claim, and the reason the rest of this file can
    // be about content: neither function takes an argument, so neither of them
    // *can* answer differently for two callers. The catalogue is compiled from
    // the operation definitions in the bundle and nothing else.
    expect(describeOperations.length).toBe(0)
    expect(mcpTools.length).toBe(0)
  })

  it('er den samme katalogen hver gang, også etter en kaldstart', () => {
    const warm = mcpTools()
    expect(mcpTools()).toBe(warm)
    resetMcpTools()
    expect(JSON.stringify(mcpTools())).toBe(JSON.stringify(warm))
  })

  it.each([
    // A URL in a description or a schema would either name a deployment or a
    // service Slaids talks to. The JSON Schema dialect is the one exception, and
    // it is the specification's own identifier rather than an address.
    ['en adresse', /https?:\/\/(?!json-schema\.org\/)/],
    ['en e-postadresse', /[\w.%+-]+@[\w-]+\.[a-z]{2,}/i],
    // An id of any kind is by definition somebody's.
    ['en uuid', /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i],
    // Credentials and the names they are configured under.
    ['et agenttoken', new RegExp(AGENT_TOKEN_PREFIX)],
    ['en miljøvariabel', /\bVITE_|SUPABASE_|SERVICE_ROLE|SECRET_KEY|PUBLISHABLE_KEY/i],
    // The database's own shape, which no agent addresses anything by.
    ['et tabellnavn', /slaids_(?:presentations|assets|agent_tokens|agent_audit|folders)\b/],
    ['en eier-id', /\bowner_?[Ii]d\b/],
  ])('nevner ikke %s', (_what, forbidden) => {
    expect(published()).not.toMatch(forbidden)
  })

  it('har ingen default eller eksempel som ikke er domenets eget vokabular', () => {
    // A schema default is published to every caller, so it must not be a value
    // somebody's deck happened to have. Everything Slaids publishes is a literal
    // from a domain union, a number from `src/domain/constants.ts` or an empty
    // value — never a string a caller could recognise as theirs.
    const values = new Set<string>()
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(walk)
      if (!value || typeof value !== 'object') return
      for (const [key, nested] of Object.entries(value)) {
        if (key === 'default' || key === 'const' || key === 'examples' || key === 'example') {
          for (const single of Array.isArray(nested) ? nested : [nested]) {
            if (typeof single === 'string') values.add(single)
          }
        }
        walk(nested)
      }
    }
    walk(mcpTools())

    for (const value of values) {
      // Short, lower-case, no spaces: an enum member or an encoding name, not a
      // title, a filename or an id.
      expect(value).toMatch(/^[a-z0-9-]{0,24}$/)
    }
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
  it('annonserer bare den ene revisjonen serveren faktisk implementerer', () => {
    // Announcing more was a bug, not generosity: `2025-03-26` would promise a
    // peer that this endpoint accepts JSON-RPC batches, which it refuses
    // outright, and `2024-11-05` would promise the older HTTP+SSE transport,
    // with two endpoints neither of which exists here.
    expect([...SUPPORTED_MCP_PROTOCOL_VERSIONS]).toEqual([MCP_PROTOCOL_VERSION])
    expect(MCP_PROTOCOL_VERSION).toBe('2025-06-18')
  })

  it('svarer med den klienten ba om når vi kan den', () => {
    for (const version of SUPPORTED_MCP_PROTOCOL_VERSIONS) {
      expect(negotiateProtocolVersion(version)).toBe(version)
    }
  })

  it.each([
    // Older revisions this server does not implement…
    '2025-03-26',
    '2024-11-05',
    '2024-10-07',
    // …a newer one it has not seen…
    '2099-01-01',
    // …and nonsense.
    '',
  ])('forhandler aldri fram %s', (requested) => {
    expect(negotiateProtocolVersion(requested)).toBe(MCP_PROTOCOL_VERSION)
    expect(isSupportedProtocolVersion(requested)).toBe(false)
  })

  it('svarer med den ene versjonen den har når klienten ikke sier noe brukbart', () => {
    expect(negotiateProtocolVersion(undefined)).toBe(MCP_PROTOCOL_VERSION)
    expect(negotiateProtocolVersion(42)).toBe(MCP_PROTOCOL_VERSION)
    expect(negotiateProtocolVersion(null)).toBe(MCP_PROTOCOL_VERSION)
  })

  it('svarer aldri med noe den ikke ville godtatt i headeren etterpå', () => {
    // The two have to be the same set: a version this server negotiates is a
    // version the client will send back on every later request.
    for (const requested of ['2025-06-18', '2025-03-26', '2024-11-05', '2099-01-01', 'tull']) {
      expect(isSupportedProtocolVersion(negotiateProtocolVersion(requested))).toBe(true)
    }
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
