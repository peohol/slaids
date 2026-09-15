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
 *
 * A deck about human evolution showed the same failure twice more, and both
 * times the rule existed while the *mechanism* did not. The named species came
 * back as sentences inside transparent containers, because a container is what
 * a zone becomes when text is written into it and nobody chose otherwise; and
 * the deck planned almost no pictures, because «consider whether a picture
 * would help» is cheapest to answer no when nothing names the pictures worth
 * looking for. Hence `CARD_FRAMING_RULE` and `IMPLICIT_CONTAINER_RULE` on the
 * one side, and named subjects and picture roles on the other.
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
  'Én stor tekstcontainer er et legitimt valg når sliden faktisk er én samlet idé som ikke trenger synlig innramming, men den er ikke standardløsningen, og den er aldri svaret på at stoffet var vanskelig å dekomponere.'

/**
 * The units that arrive with a name of their own.
 *
 * A subset of `SEMANTIC_UNITS`, and a deliberate one: these are the units a
 * reader can point at and call something. That is exactly the test for whether
 * a card title has anything to say — and therefore the test that decides
 * between a framed card and a transparent container.
 */
export const NAMED_UNITS: readonly string[] = [
  'arter',
  'kategorier',
  'aktører',
  'faser',
  'alternativer',
  'sammenligningsobjekter',
]

/**
 * Which of the two a named unit gets: a frame, or no frame.
 *
 * In the instructions rather than on `set_zone_card`, unlike the rest of the
 * content-kind detail, because it is not a detail — it is the decision the
 * decomposition step feeds directly into, and an agent that has not made it
 * before it starts writing text has already made it by default. The observed
 * failure is precisely that: a deck about named species in which every species
 * is a sentence inside a transparent container, because a container is what a
 * zone becomes when nobody chooses.
 */
export const CARD_FRAMING_RULE = `Består sliden av flere navngitte, parallelle enheter – ${NAMED_UNITS.slice(
  0,
  -1,
).join(', ')} eller ${
  NAMED_UNITS[NAMED_UNITS.length - 1]
} – skal hver enhet normalt være et \`titled-card\` der korttittelen er enhetens navn. Da ser publikum at enhetene er likeverdige, og navnet blir noe å skanne etter i stedet for en setningsstart inne i en tekstblokk. Korttittelen står på én linje og brytes ikke: får det fulle navnet ikke plass, kort ned tittelen og la den fulle formen stå i teksten – en avvist korttittel er aldri en grunn til å gå tilbake til en container. \`container\` er gjennomsiktig og rammer ingenting inn: den hører hjemme der sonen faktisk er én samlet idé uten behov for synlig innramming, og er verken standardvalget eller en måte å slippe å navngi enhetene på.`

/** Audience-visible content belongs to the subject, never to the authoring process. */
export const AUDIENCE_CONTENT_RULE =
  'Alt publikum ser skal tjene presentasjonens tema og kommunikative mål. Ikke legg inn kommentarer om Slaids, layoutvalg, designprosessen, testhensikten eller agentarbeidet i selve presentasjonen med mindre brukeren uttrykkelig har bedt om en presentasjon om nettopp dette.'

/** The distinction that decides between a list and several zones. */
export const BULLET_RULE =
  'En punktliste hører hjemme der punktene er underordnede utsagn om det samme objektet eller den samme påstanden. Representerer punktene derimot flere navngivbare konsepter, kategorier, faser eller sammenligningsenheter, skal du normalt vurdere separate soner eller kort i stedet.'

/** Quotes are evidence or voice, not decorative typography. */
export const QUOTE_RULE =
  'Bruk sitater sparsomt. En quote-blokk skal være en faktisk, etterprøvbar formulering fra en identifiserbar kilde der den eksakte ordlyden tilfører noe; ikke gjør egne oppsummeringer, parafraser eller slagord om til sitater for visuell effekt.'

/** Give short prose room to breathe when the geometry already provides it. */
export const TEXT_RHYTHM_RULE =
  'Når et kort eller en container har god plass i høyden og teksten består av flere tydelige delpoenger, bruk separate avsnitt eller bevisste linjeskift for å gi dem lesbar avstand i stedet for å presse alt sammen i én tett tekstblokk. Ikke legg inn tomme linjer bare for å fylle høyden.'

/** Same role, same treatment. */
export const PARALLEL_RULE =
  'Parallelle konsepter skal normalt ha parallell visuell behandling: samme innholdstype, samme nivå i treet og like eller nesten like vekter.'

/** Color can clarify grouping or contrast, but may not become random decoration. */
export const COLOR_SEMANTICS_RULE =
  'Bruk farge semantisk. Samme farge kan samle elementer som tilhører samme gruppe; ulike, harmoniske headerfarger kan skille tydelig forskjellige eller kontrasterende peers. Varier farge bare når variasjonen hjelper publikum å forstå strukturen, ikke for tilfeldig dekorasjon.'

/**
 * The self-check, which is about noticing a pattern rather than avoiding one.
 *
 * It asks the agent to re-examine the material, not to make the next slide look
 * different from the last. A deck of genuinely single-idea slides is allowed to
 * look like one; a deck that looks like one because nobody decomposed anything
 * is the thing being caught.
 */
export const REPEATED_FALLBACK_RULE =
  'Ender flere slides på rad som «én gjennomsiktig container med overskrift og tekst eller punktliste», har du sannsynligvis oversett semantisk struktur: dekomponer de slidene på nytt, og gi de navngitte enhetene hver sin ramme. Dette er en kvalitetsregel, ikke et krav om kunstig layoutvariasjon.'

/**
 * The default nobody chose.
 *
 * Writing text into an empty zone has to put it *somewhere*, and the lightest
 * thing that can hold text is a transparent container — so the cheapest route
 * through the API, split and write, produces containers without the agent ever
 * opening the contract of the call that picks a content kind. That is the
 * mechanism behind the flat deck, and this is the one place it can be said:
 * on the call that applies the default.
 */
export const IMPLICIT_CONTAINER_RULE =
  'Beholderen du får når du skriver tekst i en tom sone er utgangspunktet Slaids må velge for å ha et sted å legge teksten – den er ikke et designvalg du har tatt. Skal sonen være én av flere navngitte, parallelle enheter, sett innholdstypen først og skriv teksten etterpå. Gjør du ikke det, ender dekket som en rekke gjennomsiktige containere ingen har bestemt seg for.'

/**
 * Which content kind a semantic role asks for.
 *
 * Detail rather than doctrine, so it rides on `set_zone_card` — the call where
 * the choice is actually made — instead of taking up room in the instructions.
 */
export const CONTENT_KIND_RULE =
  'Velg innholdstype etter semantisk rolle, ikke etter hvor mye tekst sonen har. Korttittelen på et `titled-card` er navnet på enheten kortet viser, og skal være kort nok til å skannes. `untitled-card` passer der innholdet selv er budskapet og en etikett bare ville vært støy. `container` passer deler som hører sammen uten å være selvstendige objekter, og som ikke trenger synlig innramming. `note` er redaksjonell tekst som aldri vises for publikum, og er måten en sone reserveres til et bilde som lages et annet sted.'

/**
 * Air, which is a composition decision and not a spacer.
 *
 * Its own constant rather than the tail of `CONTENT_KIND_RULE`: the two answer
 * different questions — which kind this zone is, and whether a zone should draw
 * nothing at all — and a reader who needed the first had to read past four
 * sentences about the second to find it.
 */
export const NEGATIVE_SPACE_RULE =
  'Bruk `negative-space` konservativt og bare når den tomme flaten forbedrer komposisjonen. Det vanligste gode tilfellet er luft over og/eller under et synlig kort med lite innhold, slik at kortet ikke blir unødvendig høyt og tittel og brødtekst holdes visuelt samlet. Ikke legg negativt rom mellom parallelle kort bare for å skape avstand eller demonstrere luft; Slaids har allerede faste mellomrom, og horisontal luft som bare gjør innholdssonene smalere er vanligvis et tilbakeskritt. Denne høyde-trimmingen gjelder synlige kort, ikke transparente containere. Hvis å fjerne det negative rommet bare gir innholdet mer nyttig plass uten å svekke fokus, hierarki eller rytme, skal det bort.'

/** What a split has to be able to justify. */
export const SPLIT_RULE =
  'En splitt skal uttrykke en relasjon du har identifisert i innholdet — sammenligning, sekvens, hierarki, katalog eller fokus. Del aldri en sone for å få plass til mer tekst.'

/* ------------------------------------------------------------------ *
 * Pictures: raster or vector
 * ------------------------------------------------------------------ */

/**
 * The subjects where a picture is part of the answer rather than a bonus.
 *
 * Named, for the same reason `SEMANTIC_UNITS` are named: «consider whether a
 * picture would help» is advice an agent can honestly answer «no» to on every
 * slide without ever having looked. A list of subjects is a question it has to
 * answer about *this* deck.
 */
export const VISUAL_SUBJECTS: readonly string[] = [
  'mennesker',
  'dyr og arter',
  'anatomi',
  'steder og landskap',
  'gjenstander og redskaper',
  'historiske miljøer',
  'geografi og utbredelse',
]

/** The pictures worth looking for, the way `SEMANTIC_UNITS` are units. */
export const IMAGE_ROLES: readonly string[] = [
  'rekonstruksjon av en art, organisme eller person',
  'utsnitt av et viktig anatomisk trekk',
  'sammenlignende morfologi',
  'kart',
  'foto eller rekonstruksjon av et miljø',
  'faglig figur',
  'illustrasjon av en mekanisme eller prosess',
]

/**
 * Pictures must be considered before a deck can be called visually planned.
 *
 * The earlier wording asked the agent to «consider actively», which a deck
 * about human evolution answered with one picture: a question with no named
 * candidates is a question that is cheapest to answer no. So the subjects and
 * the picture roles are enumerated here, and the deck-level consequence — a
 * visually concrete subject with nothing planned at all is normally wrong — is
 * stated rather than implied.
 */
export const IMAGE_USAGE_RULE = `Still bildespørsmålet på hver enkelt slide: kan et relevant bilde, en figur eller et utsnitt av et viktig visuelt trekk forklare stoffet bedre enn mer tekst? I visuelt konkrete emner – ${VISUAL_SUBJECTS.join(
  ', ',
)} – er svaret normalt ja på flere slides, og et slikt dekk som ender uten et eneste planlagt bilde er som regel feil. Let konkret etter ${IMAGE_ROLES.slice(
  0,
  -1,
).join(', ')} og ${
  IMAGE_ROLES[IMAGE_ROLES.length - 1]
}. Mangler du en rastergenerator, skal du ikke droppe relevante bilder: reserver sonen, skriv bildenotatet med en konkret prompt, og gi dekket én felles bildebrief så snart minst ett generert rasterbilde er planlagt – også om det bare er ett.`

/**
 * The short form, for the agent that has not yet decided it needs a picture.
 *
 * Long enough to make the choice, short enough for a system instruction; the
 * halves below carry the rest, each on the tool that stores or plans that kind.
 */
export const IMAGE_POLICY_SUMMARY =
  'Vektor og raster er ikke samme verktøy. Grafer, plott, diagrammer, flytskjemaer, enkel ikonografi og geometriske illustrasjoner skal være SVG, og skal forbli SVG. Fotografiske, naturtro, kunstneriske eller visuelt komplekse motiver skal være rasterbilder fra en egnet bildegenerator; har du ingen, planlegger du bildet i stedet for å improvisere en erstatning.'

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
  'Har du ingen generativ bildemodell tilgjengelig, si tydelig fra om begrensningen i stedet for å lage en dårligere erstatning og fremstille den som likeverdig – og legg igjen et bildenotat i sonen bildet skal ha, så brukeren kan lage filen selv og sette den inn i den geometrien du planla.',
]

/* ------------------------------------------------------------------ *
 * Planning a picture that will be made somewhere else
 * ------------------------------------------------------------------ */

/**
 * How an agent reserves a picture's place without pretending to have made it.
 *
 * The concrete answer to the last line of `RASTER_POLICY`. Saying «I have no
 * image model» is honest but leaves the deck with a hole; this is what to do
 * instead, and it rides on `set_zone_card` — the call that creates a note —
 * rather than in the instructions, because it is only actionable once the
 * agent is already choosing what a particular zone holds.
 *
 * The two halves that make it work are the two things an agent would otherwise
 * get wrong: the zone has to be big enough for the *picture*, not for the note
 * (a note has no minimum size at all), and the style belongs in the deck's one
 * brief rather than repeated in every prompt.
 */
export const IMAGE_NOTE_POLICY: readonly string[] = [
  'Et notat med `notePurpose: "image-prompt"` reserverer geometrien til et bilde som skal lages et annet sted: komponer sliden ferdig, lag sonen bildet skal ha, og skriv prompten i notatet.',
  'Opprett et slikt notat i en sone der `image` faktisk er en tillatt innholdstype – notatet selv har ingen minstestørrelse, men bildet som skal overta sonen har det.',
  'Når notatet ligger der, svarer inspeksjonen med `reservedImageFits`: er den false, er reservasjonen for liten til å bli et bilde, og sonen må få mer plass før du går videre.',
  'Skriv motivet, de viktige objektene, handlingen, nødvendig faglig presisjon, komposisjonen, kameravinkelen når den betyr noe, hvilken del av bildet som skal bære tyngden, ønsket format eller orientering tilpasset sonens rektangel, nødvendig negativ plass, og hva som ikke skal forekomme i akkurat dette bildet.',
  'Ikke gjenta dekkets felles bildebrief i hvert notat: den ligger allerede i konteksten der bildet lages, og notatet beskriver motivet.',
]

/**
 * The deck's shared visual premise, on the tool that writes it.
 *
 * One brief per presentation, written before the individual prompts, because
 * its whole purpose is that the pictures come back looking like one deck rather
 * than like several.
 */
export const IMAGE_BRIEF_RULE =
  'Skriv dekkets felles bildebrief før de enkelte bildepromptene: den beskriver hvordan bildene skal se ut – uttrykk, realismegrad, lyssetting, kontrast, tidsperiode, miljø, bakgrunnskarakter, detaljnivå, fargeholdning, komposisjonsprinsipper, hvordan mennesker, dyr og gjenstander fremstilles, og hva som konsekvent skal unngås – og aldri hva et enkelt bilde skal vise. Motivene hører hjemme i notatet i den enkelte sonen.'

/** Where the same thinking is written out at length, for a reader. */
export const DESIGN_DOCS_PATH = 'docs/AGENT_PRESENTATION_DESIGN.md'
