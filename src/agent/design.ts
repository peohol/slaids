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
 *
 * A later deck on the same subject failed in the opposite direction: given a
 * looser vector policy, an agent that had just been told to plan pictures drew
 * each slide — heading, cards, paragraphs, illustrations and all — as one large
 * SVG, and drew its bibliography the same way. Nothing was invalid; the tree
 * Slaids can inspect had almost nothing in it, because the slide was a picture
 * of a slide rather than one. `NATIVE_COMPOSITION_RULE` exists because a rule
 * that only tightens *which* motifs get to be SVG does not stop an agent from
 * using SVG to skip the zone tree altogether — that has to be said as its own,
 * prior rule. `REFERENCE_SYSTEM_RULE` exists for the same reason on the
 * bibliography: Slaids already had a citation system nothing pointed the agent
 * at, so it built one from scratch, out of exactly the material a citation
 * cannot fit inside — the SVG text a validator does not read.
 *
 * The version after that failed twice more, and both failures were about a
 * default rather than a missing rule.
 *
 *  - **Text.** «A container is a legitimate choice» left the agent a sentence
 *    to quote every time a slide was hard to decompose, and the deck came back
 *    as one big transparent field per slide. So the default is stated the other
 *    way round now: primary text content is a `titled-card` unless there is a
 *    reason it is not — `PRIMARY_TEXT_RULE` — and a container is named for what
 *    it is actually good at, which is small supporting text that must *not*
 *    read as a unit of its own.
 *  - **Pictures.** The note workflow asked an agent to park a prompt in a zone
 *    and write a separate «shared style» brief, and the two drifted apart: wide
 *    prompts for near-square zones, motifs described in one place and shape in
 *    another, and a brief nobody could paste anywhere. Notes are gone. A picture
 *    is planned as a real picture zone plus an entry in `domain/imagePlan.ts`,
 *    the aspect ratio is measured off the zone rather than described, and the
 *    deck's one brief is generated from the plan — see `IMAGE_PLACEHOLDER_POLICY`
 *    and `IMAGE_BRIEF_RULE`.
 *
 * `ZONE_SELF_CHECK` and `DECK_SELF_CHECK` are the other half of that, and they
 * end deliberately: a checklist with no stopping point is a revision loop, and
 * an agent in one never delivers.
 */

/*
 * The two lists below are the domain's, not this module's. They are what the
 * deck's own `workflow` status reports back after a plan is written, and the
 * standing instruction and that answer have to be the same list — see
 * `IMAGE_WORKFLOW_CONTINUATION_RULE`.
 */
import {
  IMAGE_WORKFLOW_COMPLETION_CRITERIA,
  IMAGE_WORKFLOW_FORBIDDEN_CLOSINGS,
} from '../domain/imageWorkflow'

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
 * The rule a model has to have before it draws anything at all.
 *
 * Every other rule in this module assumes the agent is building with Slaids'
 * own zone tree and content kinds. This is the one that says so directly,
 * because the failure it answers was not a bad choice of motif — it was
 * building the slide *outside* the tree that a raster or an SVG file is
 * supposed to fill one zone of. Stated first and before `SEMANTIC_DECOMPOSITION`
 * would put it before the agent has any material to decompose; stated here,
 * right after, it is the answer to the question decomposition produces —
 * *express these units with*, and the answer is Slaids' own tree, not markup
 * that reimplements one.
 */
export const NATIVE_COMPOSITION_RULE =
  'Slidegeometrien er alltid Slaids sitt sonetre. Slideoverskriften er Slaids sin slide-tittel, brødtekst er Slaids-tekst, og kort og korttitler er Slaids sine egne innholdstyper; farger, grupperinger og sammenligninger bygges med Slaids sine egne mekanismer – splitter, vekter, kort og fargevalg – ikke ved å tegne dem opp. Et bilde eller en SVG fyller bare den visuelle rollen til sonen den ligger i. En SVG skal aldri brukes for å omgå sonetreet eller gjenskape noe Slaids allerede har som egen innholdstype – det gjelder slideoverskriften, vanlige tekstblokker, kort, korttitler og hele layoutgrid. Anti-mønsteret er én stor SVG som tegner flere kort, overskrifter, avsnitt og illustrasjoner som eneste innhold på en slide: det er en alternativ slide-motor, ikke en figur i en sone.'

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

/**
 * The default for primary text, said as a default rather than as a preference.
 *
 * The rule this replaces listed three kinds and left the choice open, and an
 * open choice with one cheap answer is not a choice: the cheap answer is
 * whatever a zone becomes when text is written into it, which is a container.
 * So the order is fixed here — a framed card with a title is what primary text
 * *is*, and the other two kinds are each named by the narrow case they answer.
 *
 * «Primary text» is the deliberate limit: the material the audience is there to
 * read. A running head, a source line, a unit label, a caveat under a figure is
 * not primary text, and that is exactly what a container is for.
 */
export const PRIMARY_TEXT_RULE =
  'Primært tekstinnhold skal som hovedregel være `titled-card`: et kort med en kort korttittel som sier hva innholdet er. Korttittelen er kortets hovedoverskrift, og den gir publikum noe å skanne etter i stedet for en setningsstart inne i en tekstblokk. `untitled-card` er unntaket, og bare der selve utsagnet er budskapet og en tittel ville vært støy – ett tall, én formulering, ett sitat. `container` er nesten aldri riktig for primært tekstinnhold: den er et tydelig sekundært format for små støttefelt, bildeforklaringer, fotnotepregede felt, kildehenvisninger og annet som bevisst ikke skal fremstå som en selvstendig enhet. Velger du `container` eller `untitled-card` til hovedinnholdet på en slide, skal du kunne si hvorfor en korttittel ville gjort sliden dårligere.'

/**
 * What the rich-text accent is, and what it is not.
 *
 * The stored node is still a heading — it is the same ProseMirror node it
 * always was, and renaming it would be a migration for nothing. What was wrong
 * was the *word*: an agent told it had a «heading» available inside a text
 * field uses it as the heading of the thing, and then the card it sits in needs
 * no title, and the deck loses its framing all over again. Calling it an accent
 * puts it where it belongs — one level below the card title — and makes the
 * card title the only heading a card has.
 */
export const ACCENT_RULE =
  'Inne i et tekstfelt er den fremhevede tekstblokken en *aksent*: en underoverskrift, et fremhevet poeng eller en intern oppdeling av et kort. Den er ikke kortets hovedoverskrift. Kortets hovedoverskrift er korttittelen på et `titled-card`, og et kort som trenger en overskrift skal ha korttittel – ikke en aksent som later som den er én. Bruk aksenter til å dele opp et kort som rommer flere navngitte delpoenger, og til å løfte frem det ene som bærer resten.'

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
 * Whether a named unit gets a frame, and which frame.
 *
 * In the instructions rather than on `set_zone_card`, unlike the rest of the
 * content-kind detail, because it is not a detail — it is the decision the
 * decomposition step feeds directly into, and an agent that has not made it
 * before it starts writing text has already made it by default. The observed
 * failure is precisely that: a deck about named species in which every species
 * is a sentence inside a transparent container, because a container is what a
 * zone becomes when nobody chooses.
 *
 * Stated by *role* rather than by content kind, because the two are not the
 * same question. Framing a named peer is the rule; whether that peer's body is
 * text or a picture is what picks `titled-card` or `titled-image-card`. Said
 * only about text, the rule would collide with the picture rules on exactly the
 * decks it exists for — three named species, which are both named peers and a
 * subject where pictures belong — and an agent reading a collision falls back
 * to the kind that needs no decision.
 */
export const CARD_FRAMING_RULE = `Består sliden av flere navngitte, parallelle enheter – ${NAMED_UNITS.slice(
  0,
  -1,
).join(', ')} eller ${
  NAMED_UNITS[NAMED_UNITS.length - 1]
} – skal hver enhet normalt rammes inn med enhetens navn som korttittel: \`titled-card\` når enheten bæres av tekst, og \`titled-image-card\` når det er bildet som bærer den. Da ser publikum at enhetene er likeverdige, og navnet blir noe å skanne etter i stedet for en setningsstart inne i en tekstblokk. Korttittelen står på én linje og brytes ikke: får det fulle navnet ikke plass, kort ned tittelen og la den fulle formen stå i teksten – en avvist korttittel er aldri en grunn til å droppe rammen. Et bart \`image\` hører hjemme der bildet står alene og bærer sitt eget budskap, ikke der det er ett navngitt medlem blant flere. \`container\` er aldri svaret på en navngitt enhet: den er det sekundære formatet for støttetekst, ikke en måte å slippe å navngi enhetene på.`

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
  'Ender flere slides på rad som «én stor tekstsone med overskrift og tekst eller punktliste», har du sannsynligvis oversett semantisk struktur: dekomponer de slidene på nytt, del innholdet i mindre enheter, og gi hver enhet sin egen korttittel. Én udelt tekstsone som hele slidens innhold er sjelden riktig svar mer enn én eller to ganger i et dekk. Dette er en kvalitetsregel, ikke et krav om kunstig layoutvariasjon.'

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
  'Beholderen du får når du skriver tekst i en tom sone er utgangspunktet Slaids må velge for å ha et sted å legge teksten – den er ikke et designvalg du har tatt, og den er ikke standardformatet for primært tekstinnhold. Sett innholdstypen først og skriv teksten etterpå. Gjør du ikke det, ender dekket som en rekke gjennomsiktige containere ingen har bestemt seg for.'

/**
 * Which content kind a semantic role asks for.
 *
 * Detail rather than doctrine, so it rides on `set_zone_card` — the call where
 * the choice is actually made — instead of taking up room in the instructions.
 */
export const CONTENT_KIND_RULE =
  'Velg innholdstype etter semantisk rolle, ikke etter hvor mye tekst sonen har. `titled-card` er hovedvalget for primært tekstinnhold: korttittelen er navnet på enheten kortet viser, er kortets hovedoverskrift og skal være kort nok til å skannes. `untitled-card` er unntaket, der innholdet selv er budskapet og en etikett bare ville vært støy. `container` er det sekundære formatet: små støttefelt, fotnotepregede felt og deler som bevisst ikke skal fremstå som selvstendige enheter. `image` er bildet som står alene og bærer sitt eget budskap; `titled-image-card` er det samme bildet som ett navngitt medlem i en serie eller katalog. Begge bildetypene kan opprettes tomme og venter da på filen – det er slik en bildesone planlegges.'

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
}. Relevante rasterbilder skal planlegges som ekte bildesoner og legges inn i dekkets bildeplan; skriv dekkets felles bildekontekst så snart minst ett rasterbilde er planlagt – også om det bare er ett.`

/**
 * The short form, for the agent that has not yet decided it needs a picture.
 *
 * Long enough to make the choice, short enough for a system instruction; the
 * halves below carry the rest, each on the tool that stores or plans that kind.
 */
export const IMAGE_POLICY_SUMMARY =
  'Vektor og raster er ikke samme verktøy, og SVG er aldri en alternativ slide-motor. Ikoner, grafer, plott, diagrammer, flytskjemaer, kart der vektor passer og enkle skjematiske forklaringsfigurer skal være SVG, og skal forbli SVG. Illustrasjonsbilder er normalvalget rasterbilder – mennesker, dyr, natur, bygninger, miljøer, gjenstander, historiske scener og andre motiver som først og fremst skal illustrere, ikke diagrammatisere – og skal ikke erstattes av SVG bare fordi SVG kan produseres direkte.'

/** The fixed raster planning and client hand-off contract. */
export const RASTER_WORKFLOW_RULE =
  'Slaids-agent-API-et lager ikke rasterbilder; det er et bevisst arkitekturvalg, ikke en manglende funksjon som skal oppdages. Ikke undersøk om Slaids eller vertsklienten «har en bildegenerator» før du planlegger. Rasterflyten er alltid: reserver ekte bildesoner, skriv bildeplan og felles bildekontekst, og la Slaids generere den samlede bildebriefen. Dette er standardflyten, ikke en fallback eller nødløsning. Har dekket planlagte rasterbilder, skal de genereres – det gjelder alltid når brukerbestillingen forutsetter bilder for å være oppfylt, også formuleringer som «med bilder», «bruk bilder» eller «bilder i hvert steg», men planlagte bildesoner er i seg selv nok. Når vertsklienten har et separat, innebygd bildegenereringsverktøy, skal selve genereringen vente til presentasjonstilstanden er endelig – den skal vente, ikke utgå. En brief hentet mens det fortsatt gjenstår citations, innholdsendringer, validering eller reparasjoner, eller visuell QA som kan endre bildesoner, er foreløpig og skal ikke sendes til bildegeneratoren. Etter at disse stegene er ferdige og bildesonene er stabile, hent en fersk ferdig brief fra den endelige presentasjonstilstanden. Først da er neste handling obligatorisk: skriv den returnerte briefen ut i samme samtale, og kall deretter umiddelbart vertsklientens bildegenereringsverktøy – ett kall per planlagt bilde, slik bildegenereringskontrakten under sier. At briefen finnes i verktøyresponsen er ikke en overlevering, og at briefen bare er skrevet ut i samtalen betyr ikke at genereringen er startet; genereringen er først startet når bildegenereringsverktøyet faktisk er kalt. Ikke avslutt oppgaven eller kall presentasjonen ferdig før alle disse kallene er gjort og antallet ferdige bildefiler er kontrollert, sammen med koblingen mellom hver fil og bildeplanoppføringen den ble generert fra. Ikke gjør endringer som påvirker bildeplanen etter handoff; hvis det likevel skjer, hent en ny fersk sluttbrief og start bildegenereringen på nytt. Hvis klienten ikke kan gjøre denne overleveringen direkte, er den samme sluttbriefen fortsatt normal leveranse til stedet rasterfilene produseres. Direkte overlevering av briefen automatiserer bare starten på bildegenereringen; uten en filbro tilbake til Slaids går de ferdige filene fortsatt via bildedeponeringen. Ikke bytt til en hjemmelaget erstatning eller et abstrakt diagram bare fordi rasterfilen produseres utenfor Slaids.'

/** The vector half, on the tool that writes markup. */
export const VECTOR_POLICY: readonly string[] = [
  'Bruk SVG til grafikk som faktisk bør være vektor: grafer, plott, ekte diagrammer, flytskjemaer, kart der vektor er hensiktsmessig, geometriske forklaringsfigurer, enkel ikonografi og enkle skjematiske illustrasjoner der poenget er struktur, ikke naturtro gjengivelse.',
  'SVG skal beholdes som SVG. Ikke rasteriser en SVG bare for å gjøre den om til «et bilde».',
  'Ikke etterlign fotografiske, naturtro eller organiske motiver med hjemmelaget SVG, og ikke bruk SVG som en generell erstatning for illustrasjonsbilder.',
  'En SVG skal aldri erstatte selve sliden, slideoverskriften, en vanlig tekstblokk, et kort eller en korttittel, eller tegne opp et layoutgrid Slaids selv kan bygge. Det gjelder også litteraturlister og teksttunge infografikker som i praksis erstatter Slaids-innhold – anti-mønsteret er én stor SVG med flere tegnede kort, overskrifter, avsnitt og illustrasjoner som eneste innhold på en slide.',
  'Tekst inne i en SVG skal normalt bare være korte etiketter som er en integrert del av selve figuren – akseetiketter, diagramnoder, kartetiketter eller navn på deler i en skjematisk figur – aldri løpende brødtekst eller faktapåstander som burde hatt en citation.',
]

/** The raster half, on the tool that takes a finished file. */
export const RASTER_POLICY: readonly string[] = [
  'Illustrasjonsbilder er normalvalget rasterbilder, ikke SVG: mennesker, dyr, natur, bygninger, arkitektur, miljøer og interiører, mat, gjenstander, produkter, historiske scener, rekonstruerte situasjoner og andre motiver som skal illustrere rikt eller stemningsbærende, ikke diagrammatisere.',
  'Fotografiske, naturtro, kunstneriske eller visuelt komplekse illustrasjoner skal normalt være rasterbilder laget av en egnet bildegenerator.',
  'Ikke lever en hjemmelaget, rasterisert SVG i stedet for et slikt bilde. En enkel vektortegning er ikke en akseptabel erstatning for et illustrasjonsbilde, uansett om motivet er et menneske, et bygg, et produkt, en historisk scene eller et annet konkret motiv.',
  'Hvor rasterfilen senere produseres endrer ikke medievalget: et planlagt rastermotiv skal fortsatt være raster og skal ikke erstattes av en hjemmelaget SVG eller et abstrakt diagram bare fordi rasterfilen produseres utenfor Slaids.',
]

/* ------------------------------------------------------------------ *
 * Planning the pictures that will be made somewhere else
 * ------------------------------------------------------------------ */

/**
 * How an agent plans a picture without pretending to have made one.
 *
 * The concrete answer to the last line of `RASTER_POLICY`. What this replaces
 * was a note parked in the zone with a prompt in it, and it failed in a way
 * worth naming: the note drew nothing and had no minimum size, so the zone kept
 * shrinking under it; the prompt described a shape in prose while the zone had
 * a shape of its own; and the deck's «brief» was a style paragraph the author
 * could not paste anywhere on its own.
 *
 * So the reservation is now a real picture zone — `image` or
 * `titled-image-card` with no file in it — which has a picture's minimum size
 * and a picture's rectangle, and everything about *what* the picture shows goes
 * into the deck's image plan, addressed by that zone. The shape is never
 * described: it is measured off the zone and printed into the brief.
 */
export const IMAGE_PLACEHOLDER_POLICY: readonly string[] = [
  'Avgjør først om sliden trenger bilde i det hele tatt, og hva bildet skal gjøre. Planlegg deretter sonetreet slik at bildesonen faktisk passer motivet: et stående motiv trenger en høy sone, en vid scene en bred sone. Passer ikke sonens format til motivet, skal sonene planlegges på nytt – ikke motivet presses inn i feil rektangel.',
  'Reserver sonen ved å sette innholdstypen til `image` eller `titled-image-card` uten fil. Sonen venter da på bildet, har en bildesones minstestørrelse, og `reservedImageKinds` i inspeksjonen sier hvilke bildetyper rektangelet faktisk rommer. En tom liste betyr at sonen er blitt for liten til noe bilde.',
  'Bruk `titled-image-card` når bildet er ett navngitt medlem i en serie eller katalog, og `image` når bildet står alene og bærer sitt eget budskap.',
  'Selve motivet skriver du ikke inn i sonen. Det hører hjemme i dekkets bildeplan, én oppføring per bildesone, og planen er det den samlede bildebriefen genereres fra.',
  'Når bildeplanen skrives, får hver ufylte bildesone automatisk en plassholder-bildetekst – «Sett inn bilde 1 her», «Sett inn bilde 2 her» og så videre – som følger nummereringen i briefen. Bildeteksten forsvinner av seg selv når filen legges inn. Ikke skriv slike plassholdere for hånd.',
]

/**
 * The deck's shared visual context, on the tool that writes it.
 *
 * Narrower than the brief it feeds: this is the part that is true of every
 * picture in the deck, and nothing else. The individual motifs live in the
 * plan, and the reason to keep them apart is mechanical rather than stylistic —
 * a context that describes one picture overrides the entry for that picture
 * when the two are concatenated, which is a failure `checkImagePlan` looks for
 * by name.
 */
export const IMAGE_BRIEF_RULE =
  'Den felles bildekonteksten beskriver hvordan bildene i dekket skal se ut – uttrykk, realismegrad, lyssetting, kontrast, tidsperiode, miljø, bakgrunnskarakter, detaljnivå, fargeholdning, komposisjonsprinsipper, hvordan mennesker, dyr og gjenstander fremstilles, og hva som konsekvent skal unngås – og aldri hva et enkelt bilde skal vise. Skriv den før eller sammen med bildeplanen. Den blir seksjonen «FELLES BILDEKONTEKST» i dekkets ene samlede bildebrief; motivene kommer fra bildeplanen, og formatene måles av Slaids ut fra sonene. Du skriver aldri den samlede briefen selv, og du oppgir aldri aspect ratio i fritekst.'

/**
 * What the generated brief guarantees, and therefore what is left to check.
 *
 * On the tool that writes the plan. The count, the numbering, the aspect ratios
 * and the separate-images instruction are Slaids' own — an agent that restates
 * them in prose is adding a second, weaker copy. What is genuinely the agent's
 * is the part no template can derive: whether two motifs are actually different
 * things, and whether the shape a motif needs is the shape the zone has.
 */
export const IMAGE_PLAN_RULE =
  'Bildeplanen har én oppføring per bildesone som venter på en fil, med motiv, komposisjon og utsnitt, faglige krav, og hva som skal unngås i akkurat det bildet. Slaids teller bildene, nummererer dem i dekkets rekkefølge, måler aspect ratio fra hver sones faktiske geometri og setter sammen den samlede briefen – så du skal verken skrive antall, nummer, formater eller regler om separate bilder inn i teksten din. Motiv og komposisjon er påkrevd i hver oppføring: motivet er det som skiller to bilder fra hverandre, og komposisjonen er det sonens format kontrolleres mot. Faglige krav og «unngå» er valgfrie, og briefen utelater dem når de er tomme. Skriv motivene slik at to bilder som skal vise forskjellige ting faktisk beskrives forskjellig, og slik at komposisjonen passer sonens format. Har du flyttet slides etter at planen ble skrevet, skriv den på nytt: nummereringen følger dekket, og plassholderteksten i sonene settes samtidig. Les kontrollene i svaret og rett det de peker på; er listen tom, er bildeplanen klar til bildegenerering – ikke ferdig som leveranse. Svarets `workflow` sier hva som gjenstår.'

/**
 * How the plan is carried out, once the pictures are actually being made.
 *
 * `IMAGE_PLAN_RULE` says what goes *into* the plan. This says what comes out of
 * it, and it exists because of one observed failure rather than as a matter of
 * taste: Slaids planned eight pictures, the answer carried both the structured
 * `images` list and the composed brief, and the host client sent the brief on
 * as a single image-generation job. One storyboard came back — eight motifs on
 * one canvas, one file, no number on anything, and nothing the deposit could
 * place.
 *
 * So the two halves of the answer are given different jobs, in the plainest
 * terms available: the structured list is the contract a machine executes, one
 * entry at a time, and the brief is the same plan written for a person. The
 * count is not left to be inferred from the prose either — `generation`
 * carries it, so «are we finished» is a comparison rather than an impression.
 *
 * Deliberately not a restatement of what the response already says. The numbers
 * come from the deck (`composeImageGenerationContract`); what this adds is the
 * one thing no field can state about itself — that an entry is a *job*, and
 * that the brief is not one.
 */
export const IMAGE_GENERATION_RULE =
  'Når bildene faktisk skal genereres, er den strukturerte `images`-listen i svaret den autoritative kilden: ett element i `images` = én selvstendig bildegenerering = én bildefil. Er `imageCount` 8, skal bildegeneratoren kalles 8 ganger og resultatet være 8 separate bildefiler. Arbeid oppføringene i stigende `number`, og fullfør én av gangen: les bare den ene oppføringens felter sammen med dekkets felles `imageContext`, kall bildegeneratoren én gang for akkurat den, knytt filen som kommer tilbake til den samme `imagePlanItemId`, regn ut SHA-256 av bytene den returnerte med en gang, og gi filen oppføringens eget filnavn – og gå først deretter videre til neste oppføring. Genereringsrekkefølgen er aldri en identitetskilde: rekkefølgen bildene blir ferdige i, returneres i eller vises i sier ingenting om hvilken oppføring de hører til, «det første bildet som kom tilbake» er aldri bilde 1, og et bilde skal aldri nummereres etter når det ble ferdig. Instruksen for ett bilde bygger du av feltene på den ene oppføringen – `imagePlanItemId`, `number`, `fileName`, `slideId`, `nodeId`, `slideLabel`, `aspectRatio`, `orientation`, `subject`, `composition`, `requirements`, `avoid` – sammen med dekkets felles `imageContext`, og formatet er `aspectRatio` fra den samme oppføringen, aldri et felles format for flere bilder. Den samlede `brief`-teksten er den menneskelesbare representasjonen av nøyaktig den samme planen: skriv den ut i samtalen, bruk den til manuell kopiering og som dokumentasjon, men send den aldri til bildegeneratoren som én samlet genereringsjobb når flere bilder er planlagt, og parse den aldri tilbake til enkeltbilder – informasjonen ligger allerede strukturert i `images`. Behold koblingen gjennom hele flyten: planlagt bilde 1 blir fil `1`, bilde 2 blir fil `2` og så videre, med filendelsen til formatet filen faktisk har, og filnavnet kommer alltid fra oppføringens `number` – aldri fra en teller over de ferdige filene. Kontroller antallet før deponering: det skal finnes like mange separate bildefiler som `generation.expectedFileCount`, med numrene 1‥N én gang hver og hver `imagePlanItemId` brukt nøyaktig én gang. Ett samlet collage-, storyboard-, kontaktark-, split-screen- eller infografikkbilde er aldri et gyldig svar på en plan med flere bilder, uansett hvor mange motiver det inneholder. Er antallet, nummereringen, koblingen eller formatet feil, er bildegenereringen ikke ferdig: generer de manglende bildene enkeltvis på nytt før du går videre til bildedeponeringen.'

/**
 * The rule that makes the plan a step rather than a delivery.
 *
 * Everything else in this flow describes how to do the work well. This one says
 * that the work is not over, and it exists because that turned out to be the
 * part no other rule covered: an agent asked for an illustrated talk built the
 * deck, wrote the plan, received an answer full of instructions about
 * generating the pictures, and closed the turn with «the presentation is
 * created, the pictures are not inserted yet». Every individual rule had been
 * followed. Nothing had told it that stopping there was the failure.
 *
 * Three things are said here that are said nowhere else. That the plan is an
 * intermediate step, in those words. That the deck's own `workflow.complete` is
 * what decides whether the task may be closed, so the decision is a field
 * rather than an impression. And that the endings which describe unfinished
 * work — all of them true sentences — are exactly the endings that are wrong,
 * because a true description of a half-finished job is the most natural thing
 * to write when stopping early.
 *
 * The criteria and the endings come from `domain/imagePlan.ts`, where the
 * status is computed: the standing instruction and this deck's own answer must
 * be the same list, or a delivery can satisfy one of them.
 */
export const IMAGE_WORKFLOW_CONTINUATION_RULE = `Bildeplanen er aldri et sluttpunkt. Bildeplanleggingen er et mellomsteg: så snart dekket har planlagte rasterbilder, er neste steg bildegenereringen – i samme samtale, uten å vente på en ny brukerbeskjed. Har en planlagt sone alt et bilde, sier \`workflow\` \`plan-outdated\`, og da finnes det to tilfeller som krever motsatt handling – \`nextAction\` sier hvilket: er filen i sonen laget for en bestilling som siden er skrevet om (koblingskontrollen svarer \`PLAN_CHANGED\`), skal sonen bli stående i planen og erstatningen genereres, og da genererer du hele planen, for kontrollen venter én fil per planlagt oppføring – også for soner som alt har et bilde. Er det derimot ingen kobling som gjør rede for filen, er proveniensen ukjent, og da skriver du planen på nytt med bare sonene som fortsatt venter. Følg \`nextAction\`, ikke gjetningen om hvilket av de to det er. «I samme samtale» betyr ikke før resten av presentasjonsarbeidet er ferdig: fullfør innhold, citations, validering/reparasjoner og visuell QA først, og gå deretter videre til brief og generering i den samme sammenhengende arbeidsøkten – ikke i en ny. Svaret fra bildeplanen, fra bildebriefen og fra koblingskontrollen bærer \`workflow\` med dekkets egen status, og den avgjør om oppgaven kan avsluttes: \`complete: false\` betyr at oppgaven ikke er ferdig, uansett hvor komplett slidene ser ut. Hva som skal gjøres nå, sier alltid \`nextAction\` og \`remainingSteps\` – \`complete: false\` i seg selv er ikke et signal om å generere: stadiet kan være \`plan-needs-repair\` eller \`plan-outdated\`, og da skal planen repareres eller skrives om **før** noe genereres. Krever statusen generering – \`awaiting-generation\`, eller superseded-varianten av \`plan-outdated\`, eller et reparert/omskrevet plandekk som er kommet dit – gjør du dette i tur: skriv ut den ferdige bildebriefen i samtalen, start bildegenereringen umiddelbart, generer bildene enkeltvis med ett kall per bildeoppføring, og fortsett til hvert planlagt bilde har sin egen fil. Slå aldri flere planlagte bilder sammen til ett bilde. Hver oppførings eget nummer, \`imagePlanItemId\`, motiv og aspect ratio er fasit; rekkefølgen bildene returneres i er irrelevant, og hvert ferdig bilde kobles til riktig oppføring før det neste genereres. Bildegenereringen er ferdig når koblingskontrollen svarer \`ok\` for alle planlagte oppføringer – ikke når bildesonene er fylt. Svaret blir lagret på dekket, så \`workflow\` husker kontrollen også ved senere lesninger: stadiet er \`awaiting-deposit\` så lenge bildene ikke er på plass i sonene, og \`generation-verified\` når de er det. Skriver du om motiv eller felles bildekontekst etterpå, faller kontrollen bort av seg selv og de bildene skal lages om. Slaids ser aldri en generert fil: uten en filbro kommer filene inn gjennom brukerens bildedeponering i nettleseren, så \`awaitingFileCount\` er hva Slaids mangler, aldri hvor mange bilder du skylder. Et bilde du alt har generert og fått godkjent skal derfor ikke genereres om igjen fordi sonen fortsatt står tom – så lenge du har filen. Kontrollen lagres på dekket og overlever samtalen, men bildefilene gjør ikke det: åpner du et dekk der \`workflow.stage\` er \`awaiting-deposit\` og du ikke har filene fra den forrige samtalen, er den lagrede kontrollen ingen leveranse du kan gjøre – si det til brukeren og lag bildene på nytt for de samme oppføringene, og kontroller koblingen igjen. Derfor er \`remainingSteps\` ikke tom i \`awaiting-deposit\`: den navngir begge tilfellene med betingelsen som velger dem – har du filene, lever dem; har du dem ikke, generer på nytt. \`complete: true\` er en påstand om dokumentet – at planen er dekket av en gyldig, gjeldende genereringskontroll – og alene ingen beskjed om at du kan stoppe; det er \`remainingSteps\` som sier hva som gjenstår for deg. Der listen har to grener, kan Slaids ikke velge mellom dem: du avgjør hvilken som gjelder denne samtalen, utfører den, og avslutter når **den** er gjort. Stoppen er ikke at listen blir tom – den blir ikke tom av at du leverer filene, for det er brukerens deponering som endrer dekket, og å vente på den er aldri ditt arbeid. Meld aldri et dekk ferdig uten å si hva som faktisk gjenstår, og si det slik det er: i \`awaiting-deposit\` står noen bildesoner tomme, andre viser fortsatt bildet fra forrige bestilling, og \`nextAction\` sier hvilket av delene dette dekket har. I \`generation-verified\` er ingen sone tom, og da skal du ikke påstå at noen er det – der er det eneste forbeholdet at Slaids aldri ser selve bildet, så bildene skal ses gjennom. Gjenta dekkets egen tilstand, ikke en fast setning. Oppgaven er først fullført når alt dette er sant: ${IMAGE_WORKFLOW_COMPLETION_CRITERIA.join(
  ' ',
)} ${IMAGE_WORKFLOW_FORBIDDEN_CLOSINGS.join(
  ' ',
)} Blir du faktisk blokkert, navngi blokkeringen konkret – hvilket kall, hvilken feil, hvilket bilde – i stedet for å levere planen som om den var leveransen.`

/**
 * The last thing that happens before the files leave the agent.
 *
 * On the tool that performs the check, not in the instruction, because it is
 * only writable once there are files to write about. It is the half of the fix
 * that is not prose: the agent states its bindings and Slaids compares them
 * against the plan, so «I kept the order» becomes a claim somebody else checks
 * rather than something only the model knows.
 *
 * The manifest is here for one reason. Slaids never sees the files, so the
 * binding has to travel *with* them to survive the trip through a download
 * folder — and the deposit dialog reads exactly the file this produces, through
 * the same module, so there is one definition of a correct delivery and two
 * places that ask it.
 */
export const IMAGE_HANDOFF_RULE =
  'Kjør denne kontrollen når alle bildefilene er ferdige, og før de leveres eller deponeres – aldri underveis. Én oppføring per ferdig fil, med den `imagePlanItemId` filen faktisk ble generert fra: id-en kopieres ordrett fra `images`, den konstrueres ikke og den utledes ikke fra rekkefølgen filene kom i. Oppgi også `contentHash`: SHA-256 av bytene bildegenereringen returnerte for akkurat den oppføringen, regnet ut i det filen kommer tilbake og før neste bilde genereres. Uten det avtrykket er koblingen bare metadata om et filnavn, og et filnavn overlever at innholdet byttes om; et avtrykk beregnet i ettertid fra en mappe med ferdige filer fester i tillegg bare en forveksling som allerede har skjedd. Har du ikke tilgang til bytene, utelat feltet – da svarer kontrollen `check: "unchecked"`, og leveransen skal omtales som uverifisert og overlates til manuell gjennomgang, aldri presenteres som kontrollert. Kontrollen svarer på om alle planlagte id-er finnes nøyaktig én gang, om noen id er ukjent eller gjentatt, om hvert nummer forekommer én gang, om hver id peker på den `slideId` og `nodeId` planen sier, og om filnavnet stemmer med oppføringens nummer. Les `ok` og `check` sammen: `ok: true` betyr bare at ingenting motsier seg selv, og `checkMeans` sier hva nivået faktisk dekker. Er `ok` false, skal bildene ikke deponeres: `issues` sier hvilken oppføring som mangler, er dobbelt, er feilkoblet eller har feil innhold, og de bildene genereres enkeltvis på nytt før kontrollen kjøres igjen. Er `ok` true, følger `manifest` med: lagre den som filen `manifestFileName` sammen med bildefilene, slik at deponeringen kan sammenligne hver fil med sitt eget avtrykk i nettleseren. Går filene til brukeren manuelt, lever den samme filen ved siden av bildene. Selv en kobling som stemmer sier bare hvilken fil som hører til hvilken bildeplass – den sier ingenting om hva bildet viser, så se gjennom bildene i tillegg og si det samme til brukeren.'

/* ------------------------------------------------------------------ *
 * Sources: the reference system, not an authored bibliography slide
 * ------------------------------------------------------------------ */

/**
 * The normal route for a fact that needs a source.
 *
 * The observed deck cited nothing through Slaids and instead drew its own
 * «sources and caveats» slide as a single SVG. That is two failures at once —
 * a bibliography authored by hand instead of derived, and factual claims
 * pushed into the one medium `validate_presentation` cannot read as text — so
 * this says both: the citation system is the default, and prose that needs a
 * source is exactly the prose that must never end up inside SVG markup.
 */
export const REFERENCE_SYSTEM_RULE =
  'Når eksterne kilder brukes til å støtte faktapåstander, registrer dem i Slaids sitt innebygde referansesystem og la de aktuelle tekstblokkene bruke citations som peker på dem – Slaids sine avledede referansesider genererer selve listen. Ikke opprett en egen slide bare for å ramse opp kilder eller en bibliografi; det er en manuell erstatning for noe Slaids allerede genererer. Unntaket er en faglig slide brukeren uttrykkelig har bedt om, som diskuterer f.eks. evidenskvalitet eller metodiske begrensninger – selv da hører selve bibliografien hjemme i referansesystemet, ikke skrevet eller tegnet som en liste på sliden. Faktapåstander som trenger en citation skal derfor aldri bakes inn som tekst i en SVG: det er nettopp den veien som omgår citation-systemet.'

/* ------------------------------------------------------------------ *
 * Rendering as real visual QA
 * ------------------------------------------------------------------ */

/**
 * What structural validity does not cover.
 *
 * The observed deck was structurally valid end to end: every slide passed
 * `validate_presentation`, and text inside its self-authored SVGs was still
 * clipped, uninspected, because a validator only knows the picture's bounding
 * box fit — never what the picture drew inside it. So «valid» cannot be the
 * finishing line; rendering and looking has to be a stated step, not an
 * optional nicety left to whichever agent happens to think of it.
 */
export const VISUAL_QA_RULE =
  'Strukturell validering er nødvendig, men ikke tilstrekkelig. Før du anser presentasjonen ferdig, render representative slides og inspiser dem visuelt. Slides med egenprodusert SVG – særlig SVG med interne etiketter eller tekst – skal inspiseres etter at filen er plassert i sonen: intern beskjæring, tekst som havner utenfor synlig område, uleselige etiketter og feil cropping er nettopp det en validator ikke kan se, fordi den bare vet at selve bildeboksen fikk plass. Rett opp det du finner før du leverer.'

/* ------------------------------------------------------------------ *
 * The two self-checks, and where they stop
 * ------------------------------------------------------------------ */

/**
 * Four questions per text zone, asked while the zone is still cheap to change.
 *
 * A checklist rather than another rule, because the rules are already stated
 * and the failure was never that the agent disagreed with them — it was that
 * nothing made it look back at what it had just written. Each question names
 * one concrete defect and its repair, in the order the repairs get more
 * expensive: change the kind, move the heading, split the zone, divide the
 * inside.
 */
export const ZONE_SELF_CHECK: readonly string[] = [
  'Har jeg brukt `container` eller `untitled-card` der dette egentlig burde vært et `titled-card`?',
  'Har jeg brukt en aksent som om den var kortets hovedoverskrift, der korttittelen skulle båret navnet?',
  'Kunne dette tekstinnholdet vært fordelt på flere mindre soner med hver sin korttittel?',
  'Hvis ikke: kunne sonen likevel fått bedre intern oppdeling med subfelter og aksenter?',
]

/**
 * The pass over the finished draft, and the sentence that ends it.
 *
 * The last line is load-bearing. A quality checklist with no stopping point is
 * a revision loop, and an agent in one keeps improving a deck nobody has
 * received — so «stop when these are answered» is part of the check rather
 * than advice around it.
 */
export const DECK_SELF_CHECK: readonly string[] = [
  'Har semantisk like elementer fått lik visuell behandling gjennom hele presentasjonen?',
  'Passer fargevalgene til temaene og strukturen, og bærer de mening i stedet for å være dekorasjon?',
  'Har flere slides falt tilbake til det samme standardmønsteret uten god grunn?',
  'Er bildeplanen i samsvar med sonene: én oppføring per bildesone som venter på en fil, og ingen sone uten oppføring?',
  'Stemmer hvert planlagt motiv med formatet på sonen det skal ligge i?',
  'Er to planlagte bilder blitt så like at de i praksis beskriver nesten samme motiv?',
]

/** The stopping point, said once and on purpose. */
export const SELF_CHECK_STOP =
  'Når kontrollpunktene er besvart, det du fant er rettet og du har gjort det `workflow.remainingSteps` krever av deg, er **ditt** arbeid ferdig: ikke start en ny forbedringsrunde uten at det er kommet en ny instruks eller et nytt funn – dette er en sluttkontroll, ikke en åpen sløyfe. Det er `remainingSteps` som avgjør det, ikke `complete` alene: `complete` er en påstand om dokumentet – at bildeplanen er dekket av en gyldig, gjeldende genereringskontroll – og kontrollen lagres på dekket mens bildefilene ikke gjør det. I `no-planned-images` og `generation-verified` er listen tom, og da er både du og dekket ferdig. I `awaiting-deposit` er den ikke tom, og de to stegene er alternativer Slaids ikke kan velge mellom, fordi betingelsen er noe bare du kan se: du velger den grenen som gjelder denne samtalen, utfører den, og avslutter når **den** er gjort – ikke når listen blir tom, for den blir ikke tom av det du gjør. Har du bildefilene fra genereringen, lever dem med manifestet og si hva brukeren skal gjøre – da har du gjort ditt, mens bildene fortsatt mangler i dekket, og da skal du ikke si at presentasjonen er ferdig, og ikke vente på at brukeren deponerer dem. Har du dem ikke, fordi dekket er åpnet i en senere samtale, er den lagrede kontrollen ingen leveranse du kan gjøre: da gjenstår det agentarbeid, og du genererer de samme oppføringene på nytt og kontrollerer koblingen igjen før du avslutter. Uansett hvilken av de to: si hva som gjenstår og hvem som gjør det, slik `nextAction` beskriver.'

/** Where the same thinking is written out at length, for a reader. */
export const DESIGN_DOCS_PATH = 'docs/AGENT_PRESENTATION_DESIGN.md'
