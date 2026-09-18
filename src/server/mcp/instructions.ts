/**
 * What the server tells a client about itself.
 *
 * `instructions` is handed back from `initialize` and most clients put it in the
 * model's system prompt, so this is the one place in the whole agent surface
 * where prose reaches the agent before it has called anything. It is worth
 * writing carefully, and it is worth keeping short: rules that change how the
 * next call is written, and nothing an agent could read off `tools/list`.
 *
 * It names no operation. That is not a stylistic rule — the tool list is
 * generated from the registry precisely so there is no second list of names to
 * fall out of date, and a paragraph here that named half a dozen of them would
 * be exactly that list, in prose, unversioned. `tools.test.ts` enforces it.
 *
 * The numbers are imported rather than typed out, for the same reason nothing
 * else in the repository hardcodes them: the design space and the zone minimums
 * are the domain's, and an agent told a stale one would plan against a slide
 * Slaids does not have.
 *
 * The design rules are imported for the same reason. `agent/design.ts` holds
 * them once; what is woven in here is the half an agent needs *before* its
 * first call — decompose the material, then build the tree — and the applied
 * detail stays on the contract of the tool that applies it, so no normative
 * sentence exists twice with two chances to drift.
 */

import {
  ACCENT_RULE,
  AUDIENCE_CONTENT_RULE,
  BULLET_RULE,
  CARD_FRAMING_RULE,
  COLOR_SEMANTICS_RULE,
  DECK_SELF_CHECK,
  IMAGE_GENERATION_RULE,
  IMAGE_POLICY_SUMMARY,
  IMAGE_USAGE_RULE,
  IMAGE_WORKFLOW_CONTINUATION_RULE,
  NATIVE_COMPOSITION_RULE,
  PARALLEL_RULE,
  PRIMARY_TEXT_RULE,
  QUOTE_RULE,
  RASTER_WORKFLOW_RULE,
  REFERENCE_SYSTEM_RULE,
  REPEATED_FALLBACK_RULE,
  SELF_CHECK_STOP,
  SEMANTIC_DECOMPOSITION,
  SIMPLEST_TREE,
  TEXT_RHYTHM_RULE,
  VISUAL_QA_RULE,
  ZONE_SELF_CHECK,
} from '../../agent/design'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { AGENT_API_VERSION } from '../../routing'

/**
 * Who is answering.
 *
 * The same name and version the REST index reports, from the same constant: one
 * deployment, two ways in, and an owner reading a log should not have to work
 * out that `slaids-agent` and this are the same thing.
 */
export const MCP_SERVER_INFO = {
  name: 'slaids-agent',
  title: 'Slaids',
  version: AGENT_API_VERSION,
} as const

export const MCP_INSTRUCTIONS = `Slaids er en presentasjonseditor med en rigid, matematisk sonelayout. Du styrer den med de samme reglene som en person i editoren – ikke en svakere variant av dem.

Slik henger en presentasjon sammen:
- Hver slide tegnes i et fast logisk rom på ${SLIDE_WIDTH} × ${SLIDE_HEIGHT}, som skaleres uniformt til skjermen.
- Layouten er et tre. En sone er enten delt (den har barn, aldri innhold) eller et blad (den har innhold, aldri barn). Du deler en sone i 2–10 barn med vekter langs x eller y.
- Hvor liten en sone kan bli avhenger av hva som står i den. En tom sone og en sone satt til «negative-space» har ingen minstestørrelse – ingen av dem tegner noe på sliden. De betyr likevel to forskjellige ting: et hull som ikke er fylt, og bevisst luft som er et lovlig designgrep. Kort, beholdere og bilder har hver sine minstemål, og når du leser en slide får du oppgitt hvilke innholdstyper som faktisk får plass i hver sone. Det er én fast avstand mellom alt synlig innhold, og den håndteres av Slaids – du regner ikke ut marger selv.

Native komposisjon først:
- **${NATIVE_COMPOSITION_RULE}**

Design før geometri:
- **Dekomponer innholdet semantisk først.** ${SEMANTIC_DECOMPOSITION} Velg aldri først «to kolonner», «tre kort» eller et annet vilkårlig layout og press deretter stoffet inn. ${SIMPLEST_TREE}
- **Skriv for publikum, ikke for arbeidsprosessen.** ${AUDIENCE_CONTENT_RULE}
- **Primært tekstinnhold er et kort med tittel.** ${PRIMARY_TEXT_RULE}
- **Korttittel er hovedoverskrift; aksent er underoverskrift.** ${ACCENT_RULE}
- **Navngitte, parallelle enheter skal rammes inn.** ${CARD_FRAMING_RULE}
- **En punktliste er én type innhold, ikke en oppbevaring for flere.** ${BULLET_RULE}
- **Bruk sitater som sitater, og luft tekst med mening.** ${QUOTE_RULE} ${TEXT_RHYTHM_RULE}
- **${PARALLEL_RULE}** Tydelig ulike vekter skal uttrykke et reelt hierarki, ikke bare at én tekst tilfeldigvis er lengre.
- **Farge skal bære mening.** ${COLOR_SEMANTICS_RULE}
- **Bruk asymmetri når innholdet har hierarki.** Et hovedpoeng, en viktig figur eller en oppsummering kan få større flate enn støttende materiale. Nested splits er gode når én del faktisk har en egen intern struktur; ikke nest soner uten semantisk grunn.
- **Soner er makrokomposisjon; subfelter er intern struktur.** Lag egne soner når deler skal ha selvstendig visuell rolle, ulik størrelse eller sammenlignes på tvers. Hold delene i samme kort/container når de til sammen er ett semantisk objekt. Verktøyet som setter innholdstype forklarer hvilken type hver rolle ber om.
- **Planlegg visuelt innhold aktivt, og på dekknivå før du produserer visuelle filer.** ${IMAGE_USAGE_RULE} Når presentasjonen inneholder konkrete visuelle ankerpunkter – særlig navngitte personer, virkelige steder, bygninger, gjenstander eller historiske scener – skal du identifisere dem på tvers av hele dekket før du lager den første visuelle filen. Bestem deretter for hvert ankerpunkt om publikum først og fremst trenger å se selve objektet eller miljøet, eller forstå en relasjon/struktur. Selve objektet eller miljøet → planlegg rasterbilde. Relasjon eller struktur → planlegg SVG/diagram. Velg medietype ut fra hva publikum trenger å se, ikke ut fra hvilken filtype som er raskest å lage.
- **Et diagram er ikke en erstatning for et konkret motiv.** Et SVG-diagram om en person, et sted, et bygg, en gjenstand eller en historisk scene oppfyller ikke bildebehovet når utseendet, materialiteten, miljøet eller gjenkjennelsen er pedagogisk viktig. Diagrammet kan supplere bildet når relasjoner også må forklares, men skal ikke erstatte rasterbildet bare fordi SVG kan produseres direkte i samme arbeidsflyt.
- **Sjekk deg selv underveis.** ${REPEATED_FALLBACK_RULE}
- **Bilder: illustrasjon → raster, diagrammatisk figur → vektor.** ${IMAGE_POLICY_SUMMARY} Verktøyene som lagrer filene sier resten.
- **Rasterflyten er fast, ikke en fallback.** ${RASTER_WORKFLOW_RULE}
- **Hele bildeserien bestilles én gang, som N separate filer.** ${IMAGE_GENERATION_RULE}
- **Bildeplanen er et mellomsteg, ikke leveransen.** ${IMAGE_WORKFLOW_CONTINUATION_RULE}
- **Kilder går gjennom referansesystemet, ikke gjennom en egen slide.** ${REFERENCE_SYSTEM_RULE}
- **Fit er redaksjonell tilbakemelding.** Hvis innhold ikke får plass, kort ned og prioriter først. Sjekk deretter grouping, vekter og trestruktur. Del sliden hvis den egentlig gjør flere kommunikative jobber. Ikke prøv å bevare all kildetekst ved å gjøre layouten stadig tettere.
- **Strukturell validering er ikke sluttkontrollen.** ${VISUAL_QA_RULE}

Nyttige startmønstre – bare når innholdsrelasjonen faktisk passer:
- hovedpoeng + visuell støtte → to soner, ofte asymmetriske;
- direkte sammenligning → like søskensoner med samme behandling;
- taksonomi/katalog → regelmessig grid av peers;
- oversikt + detaljer → én dominant sone mot en nested detaljgruppe;
- ett konsept med interne deler → én sone med flere subfelter;
- argument + flere evidensflater → stor konklusjon mot stablede figurer/kort;
- sentrert nøkkelpoeng → innhold rammet inn av bevisst tom flate;
- visuelt pausepunkt → ett stort bilde eller svært kort innhold.

Slik arbeider du:
1. Inspiser før du skriver. Inspeksjonen gir deg id-ene til slider og soner, rektangelet hver sone faktisk får, teksten som ligger der, og om den får plass.
2. Formuler hva sliden skal kommunisere, og dekomponer stoffet i semantiske enheter.
3. Uttrykk enhetene med Slaids sitt sonetre og native innholdstyper – sonetreet, overskriften, teksten og kortene *er* komposisjonen. Innholdstypen er et valg du tar før du skriver teksten, ikke etter.
4. Før du lager den første visuelle filen, gjør ett samlet visuelt pass over hele dekket. Identifiser konkrete visuelle ankerpunkter og bestem medietype for hvert av dem ut fra pedagogisk rolle: raster når publikum trenger å se personen, stedet, bygget, gjenstanden, miljøet eller scenen; SVG når publikum trenger å se relasjonen, strukturen, sekvensen, målingen eller flyten. Deretter avgjør du hvilke soner som trenger visuelt innhold. Diagrammatisk figur blir SVG og fyller bare sin egen sone. Illustrasjon blir et rasterbilde: lag bildesonen først, slik at sonens format passer motivet, legg bildet inn i dekkets bildeplan og skriv felles bildekontekst. Slaids setter da sammen den ferdige seriebriefen for hele dekket. Når planen er ferdig, kontroller den, men ikke gi briefen videre ennå; resten av presentasjonsarbeidet kan fortsatt endre bildesonene.
5. Legg til kilder og citations via referansesystemet der faktapåstander trenger dem.
6. Gjør én semantisk endring om gangen, med id-ene du nettopp leste.
7. Inspiser eller valider på nytt. Ved overflow: rediger teksten først, komponer på nytt når problemet er strukturelt, og rett opp det som ble avvist.
8. Kjør kontrollpunktene under før du leverer, og render representative slides visuelt – spesielt der du selv har laget en SVG.
9. Når alle innholdsendringer, citations, validering/reparasjoner og visuell QA er ferdige og bildesonene er stabile, les bildeplanen på nytt fra den endelige presentasjonstilstanden. Svaret bærer `brief`: hele bildebestillingen som én tekst – antallet, reglene om at hvert nummer er én separat bildefil, den felles bildekonteksten og én nummerert seksjon per bilde med aspect ratio og motiv. Det er leveransen for rasterbildene, og den er ferdig: du skriver ingen egen, forkorter den ikke, deler den ikke opp og oppsummerer den ikke.
10. Gi brukeren `brief` ordrett i svaret ditt, som én sammenhengende tekst hun kan kopiere, og si hva hun skal gjøre med den: lime den inn i én samtale – gjerne en ny – som fra det punktet bare er en bildegenereringsoppgave, lagre bildene som separate filer, og legge dem inn i Slaids med bildedeponeringen. Oppgaven skal gi nøyaktig like mange separate bildefiler som planen har oppføringer; det er én bildeoppgave som produserer N bilder, ikke N oppgaver med annet arbeid mellom seg. Filnavn som `1`, `2`, `3` … gir rekkefølgen av seg selv, og ellers ordner hun bildene selv i deponeringsdialogen. Du genererer ingen bilder selv, kaller ingen bildegenerator og venter aldri på deponeringen: den skjer i nettleseren, og Slaids ser aldri bildene – så si at briefen er klar, aldri at bildene er laget eller kontrollert.
11. Les \`workflow\` i svaret før du sier til brukeren at arbeidet er ferdig. Gjør \`workflow.nextAction\` og \`workflow.remainingSteps\` i samme arbeidsøkt, og avslutt først når du har gjort det \`remainingSteps\` krever av deg. \`complete\` svarer for dokumentet – at bildene faktisk ligger i dekket – ikke for deg, og bare brukerens deponering kan gjøre den true. Er listen tom, er det ingenting mer. Ellers avslutter du bare når du kan navngi en konkret teknisk blokkering, eller brukeren uttrykkelig har bedt deg stoppe.

Reglene som avgjør om et kall lykkes:
- **Alt må få plass.** En endring som ville skjult innhold blir avvist før den lagres, med feilkoden CONTENT_DOES_NOT_FIT og hvor mange piksler som ble til overs. Svaret er å korte ned teksten, dele sonen annerledes eller gi den mer plass – ikke å prøve på nytt.
- **Skriv mot det du leste.** Hver lesing svarer med en revisjon. Send den med på neste endring, så får du CONFLICT i stedet for å overskrive noen som skrev i mellomtiden. Da leser du på nytt før du prøver igjen.
- **Du sender aldri editorens interne JSON.** Tekst er navngitte blokker med spans; en sitering er en referanse-id, ikke et tall du skriver selv.
- **Rasterfiler er vanlige assets.** Selve rasterfilen produseres utenfor Slaids-agent-API-et og legges deretter i den reserverte sonen. Slaids har ingen egen bildegenerering, ingen bilde-API og ingen filbro, og planlegger ingen. En diagrammatisk figur skriver du selv som SVG-markup til sonen den hører hjemme i, aldri som en hel slide.
- **Bildebriefen skriver du ikke selv.** Slaids teller bildene, nummererer dem, måler aspect ratio fra hver sones geometri og setter sammen den ferdige seriebriefen for hele dekket – de felles reglene, den felles bildekonteksten og én nummerert seksjon per bildeoppføring. Du skriver den felles bildekonteksten og motivene; alt det andre er avledet, og en aspect ratio du oppgir i fritekst er nettopp det som gjør bestilling og sone uenige.

Kontrollpunkter før du leverer:
- For hver tekstsone du lager: ${ZONE_SELF_CHECK.join(' ')}
- Når første hele utkast står: ${DECK_SELF_CHECK.join(' ')}
- **Kontroller mediemiksen eksplisitt.** Hvis presentasjonen handler om visuelt konkrete emner som mennesker, steder, bygninger, gjenstander eller historiske miljøer og du står igjen med 0 planlagte rasterbilder og heller ingen innsatte rasterbilder, skal du stoppe og vurdere dekket på nytt før levering. Fravær av rasterbilder er ikke automatisk feil, men det krever en konkret faglig grunn – «SVG var enklere å lage» er aldri en slik grunn. Gå gjennom hver SVG og spør om relasjonen/strukturen faktisk er det publikum trenger å se, eller om du har abstrahert bort et konkret motiv som burde vært et rasterbilde. En definert felles bildekontekst uten noen planlagte rasterbilder eller innsatte rasterbilder er et særskilt faresignal og skal utløse samme revurdering.
- **Kontroller \`workflow\` før du avslutter.** \`complete\` svarer for dokumentet – at bildene faktisk ligger i dekket – og blir bare true av at brukeren deponerer filene, så den er verken en kvittering for arbeidet ditt eller i seg selv en beskjed om at noe gjenstår. Det er \`workflow.remainingSteps\` som sier hva som gjenstår for deg, og \`workflow.forbiddenClosings\` hvilke avslutninger som er gale i det stadiet du står i. \`workflow.completionCriteria\` sier hva fullført krever, deponeringen inkludert. Er listen tom, er du ferdig.
- ${SELF_CHECK_STOP}

Feil er svar, ikke unntak. Når et verktøy har kjørt og Slaids sier nei – CONTENT_DOES_NOT_FIT, CONFLICT, noe som ikke finnes, et scope du mangler – kommer det tilbake som et resultat med isError og en maskinlesbar kode i structuredContent.error. Les koden og detaljene: de sier hva som skal endres. Et kall som aldri var gyldig – et verktøy som ikke finnes, eller argumenter som ikke passer verktøyets skjema – kommer som en JSON-RPC-feil i stedet, med den samme koden i data.

Tokenet ditt har et sett scopes, og et verktøy du mangler scope for svarer FORBIDDEN_SCOPE uansett hvordan kallet ellers ser ut; vanlig redigering gir aldri rett til å publisere.`