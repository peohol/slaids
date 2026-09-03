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
 */

import { MIN_ZONE_HEIGHT, MIN_ZONE_WIDTH, SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
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
- Ingen sone kan bli mindre enn ${MIN_ZONE_WIDTH} × ${MIN_ZONE_HEIGHT}. Det er én fast avstand mellom alt synlig innhold, og den håndteres av Slaids – du regner ikke ut marger selv.

Slik arbeider du:
1. Inspiser før du skriver. Inspeksjonen gir deg id-ene til slider og soner, rektangelet hver sone faktisk får, teksten som ligger der, og om den får plass.
2. Gjør én semantisk endring om gangen, med id-ene du nettopp leste.
3. Inspiser eller valider på nytt, og rett opp det som ble avvist.

Fire regler som avgjør om et kall lykkes:
- **Alt må få plass.** En endring som ville skjult innhold blir avvist før den lagres, med feilkoden CONTENT_DOES_NOT_FIT og hvor mange piksler som ble til overs. Svaret er å korte ned teksten, dele sonen annerledes eller gi den mer plass – ikke å prøve på nytt.
- **Skriv mot det du leste.** Hver lesing svarer med en revisjon. Send den med på neste endring, så får du CONFLICT i stedet for å overskrive noen som skrev i mellomtiden. Da leser du på nytt før du prøver igjen.
- **Du sender aldri editorens interne JSON.** Tekst er navngitte blokker med spans; en sitering er en referanse-id, ikke et tall du skriver selv.
- **Slaids lager ikke bilder.** Det finnes ingen bildegenerering her og kommer ikke til å gjøre det. Et rasterbilde må du ha ferdig og laste opp, og en figur skriver du selv som SVG-markup. Begge blir helt vanlige filer du deretter plasserer i en sone.

Feil er svar, ikke unntak. Når et verktøy har kjørt og Slaids sier nei – CONTENT_DOES_NOT_FIT, CONFLICT, noe som ikke finnes, et scope du mangler – kommer det tilbake som et resultat med isError og en maskinlesbar kode i structuredContent.error. Les koden og detaljene: de sier hva som skal endres. Et kall som aldri var gyldig – et verktøy som ikke finnes, eller argumenter som ikke passer verktøyets skjema – kommer som en JSON-RPC-feil i stedet, med den samme koden i data.

Tokenet ditt har et sett scopes, og et verktøy du mangler scope for svarer FORBIDDEN_SCOPE uansett hvordan kallet ellers ser ut; vanlig redigering gir aldri rett til å publisere.`
