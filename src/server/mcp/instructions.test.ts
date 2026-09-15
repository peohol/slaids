// @vitest-environment node
/**
 * The design contract, as an agent actually receives it.
 *
 * `tools.test.ts` checks that the catalogue *is* the registry. This file checks
 * the other half of the agent surface: the prose. An agent composing a deck
 * reads exactly two things before it decides anything — the instructions the
 * server hands back from `initialize`, and the tool descriptions in
 * `tools/list` — so a rule that exists only in `docs/` is a rule that did not
 * reach it. That is not hypothetical: a test deck came back as slide after
 * slide of one container with a heading and a bullet list, every one of them
 * valid, while the guide in `docs/` said not to.
 *
 * Three claims, and they are why the rules live in `agent/design.ts`:
 *
 *  - the rules that must work *before the first call* are in the instructions;
 *  - the rules that only matter once a particular call is being written are on
 *    that call's contract, and reachable from the catalogue;
 *  - and each normative sentence appears exactly once across the two, so there
 *    is no second copy to drift out of step with the first.
 *
 * The last one is the load-bearing one, and it is why these assert on the
 * constants rather than on wording: a rule that is reworded stays tested, and
 * a rule that is quietly restated somewhere else fails here.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUDIENCE_CONTENT_RULE,
  BULLET_RULE,
  COLOR_SEMANTICS_RULE,
  CONTENT_KIND_RULE,
  DESIGN_DOCS_PATH,
  IMAGE_POLICY_SUMMARY,
  IMAGE_USAGE_RULE,
  PARALLEL_RULE,
  QUOTE_RULE,
  RASTER_POLICY,
  REPEATED_FALLBACK_RULE,
  SEMANTIC_DECOMPOSITION,
  SEMANTIC_UNITS,
  SIMPLEST_TREE,
  SINGLE_CONTAINER_RULE,
  SPLIT_RULE,
  TEXT_RHYTHM_RULE,
  VECTOR_POLICY,
} from '../../agent/design'
import { MCP_INSTRUCTIONS } from './instructions'
import { mcpTools } from './tools'

/** What an agent reads off the catalogue, as one body of text. */
const toolProse = (): string => mcpTools().map((tool) => tool.description).join('\n')

/** Everything prose that reaches an agent, from both halves of the surface. */
const agentSurface = (): string => `${MCP_INSTRUCTIONS}\n${toolProse()}`

/** Every normative sentence, wherever it is meant to live. */
const NORMATIVE = [
  SEMANTIC_DECOMPOSITION,
  SIMPLEST_TREE,
  SINGLE_CONTAINER_RULE,
  AUDIENCE_CONTENT_RULE,
  BULLET_RULE,
  QUOTE_RULE,
  TEXT_RHYTHM_RULE,
  PARALLEL_RULE,
  COLOR_SEMANTICS_RULE,
  REPEATED_FALLBACK_RULE,
  CONTENT_KIND_RULE,
  SPLIT_RULE,
  IMAGE_USAGE_RULE,
  IMAGE_POLICY_SUMMARY,
  ...VECTOR_POLICY,
  ...RASTER_POLICY,
]

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('det agenten vet før første kall', () => {
  it('krever semantisk dekomponering, og navngir hva den skal lete etter', () => {
    expect(MCP_INSTRUCTIONS).toContain(SEMANTIC_DECOMPOSITION)
    // Every unit by name: «find the structure» without saying which structures
    // is the advice that produced the flat deck in the first place.
    for (const unit of SEMANTIC_UNITS) expect(MCP_INSTRUCTIONS).toContain(unit)
  })

  it('holder publikumsinnholdet på temaet i stedet for å kommentere designarbeidet', () => {
    expect(MCP_INSTRUCTIONS).toContain(AUDIENCE_CONTENT_RULE)
    expect(AUDIENCE_CONTENT_RULE).toMatch(/Alt publikum ser/i)
    expect(AUDIENCE_CONTENT_RULE).toMatch(/Slaids|layoutvalg|designprosessen/i)
    expect(AUDIENCE_CONTENT_RULE).toMatch(/med mindre brukeren uttrykkelig/i)
  })

  it('skiller punktlisten som underordnede utsagn fra flere parallelle konsepter', () => {
    expect(BULLET_RULE).toMatch(/underordnede utsagn/i)
    expect(BULLET_RULE).toMatch(/navngivbare konsepter|kategorier|faser|sammenligningsenheter/i)
    expect(MCP_INSTRUCTIONS).toContain(BULLET_RULE)
    expect(MCP_INSTRUCTIONS).toContain(SINGLE_CONTAINER_RULE)
  })

  it('holder sitater til ekte ordlyd og bruker avsnitt når høyden tillater det', () => {
    expect(MCP_INSTRUCTIONS).toContain(QUOTE_RULE)
    expect(MCP_INSTRUCTIONS).toContain(TEXT_RHYTHM_RULE)
    expect(QUOTE_RULE).toMatch(/faktisk, etterprøvbar formulering/i)
    expect(QUOTE_RULE).toMatch(/ikke gjør egne oppsummeringer, parafraser eller slagord/i)
    expect(TEXT_RHYTHM_RULE).toMatch(/separate avsnitt|linjeskift/i)
    expect(TEXT_RHYTHM_RULE).toMatch(/god plass i høyden/i)
  })

  it('ber om det enkleste treet som gjør relasjonene visuelt eksplisitte', () => {
    // Both halves of the sentence matter. «Simplest» alone was read as «fewest
    // zones», which is one big container every time.
    expect(SIMPLEST_TREE).toMatch(/enkleste/i)
    expect(SIMPLEST_TREE).toMatch(/eksplisitt/i)
    expect(MCP_INSTRUCTIONS).toContain(SIMPLEST_TREE)
  })

  it('ber agenten se etter mønsteret i sitt eget dekk', () => {
    expect(MCP_INSTRUCTIONS).toContain(REPEATED_FALLBACK_RULE)
    // A quality rule, not a demand for variety for its own sake.
    expect(REPEATED_FALLBACK_RULE).toMatch(/ikke et krav om kunstig layoutvariasjon/i)
  })

  it('krever parallell behandling av parallelle konsepter', () => {
    expect(MCP_INSTRUCTIONS).toContain(PARALLEL_RULE)
  })

  it('bruker farge for grouping eller kontrast, ikke som tilfeldig pynt', () => {
    expect(MCP_INSTRUCTIONS).toContain(COLOR_SEMANTICS_RULE)
    expect(COLOR_SEMANTICS_RULE).toMatch(/Samme farge kan samle/i)
    expect(COLOR_SEMANTICS_RULE).toMatch(/ulike, harmoniske headerfarger/i)
    expect(COLOR_SEMANTICS_RULE).toMatch(/ikke for tilfeldig dekorasjon/i)
  })

  it('krever aktiv vurdering av relevante bilder før agenten kan hoppe over dem', () => {
    expect(MCP_INSTRUCTIONS).toContain(IMAGE_USAGE_RULE)
    expect(IMAGE_USAGE_RULE).toMatch(/Vurder aktivt på hver slide/i)
    expect(IMAGE_USAGE_RULE).toMatch(/anatomi|historiske miljøer/i)
    expect(IMAGE_USAGE_RULE).toMatch(/skal du ikke droppe relevante bilder/i)
    expect(IMAGE_USAGE_RULE).toMatch(/bildenotater/i)
  })

  it('holder detaljreglene ute av systeminstruksen, der de hører til på et verktøy', () => {
    // The instruction is what an agent is given unasked, so it carries what
    // changes the first call and nothing an agent could read off the catalogue.
    for (const detail of [CONTENT_KIND_RULE, SPLIT_RULE, ...VECTOR_POLICY, ...RASTER_POLICY]) {
      expect(MCP_INSTRUCTIONS).not.toContain(detail)
      expect(toolProse()).toContain(detail)
    }
  })
})

describe('negativt rom', () => {
  it('brukes primært til å trimme synlige kort i høyden, ikke til å skvise peers sideveis', () => {
    expect(CONTENT_KIND_RULE).toMatch(/over og\/eller under et synlig kort/i)
    expect(CONTENT_KIND_RULE).toMatch(/Ikke legg negativt rom mellom parallelle kort/i)
    expect(CONTENT_KIND_RULE).toMatch(/horisontal luft.*smalere/i)
    expect(CONTENT_KIND_RULE).toMatch(/ikke transparente containere/i)
  })

  it('må ha en kompositorisk gevinst for å bli stående', () => {
    expect(CONTENT_KIND_RULE).toMatch(/forbedrer komposisjonen/i)
    expect(CONTENT_KIND_RULE).toMatch(/Hvis å fjerne det negative rommet.*skal det bort/i)
  })
})

describe('raster og vektor', () => {
  it('er en policy agenten faktisk får, ikke bare noe som står i docs', () => {
    const surface = agentSurface()
    expect(surface).toContain(IMAGE_POLICY_SUMMARY)
    for (const rule of [...VECTOR_POLICY, ...RASTER_POLICY]) expect(surface).toContain(rule)
  })

  it('sier at vektor forblir vektor og at fotografiske motiver er raster', () => {
    const surface = agentSurface()
    expect(surface).toMatch(/SVG skal beholdes som SVG/i)
    expect(surface).toMatch(/[Ii]kke rasteriser/)
    expect(surface).toMatch(/[Ff]otografiske/)
    expect(surface).toMatch(/bildegenerator/)
  })

  it('ber agenten si fra når den mangler en bildegenerator, i stedet for å improvisere', () => {
    expect(RASTER_POLICY.join(' ')).toMatch(/si tydelig fra om begrensningen/i)
  })

  it('sier at denne serveren ikke lager bilder, uten å love at det aldri skjer', () => {
    expect(MCP_INSTRUCTIONS).toMatch(/lager ikke bilder/i)
    expect(agentSurface()).not.toMatch(/kommer ikke til å|aldri kommer til/i)
  })

  it('krever bildebrief også når bare ett generert rasterbilde er planlagt', () => {
    const guide = readFileSync(join(process.cwd(), DESIGN_DOCS_PATH), 'utf8')
    expect(guide).toMatch(/minst ett generert rasterbilde planlegges/i)
    expect(guide).not.toMatch(/dersom flere rasterbilder skal genereres/i)
  })
})

describe('regelen mot å falle tilbake til container + punktliste', () => {
  it('sier aldri, noe sted, at mønsteret er standardvalget', () => {
    // The wording that must never come back is «this is what you do by
    // default». Stated as a property rather than as a forbidden phrase: any
    // sentence that puts the pattern together with default-vocabulary has to
    // be denying it, not prescribing it.
    const sentences = agentSurface()
      .split(/(?<=[.:])\s+|\n/)
      .filter((sentence) => /punktliste|stor (tekst)?container/i.test(sentence))
    expect(sentences.length).toBeGreaterThan(0)
    for (const sentence of sentences) {
      if (!/standard\w*|fallback|utgangspunkt|som regel/i.test(sentence)) continue
      expect(sentence, `«${sentence}» fremstiller mønsteret som standardvalg`).toMatch(/\bikke\b/i)
    }
  })

  it('sier at én container er et lovlig valg, så regelen ikke blir et forbud', () => {
    expect(SINGLE_CONTAINER_RULE).toMatch(/legitimt valg/i)
  })
})

describe('én regel, ett sted', () => {
  it('sier hver normative setning nøyaktig én gang på hele agentflaten', () => {
    const surface = agentSurface()
    const repeated = NORMATIVE.filter((rule) => occurrences(surface, rule) !== 1).map(
      (rule) => `${occurrences(surface, rule)}×: ${rule.slice(0, 60)}…`,
    )
    expect(repeated).toEqual([])
  })

  it('henter dem fra én modul, som designguiden forklarer og ikke erstatter', () => {
    const guide = readFileSync(join(process.cwd(), DESIGN_DOCS_PATH), 'utf8')
    // The doc is the long form for a reader. What it must not do is list a
    // different set of semantic units than the one an agent is handed.
    const listed = [...guide.matchAll(/^- \*\*([^*]+)\*\*[;.]$/gm)].map(([, unit]) => unit)
    for (const unit of SEMANTIC_UNITS) expect(listed).toContain(unit)
  })
})
