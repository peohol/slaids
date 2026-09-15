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
  CARD_FRAMING_RULE,
  COLOR_SEMANTICS_RULE,
  CONTENT_KIND_RULE,
  DESIGN_DOCS_PATH,
  IMAGE_BRIEF_RULE,
  IMAGE_NOTE_POLICY,
  IMAGE_POLICY_SUMMARY,
  IMAGE_ROLES,
  IMAGE_USAGE_RULE,
  IMPLICIT_CONTAINER_RULE,
  NAMED_UNITS,
  NEGATIVE_SPACE_RULE,
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
  VISUAL_SUBJECTS,
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
  CARD_FRAMING_RULE,
  AUDIENCE_CONTENT_RULE,
  BULLET_RULE,
  QUOTE_RULE,
  TEXT_RHYTHM_RULE,
  PARALLEL_RULE,
  COLOR_SEMANTICS_RULE,
  REPEATED_FALLBACK_RULE,
  CONTENT_KIND_RULE,
  NEGATIVE_SPACE_RULE,
  IMPLICIT_CONTAINER_RULE,
  SPLIT_RULE,
  IMAGE_USAGE_RULE,
  IMAGE_POLICY_SUMMARY,
  IMAGE_BRIEF_RULE,
  ...IMAGE_NOTE_POLICY,
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

  it('stiller bildespørsmålet per slide, og navngir bildene som er verdt å lete etter', () => {
    expect(MCP_INSTRUCTIONS).toContain(IMAGE_USAGE_RULE)
    expect(IMAGE_USAGE_RULE).toMatch(/på hver enkelt slide/i)
    // Named candidates, for the same reason the semantic units are named: an
    // open question about «relevant visual content» is cheapest to answer no.
    for (const subject of VISUAL_SUBJECTS) expect(MCP_INSTRUCTIONS).toContain(subject)
    for (const role of IMAGE_ROLES) expect(MCP_INSTRUCTIONS).toContain(role)
    expect(IMAGE_USAGE_RULE).toMatch(/skal du ikke droppe relevante bilder/i)
    expect(IMAGE_USAGE_RULE).toMatch(/bildenotat/i)
  })

  it('sier at et visuelt konkret dekk uten et eneste planlagt bilde normalt er feil', () => {
    // The deck-level consequence, stated rather than implied: a per-slide
    // «consider it» can be answered no every time without anything noticing.
    expect(IMAGE_USAGE_RULE).toMatch(/uten et eneste planlagt bilde/i)
    expect(IMAGE_USAGE_RULE).toMatch(/feil/i)
  })

  it('holder detaljreglene ute av systeminstruksen, der de hører til på et verktøy', () => {
    // The instruction is what an agent is given unasked, so it carries what
    // changes the first call and nothing an agent could read off the catalogue.
    for (const detail of [
      CONTENT_KIND_RULE,
      NEGATIVE_SPACE_RULE,
      IMPLICIT_CONTAINER_RULE,
      SPLIT_RULE,
      IMAGE_BRIEF_RULE,
      ...IMAGE_NOTE_POLICY,
      ...VECTOR_POLICY,
      ...RASTER_POLICY,
    ]) {
      expect(MCP_INSTRUCTIONS).not.toContain(detail)
      expect(toolProse()).toContain(detail)
    }
  })
})

describe('navngitte, parallelle enheter får en ramme', () => {
  it('gjør innramming til hovedregelen, før agenten har skrevet en linje tekst', () => {
    // Before the first call, not on a tool: the choice between a framed card
    // and a transparent container is made during decomposition, and an agent
    // that has not made it by then has already made it by default.
    expect(MCP_INSTRUCTIONS).toContain(CARD_FRAMING_RULE)
    expect(CARD_FRAMING_RULE).toMatch(/titled-card/)
    expect(CARD_FRAMING_RULE).toMatch(/normalt/i)
    for (const unit of NAMED_UNITS) expect(MCP_INSTRUCTIONS).toContain(unit)
  })

  it('er rollebasert, så den ikke kolliderer med bildereglene på de samme dekkene', () => {
    // Three named species are both named peers and a subject where pictures
    // belong, so a framing rule stated only about text would contradict the
    // picture rules on exactly the decks it exists for — and an agent reading a
    // contradiction reaches for the kind that needs no decision.
    expect(CARD_FRAMING_RULE).toMatch(/titled-image-card/)
    expect(CARD_FRAMING_RULE).toMatch(/når enheten bæres av tekst/i)
    expect(CARD_FRAMING_RULE).toMatch(/når det er bildet som bærer den/i)
    // Both unframed kinds answer the same question, so both are bounded here.
    expect(CARD_FRAMING_RULE).toMatch(/`container` og et bart `image`/)

    // And the kind the rule names has to be one the agent can actually ask for.
    const card = mcpTools().find((tool) => tool.name.endsWith('set_zone_card'))
    const kind = (
      (card?.inputSchema.properties ?? {}) as Record<string, { enum?: string[] }>
    ).kind
    expect(kind?.enum).toContain('titled-image-card')
  })

  it('svarer på en avvist korttittel med en kortere tittel, ikke med en container', () => {
    // A card title is one line and does not wrap, so a long name is refused at
    // the width several peers get. Without this, the refusal reads like «a card
    // does not work here» — and the container that accepts anything is one call
    // away. See `agent/design.test.ts`, which pins the refusal itself.
    expect(CARD_FRAMING_RULE).toMatch(/én linje/i)
    expect(CARD_FRAMING_RULE).toMatch(/kort ned tittelen/i)
    expect(CARD_FRAMING_RULE).toMatch(/aldri en grunn til å droppe rammen/i)
  })

  it('avgrenser de rammeløse typene til det de faktisk er for', () => {
    // Still legal — the rule is about what the unframed kinds are *for*, not a
    // ban. Both of them, now that a named peer can be a picture.
    expect(CARD_FRAMING_RULE).toMatch(/én samlet idé eller ett bilde som står alene/i)
    expect(CARD_FRAMING_RULE).toMatch(/ikke der den er ett navngitt medlem blant flere/i)
    expect(CARD_FRAMING_RULE).toMatch(/verken standardvalget/i)
    expect(SINGLE_CONTAINER_RULE).toMatch(/én samlet idé/i)
  })

  it('sier på verktøyet som skriver tekst at beholderen er et uvalgt utgangspunkt', () => {
    // The mechanism behind the flat deck: writing text into an empty zone has
    // to put it somewhere, and that somewhere is a transparent container. An
    // agent that only ever writes text never opens the contract that picks a
    // content kind, so the warning has to ride on the call it actually makes.
    expect(toolProse()).toContain(IMPLICIT_CONTAINER_RULE)
    expect(IMPLICIT_CONTAINER_RULE).toMatch(/ikke et designvalg/i)
    expect(IMPLICIT_CONTAINER_RULE).toMatch(/sett innholdstypen først/i)
  })
})

describe('negativt rom', () => {
  it('brukes primært til å trimme synlige kort i høyden, ikke til å skvise peers sideveis', () => {
    expect(NEGATIVE_SPACE_RULE).toMatch(/over og\/eller under et synlig kort/i)
    expect(NEGATIVE_SPACE_RULE).toMatch(/Ikke legg negativt rom mellom parallelle kort/i)
    expect(NEGATIVE_SPACE_RULE).toMatch(/horisontal luft.*smalere/i)
    expect(NEGATIVE_SPACE_RULE).toMatch(/ikke transparente containere/i)
  })

  it('må ha en kompositorisk gevinst for å bli stående', () => {
    expect(NEGATIVE_SPACE_RULE).toMatch(/forbedrer komposisjonen/i)
    expect(NEGATIVE_SPACE_RULE).toMatch(/Hvis å fjerne det negative rommet.*skal det bort/i)
  })

  it('står på verktøyet som setter innholdstypen, sammen med den regelen', () => {
    expect(toolProse()).toContain(NEGATIVE_SPACE_RULE)
    expect(toolProse()).toContain(CONTENT_KIND_RULE)
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
    // The trigger, on the surface an agent actually reads. It lived only in the
    // guide, which meant the rule that decides *whether* to write a brief was
    // reachable only from the contract of the call that writes one.
    expect(IMAGE_USAGE_RULE).toMatch(/minst ett generert rasterbilde/i)
    expect(IMAGE_USAGE_RULE).toMatch(/også om det bare er ett/i)
    expect(agentSurface()).not.toMatch(/dersom flere rasterbilder skal genereres/i)

    const guide = readFileSync(join(process.cwd(), DESIGN_DOCS_PATH), 'utf8')
    expect(guide).toMatch(/minst ett generert rasterbilde planlegges/i)
    expect(guide).not.toMatch(/dersom flere rasterbilder skal genereres/i)
  })

  it('gir agenten hele planen for et bilde den ikke kan lage selv', () => {
    // Reserve the zone, write the prompt into it, and give the deck one shared
    // brief. Every step has to be reachable, or «plan the picture instead of
    // dropping it» is advice with no procedure behind it.
    const surface = agentSurface()
    for (const rule of IMAGE_NOTE_POLICY) expect(surface).toContain(rule)
    expect(surface).toContain(IMAGE_BRIEF_RULE)
    expect(IMAGE_NOTE_POLICY.join(' ')).toMatch(/image-prompt/)
    expect(IMAGE_NOTE_POLICY.join(' ')).toMatch(/reservedImageKinds/)
  })

  it('sier at reservasjonen måles mot bildetypen som faktisk er planlagt', () => {
    // A `titled-image-card` carries a header above the picture and needs more
    // room than a bare `image`, so «the reservation holds» is not one answer.
    const policy = IMAGE_NOTE_POLICY.join(' ')
    expect(policy).toMatch(/titled-image-card/)
    expect(policy).toMatch(/trenger mer plass enn et bart `image`/i)
    expect(policy).toMatch(/tom liste/i)
  })
})

describe('regelen mot å falle tilbake til container + overskrift + tekst', () => {
  it('sier aldri, noe sted, at mønsteret er standardvalget', () => {
    // The wording that must never come back is «this is what you do by
    // default». Stated as a property rather than as a forbidden phrase: any
    // sentence that puts the pattern together with default-vocabulary has to
    // be denying it, not prescribing it.
    const sentences = agentSurface()
      .split(/(?<=[.:])\s+|\n/)
      .filter((sentence) => /punktliste|container/i.test(sentence))
    expect(sentences.length).toBeGreaterThan(0)
    for (const sentence of sentences) {
      if (!/standard\w*|fallback|utgangspunkt|som regel/i.test(sentence)) continue
      expect(sentence, `«${sentence}» fremstiller mønsteret som standardvalg`).toMatch(
        /\b(ikke|aldri|verken)\b/i,
      )
    }
  })

  it('navngir mønsteret, tekstvarianten så vel som punktlistevarianten', () => {
    // The observed deck was not bullet lists. It was a heading and a paragraph
    // in a transparent container, slide after slide — the same fallback with
    // the list taken out, which a rule naming only «container + punktliste»
    // does not catch.
    expect(REPEATED_FALLBACK_RULE).toMatch(/gjennomsiktig container/i)
    expect(REPEATED_FALLBACK_RULE).toMatch(/overskrift/i)
    expect(REPEATED_FALLBACK_RULE).toMatch(/tekst eller punktliste/i)
    expect(MCP_INSTRUCTIONS).toContain(REPEATED_FALLBACK_RULE)
  })

  it('svarer med hva agenten skal gjøre i stedet, ikke bare hva den ikke skal', () => {
    // A prohibition an agent cannot act on is a prohibition it ignores: the
    // self-check has to point back at decomposition and framing.
    expect(REPEATED_FALLBACK_RULE).toMatch(/dekomponer/i)
    expect(REPEATED_FALLBACK_RULE).toMatch(/ramme/i)
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
    for (const unit of NAMED_UNITS) expect(listed).toContain(unit)
  })

  it('lar guiden og agentflaten lete etter de samme bildene', () => {
    // Same claim, for the picture roles: a guide that named other pictures
    // than the agent surface does would be a second contract, and the reader
    // and the agent would be designing different decks.
    const guide = readFileSync(join(process.cwd(), DESIGN_DOCS_PATH), 'utf8')
    for (const role of IMAGE_ROLES) expect(guide).toContain(role)
    for (const subject of VISUAL_SUBJECTS) expect(guide).toContain(subject)
  })
})
