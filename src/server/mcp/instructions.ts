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
  BULLET_RULE,
  IMAGE_POLICY_SUMMARY,
  PARALLEL_RULE,
  REPEATED_FALLBACK_RULE,
  SEMANTIC_DECOMPOSITION,
  SIMPLEST_TREE,
  SINGLE_CONTAINER_RULE,
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
- Hvor liten en sone kan bli avhenger av hva som står i den. En tom sone og en sone satt til «negative-space» har ingen minstestørrelse – bevisst luft er et lovlig designgrep. Kort, beholdere og bilder har hver sine minstemål, og når du leser en slide får du oppgitt hvilke innholdstyper som faktisk får plass i hver sone. Det er én fast avstand mellom alt synlig innhold, og den håndteres av Slaids – du regner ikke ut marger selv.

Design før geometri:
- **Dekomponer innholdet semantisk først.** ${SEMANTIC_DECOMPOSITION} Velg aldri først «to kolonner», «tre kort» eller et annet vilkårlig layout og press deretter stoffet inn. ${SIMPLEST_TREE}
- **Én stor container med overskrift og punktliste er et valg, ikke et standardsvar.** ${SINGLE_CONTAINER_RULE} ${BULLET_RULE}
- **${PARALLEL_RULE}** Tydelig ulike vekter skal uttrykke et reelt hierarki, ikke bare at én tekst tilfeldigvis er lengre.
- **Bruk asymmetri når innholdet har hierarki.** Et hovedpoeng, en viktig figur eller en oppsummering kan få større flate enn støttende materiale. Nested splits er gode når én del faktisk har en egen intern struktur; ikke nest soner uten semantisk grunn.
- **Soner er makrokomposisjon; subfelter er intern struktur.** Lag egne soner når deler skal ha selvstendig visuell rolle, ulik størrelse eller sammenlignes på tvers. Hold delene i samme kort/container når de til sammen er ett semantisk objekt. Verktøyet som setter innholdstype forklarer hvilken type hver rolle ber om.
- **Sjekk deg selv underveis.** ${REPEATED_FALLBACK_RULE}
- **Bilder: vektor der vektor hører hjemme.** ${IMAGE_POLICY_SUMMARY} Verktøyene som lagrer filene sier resten.
- **Fit er redaksjonell tilbakemelding.** Hvis innhold ikke får plass, kort ned og prioriter først. Sjekk deretter grouping, vekter og trestruktur. Del sliden hvis den egentlig gjør flere kommunikative jobber. Ikke prøv å bevare all kildetekst ved å gjøre layouten stadig tettere.

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
2. Formuler hva sliden skal kommunisere, dekomponer stoffet i semantiske enheter, klassifiser relasjonene mellom dem, og bygg deretter sonetreet og velg innholdstyper.
3. Gjør én semantisk endring om gangen, med id-ene du nettopp leste.
4. Inspiser eller valider på nytt. Ved overflow: rediger teksten først, komponer på nytt når problemet er strukturelt, og rett opp det som ble avvist.

Fire regler som avgjør om et kall lykkes:
- **Alt må få plass.** En endring som ville skjult innhold blir avvist før den lagres, med feilkoden CONTENT_DOES_NOT_FIT og hvor mange piksler som ble til overs. Svaret er å korte ned teksten, dele sonen annerledes eller gi den mer plass – ikke å prøve på nytt.
- **Skriv mot det du leste.** Hver lesing svarer med en revisjon. Send den med på neste endring, så får du CONFLICT i stedet for å overskrive noen som skrev i mellomtiden. Da leser du på nytt før du prøver igjen.
- **Du sender aldri editorens interne JSON.** Tekst er navngitte blokker med spans; en sitering er en referanse-id, ikke et tall du skriver selv.
- **Slaids lager ikke bilder.** Denne serveren genererer ingen bilder. Et rasterbilde må du ha ferdig – fra ditt eget miljø – og laste opp, og en figur skriver du selv som SVG-markup. Begge blir helt vanlige filer du deretter plasserer i en sone.

Feil er svar, ikke unntak. Når et verktøy har kjørt og Slaids sier nei – CONTENT_DOES_NOT_FIT, CONFLICT, noe som ikke finnes, et scope du mangler – kommer det tilbake som et resultat med isError og en maskinlesbar kode i structuredContent.error. Les koden og detaljene: de sier hva som skal endres. Et kall som aldri var gyldig – et verktøy som ikke finnes, eller argumenter som ikke passer verktøyets skjema – kommer som en JSON-RPC-feil i stedet, med den samme koden i data.

Tokenet ditt har et sett scopes, og et verktøy du mangler scope for svarer FORBIDDEN_SCOPE uansett hvordan kallet ellers ser ut; vanlig redigering gir aldri rett til å publisere.`
