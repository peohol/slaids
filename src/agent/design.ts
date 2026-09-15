/**
 * The design contract an agent composes slides against.
 *
 * Slaids will accept any tree that fits. That is a *validity* rule, and it is
 * the only one the domain can enforce — whether a slide communicates well is
 * not something a validator can decide, and Slaids deliberately does not try.
 * So the quality rules live here instead, as text that reaches the agent while
 * it is still deciding: the ones it must have before its first call are woven
 * into the MCP instructions, and the ones that only matter once it is choosing
 * a particular content kind or a particular kind of picture ride along on the
 * contract of the tool that does that.
 *
 * One rule, one constant, one surface. A rule stated in the instructions is not
 * restated on a tool, and a rule on a tool is not restated in the instructions:
 * two copies of a normative sentence is how the two come to disagree, and an
 * agent reading a contradiction has been told nothing. `docs/AGENT_PRESENTATION_DESIGN.md`
 * is the same thinking at length, for a reader rather than a prompt; it explains
 * and exemplifies these rules, and never states a different one.
 *
 * The failure this exists to prevent is specific and was observed: an agent
 * given free rein produces slide after slide of one big container with a
 * heading and a bullet list. Every one of them is valid, and the deck is flat.
 * The cause is not that the agent prefers bullet lists — it is that it never
 * asked what the material was *made of* before it reached for geometry.
 */

/**
 * The units a slide's material decomposes into.
 *
 * Not a menu of layouts and not a taxonomy of slides: a list of the things
 * worth *looking for* in the source material, before any zone exists. Each one
 * is a question — are there several of these here? — and a yes is what makes a
 * relation available to express visually.
 */
export const SEMANTIC_UNITS: readonly string[] = [
  'kategorier',
  'aktører',
  'faser',
  'alternativer',
  'årsaker og virkninger',
  'parallelle dimensjoner',
  'tidssekvenser',
  'sammenlignbare objekter',
  'hovedpåstand + evidens',
  'ett objekt med interne underdeler',
]

/** The step that has to happen before geometry, said as an instruction. */
export const SEMANTIC_DECOMPOSITION = `Før du velger geometri: finn ut hvilke semantiske enheter sliden faktisk består av. Let aktivt etter ${SEMANTIC_UNITS.slice(
  0,
  -1,
).join(', ')} og ${SEMANTIC_UNITS[SEMANTIC_UNITS.length - 1]}. Uttrykk deretter relasjonen mellom enhetene visuelt.`

/**
 * What «simplest» means here.
 *
 * The earlier wording — build the simplest tree — was read as «build the
 * fewest zones», which is one big container every time. Simplicity is a
 * constraint on the tree that expresses the relations, not an alternative to
 * expressing them.
 */
export const SIMPLEST_TREE =
  'Bygg det enkleste sonetreet som gjør de viktige semantiske relasjonene visuelt eksplisitte.'

/** When one container is the right answer, and when it is the lazy one. */
export const SINGLE_CONTAINER_RULE =
  'Én stor tekstcontainer er et legitimt valg når innholdet faktisk er én sammenhengende idé, men den er ikke standardløsningen.'

/** The distinction that decides between a list and several zones. */
export const BULLET_RULE =
  'En punktliste hører hjemme der punktene er underordnede utsagn om det samme objektet eller den samme påstanden. Representerer punktene derimot flere navngivbare konsepter, kategorier, faser eller sammenligningsenheter, skal du normalt vurdere separate soner eller kort i stedet.'

/** Same role, same treatment. */
export const PARALLEL_RULE =
  'Parallelle konsepter skal normalt ha parallell visuell behandling: samme innholdstype, samme nivå i treet og like eller nesten like vekter.'

/**
 * The self-check, which is about noticing a pattern rather than avoiding one.
 *
 * It asks the agent to re-examine the material, not to make the next slide look
 * different from the last. A deck of genuinely single-idea slides is allowed to
 * look like one; a deck that looks like one because nobody decomposed anything
 * is the thing being caught.
 */
export const REPEATED_FALLBACK_RULE =
  'Ender flere slides på rad som «én stor container + punktliste», har du sannsynligvis oversett semantisk struktur: dekomponer de slidene på nytt. Dette er en kvalitetsregel, ikke et krav om kunstig layoutvariasjon.'

/**
 * Which content kind a semantic role asks for.
 *
 * Detail rather than doctrine, so it rides on `set_zone_card` — the call where
 * the choice is actually made — instead of taking up room in the instructions.
 */
export const CONTENT_KIND_RULE =
  'Velg innholdstype etter semantisk rolle. Foretrekk `titled-card` når hvert element naturlig kan få en kort semantisk etikett — en kategori, aktør, fase, et alternativ eller en sammenligningsenhet; korttittelen er da den etiketten. `untitled-card` passer der innholdet selv er budskapet og en etikett bare ville vært støy. `container` passer deler som hører sammen uten å være selvstendige objekter. `negative-space` er en beslutning om luft, ikke en sone du glemte å fylle.'

/** What a split has to be able to justify. */
export const SPLIT_RULE =
  'En splitt skal uttrykke en relasjon du har identifisert i innholdet — sammenligning, sekvens, hierarki, katalog eller fokus. Del aldri en sone for å få plass til mer tekst.'

/* ------------------------------------------------------------------ *
 * Pictures: raster or vector
 * ------------------------------------------------------------------ */

/**
 * The short form, for the agent that has not yet decided it needs a picture.
 *
 * Long enough to make the choice, short enough for a system instruction; the
 * two halves below carry the rest, each on the tool that stores that kind.
 */
export const IMAGE_POLICY_SUMMARY =
  'Vektor og raster er ikke samme verktøy. Grafer, plott, diagrammer, flytskjemaer, enkel ikonografi og geometriske illustrasjoner skal være SVG, og skal forbli SVG. Fotografiske, naturtro, kunstneriske eller visuelt komplekse motiver skal være rasterbilder fra en egnet bildegenerator.'

/** The vector half, on the tool that writes markup. */
export const VECTOR_POLICY: readonly string[] = [
  'Bruk SVG til grafikk som faktisk bør være vektor: grafer, plott, diagrammer, flytskjemaer, enkel ikonografi og geometriske illustrasjoner.',
  'SVG skal beholdes som SVG. Ikke rasteriser en SVG bare for å gjøre den om til «et bilde».',
  'Ikke etterlign fotografiske, naturtro eller organiske motiver med hjemmelaget SVG.',
]

/** The raster half, on the tool that takes a finished file. */
export const RASTER_POLICY: readonly string[] = [
  'Fotografiske, naturtro, kunstneriske eller visuelt komplekse illustrasjoner skal normalt være rasterbilder laget av en egnet bildegenerator.',
  'Ikke lever en hjemmelaget, rasterisert SVG i stedet for et slikt bilde.',
  'Har du ingen generativ bildemodell tilgjengelig, si tydelig fra om begrensningen i stedet for å lage en dårligere erstatning og fremstille den som likeverdig.',
]

/** Where the same thinking is written out at length, for a reader. */
export const DESIGN_DOCS_PATH = 'docs/AGENT_PRESENTATION_DESIGN.md'
