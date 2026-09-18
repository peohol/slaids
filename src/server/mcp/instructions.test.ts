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
  ACCENT_RULE,
  AUDIENCE_CONTENT_RULE,
  BULLET_RULE,
  CARD_FRAMING_RULE,
  COLOR_SEMANTICS_RULE,
  CONTENT_KIND_RULE,
  DECK_SELF_CHECK,
  DESIGN_DOCS_PATH,
  IMAGE_BRIEF_RULE,
  IMAGE_GENERATION_RULE,
  IMAGE_HANDOFF_RULE,
  IMAGE_JOB_RULE,
  IMAGE_PLACEHOLDER_POLICY,
  IMAGE_PLAN_RULE,
  IMAGE_POLICY_SUMMARY,
  IMAGE_ROLES,
  IMAGE_USAGE_RULE,
  IMPLICIT_CONTAINER_RULE,
  NAMED_UNITS,
  NATIVE_COMPOSITION_RULE,
  NEGATIVE_SPACE_RULE,
  PARALLEL_RULE,
  PRIMARY_TEXT_RULE,
  QUOTE_RULE,
  RASTER_POLICY,
  RASTER_WORKFLOW_RULE,
  REFERENCE_SYSTEM_RULE,
  REPEATED_FALLBACK_RULE,
  SELF_CHECK_STOP,
  SEMANTIC_DECOMPOSITION,
  SEMANTIC_UNITS,
  SIMPLEST_TREE,
  SPLIT_RULE,
  TEXT_RHYTHM_RULE,
  VECTOR_POLICY,
  VISUAL_QA_RULE,
  VISUAL_SUBJECTS,
  ZONE_SELF_CHECK,
} from '../../agent/design'
import { PLANNED_IMAGE_FIELDS } from '../../domain/constants'
import { MCP_INSTRUCTIONS } from './instructions'
import { mcpTools } from './tools'

/** What an agent reads off the catalogue, as one body of text. */
const toolProse = (): string => mcpTools().map((tool) => tool.description).join('\n')

/** Everything prose that reaches an agent, from both halves of the surface. */
const agentSurface = (): string => `${MCP_INSTRUCTIONS}\n${toolProse()}`

/** Every normative sentence, wherever it is meant to live. */
const NORMATIVE = [
  NATIVE_COMPOSITION_RULE,
  SEMANTIC_DECOMPOSITION,
  SIMPLEST_TREE,
  PRIMARY_TEXT_RULE,
  ACCENT_RULE,
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
  RASTER_WORKFLOW_RULE,
  IMAGE_BRIEF_RULE,
  IMAGE_PLAN_RULE,
  IMAGE_GENERATION_RULE,
  IMAGE_HANDOFF_RULE,
  IMAGE_JOB_RULE,
  REFERENCE_SYSTEM_RULE,
  VISUAL_QA_RULE,
  SELF_CHECK_STOP,
  ...ZONE_SELF_CHECK,
  ...DECK_SELF_CHECK,
  ...IMAGE_PLACEHOLDER_POLICY,
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
    expect(IMAGE_USAGE_RULE).toMatch(/Relevante rasterbilder skal planlegges/i)
    expect(IMAGE_USAGE_RULE).toMatch(/bildeplan/i)
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
      IMAGE_PLAN_RULE,
      IMAGE_HANDOFF_RULE,
      ...IMAGE_PLACEHOLDER_POLICY,
      ...VECTOR_POLICY,
      ...RASTER_POLICY,
    ]) {
      expect(MCP_INSTRUCTIONS).not.toContain(detail)
      expect(toolProse()).toContain(detail)
    }
  })
})

describe('native komposisjon først', () => {
  it('sier at sonetreet og Slaids sine egne innholdstyper er komposisjonen, før agenten bygger noe', () => {
    // The regression this exists for: a deck that was structurally valid but
    // where almost every content slide was one large SVG standing in for the
    // zone tree, the heading, the cards and the body text all at once.
    expect(MCP_INSTRUCTIONS).toContain(NATIVE_COMPOSITION_RULE)
    expect(NATIVE_COMPOSITION_RULE).toMatch(/sonetre/i)
    expect(NATIVE_COMPOSITION_RULE).toMatch(/slideoverskrift/i)
    expect(NATIVE_COMPOSITION_RULE).toMatch(/kort og korttitler/i)
  })

  it('sier eksplisitt at SVG/raster er innhold i en sone, ikke en alternativ slide-motor', () => {
    expect(NATIVE_COMPOSITION_RULE).toMatch(/fyller bare den visuelle rollen/i)
    expect(NATIVE_COMPOSITION_RULE).toMatch(/aldri.*omgå sonetreet/i)
    expect(NATIVE_COMPOSITION_RULE).toMatch(/alternativ slide-motor/i)
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
    // The unframed picture kind is bounded here, and the transparent container
    // is ruled out for a named unit outright.
    expect(CARD_FRAMING_RULE).toMatch(/et bart `image`/i)
    expect(CARD_FRAMING_RULE).toMatch(/`container` er aldri svaret på en navngitt enhet/i)

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
    // ban. A bare picture is the one that keeps a legitimate use for a named
    // subject; a container does not, because it is support text.
    expect(CARD_FRAMING_RULE).toMatch(/der bildet står alene og bærer sitt eget budskap/i)
    expect(CARD_FRAMING_RULE).toMatch(/ikke der det er ett navngitt medlem blant flere/i)
    expect(CARD_FRAMING_RULE).toMatch(/ikke en måte å slippe å navngi enhetene på/i)
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

  it('gjør rasterplanen til standard i stedet for availability-fallback', () => {
    const surface = agentSurface()
    expect(surface).toContain(RASTER_WORKFLOW_RULE)
    expect(RASTER_WORKFLOW_RULE).toMatch(/standardflyten/i)
    expect(RASTER_WORKFLOW_RULE).toMatch(/ikke en fallback eller nødløsning/i)
    expect(RASTER_WORKFLOW_RULE).toMatch(/de ferdige filene legges inn gjennom bildedeponeringen/i)
    // No file bridge and no image API is held out as available or planned: the
    // surface says there is none, and names the manual route that exists
    // instead. The old wording («uten en filbro», «med mindre klienten har en
    // filbro») read as one being on the way.
    expect(agentSurface()).toMatch(
      /ingen egen bildegenerering, ingen bilde-API og ingen filbro, og planlegger ingen/i,
    )
    expect(agentSurface()).not.toMatch(/uten en filbro|med mindre klienten har en filbro/i)
    expect(RASTER_WORKFLOW_RULE).toMatch(/«Kopier prompt»-knapp i Slaids/i)
    expect(RASTER_WORKFLOW_RULE).toMatch(/ny, tom ChatGPT-samtale/i)
    expect(surface).not.toMatch(/Mangler du en rastergenerator|har du ingen[^.]*bildegenerator/i)
    expect(RASTER_POLICY.join(' ')).not.toMatch(/si tydelig fra om begrensningen/i)
  })

  it('sier at Slaids-agent-API-et ikke lager rasterbilder, uten å love at det aldri skjer', () => {
    expect(MCP_INSTRUCTIONS).toContain(RASTER_WORKFLOW_RULE)
    expect(RASTER_WORKFLOW_RULE).toMatch(/lager ikke rasterbilder/i)
    expect(agentSurface()).not.toMatch(/kommer ikke til å|aldri kommer til/i)
  })

  it('krever bildebrief også når bare ett generert rasterbilde er planlagt', () => {
    // The trigger, on the surface an agent actually reads. It lived only in the
    // guide, which meant the rule that decides *whether* to write a brief was
    // reachable only from the contract of the call that writes one.
    expect(IMAGE_USAGE_RULE).toMatch(/minst ett rasterbilde er planlagt/i)
    expect(IMAGE_USAGE_RULE).toMatch(/også om det bare er ett/i)
    expect(agentSurface()).not.toMatch(/dersom flere rasterbilder skal genereres/i)

    const guide = readFileSync(join(process.cwd(), DESIGN_DOCS_PATH), 'utf8')
    expect(guide).toMatch(/minst ett rasterbilde planlegges/i)
    expect(guide).not.toMatch(/dersom flere rasterbilder skal genereres/i)
  })

  it('forbyr create_svg_asset-kontrakten å gjenskape slideoverskrift, tekst, kort eller hele layouten', () => {
    // The anti-pattern from p_ssk8ao0znyp, named on the contract of the call
    // that actually creates the file — not only in prose an agent never opens.
    const policy = VECTOR_POLICY.join(' ')
    expect(policy).toMatch(/aldri erstatte selve sliden/i)
    expect(policy).toMatch(/slideoverskriften/i)
    expect(policy).toMatch(/en vanlig tekstblokk/i)
    expect(policy).toMatch(/et kort eller en korttittel/i)
    expect(policy).toMatch(/litteraturlister/i)
    expect(policy).toMatch(/teksttunge infografikker/i)

    const svgTool = mcpTools().find((tool) => tool.name.endsWith('create_svg_asset'))
    for (const rule of VECTOR_POLICY) expect(svgTool?.description).toContain(rule)
  })

  it('tillater ekte diagrametiketter i SVG, men ikke løpende brødtekst eller upassede citations', () => {
    const policy = VECTOR_POLICY.join(' ')
    expect(policy).toMatch(/akseetiketter, diagramnoder, kartetiketter/i)
    expect(policy).toMatch(/aldri løpende brødtekst eller faktapåstander/i)
  })

  it('gjør illustrasjonsbilder generelt til raster, ikke bare fotografiske eller biologiske motiver', () => {
    // Section C: the rule has to name illustration subjects broadly — a
    // building, a product, a historical scene — not only the photographic or
    // organic motifs the earlier wording singled out.
    const raster = RASTER_POLICY.join(' ')
    expect(raster).toMatch(/mennesker, dyr, natur, bygninger/i)
    expect(raster).toMatch(/produkter, historiske scener/i)
    expect(raster).toMatch(/en enkel vektortegning er ikke en akseptabel erstatning/i)
    expect(raster).toMatch(/uansett om motivet er et menneske, et bygg, et produkt/i)

    // And SVG stays legitimate for the diagrammatic cases it always covered.
    const vector = VECTOR_POLICY.join(' ')
    expect(vector).toMatch(/grafer, plott, ekte diagrammer, flytskjemaer/i)
  })

  it('gir agenten hele planen for et bilde den ikke kan lage selv', () => {
    // Decide whether the slide needs a picture, shape the zone to the motif,
    // reserve a real picture zone, and put the motif in the deck's plan. Every
    // step has to be reachable, or «plan the picture instead of dropping it» is
    // advice with no procedure behind it.
    const surface = agentSurface()
    for (const rule of IMAGE_PLACEHOLDER_POLICY) expect(surface).toContain(rule)
    expect(surface).toContain(IMAGE_BRIEF_RULE)
    expect(surface).toContain(IMAGE_PLAN_RULE)
  })

  it('planlegger sonens format mot motivet, ikke motivet mot sonen', () => {
    // The failure this replaced: wide prompts written for near-square zones,
    // because the shape was described in prose instead of measured.
    const policy = IMAGE_PLACEHOLDER_POLICY.join(' ')
    expect(policy).toMatch(/passer ikke sonens format til motivet/i)
    expect(policy).toMatch(/planlegges på nytt/i)
    expect(policy).toMatch(/ikke motivet presses inn i feil rektangel/i)
  })

  it('reserverer en ekte bildesone, og måler den mot bildetypen som er planlagt', () => {
    // A `titled-image-card` carries a header above the picture and needs more
    // room than a bare `image`, so «the reservation holds» is not one answer.
    const policy = IMAGE_PLACEHOLDER_POLICY.join(' ')
    expect(policy).toMatch(/`image` eller `titled-image-card` uten fil/i)
    expect(policy).toMatch(/reservedImageKinds/)
    expect(policy).toMatch(/for liten til noe bilde/i)
  })

  it('lar Slaids stemple plassholderteksten, i stedet for at agenten skriver den', () => {
    // The caption and the brief have to say the same number, and the only way
    // to guarantee that is for one call to produce both.
    const policy = IMAGE_PLACEHOLDER_POLICY.join(' ')
    expect(policy).toMatch(/Sett inn bilde 1 her/)
    expect(policy).toMatch(/Ikke skriv slike plassholdere for hånd/i)
  })

  it('gjør hvert planlagt bilde til én selvstendig bildegenerering', () => {
    // The observed failure: eight planned pictures, one storyboard back,
    // because the composed brief is one message and was handed on as one job.
    // The rule has to reach the agent, and it has to be unmistakable about
    // which half of the answer drives generation.
    expect(agentSurface()).toContain(IMAGE_GENERATION_RULE)
    expect(IMAGE_GENERATION_RULE).toMatch(
      /ett element i `images` = én selvstendig bildegenerering = én bildefil/i,
    )
    expect(IMAGE_GENERATION_RULE).toMatch(/send den aldri til bildegeneratoren som én samlet genereringsjobb/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/parse den aldri tilbake til enkeltbilder/i)
    // The count is checked against the plan before the files are deposited,
    // and one picture of many motifs never satisfies a plan of many pictures.
    expect(IMAGE_GENERATION_RULE).toMatch(/generation\.expectedFileCount/)
    expect(IMAGE_GENERATION_RULE).toMatch(/aldri et gyldig svar på en plan med flere bilder/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/generer de manglende bildene enkeltvis på nytt/i)
    // And the count is a check on the finished delivery, not a task the agent
    // restates. «Er `imageCount` 8, skal bildegeneratoren kalles 8 ganger» is
    // gone: an agent that carries that sentence into the conversation has told
    // the generator the job is eight pictures, which is the whole leak.
    expect(IMAGE_GENERATION_RULE).not.toMatch(/`imageCount` 8/)
    expect(IMAGE_GENERATION_RULE).not.toMatch(/kalles 8 ganger/i)
    expect(IMAGE_GENERATION_RULE).toMatch(
      /Det tallet er en kontroll av det ferdige settet, ikke noe du sier i samtalen/i,
    )
  })

  it('holder flerbildekonteksten ute av samtalen, ikke bare ute av prompten', () => {
    /*
     * The root cause. Separate prompts were already the rule and were already
     * being followed: the plan still reached the generator, through the
     * conversation — a printed brief, a summary of the plan, «nå lager jeg de
     * ni bildene», a running count. A generator that has read a set composes a
     * set, and the merged image that comes back is its ordinary behaviour, so
     * the fix has to be what is exposed rather than another prohibition.
     */
    expect(IMAGE_GENERATION_RULE).toMatch(
      /Hver enkelt generering skal se ut som en fullstendig selvstendig oppgave, også i samtalen/i,
    )
    expect(IMAGE_GENERATION_RULE).toMatch(/ikke skriv ut `brief`/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/ikke oppsummer bildeplanen/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/ikke list opp bildene som skal lages/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/ikke tell dem/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/nøytral og ikke røpe at flere bilder er planlagt/i)
    // Named as the mechanism, so it does not read as etiquette around the
    // warnings it replaces — and as best effort, because a host whose image
    // tool reads the conversation can see more than the agent chose.
    expect(IMAGE_GENERATION_RULE).toMatch(/Dette er hovedgrepet, og det er best effort, ikke en garanti/i)
    expect(IMAGE_GENERATION_RULE).toMatch(
      /vertsklienten kan gi bildeverktøyet mer av samtalen enn du styrer/i,
    )
    // And the supported way out, so the answer to a merged picture is an action
    // rather than another warning.
    expect(IMAGE_GENERATION_RULE).toMatch(/«Kopier prompt»/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/ny, tom ChatGPT-samtale/i)
    // And the brief is labelled for what it is on the surface too.
    expect(IMAGE_GENERATION_RULE).toMatch(/`brief` er intern/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/følger ikke med i normalflyten i det hele tatt/i)
  })

  it('bevarer nummereringen fra planlagt bilde til bildefil', () => {
    // The deposit matches `1.png`, `2.jpg`, … to the zones they were ordered
    // for, so a renumbering anywhere in the flow puts pictures in the wrong
    // zones rather than failing.
    expect(IMAGE_GENERATION_RULE).toMatch(/planlagt bilde 1 blir fil `1`/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/med filendelsen til formatet/i)
  })

  it('sier at genereringsrekkefølgen aldri er en identitetskilde', () => {
    // The second observed failure, and the one a count could not see: nine
    // pictures generated in the order 1, 3, 9, 6, 5, 8, 2, 4, 7, named by
    // arrival, seven of them on the wrong slide. The rule has to name the
    // identity that replaces the order.
    expect(IMAGE_GENERATION_RULE).toMatch(/Genereringsrekkefølgen er aldri en identitetskilde/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/«det første bildet som kom tilbake» er aldri bilde 1/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/aldri nummereres etter når det ble ferdig/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/aldri fra en teller over de ferdige filene/i)
  })

  it('gjør arbeidsflyten eksplisitt sekvensiell, én jobb av gangen', () => {
    // Order matters in the loop itself: the binding is written down before the
    // next generation call exists to confuse it with. An agent that collects
    // every file first has nothing left to bind them from — and one that holds
    // several jobs at once has the set back in context.
    expect(IMAGE_GENERATION_RULE).toMatch(/Fullfør én jobb av gangen/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/knytt filen som kommer tilbake til den samme `imagePlanItemId`/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/hent først deretter neste jobb/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/ikke hent flere jobber på forskudd/i)
    expect(IMAGE_GENERATION_RULE).toMatch(
      /ikke hent bildeplanen på nytt for å få tak i de andre motivene/i,
    )
    // And the rule that makes one job a whole task is on the call that hands
    // one out, where an agent meets it.
    expect(toolProse()).toContain(IMAGE_JOB_RULE)
    expect(IMAGE_JOB_RULE).toMatch(/Dette er én bildegenereringsoppgave/i)
    expect(IMAGE_JOB_RULE).toMatch(/Send `prompt` ordrett/i)
    expect(IMAGE_JOB_RULE).toMatch(/`all-reported` er slutten på løkken, ikke et tall/i)
    // And the name is not read as a receipt: the queue emptying says the
    // bindings were reported, never that a generator ran.
    expect(IMAGE_JOB_RULE).toMatch(/«meldt», ikke «generert»/i)
  })

  it('gjør sluttkontrollen av koblingen til et kall, ikke en huskeregel', () => {
    // On the tool that performs it, because it is only writable once there are
    // files to write about — and because the whole value of the check is that
    // somebody other than the model does it.
    expect(toolProse()).toContain(IMAGE_HANDOFF_RULE)
    expect(IMAGE_HANDOFF_RULE).toMatch(/for hver oppføring så snart bildet er laget/i)
    expect(IMAGE_HANDOFF_RULE).toMatch(/før du henter neste jobb/i)
    expect(IMAGE_HANDOFF_RULE).toMatch(/kopieres ordrett fra jobben/i)
    expect(IMAGE_HANDOFF_RULE).toMatch(/den utledes ikke fra rekkefølgen/i)
    expect(IMAGE_HANDOFF_RULE).toMatch(/nøyaktig én gang/i)
    expect(IMAGE_HANDOFF_RULE).toMatch(/`ok` false.*skal bildene ikke deponeres/i)
    expect(IMAGE_HANDOFF_RULE).toMatch(/`manifest`.*`manifestFileName`/)
  })

  it('tilbyr avtrykket som ekstra kontroll, aldri som et vilkår', () => {
    // A record is otherwise a claim about a file *name*, and a name survives
    // having its contents swapped — so the digest is worth asking for. What it
    // must never be is a condition: the ordinary host cannot read the bytes its
    // own image tool returned, and a flow that stopped there could not be
    // finished at all except by generating the same picture again.
    expect(IMAGE_HANDOFF_RULE).toMatch(/`contentHash`/)
    expect(IMAGE_HANDOFF_RULE).toMatch(/SHA-256 av dem/i)
    expect(IMAGE_HANDOFF_RULE).toMatch(/\*\*ekstra\*\* kontroll, ikke et vilkår/i)
    expect(IMAGE_HANDOFF_RULE).toMatch(/de fleste verter, ChatGPT blant dem, gir deg ikke bytene/i)
    expect(IMAGE_HANDOFF_RULE).toMatch(/utelater du feltet og går videre til neste bilde/i)
    // The old model is gone from the prose as well as from the schema.
    expect(IMAGE_HANDOFF_RULE).not.toMatch(/bytesUnavailable/)
    expect(IMAGE_GENERATION_RULE).not.toMatch(/Avtrykket er ikke valgfritt bokholderi/i)
    expect(agentSurface()).not.toMatch(/generation-unverified|unverified-claim|all-answered/)
    // And a digest that *is* sent has to be taken from the response, not from
    // the folder afterwards.
    expect(IMAGE_HANDOFF_RULE).toMatch(/i det filen kommer tilbake/i)
    expect(IMAGE_HANDOFF_RULE).toMatch(/beregnet i ettertid.*fester.*allerede har skjedd/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/regn ut SHA-256 av dem med en gang/i)
  })

  it('sier best effort om isolasjonen, og lover ingen garanti', () => {
    /*
     * The product decision this pins, stated as a property of the surface: the
     * one-picture-at-a-time flow is the best available mechanism against merged
     * pictures, and it is not a guarantee. A host whose image tool reads the
     * conversation can hand it context the agent never chose, and Slaids can
     * neither prevent that nor prove it did not happen — so an instruction that
     * promised isolation would have the agent promise it to the user in turn.
     */
    const surface = agentSurface()
    expect(surface).toMatch(/best effort/i)
    expect(IMAGE_JOB_RULE).toMatch(/\*\*Dette er best effort, ikke en garanti\.\*\*/)
    expect(IMAGE_JOB_RULE).toMatch(
      /lov derfor aldri at generatoren bare har sett denne ene prompten/i,
    )
    // No hard claim about what ChatGPT's image tool can see, anywhere.
    expect(surface).not.toMatch(/bare (?:kan )?se (?:den ene|én) prompt/i)
    expect(surface).not.toMatch(/garantert isolasjon|isolasjonen er garantert/i)
    expect(surface).not.toMatch(/kontekstisolert/i)

    // And the supported fallback is named as a first-class step, so the answer
    // to a merged picture is an action rather than another warning.
    expect(surface).toMatch(/ny, tom ChatGPT-samtale/i)
    expect(surface).toMatch(/«Kopier prompt»/)
  })

  it('sier hva en melding om generering ikke er', () => {
    // The two overstatements this replaces. «Kontrollert» must not creep into
    // meaning «the right picture», and a binding Slaids never held against a
    // file must be described as what it is: a self-report.
    expect(IMAGE_HANDOFF_RULE).toMatch(/sier ingenting om hva bildet viser/i)
    expect(IMAGE_HANDOFF_RULE).toMatch(/koblingen er selvrapportert/i)
    expect(IMAGE_HANDOFF_RULE).toMatch(/aldri at et bilde er laget eller kontrollert/i)
    expect(IMAGE_HANDOFF_RULE).toMatch(/`reporting` og `reportingMeans`/)
  })

  it('bruker oppføringens ferdige prompt som instruks, og holder resten utenfor kallet', () => {
    // The instruction for one picture is composed by Slaids from the deck's
    // shared context and that one entry — so there is nothing for the agent to
    // assemble, and therefore no reason for it to have the rest of the plan
    // open while it does. Every field that used to be part of the instruction
    // is still named here, as something the call must *not* carry: each of them
    // says «one of several» to whoever reads it.
    expect(IMAGE_GENERATION_RULE).toMatch(/Slaids gir deg den ene jobben som står igjen/i)
    expect(IMAGE_GENERATION_RULE).toMatch(
      /ingen andre oppføringer, ingen samlet brief, intet antall/i,
    )
    expect(IMAGE_GENERATION_RULE).toMatch(/hele instruksen for det ene bildet/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/Send den ordrett, ett kall per jobb, og bygg den aldri selv/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/Ingenting annet skal inn i kallet/i)
    for (const field of ['number', 'slideId', 'nodeId', 'slideLabel', 'aspectRatio', 'orientation']) {
      expect(IMAGE_GENERATION_RULE).toContain(`\`${field}\``)
    }
    for (const field of PLANNED_IMAGE_FIELDS) {
      expect(IMAGE_GENERATION_RULE).toContain(`\`${field}\``)
    }
    expect(IMAGE_GENERATION_RULE).toMatch(/din egen bokføring ved siden av kallet/i)
    expect(IMAGE_GENERATION_RULE).toMatch(/`imageContext`/)
    expect(IMAGE_GENERATION_RULE).toMatch(/aldri et felles format for flere bilder/i)
  })

  it('sier at agenten ikke skriver den samlede briefen, antallet eller formatene selv', () => {
    // Everything derived is Slaids'. An aspect ratio an agent states in prose is
    // exactly what makes brief and zone disagree.
    expect(IMAGE_PLAN_RULE).toMatch(/Slaids teller bildene/i)
    expect(IMAGE_PLAN_RULE).toMatch(/måler aspect ratio fra hver sones faktiske geometri/i)
    expect(IMAGE_PLAN_RULE).toMatch(/verken skrive antall, nummer, formater/i)
    expect(IMAGE_BRIEF_RULE).toMatch(/aldri hva et enkelt bilde skal vise/i)
    expect(IMAGE_BRIEF_RULE).toMatch(/aldri oppgir aspect ratio i fritekst|aldri aspect ratio i fritekst|du oppgir aldri aspect ratio i fritekst/i)
  })

  it('gir kontrollene et sluttpunkt, så de ikke blir en åpen forbedringssløyfe', () => {
    for (const question of [...ZONE_SELF_CHECK, ...DECK_SELF_CHECK]) {
      expect(MCP_INSTRUCTIONS).toContain(question)
    }
    expect(MCP_INSTRUCTIONS).toContain(SELF_CHECK_STOP)
    expect(SELF_CHECK_STOP).toMatch(/ikke en åpen sløyfe/i)
    // The four zone questions, in the order the repairs get more expensive.
    expect(ZONE_SELF_CHECK[0]).toMatch(/`container` eller `untitled-card`.*`titled-card`/i)
    expect(ZONE_SELF_CHECK[1]).toMatch(/aksent.*hovedoverskrift/i)
    expect(ZONE_SELF_CHECK[2]).toMatch(/flere mindre soner/i)
    expect(ZONE_SELF_CHECK[3]).toMatch(/subfelter og aksenter/i)
    // And the deck pass has to cover the picture plan, not just the text.
    expect(DECK_SELF_CHECK.join(' ')).toMatch(/bildeplanen/i)
    expect(DECK_SELF_CHECK.join(' ')).toMatch(/formatet på sonen/i)
    expect(DECK_SELF_CHECK.join(' ')).toMatch(/nesten samme motiv/i)
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
    expect(REPEATED_FALLBACK_RULE).toMatch(/én stor tekstsone/i)
    expect(REPEATED_FALLBACK_RULE).toMatch(/overskrift/i)
    expect(REPEATED_FALLBACK_RULE).toMatch(/tekst eller punktliste/i)
    expect(MCP_INSTRUCTIONS).toContain(REPEATED_FALLBACK_RULE)
  })

  it('svarer med hva agenten skal gjøre i stedet, ikke bare hva den ikke skal', () => {
    // A prohibition an agent cannot act on is a prohibition it ignores: the
    // self-check has to point back at decomposition and framing.
    expect(REPEATED_FALLBACK_RULE).toMatch(/dekomponer/i)
    expect(REPEATED_FALLBACK_RULE).toMatch(/korttittel/i)
  })

  it('gjør kort med tittel til standardvalget, og container til et sekundært format', () => {
    // The default said as a default. The rule this replaced listed three kinds
    // and left the choice open, and an open choice with one cheap answer is not
    // a choice: the cheap answer is whatever a zone becomes when text is
    // written into it.
    expect(MCP_INSTRUCTIONS).toContain(PRIMARY_TEXT_RULE)
    expect(PRIMARY_TEXT_RULE).toMatch(/som hovedregel være `titled-card`/i)
    expect(PRIMARY_TEXT_RULE).toMatch(/`untitled-card` er unntaket/i)
    expect(PRIMARY_TEXT_RULE).toMatch(/`container` er nesten aldri riktig for primært tekstinnhold/i)
    expect(PRIMARY_TEXT_RULE).toMatch(/sekundært format/i)
    expect(PRIMARY_TEXT_RULE).toMatch(/fotnotepregede felt/i)
    // And the escape hatch is closed: choosing otherwise needs a reason.
    expect(PRIMARY_TEXT_RULE).toMatch(/skal du kunne si hvorfor/i)
  })

  it('kaller den fremhevede tekstblokken en aksent, ikke kortets overskrift', () => {
    // The word was the bug: an agent offered a «heading» inside a text field
    // uses it as the heading of the thing, and then the card needs no title.
    expect(MCP_INSTRUCTIONS).toContain(ACCENT_RULE)
    expect(ACCENT_RULE).toMatch(/aksent/i)
    expect(ACCENT_RULE).toMatch(/underoverskrift/i)
    expect(ACCENT_RULE).toMatch(/ikke kortets hovedoverskrift/i)
    expect(ACCENT_RULE).toMatch(/korttittelen/i)
  })

  it('tilbyr blokken som `accent` i selve tekstformatet, ikke som `heading`', () => {
    // The contract is where the misunderstanding lived, so the rename is there
    // — the stored ProseMirror node is still a heading and needs no migration.
    const text = mcpTools().find((tool) => tool.name.endsWith('set_zone_text'))
    const blocks = JSON.stringify(text?.inputSchema ?? {})
    expect(blocks).toContain('"accent"')
    expect(blocks).not.toContain('"heading"')
  })
})

describe('kilder går gjennom referansesystemet', () => {
  it('gjør Slaids sitt referansesystem til normalveien, før agenten skriver en kildeslide', () => {
    // Section D, and the direct answer to p_ssk8ao0znyp: 0 references, a
    // hand-drawn «Kilder og forbehold» SVG instead.
    expect(MCP_INSTRUCTIONS).toContain(REFERENCE_SYSTEM_RULE)
    expect(REFERENCE_SYSTEM_RULE).toMatch(/referansesystem/i)
    expect(REFERENCE_SYSTEM_RULE).toMatch(/citations/i)
  })

  it('forbyr en manuell bibliografi-slide, med unntak for en uttrykkelig ønsket faglig slide', () => {
    expect(REFERENCE_SYSTEM_RULE).toMatch(/ikke opprett en egen slide bare for å ramse opp kilder/i)
    expect(REFERENCE_SYSTEM_RULE).toMatch(/brukeren uttrykkelig har bedt om/i)
    expect(REFERENCE_SYSTEM_RULE).toMatch(/selve bibliografien hjemme i referansesystemet/i)
  })

  it('sier at en faktapåstand med citation-behov aldri hører hjemme som tekst i en SVG', () => {
    expect(REFERENCE_SYSTEM_RULE).toMatch(/aldri bakes inn som tekst i en SVG/i)
  })
})

describe('visuell QA er en del av ferdigkontrollen', () => {
  it('krever rendring og inspeksjon i tillegg til strukturell validering', () => {
    // Section E, and the second half of the regression: the deck validated
    // structurally end to end while text inside its self-authored SVGs was
    // clipped without anything noticing.
    expect(MCP_INSTRUCTIONS).toContain(VISUAL_QA_RULE)
    expect(VISUAL_QA_RULE).toMatch(/ikke tilstrekkelig/i)
    expect(VISUAL_QA_RULE).toMatch(/render representative slides/i)
  })

  it('peker spesielt på egenprodusert SVG med interne etiketter eller tekst', () => {
    expect(VISUAL_QA_RULE).toMatch(/egenprodusert SVG/i)
    expect(VISUAL_QA_RULE).toMatch(/intern beskjæring/i)
    expect(VISUAL_QA_RULE).toMatch(/uleselige etiketter/i)
  })
})

describe('den gamle notat-/bildeprompt-flyten er borte fra alt agenten og leseren får', () => {
  /**
   * The vocabulary of the workflow this replaced.
   *
   * Asserted as an absence rather than left to review, because a retired
   * mechanism that survives in prose is worse than one that was never removed:
   * the code refuses the call, and the agent spends a round discovering it.
   */
  const RETIRED = [
    /bildenotat/i,
    /notePurpose/,
    /noteText/,
    /image-prompt/,
    /\bnotat(et|er|ene)?\b/i,
    /set_image_brief\b/,
  ]

  it('nevner den ikke på agentflaten', () => {
    const surface = agentSurface()
    for (const pattern of RETIRED) {
      expect(surface, `${pattern} står fortsatt i agentflaten`).not.toMatch(pattern)
    }
  })

  it('nevner den ikke i designguiden', () => {
    const guide = readFileSync(join(process.cwd(), DESIGN_DOCS_PATH), 'utf8')
    for (const pattern of RETIRED) {
      expect(guide, `${pattern} står fortsatt i ${DESIGN_DOCS_PATH}`).not.toMatch(pattern)
    }
  })

  it('beskriver i stedet den nye flyten, begge steder', () => {
    const guide = readFileSync(join(process.cwd(), DESIGN_DOCS_PATH), 'utf8')
    const surface = agentSurface()
    for (const text of [guide, surface]) {
      expect(text).toMatch(/bildeplan/i)
      expect(text).toMatch(/Sett inn bilde 1 her/)
      expect(text).toMatch(/felles bildekontekst/i)
    }
    // And the guide shows the generated templates, so a reader can recognise
    // both: the prompt one picture is made from, and the internal brief.
    expect(guide).toContain('Lag ett bilde.')
    expect(guide).toContain('Lag nøyaktig [ANTALL] separate bilder til én presentasjon.')
    expect(guide).toMatch(/Begge malene bor i `src\/domain\/imagePlan\.ts`/)
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

  it('lar guiden si samme stadium som domenet etter en godkjent kontroll', () => {
    /*
     * The guide is what `CLAUDE.md` sends a developing agent to read before it
     * touches the agent's rules, so a wrong stage here is not cosmetic: it can
     * put back the very confusion this flow spent its rounds removing. It said
     * a passing check gave `stage: generation-verified`, and it does not —
     * `composeImageWorkflowStatus` reaches that stage only when nothing the
     * deck can see is outstanding. A verified set whose files are not in the
     * zones is `awaiting-deposit`.
     */
    const guide = readFileSync(join(process.cwd(), DESIGN_DOCS_PATH), 'utf8')
    expect(guide).not.toMatch(/generation-verified/)
    expect(guide).toMatch(
      /ligger filene ennå ikke i sonene, er `workflow\.stage` `awaiting-deposit`/i,
    )
    expect(guide).toMatch(
      /`images-in-deck` kommer først når ingenting Slaids kan se er utestående/i,
    )
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
