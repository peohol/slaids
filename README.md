# Slaids

Nettleserbasert presentasjonseditor for 16:9-presentasjoner med matematisk stram
soneinndeling. Slaids prøver ikke å gjenskape PowerPoint – styrken er det motsatte
av fri plassering: innhold tvinges inn i et rekursivt sonetre der **avstanden
mellom alt synlig innhold alltid er nøyaktig den samme**, uansett hvor dypt
layoutet er nestet.

> `IMPLEMENTATION_PLAN.md` er den gjeldende normative spesifikasjonen.
> `docs/archive/VISION.original-2026-08-20.md` er den opprinnelige visjonen, bevart som historikk – ikke normativ.
> `VISION.md` i roten peker bare videre til de to; den inneholder ingen krav.
> Idévinduet er en tro port av idévinduet i `peohol/mdeditz` – samme modell, samme
> gest, samme vindu – lagt inn i Slaids' typed domene.

## Kjerneidé

- Hver slide rendres i et fast logisk designrom på `1600 × 900` og skaleres uniformt.
- Layoutet er et rekursivt tre: `split` har barn og aldri innhold, `leaf` har innhold og aldri barn.
- Splits har 2–10 barn med eksplisitte forholdstall (`[1, 2]`, `[0.5, 1]` og `[2, 4]` er ekvivalente).
- En ren geometry engine (`src/domain/geometry.ts`) regner ut alle rektangler.
  Det globale gapet `G` løses aritmetisk – `usable = L - G × (n - 1)` – slik at
  nesting aldri kan doble en avstand.
- Editor, miniatyrbilder, presentasjonsmodus og innholdsmåling bruker samme
  renderer og samme geometri.

## Funksjonalitet i dag

**Bibliotek**

- passordinnlogging for Slaids' ene personlige bruker når appen kjører mot Supabase (se «Lagring»)
- opprett presentasjon med tittel, global bakgrunnsfarge og globale fonter
- åpne, gi nytt navn, dupliser (inkludert filer), slett med bekreftelse
- mapper, og flytting av presentasjoner mellom dem
- eksport og import av `.slaids`-sikkerhetskopi (zip med manifest, data og filer)
- agenttokens: lag, se og trekk tilbake nøklene en KI-agent bruker mot REST-API-et
  og MCP-serveren

**Agent-API**

- versjonert REST under `/api/agent/v1/`, med katalogen generert fra
  operasjonene selv
- **MCP-server på `/api/agent/v1/mcp`** med de samme operasjonene som verktøy,
  bak det samme tokenet – verktøylisten bygges av det samme registeret, og begge
  transportene kaller den samme koden
- tilbakekallbare tokens med scopes; vanlig redigering gir ikke rett til å dele
- **bibliotekets livsløp**: se mappene, flytte en presentasjon mellom dem,
  duplisere en presentasjon med filene sine, og slette en for godt – med
  scope-grensen tegnet per operasjon og en vaktet, uangrelig sletting
- binær filopplasting uten base64, og `409 CONFLICT` når noen skrev først
- **rendret preview** (`render_slide_preview`): én side som PNG, tegnet av
  Slaids' egne komponenter og stilark i en ekte Chromium, så en agent kan se på
  komposisjonen og rette den. Binært over REST, som en image-blokk over MCP.
- én auditrad per kall – uten slideinnhold, filer eller hele forespørsler

**Deling**

- `Del`-bryter i verktøylinjen publiserer presentasjonen til en hemmelig lenke,
  `/s/<token>`, som hvem som helst kan åpne uten å logge inn
- seerne får kun visning: ingen editor, ingen filmstripe, ingen redigering, og
  ingen katalog man kan finne delte presentasjoner i – man må kjenne lenken
- en avledet QR-side legges automatisk aller sist, etter referansesidene
- slås delingen av, dør lenken; slås den på igjen, får man en helt ny lenke
- krever Supabase-modus (se «Lagring»); i lokal modus er bryteren avslått

**Slides**

- opprett med eller uten overskriftssone, dupliser, slett, endre rekkefølge (DnD)
- overskriftssonen er deterministisk: én linje, fast høyde, tekst som ikke får plass avvises

**Soneredigering**

- stiplede sonegrenser, slør med backdrop blur over valgt subtre, handlingsknapper
- hit-testing via geometry engine – klikk i gapet velger supersonen
- piltastnavigering opp/ned/venstre/høyre med wraparound, og klikkbar breadcrumb
- splitt sone (2–10 barn) med orientering, forholdstall og live geometri-preview
- rediger eksisterende splitting; innhold som mister sonen sin kan reddes til sandkassen
- dra i gapet mellom subsoner for å justere forholdstall direkte
- minimumsstørrelse valideres for hele subtreet, ikke bare for det enkelte bladet

**Innhold**

- beholder (transparent), kort uten tittel, kort med tittel
- 1–6 subfelt per kort med egne forholdstall, orientering og skillelinjer
- rik tekst via Tiptap: avsnitt, overskrift (pilledesign), fet/kursiv/understreket,
  punktlister, nummererte lister, sitat, kode, lenker og tabeller med rad-/kolonnekontroller
- bilder og SVG som filer i lagringen (Supabase Storage eller IndexedDB), med breddevalg i prosent
- enkle vektorfigurer, både som hel sone og inline i tekst
- 12 × 4-fargepalett med automatisk tekstfarge etter kontrast
- referanser med avledet nummerering (`1–3, 5, 6, 8–10`) og automatisk genererte
  referanseslides, som vises som skrivebeskyttede slides i filmstripen
- sandkasse for innhold som midlertidig er utenfor en sone, med fit-bevisst DnD
- strukturell utklippstavle (Ctrl+C/X/V i sonemodus), normalisert ekstern paste
  og Ctrl+Shift+V for ren tekst
- idévindu (én linje per idé, ett kategorinivå, dra for å sortere) og layout-maler
- angre/gjør om, autosave med eksplisitt status, oversikt over hurtigtaster
- lagringsbruk vises i biblioteket, og forlatte filer ryddes bort automatisk

**Innholdsgrense**

`overflow: hidden` er siste visuelle sikkerhetsnett, ikke regelen. Regelen er at
en lovlig redigeringsoperasjon aldri skal ende med at innhold som var synlig blir
skjult. Det håndheves i to former, begge i domenelaget:

- **Plassering** – kan dette innholdet ligge i den sonen? Absolutt sjekk, brukt av
  kommandoene som plasserer innhold (`setZoneContent`, `moveZoneContent`,
  `copyZoneContent`, `placeSandboxItem`, `splitLeaf`, `addSlide`).
- **Regresjon** – gjør denne endringen at innhold som allerede ligger på sliden får
  *dårligere* plass? Det er hva en global fontendring, en forholdstallsendring, et
  nytt antall subfelt, en orienteringsendring eller en konvertering mellom
  innholdstyper kan gjøre. `src/domain/commands/fitGuard.ts` måler den
  prospektive tilstanden før commit og avviser den hvis noen sone viser mindre
  enn før.

Regresjon, ikke absolutt fit, er riktig test for den andre formen: innhold kan
allerede være i overflow – etter import, migrasjon eller en fontendring gjort før
regelen fantes – og en sone som ikke kan endres i det hele tatt kan heller aldri
repareres. Derfor er «ikke verre enn før» tillatt, «verre» ikke.

Under aktiv skriving håndheves grensen i stedet mot den levende DOM-en i
`RichTextEditor`, som ruller tilbake til siste gyldige dokument – aldri midt i en
IME-komposisjon. Kommandoene tar fit-sjekkerne som argument, så et senere
REST/MCP-API får nøyaktig de samme reglene uten å gå veien om UI-et.

Målingen skjer med de samme komponentene som brukes til visning: innholdet rendres
utenfor skjermen i nøyaktig målsonens størrelse og med den prospektive fonten,
slik at svaret er det brukeren faktisk vil se. Utenfor nettleseren brukes en ren,
font-bevisst estimator (`src/domain/fit.ts`).

Tre ting utenfor selve sonen bestemmer hvor mye plass innholdet trenger, og alle
tre måles i den tilstanden som faktisk kommer til å vises:

- **geometrien** sonen ligger i,
- **typografien** – en fontendring committes først når webfonten er lastet, så
  målingen gjøres aldri mot reservefonten, og
- **citation-nummereringen** – tallene utledes av rekkefølgen referansene først
  brukes i, så en endring på én slide kan gjøre en etikett bredere på en annen.
  Kommandoer som endrer den rekkefølgen valideres mot konsekvensene i hele
  presentasjonen, ikke bare i sonen som ble redigert.

## Lagring

Slaids har to lagringsmoduser, og valget tas ett sted –
`src/persistence/activeRepository.ts`. Resten av appen ser bare
`SlaidsRepository`.

| Modus                  | Når                                                              | Hva som skjer                                                       |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| Supabase (produksjon)  | `VITE_SUPABASE_URL` **og** `VITE_SUPABASE_PUBLISHABLE_KEY` er satt | innlogging kreves; alt lagres i Supabase (Postgres + privat Storage) |
| Lokal (utvikling/test) | ingen av variablene er satt                                        | ingen innlogging; alt lagres i IndexedDB via Dexie                   |
| Konfigurasjonsfeil     | nøyaktig én av variablene er satt                                  | appen stopper og sier hvilken som mangler                            |

Dette er en **modus, ikke en fallback**. Er Supabase konfigurert men utilgjengelig,
viser appen en feil – den begynner ikke å lagre lokalt og lage to konkurrerende
sannhetskilder. Et bygg med bare én av variablene er heller ikke lokal modus: det
er en deploy-feil, og appen stopper i stedet for å skrive produksjonsdata til
nettleseren.

Bare den publiserbare (anon) nøkkelen hører hjemme i frontend. En
service-role-nøkkel ville omgå RLS og skal aldri legges inn her.

### Supabase-oppsett

```bash
# .env.local – verdiene hentes fra Supabase-prosjektet
VITE_SUPABASE_URL=https://<prosjekt>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable/anon key>
```

Slaids har ikke et flerbrukersystem: bare én bestemt Supabase Auth-bruker er
tillatt. Innloggingsskjermen ber derfor bare om passord, og både app-gaten og RLS-
policyene avviser alle andre Auth-brukere. Supabase-prosjektet er delt
infrastruktur, men dette gir ingen konto- eller produktkobling til andre apper
som bruker samme prosjekt. Utlogging bruker `scope: 'local'`, slik at den bare
avslutter Slaids-sesjonen i denne nettleseren.

Skjemaet ligger i `supabase/migrations/`:

- fire tabeller i `public` (`slaids_folders`, `slaids_presentations`,
  `slaids_templates`, `slaids_assets`), alle med `owner_id` og RLS som både
  håndhever eierskap og Slaids' ene tillatte Auth-bruker;
- en trigger som øker `version` og setter `updated_at` når selve dokumentet
  endres, slik at en gammel kopi fra en annen fane får en tydelig konfliktfeil i
  stedet for å overskrive en nyere. Rene delingsendringer holdes utenfor: å
  publisere eller trekke tilbake en lenke er ikke en redigering, og skal ikke
  gjøre den åpne editorens versjon utdatert;
- kolonnene `is_shared`, `share_token` og `shared_document` for deling, med en
  CHECK som binder dem sammen: delt betyr publisert, og ikke delt betyr at det
  ikke finnes noe publisert;
- den private bucketen `slaids-assets` med policies som binder hver fil til
  `<owner_id>/<presentation_id>/<asset_id>` og den samme tillatte brukeren.

Deling har i tillegg en Edge Function, `slaids-share`, som er den eneste
offentlige inngangen. Se «Deling» lenger ned for hva den gjør og hvorfor den
finnes.

### Deploye Slaids-migrasjoner

**Ikke bruk `supabase db push` herfra.** Supabase-prosjektet er delt
infrastruktur – Slaids, Huskis og mdeditz bor i det samme prosjektet, fra tre
uavhengige repoer – mens Supabases egen migrasjonshistorikk,
`supabase_migrations.schema_migrations`, er **prosjektglobal**. Den inneholder
alle appenes migrasjoner, blant annet `20260806132939_mdeditz_store`, som ikke
finnes i dette repoet.

`db push` leser den tabellen som om den var historikken til repoet du står i, så
herfra stopper den:

```text
Remote migration versions not found in local migrations directory.
```

og foreslår `supabase migration repair --status reverted 20260806132939` eller
`supabase db pull`. **Følg ingen av dem.** Den første skriver om *mdeditz'*
historikk; den andre drar en annen apps skjema inn i Slaids. Det finnes ingen
flagg som avgrenser `db push` til én app (`--include-all` gjelder motsatt vei –
lokale migrasjoner som mangler i historikken), og `config.toml` har ingen
innstilling for det.

Slaids fører derfor sin egen historikk, i sin egen tabell,
`public.slaids_migrations`, ved siden av sine egne tabeller:

```bash
# Connection string fra Supabase-dashbordet: Project Settings → Database.
# Dette er en hemmelighet – hold den utenfor repoet og utenfor Vercel.
export SLAIDS_DB_URL='postgresql://postgres:...@db.<prosjekt-ref>.supabase.co:5432/postgres'

./scripts/deploy-migrations.sh --dry-run   # hva som ville blitt kjørt – leser bare
./scripts/deploy-migrations.sh             # kjør det
```

`--dry-run` er read-only i streng forstand: den sender ingen setning som endrer
noe, ikke engang opprettelsen av historikktabellen. Mot en base som aldri har
sett Slaids etterlater den den nøyaktig som den fant den, og melder alle
migrasjonene som gjenstående – hvilket er sant. Historikktabellen opprettes
først i en ekte kjøring, rett før den første migrasjonen.

Skriptet kjører hver migrasjon i `supabase/migrations/` som ikke allerede står i
Slaids' egen historikk, i filnavnrekkefølge, og hver av dem i én transaksjon
sammen med sin egen historikkrad – så en feil etterlater verken en halvkjørt
migrasjon eller en historikk som lyver. Det leser og skriver aldri den delte
tabellen, og nekter å kjøre en migrasjon som i det hele tatt nevner den.

Det er dét som gjør det trygt for de andre appene: ingenting her er globalt.
Deres historikk er urørt, og Slaids-migrasjoner lager bare `slaids_`-prefiksede
objekter.

Har du ikke `psql`, kan du kjøre den nye migrasjonsfilen i Supabase-dashbordets
SQL Editor i stedet. Migrasjonene er skrevet idempotent (`if not exists`,
`create or replace`, `drop … if exists` før `create`), så en fil som kjøres to
ganger gjør ingen skade – men da må du selv holde styr på hva som er kjørt.

Edge Function-en deployes for seg, og berører ingen migrasjonshistorikk:

```bash
supabase functions deploy slaids-share --project-ref <prosjekt-ref>
```

**Aldri med `--prune`.** Det flagget sletter Edge Functions som finnes i
prosjektet men ikke lokalt – altså Huskis' og mdeditz' funksjoner.

Supabase-oppsettet er **verifisert mot et ekte prosjekt**: innlogging,
reload/session-persistens, filer, mapper, import/eksport, sletting, utlogging,
samtidighetskonflikt mellom faner og enheter, nettverksbrudd og en InPrivate-sesjon
er alle testet manuelt og fungerer.

### Deploy til Vercel

Begge variablene

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

må være slått på for **både Production og Preview** i Vercel. Dette er den ene
deploy-fella vi faktisk gikk i: er de bare satt for Production, bygges hver
PR-preview uten dem, og siden ingen av dem finnes er det ikke en feil – det er
lokal modus. Previewen starter da uten innlogging og lagrer i nettleseren, mot en
tom Dexie-base, og ser ut som om alt er borte.

Regelen bak det er den samme som i tabellen over, og den er verdt å ha i hodet
når man setter miljøvariabler:

| Variabler satt      | Hva bygget blir                                                     |
| ------------------- | ------------------------------------------------------------------- |
| ingen               | bevisst lokal modus: Dexie, ingen innlogging, ingen deling           |
| begge               | Supabase-modus: innlogging kreves, deling tilgjengelig               |
| nøyaktig én         | hard konfigurasjonsfeil – appen stopper og sier hvilken som mangler  |

`vercel.json` gjør to ting til for delingsruten:

- en SPA-rewrite, slik at en direkte forespørsel til `/s/<token>` – som Vercel
  ellers ville svart 404 på – serverer `index.html` og lar appen rute selv;
- `X-Robots-Tag: noindex, nofollow` og `Referrer-Policy: no-referrer` som
  svarhoder på `/s/`. Den delte visningen setter de samme som `<meta>`, men det
  virker først etter at JavaScript har kjørt – en crawler kan nøye seg med det
  første HTML-svaret.

SPA-rewriten er skrevet slik at den aldri kan svelge `/api/` eller `/assets/`,
og agent-API-et har sin egen rewrite foran den – se «Ruting av agent-API-et».

Én ting til om testing: **PR-previews ligger bak Vercel Authentication.** En
delingslenke mot en preview sender en anonym besøkende til Vercels
innloggingsside, uansett hva Slaids gjør. Skal du teste at lenken virker uten
innlogging – i et InPrivate-vindu, eller fra telefonen – må det gjøres mot
Production.

Service-role-nøkkelen hører **ikke** hjemme noe sted i Vercel. Den brukes bare av
Edge Function-en, der Supabase selv injiserer den.

## Kom i gang

```bash
npm install
npm run dev          # http://localhost:5173
```

## Utviklingskommandoer

| Kommando            | Hva den gjør                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Vite dev-server                               |
| `npm run build`     | Typecheck + produksjonsbuild                  |
| `npm run preview`   | Serverer produksjonsbuilden på port 4173      |
| `npm run typecheck` | `tsc --noEmit`                                |
| `npm run lint`      | ESLint                                        |
| `npm test`          | Vitest (domene, geometri, schema, persistens, agent-API, MCP og rendret preview) |
| `npm run e2e`       | Playwright (bygger og serverer selv)          |

`npm test` starter en ekte Chromium for previewtestene. Den kommer fra
`@sparticuz/chromium`, som er en vanlig avhengighet, så det trengs ingenting –
men `SLAIDS_CHROMIUM_EXECUTABLE` kan peke på en du allerede har:

```bash
SLAIDS_CHROMIUM_EXECUTABLE=/sti/til/chrome npm test
```

Playwright laster normalt ned egen nettleser. I miljøer uten nedlasting kan du
peke på en eksisterende Chromium:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/sti/til/chrome npm run e2e
```

## Deling

Deling er **publisering, ikke samarbeid**. Slaids er fortsatt en énbruker-app:
en delt lenke gir ingen konto og ingen Auth-bruker, bare lesetilgang til én
publisert kopi. Den som eier presentasjonen er fremdeles den eneste som kan
logge inn og den eneste som kan endre noe.

Det er to dokumenter, og forskjellen mellom dem er hele sikkerhetsmodellen:

| Dokument                       | Hvem ser det        | Hva det inneholder                                      |
| ------------------------------ | ------------------- | ------------------------------------------------------- |
| `document` (arbeidskopien)     | bare eieren         | hele `Presentation`: sandkasse, idéer, mappe, alle filer |
| `shared_document` (snapshotet) | alle med lenken     | tittel, tema, slides, siterte referanser, viste filer    |

Snapshotet bygges i `src/domain/sharing.ts` ved å **liste opp hva som skal med**,
aldri ved å slette felter fra arbeidskopien. Et nytt felt på `Presentation` er
derfor privat helt til noen med vilje publiserer det – som er riktig standard for
den retningen dataene går.

Delingsstatus er ikke en del av `Presentation` i det hele tatt. Den bor på raden
i databasen, og det er dét som gjør at den ikke kan angres med Ctrl+Z, ikke blir
med i `.slaids`-eksporten, og ikke arves av en kopi eller en import.

**Ruter og komponenter**

```text
/                     → AuthGate → bibliotek/editor        (privat)
/s/<token>            → SharedPresentationView             (offentlig)

PresentationPlayer          én renderer, ett sett geometri
├─ PresentView              lokalt, med «Avslutt»
└─ SharedPresentationView   offentlig, uten vei tilbake
```

`src/Root.tsx` velger mellom dem én gang, over `AuthGate`. Den delte visningen
monterer aldri en privat komponent og ber aldri om en sesjon.

**Sidene i et delt dekk**

```text
authored slides → avledede referansesider → avledet QR-side
```

Bare den første gruppen er lagret. QR-siden er ikke en slide og ligger ikke i
`presentation.slides`; den er et eget medlem av `DeckPage`-unionen i
`src/domain/pages.ts`, og finnes bare så lenge delingen er på. Derfor kan den
verken slettes, flyttes, dupliseres eller redigeres – det finnes ingen kommando
som når den.

**Den offentlige inngangen**

`anon` har fortsatt ingen tilgang til `slaids_presentations`. Alt en seer får,
kommer fra Edge Function-en `slaids-share`, som kjører med service role på
serversiden og svarer på nøyaktig to spørsmål:

```text
GET .../slaids-share?token=<token>              → det saniterte snapshotet
GET .../slaids-share?token=<token>&asset=<id>   → én fil dekket faktisk viser
```

Det finnes ingen listeform. Feil token, tilbakekalt deling, slettet presentasjon
og en fil som ikke er i snapshotet gir alle den samme generelle 404-en, slik at
endepunktet ikke kan brukes til å finne ut om et token er ekte. Svarene sendes
med `Cache-Control: no-store` og `X-Robots-Tag: noindex, nofollow` – en cachet
kopi ville overlevd tilbakekallingen som skulle fjerne den.

Filene forblir private: bucketen er ikke offentlig, og det lages ingen kopi av
dem. Edge Function-en henter fila selv, og bare når snapshotet lister den.

**Å slå av og på**

Tokenet roteres både når delingen slås av og når den slås på igjen. En lenke som
er trukket tilbake blir derfor aldri gyldig igjen, og en ny deling er en ny
adresse. Publisering venter alltid på at autosave har landet: går ikke lagringen
igjennom, publiseres ingenting, og bryteren blir stående av.

## Bilder, SVG og agenter

**Slaids genererer ikke bilder.** Det finnes ingen bildegenerering i appen, og
ingen kobling mot noen ekstern bildetjeneste – betalt eller gratis. Et bilde
kommer alltid ferdig utenfra. Det er en produktgrense, ikke en manglende
funksjon: Slaids er en layoutmotor.

Et transportuavhengig agentlag ligger i `src/agent/` (Agent Core). Det gir en
agent semantiske operasjoner over de samme domenekommandoene som UI-et bruker –
aldri rå JSON – og med nøyaktig de samme reglene: minstemål på soner, ett gap,
innhold og overskrifter som må få plass, referanseintegritet.

En agent kan opprette en presentasjon, legge til og flytte slides, dele soner,
fylle dem med tekst, sette temaet hele dekket tegnes i, legge inn referanser og
sitere dem, plassere bilder, og be om en eksplisitt sluttkontroll – uten React,
museklikk eller databasetilgang:

| Operasjon                                                              | Hva den gjør                                  |
| ---------------------------------------------------------------------- | --------------------------------------------- |
| `create_presentation`, `add_slide`, `duplicate_slide`, `move_slide`, `delete_slide` | bygger dekket                     |
| `inspect_slide`, `get_presentation`, `list_presentations`              | finner id-er, geometri, tekst, tema og revisjon |
| `split_zone`, `adjust_split`, `delete_zone`, `clear_zone`              | soneinndelingen                               |
| `move_zone_content`                                                    | flytter et helt innhold fra én sone til en annen, med id-ene i behold |
| `copy_zone_content`                                                    | kopierer et helt innhold til en tom sone; kilden blir stående, kopien får nye id-er |
| `set_zone_text`, `set_zone_card`, `set_vertical_alignment`, `set_slide_title`, `set_slide_has_title` | innholdet          |
| `adjust_subfields`                                                     | retning, forholdstall og antall subfelt inne i ett kort |
| `list_sandbox_items`, `place_sandbox_item`, `duplicate_sandbox_item`, `delete_sandbox_item` | sandkassen: innhold en strukturendring flyttet ut, i stedet for å slette det |
| `set_theme`, `set_cover`, `set_cover_color`, `set_presentation_title`  | utseendet og navnet på hele dekket            |
| `add_reference`, `update_reference`, `delete_reference`                | referansene citations peker på                |
| `delete_unused_references`                                             | rydder bort referanser ingenting siterer      |
| `validate_slide`, `validate_presentation`                              | leser og rapporterer, reparerer aldri         |
| `render_slide_preview`                                                 | tegner én side som PNG, slik publikum ser den |

For bilder finnes det nøyaktig to dører inn:

| Operasjon          | Hva agenten sender                          | Hva den får      |
| ------------------ | ------------------------------------------- | ---------------- |
| `upload_asset`     | metadata + filinnhold (base64, bytes, blob) | `assetId`        |
| `create_svg_asset` | `name` + `svgMarkup`                        | `assetId`        |
| `set_zone_asset`   | `assetId` + slide og sone                   | plassert innhold |
| `list_assets`      | `presentationId`                            | filene, med `used` |
| `delete_asset`     | `assetId`                                   | filen ut av dekket, bytene med |

- **Agenten kan laste opp ferdige bilder.** Formatet leses ut av bytene, ikke av
  hva kalleren kaller filen – og hele filen gås gjennom, ikke bare filhodet: en
  avkortet eller endret PNG, JPEG, GIF eller WEBP blir avvist i stedet for å bli
  en slide som viser et ødelagt bilde. Størrelsen tas alltid fra bildedataene,
  aldri fra noe kalleren oppgir. AVIF gjenkjennes, men lagres ikke i agentveien
  ennå (editoren tar det fortsatt imot, der dekoder nettleseren det).
- **Agenten kan lage SVG direkte.** SVG er et førsteklasses agentformat: markup
  inn, vektorasset ut. Markupen valideres og saneres mot en allowlist og
  serialiseres på nytt fra det parsede treet, så bare det Slaids faktisk forsto
  blir lagret. Skript, hendelsesattributter, `foreignObject`, `javascript:`,
  referanser ut av dokumentet og egne entiteter avvises med en egen feilkode i
  stedet for å bli stille fjernet. `<style>` lagres ikke – et CSS-dokument kan
  ikke valideres uten en ekte CSS-parser – men det fjernes og rapporteres i
  stedet for å avvise hele filen, slik at en eksport fra Illustrator eller
  matplotlib fortsatt kan lagres. `style`-attributtet virker, med en allowlist
  av funksjoner og uten CSS-escapes. En SVG uten kjent
  størrelsesforhold avvises også: uten `viewBox` eller `width`/`height` finnes
  det ingen riktig måte å legge den ut på.
- **Ingen bildegenererende operasjon** – ingen `generate_image(prompt)` som
  sender prompten videre til en bildeleverandør. Skal Slaids noen gang generere
  et bilde, er det en endring av `IMPLEMENTATION_PLAN.md` §44 først.
- Uansett dør blir resultatet et helt vanlig asset: bytene i lagringen, en
  `AssetRef` i dokumentet, `isVector: true` for SVG, og visning gjennom `<img>`
  og en Blob-URL – aldri injisert markup.
- Sone-id-en agenten plasserer i finner den med `inspect_slide`, som beskriver
  sonene med geometry engine-ens egne mål – ikke ved å få utlevert dokumentet.

Noen ting til er verdt å vite om hvordan laget oppfører seg:

- **Agenten styrer temaet, ikke bare innholdet.** `get_presentation` bærer
  bakgrunnsfargen, de to fontene, luften og skriftstørrelsen, og `set_theme`
  setter dem – gjennom den samme kommandoen som temamodalen, så en temaendring
  som ville skjult innhold blir avvist på samme måte, i sin helhet, uten at noe
  lagres. Luft og skriftstørrelse flytter i tillegg geometrien, så de måles to
  ganger: en endring som ville gjort soner mindre enn minstemålet avvises med
  `ZONE_TOO_SMALL` selv om sonene er tomme og ingenting kunne blitt skjult.
- **Agenten får bare fonter Slaids kan garantere.** Katalogen skiller mellom
  webfonter, som Slaids henter selv og kan gi til hvem som helst som tegner
  dekket, og lokale fonter som Calibri og Segoe UI, som maskinen enten har eller
  ikke har. Editoren tilbyr begge – der ser forfatteren resultatet selv – mens
  `set_theme` publiserer webfontene, generert fra katalogen. Ellers kunne en
  agent valgt en font den hodeløse fit-målingen regnet på, previewet byttet ut i
  stillhet, og `fontsReady: true` sa var i orden. Et dekk kan fortsatt være satt
  i en lokal font: `get_presentation` markerer den med `guaranteed: false`, og et
  preview av det dekket rapporterer `fontsReady: false` med en advarsel som
  navngir fonten. Fonter velges med id fra Slaids' egen fontkatalog, og de gyldige
  valgene er publisert som et enum i operasjonens JSON Schema, generert fra
  katalogen selv. Luft og skriftstørrelse publiseres med domenets eget intervall;
  editorens fire trinn («tett», «normal», «luftig», «ekstra luftig») siteres som
  navn en agent kan bruke, ikke som grensene den må holde seg til. En hodeløs
  fit-måling dømmer alltid den fonten som ble navngitt – aldri en reservefont
  som tilfeldigvis er lastet – så et tema som ble godkjent er det samme temaet
  et senere preview tegner.
- **Agenten kan dele opp innsiden av et kort, ikke bare sliden.** Et kort deler
  seg i subfelt på samme måte som en slide deler seg i soner, og
  `adjust_subfields` setter retningen (`x` gir kolonner, `y` gir rader),
  forholdstallene og antallet – to tekstspalter i det samme kortet, eller en
  figur som får 2/3 og forklaringen 1/3. Det er én operasjon og ikke tre fordi
  de tre spørsmålene gjelder det samme rektangelet: to felt over hverandre kan
  være for lave for noe to felt ved siden av hverandre bærer fint, så «sett
  antallet» og deretter «sett retningen» ville blitt avvist på veien til en
  layout som får plass. Ett kall måles én gang, mot layouten det faktisk ba om,
  og avvises i sin helhet hvis noe ville blitt skjult – aldri med halve
  endringen lagret. `inspect_slide` leser den samme layouten tilbake som
  `subfieldAxis` og `subfieldWeights`, ved siden av `axis` og `weights` for
  selve soneinndelingen.
- **Innhold kan flyttes, ikke bare bygges opp igjen.** `move_zone_content` tar
  hele innholdet i én bladsone og setter det i en annen, tom bladsone – på den
  samme sliden eller på en annen. Det er det samme innholdsobjektet som flytter
  seg, så content-id, subfelt-id-er, citations og filreferanser følger med, og
  agenten kan skrive videre inn i det samme subfeltet etterpå. Å tømme sonen og
  bygge innholdet opp igjen et annet sted gir noe som ser likt ut og er
  adresserbart av ingenting agenten allerede holder. Kilde og mål navngis hver
  for seg – `fromSlideId`/`fromNodeId` og `toSlideId`/`toNodeId`, der `toSlideId`
  utelatt betyr den samme sliden – og svaret bærer målsonen og subfelt-id-ene, så
  agenten kan skrive videre uten en ekstra lesing. Id-er og ingenting mer:
  `presentations:read` og `presentations:write` er uavhengige på et token, og et
  svar som beskrev innholdet ville gjort flyttingen til et `inspect_slide` uten
  lesescopet – å flytte innhold til den sonen det allerede står i er en lovlig
  no-op. Reglene er
  plasseringens vanlige: målet må være en tom bladsone, innholdet må få plass
  der, og en flytting som endrer hvilken citation som forekommer først må også
  gjennom den globale fit-guarden.
- **Og kopieres, med nye id-er.** `copy_zone_content` adresseres nøyaktig som
  `move_zone_content` og kvitterer på samme måte, men lover det motsatte om
  id-ene: kilden blir stående bit for bit som den var, og kopien er et eget
  innholdsobjekt med ny content-id og nye subfelt-id-er. Derfor er det to
  operasjoner og ikke et flagg – en «flytt» som noen ganger lager nye id-er er
  to operasjoner med ett navn – på samme måte som `move_slide` og
  `duplicate_slide` er to. Kopiens subfelt-id-er er de eneste id-ene agenten
  ikke kunne visst om på forhånd, så de står i svaret: den kan skrive rett inn i
  kopien uten en ekstra lesing. Filen en sone viser dupliseres ikke – begge
  sonene peker på den samme assetet – og reglene er ellers plasseringens
  vanlige: målet må være en tom bladsone (kildesonen er selv opptatt), kopien må
  få plass der, og en kopi som gir en referanse en tidligere første forekomst må
  også gjennom den globale fit-guarden.
- **Og ryddes bort igjen.** En agent som laster opp en figur den senere
  erstatter, etterlot til nå en foreldreløs fil den ikke kunne fjerne.
  `delete_asset` tar filen ut av dekket og sletter bytene i samme operasjon, og
  `delete_unused_references` fjerner referanser ingenting siterer. Begge er
  smale med vilje: `delete_asset` avvises med `ASSET_IN_USE` så lenge filen
  vises et sted – som innholdet i en sone, inline i en tekst, eller fra
  innhold som ligger parkert i sandkassen – og feilen sier hvor mange steder av
  hvert slag, så agenten vet hva den må rydde først. Ingenting halveis: en
  avvisning lagrer verken dokumentet eller rører filen, og en godkjent sletting
  skriver dokumentet først og bytene etterpå, fordi en fil ingen peker på koster
  lagring mens et dokument som peker på en fil som er borte koster sliden.
  `fileRemoved` sier om det siste faktisk skjedde – lest av lagringen selv, ikke
  utledet av at kallet gikk igjennom. `delete_unused_references`
  regner sandkassen som bruk, av samme grunn, og er idempotent: et andre kall
  fjerner ingenting og flytter ingen revisjon.
- **Agenten skriver aldri editorens JSON.** Tekst sendes som navngitte blokker –
  avsnitt, overskrift, sitat, punktliste, nummerert liste – med fet/kursiv og
  citations som peker på reference-ID-er, aldri på et nummer. `inspect_slide`
  leser det tilbake i samme format. Innhold formatet ikke kan uttrykke (en
  tabell, en kodeblokk) kommer tilbake som en `unsupported`-blokk med teksten
  sin, slik at ingenting er usynlig, og kan ikke sendes inn igjen.
- **En feil som ikke får plass er handlingsbar.** `CONTENT_DOES_NOT_FIT` bærer
  slide, sone, hvor mye som ikke fikk plass og hvor stor sonen er, så en agent
  kan forkorte og prøve igjen uten å gjette. Ingenting lagres når en operasjon
  avvises – heller ikke halvveis gjennom en sammensatt operasjon.
- **En agent som leste før noen andre skrev får beskjed.** Hver lesing svarer med
  en `revision`, og hver mutasjon kan sende den tilbake som `expectedRevision`.
  Har presentasjonen endret seg i mellomtiden, blir kallet avvist med `CONFLICT`
  i stedet for å overskrive den nyere versjonen. Selve skrivingen er i tillegg
  alltid låst mot nøyaktig den lesingen operasjonen bygget på – ikke mot den
  nyeste versjonen lagringslaget tilfeldigvis kjenner – så to samtidige kall
  ikke kan lande oppå hverandre.
- **Sandkassen er ikke en blindvei.** Enhver strukturendring med
  `disposition: 'sandbox'` (standarden) svarer med `sandboxItemIds` – id-ene
  til det som faktisk ble parkert – så en agent kan fortsette direkte i stedet
  for å lese sandkassen på nytt bare for å finne dem. `list_sandbox_items`
  leser resten tilbake i samme tekstformat som `inspect_slide`, og
  `place_sandbox_item` setter et element tilbake i en sone med de samme
  reglene som all annen plassering: fit-gating, en global sjekk av om
  citation-nummereringen fortsatt holder andre steder i dekket, og full
  atomisitet.

Se `IMPLEMENTATION_PLAN.md` §44 for hele kontrakten.

## Rendret preview: å faktisk se sliden

`validate_slide` svarer på om en slide er **lovlig**. Den kan ikke svare på om
den er **god** – om blikket lander riktig, om et kort er knøttlite ved siden av
nabokortet, om en figur er beskåret på en måte tallene er helt fornøyde med. Det
krever å se den, og det er dét `render_slide_preview` er til for:

```text
bygg slide → validate_slide → render_slide_preview → se på den → juster → rendre på nytt
```

```bash
export SLAIDS_TOKEN=slaids_at_…
export SLAIDS_API=https://<domenet>/api/agent/v1

# Bildet, som et bilde
curl -sS -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"presentationId":"p_…","slideId":"s_…"}' \
     "$SLAIDS_API/operations/render_slide_preview" -o slide.png

# Eller hele svaret som JSON, med bildet som base64
curl -sS -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -H 'Accept: application/json' \
     -d '{"presentationId":"p_…","slideId":"s_…","scale":0.5}' \
     "$SLAIDS_API/operations/render_slide_preview"
```

- **Det er den virkelige rendereren.** Ikke et bilde bygget av de samme tallene:
  de samme React-komponentene presentasjonsmodus og den delte visningen tegner,
  under Slaids' egne stilark, i en ekte Chromium. En regel som legges til i
  `slide.css` er i previewet med en gang. Det finnes ingen «agentrenderer» å
  drifte fra hverandre.
- **`slideId` er en side, ikke bare en slide.** En slide, `__cover__` for
  forsiden, eller id-en til en avledet referanseside. En id som ikke finnes gir
  `SLIDE_NOT_FOUND` med id-ene som *finnes*, så neste kall kan treffe.
- **`scale`** er piksler per logisk enhet. `1` (standard) gir 1600 × 900, det
  publikum ser; `0.5` gir 800 × 450 og en fjerdedel av tokenene. Layouten skjer
  alltid i designrommet – bare samplingen endrer seg – så et lite preview er den
  samme sliden, ikke en strukket en.
- **Det endrer ingenting.** `presentations:read` alene holder, og revisjonen
  svaret bærer er den lesingen bildet viser, så en agent kan rendre, tenke og
  skrive mot den samme revisjonen uten en falsk `CONFLICT`.
- **Over REST er svaret bildet**: `200` med `Content-Type: image/png` og bytene
  som kropp, pluss `X-Slaids-Revision` og `X-Slaids-Operation`. Et par hundre
  kilobyte base64 inne i en konvolutt er ikke en tjeneste. `Accept:
  application/json` gir den vanlige konvolutten med bildet som base64 i
  `data.image.base64`, sammen med `pageKind`, `scale`, `fontsReady` og
  `warnings`.
- **Over MCP er svaret en image-blokk**, altså MCPs egen mekanisme for visuelt
  innhold – den blokken en klient gir videre til en multimodal modell. De samme
  bytene limt inn som tekst ville vært en halv megabyte tegn modellen leser som
  tegn. `structuredContent` beskriver bildet (media-type, størrelse, byte-antall)
  og gjentar det ikke.
- **`fontsReady` og `warnings` er verdt å lese.** Fontene hentes serverside og
  bakes inn i dokumentet, men en familie som ikke kunne hentes gir
  `fontsReady: false` – komposisjonen er riktig, men linjelengder kan avvike.
  En fil lageret ikke har nevnes i `warnings` framfor å bare mangle i bildet.
- Svarer installasjonen `PREVIEW_UNAVAILABLE` (`501`), kan den ikke rendre
  previews i det hele tatt, og resten av API-et virker som før.
  `PREVIEW_FAILED` (`502`) betyr at rendereren finnes og at dette forsøket gikk
  galt – prøv igjen. Ble bildet for stort til å sendes (over 3 MB, i praksis bare
  mulig på `scale: 2`), sier den samme feilen hvor stort det ble og at en lavere
  `scale` er svaret, i stedet for at plattformen kutter responsen.

Rasteriseringen bruker `puppeteer-core` med Chromium fra `@sparticuz/chromium`.
Begge er **pinnet eksakt**, og majoren må være den samme: `puppeteer-core` er
bygget mot én bestemt Chrome-build, `@sparticuz/chromium` *er* Chromium-versjonen
og følger uttrykkelig ikke semver, og ingen av dem sjekker den andre – et avvik
feiler først på den CDP-kommandoen de er uenige om. Skal de oppgraderes, finn
`puppeteer-core`-utgivelsen som peker på samme Chromium-major
([pptr.dev/chromium-support](https://pptr.dev/chromium-support)) og flytt begge;
`src/render/browserVersions.test.ts` sier fra hvis de kommer i utakt.
Begge er vanlige avhengigheter, så det trengs ingen konfigurasjon på Vercel og
ingenting lastes ned ved kjøring; `vercel.json` pakker nettleserbinærene med
funksjonen (`includeFiles`), fordi ingen importgraf nevner dem. Lokalt kan
`SLAIDS_CHROMIUM_EXECUTABLE` peke på en Chromium du allerede har. Tegner
previewet mot en Chromium som går tom for minne, kan `functions.memory` i
`vercel.json` heves.

## REST-API for agenter

Agent Core er nåbar utenfra, versjonert fra første dag:

```
GET  /api/agent/v1                    hva dette er, og hvor katalogen ligger
GET  /api/agent/v1/operations         alle operasjoner, med JSON Schema og scopes
POST /api/agent/v1/operations/<navn>  kjør én operasjon
POST /api/agent/v1/mcp                de samme operasjonene som MCP-verktøy
```

Den siste er MCP-serveren; den har sitt eget avsnitt lenger nede. Alt over den –
token, scopes, feilkoder, samtidighet og audit – er identisk.

Katalogen er ikke skrevet for hånd. Den genereres fra operasjonene selv, så
navnene, skjemaene og scopene REST publiserer er nøyaktig de Agent Core
håndhever. Alt går som `POST`, også lesingene: argumentene til en operasjon er
ett objekt med ett strengt skjema, og å dele dem mellom query-streng og kropp
ville gjort kontrakten til to kontrakter.

Transportlaget inneholder ingen domeneregler. Det autentiserer, validerer,
oversetter forespørselen til Agent Core-input, kaller inn og oversetter svaret
tilbake. Alt annet – fit, minstemål, referanseintegritet, atomisitet – er de
samme kommandoene editoren kjører.

### Svarformatet

```jsonc
// suksess
{ "ok": true, "operation": "set_zone_text", "revision": "…", "data": { … } }

// feil
{ "ok": false, "operation": "set_zone_text",
  "error": { "code": "CONTENT_DOES_NOT_FIT", "message": "…",
             "details": { "slideId": "…", "nodeId": "…", "overflow": 42, "rect": { … } } } }
```

Feilkodene er domenets egne. HTTP-statusen er en grovere lesing av den samme
koden, aldri en tredje mening:

| Status | Betyr                                                                     |
| ------ | ------------------------------------------------------------------------- |
| `400`  | forespørselen var feil i seg selv (`INVALID_INPUT`, ugyldige verdier)      |
| `401`  | mangler et gyldig token                                                   |
| `403`  | tokenet mangler et scope operasjonen krever                               |
| `404`  | ukjent operasjon, eller en id som ikke finnes                             |
| `409`  | noen skrev etter at du leste (`CONFLICT`), eller sonen er allerede opptatt |
| `413`  | forespørselen eller filen er for stor                                     |
| `415`  | filtypen støttes ikke                                                     |
| `422`  | forstått, og avvist av reglene (`CONTENT_DOES_NOT_FIT`, `ASSET_IN_USE`, `UNSAFE_SVG` …) |
| `501`  | denne installasjonen gjør ikke dette (`SHARING_UNAVAILABLE`, `PREVIEW_UNAVAILABLE`) |
| `502`  | lagringen eller previewrendereren svarte ikke                             |
| `503`  | serveren er ikke satt opp mot Supabase                                    |

Skillet mellom `400` og `422` er poenget: `400` betyr «du sendte tull», `422`
betyr «Slaids sa nei». Å sende det samme på nytt hjelper bare i det første
tilfellet. `501` og `502` er det samme skillet én etasje ned: `501` betyr «slutt
å spørre», `502` betyr «prøv igjen».

Én operasjon svarer ikke med denne konvolutten i det hele tatt:
`render_slide_preview` svarer med bildet, som et bilde. Se «Rendret preview».

### En liten runde

```bash
export SLAIDS_TOKEN=slaids_at_…
export SLAIDS_API=https://<domenet>/api/agent/v1

# Hva kan API-et?
curl -H "Authorization: Bearer $SLAIDS_TOKEN" "$SLAIDS_API/operations"

# Lag en presentasjon
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"title":"Fra en agent"}' \
     "$SLAIDS_API/operations/create_presentation"

# Finn sone-id-ene på den første sliden
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"presentationId":"p_…","slideId":"s_…"}' \
     "$SLAIDS_API/operations/inspect_slide"

# Skriv tekst i en sone, mot revisjonen du nettopp leste
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"presentationId":"p_…","slideId":"s_…","nodeId":"n_…","expectedRevision":"…",
          "blocks":[{"type":"paragraph","spans":[{"text":"Hei."}]}]}' \
     "$SLAIDS_API/operations/set_zone_text"

# Gjør kortet i sonen til to spalter, den venstre dobbelt så bred.
# Retning, forholdstall og antall i ett kall – de måles sammen.
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"presentationId":"p_…","slideId":"s_…","nodeId":"n_…","expectedRevision":"…",
          "subfieldCount":2,"axis":"x","weights":[2,1]}' \
     "$SLAIDS_API/operations/adjust_subfields"
```

### Samtidighet over ledningen

Hver lesing svarer med `revision`. Send den tilbake som `expectedRevision` på
neste mutasjon, så blir kallet avvist med `409 CONFLICT` i stedet for å
overskrive noen som skrev i mellomtiden.

Ett unntak, med vilje: å *trekke tilbake* en delingslenke sjekker ingen revisjon
og leser ikke dokumentet. En gammel revisjon – eller et dokument som ikke lar seg
lese – skal aldri kunne holde en offentlig lenke i live.

### Biblioteket: mapper, kopier og sletting

Fire operasjoner arbeider på presentasjonen utenfra i stedet for inni den, og de
bruker bibliotekets egne regler – ikke en parallell modell for API-et.

```bash
# Hvilke mapper finnes?
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{}' "$SLAIDS_API/operations/list_folders"

# Legg dekket i en mappe. `null` flytter det ut til rotnivå igjen.
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"presentationId":"p_…","folderId":"fl_…"}' \
     "$SLAIDS_API/operations/move_presentation"

# Kopier hele dekket, filene inkludert, og gi kopien et navn
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"presentationId":"p_…","title":"Variant for styret"}' \
     "$SLAIDS_API/operations/duplicate_presentation"

# Slett for godt, mot revisjonen du så
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"presentationId":"p_…","expectedRevision":"…"}' \
     "$SLAIDS_API/operations/delete_presentation"
```

**Scopene er ikke de samme for de fire**, og forskjellene er med vilje:

| Operasjon                | Krever                                    |
| ------------------------ | ----------------------------------------- |
| `list_folders`           | `presentations:read`                      |
| `move_presentation`      | `presentations:write`                     |
| `duplicate_presentation` | `presentations:read` + `presentations:write` + `assets:write` |
| `delete_presentation`    | `presentations:write` + `assets:write`    |

En kopi svarer med kopien slik `get_presentation` ville lest den – derfor
lesescopet – og lagrer én ny fil for hver fil kilden har, derfor `assets:write`.
En sletting ødelegger både dokumentet og hver eneste fil under det, som er
nøyaktig de to tingene de to skrivescopene beskytter. Filscopet gjelder begge
veier: autoriteten som legger en fil inn i lageret er den samme som tar den ut,
så et token uten `assets:write` kan verken laste opp, kopiere eller slette filer.
`sharing:write` kreves av ingen av dem: ingenting her publiserer noe, og en
sletting tar en publisert lenke *ned*.

**En sletting kan ikke angres**, og det som følger med er dokumentet, slidene,
filradene, bytene i lagringen og en eventuell delingslenke – lenken fordi
delingsstatusen er kolonner på den samme raden som slettes. Den er vaktet mot
revisjonen operasjonen leste, også når du ikke oppgir en, og en id som ikke
finnes svarer `PRESENTATION_NOT_FOUND` i stedet for et stille `ok`. Kvitteringen
er `{ "presentationId": "…", "deleted": true }` – ingen `revision`, siden det
ikke finnes et dokument igjen å skrive mot.

**En kopi er selvstendig.** Filene kopieres i stedet for å deles, så kopien
overlever at originalen slettes, og hver id inne i dokumentet – slide, sone,
innhold, subfelt, sandkasse – er ny. Kopien arver aldri delingen: den starter
som ikke delt, som en duplisering i biblioteket. `expectedRevision` gjelder
kilden og betyr «kopier nøyaktig den lesingen jeg så».

**En mappe må finnes fra før.** Slaids lager den ikke, og en `folderId` som ikke
finnes avvises med `FOLDER_NOT_FOUND` (404) før noe skrives – et dekk i en mappe
som ikke finnes ville ikke vært synlig noe sted, verken på rotnivå eller i en
mappe. Det gjelder begge dørene inn: `create_presentation` tar den samme
sjekken. Å flytte et dekk til mappen det allerede ligger i er en lovlig no-op som
ikke flytter revisjonen.

### Filer

En fil trenger ikke være base64 over REST. Det publiserte JSON Schema-et
beskriver bare base64 og tekst fordi bare de kan ligge i en JSON-forespørsel;
REST tar imot bytene direkte:

```bash
# multipart
curl -H "Authorization: Bearer $SLAIDS_TOKEN" \
     -F presentationId=p_abc -F name=figur.png -F file=@figur.png \
     https://<domenet>/api/agent/v1/operations/upload_asset

# rå binær, med feltene i query-strengen
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: image/png' \
     --data-binary @figur.png \
     "https://<domenet>/api/agent/v1/operations/upload_asset?presentationId=p_abc&name=figur.png"
```

### Agenttokens

Tokens lages i biblioteket, under **Agenttokens**. Et token er

- 32 tilfeldige bytes, generert i din egen nettleser;
- lagret bare som SHA-256, så det kan ikke vises igjen – kopier det med én gang;
- navngitt, med opprettelsestid, valgfri utløpstid og tidspunkt for siste bruk;
- tilbakekallbart når som helst, med umiddelbar virkning.

Det sendes som `Authorization: Bearer slaids_at_…`.

Scopene er fire, og de er skilt fra hverandre med vilje:

| Scope                  | Gir rett til                                          |
| ---------------------- | ----------------------------------------------------- |
| `presentations:read`   | lese, inspisere og validere                            |
| `presentations:write`  | lage og endre presentasjoner, slides, soner, referanser |
| `assets:write`         | laste opp bilder, lage SVG-figurer og slette filer      |
| `sharing:write`        | publisere en presentasjon på en delingslenke           |

**Vanlig redigering gir ikke rett til å publisere.** Et token som skal bygge
slides trenger ikke `sharing:write`, og får det ikke med mindre du krysser det
av. Håndhevingen skjer serverside på hver forespørsel, ut fra det samme feltet
katalogen publiserer.

**Å slette en fil krever det samme som å laste den opp.** `delete_asset` er
speilbildet av `upload_asset` og krever `assets:write`, ikke
`presentations:write` – og det holder nettopp fordi operasjonen er innelukket i
fillisten: den avvises så lenge noe viser filen, så den kan aldri fjerne et
bilde fra en slide. Et token som bare får lagre filer kan heller ikke lese dekket
gjennom den. Verken kvitteringen eller avvisningen navngir en slide eller en
sone; avvisningen sier hvor mange steder filen vises, av hvert slag, og resten
finner en agent med `list_assets` og `inspect_slide` – som krever
`presentations:read`.

Et token er en delegasjon fra Slaids-eieren, ikke en ny bruker: raden navngir
eieren, og det er derfra `owner_id` kommer på hver skriving.

### Audit

Hvert autentisert kall skriver én rad i `slaids_agent_audit`: hvilket token (id
og navn, aldri tokenet selv), tidspunkt, operasjon, presentasjon, om det gikk, og
feilkoden. Også katalogoppslag (`index`, `catalogue`) og forespørsler til en
ukjent adresse (`unknown_route`) – et stjålet tokens første trekk er å spørre hva
det får lov til, og det er det tidligste en eier kunne legge merke til. Tabellen har ingen kolonne slideinnhold, filbytes eller hele
forespørsler kan havne i. Et tilbakekalt token som brukes igjen skrives også
ned – det er dét en audit er til for – mens et token ingen har sett før ikke
gjør det, siden det ikke er noen å tilskrive raden.

### Servermiljø

REST-laget kjører som en Vercel-funksjon (`api/agent/v1.ts`) og krever to
servervariabler, som **ikke** skal ha `VITE_`-prefiks:

```bash
SLAIDS_SUPABASE_URL=https://<ref>.supabase.co   # eller SUPABASE_URL
SLAIDS_SUPABASE_SECRET_KEY=sb_secret_…          # eller SUPABASE_SERVICE_ROLE_KEY
SLAIDS_AGENT_MAX_REQUEST_BYTES=4194304          # valgfri; standard 4 MB
```

**Agenten må bruke Slaids' eget domene, ikke en `.vercel.app`-adresse.** Vercel
Authentication er slått på for alt annet enn egne domener, så et kall til en
preview- eller `.vercel.app`-adresse svarer med en omdirigering til Vercels
innlogging i stedet for med API-et. Det gjelder hele deployen, ikke bare
agent-API-et.

Nøkkelen går forbi row level security, og hører derfor bare hjemme i
servermiljøet. Alt som heter `VITE_*` bygges inn i nettleserbundelen – finner
oppstarten den samme nøkkelen under et slikt navn, nekter den å starte i det
hele tatt, fordi nøkkelen da allerede er offentlig og må roteres. Uten
variablene svarer API-et `503` og sier hvilken som mangler; en server har ingen
IndexedDB å falle tilbake på.

Tabellene `slaids_agent_tokens` og `slaids_agent_audit` kommer med migrasjonen
`20260902190000_slaids_agent_api.sql`. Se «Deploye Slaids-migrasjoner».

### Ruting av agent-API-et

Alle adressene – MCP-endepunktet inkludert – serveres av **én statisk funksjon**,
`api/agent/v1.ts`, som svarer på `/api/agent/v1`. Alt under den kommer inn gjennom
én eksplisitt rewrite i `vercel.json`:

```json
{ "source": "/api/agent/v1/:__slaidsPath*", "destination": "/api/agent/v1" }
```

Det er ikke en stilpreferanse. Inngangen var tidligere en
`[...path]`-catch-all, altså en rute plattformen utvidet på egen hånd ut fra
filnavnet – og det den faktisk dekket var ett ledd: `/api/agent/v1/operations`
svarte med katalogen, mens `/api/agent/v1/operations/<navn>` – adressen hver
eneste operasjon kalles på – fikk Vercels egen tekst-404. Klienten fikk da
`SyntaxError: Unexpected token 'T', "The page c"…`, fordi svaret aldri kom fra
Slaids. Ruting som står skrevet i repoet kan testes; ruting som utledes av et
filnavn kan bare observeres i produksjon.

En rewrite kan ikke bære ekstra ledd inn i en statisk funksjon, så Vercel legger
dem i query-strengen til destinasjonen. `agentApiUrl` i `src/routing.ts` setter
adressen sammen igjen og **fjerner parameteren** før ruting: query-strengen er
operasjonsinput for en råopplasting, og et felt plattformen la til ville blitt
avvist av et strengt skjema. `src/server/agent/deployment.test.ts` går den veien en
adresse med to ledd faktisk går – `vercel.json` kompilert med Vercels egen
`convertRewrites`, videre inn i funksjonens URL, gjennom ruteren og ut som
operasjonens eget svar – og sjekker samtidig at SPA-rewriten aldri tar `/api/`.

`npm run build` bygger serverfunksjonen til én fil, `src/server/generated/agentApi.js`,
og Vercel-inngangen importerer den. Det er ikke en optimalisering: plattformen
kompilerer hver `.ts`-fil for seg og lar Node løse importene mellom dem, og
TypeScript skriver modulnavn ut ordrett – så `from './handler'` blir stående, og
Nodes ESM-resolver har verken filtypegjetting eller index-oppslag. Uten
bundelen svarer funksjonen `ERR_UNSUPPORTED_DIR_IMPORT` ved første kall, med en
grønn deploy bak seg. `scripts/check-agent-bundle.mjs` laster bundelen i vanlig
Node og kaller den som en del av byggingen, så nøyaktig den feilen stopper her i
stedet for i produksjon. Den bygger også verktøykatalogen inne i bundelen: den
genereres først når en klient spør, så en operasjon hvis input ikke lar seg
uttrykke i JSON Schema ville ellers deployet grønt og svart `500` på den aller
første `tools/list`. Og den leter etter Slaids' eget stilark i bundelen: CSS-en
previewet tegner med importeres med `?inline`, og en import som ikke blir
prosessert feiler ikke – den gir en tom streng, og previewet ville rendret hver
slide uten stiler mens alt som bare leser markup fortsatte å bestå.

`vercel.json` har i tillegg én `functions`-oppføring, av samme grunn som
rewriten står skrevet ned:

```json
{ "api/agent/v1.ts": { "includeFiles": "node_modules/@sparticuz/chromium/bin/**" } }
```

Nettleseren previewet rasteriserer med ligger i `@sparticuz/chromium`, og
plattformens avhengighetssporing følger *importen* og pakker JavaScript-en. Det
den ikke kan se, er at pakken deretter leser en Chromium ut av sin egen `bin/` –
brotli-blober, funnet via en sti utledet av `import.meta.url`, som ingen
importgraf nevner. Uten linjen over ville hver eneste preview svart «the input
directory does not exist» bak en grønn deploy, og `deployment.test.ts` håndhever
den derfor sammen med resten av rutingen.

## MCP-server for agenter

De samme operasjonene er også MCP-verktøy, på den samme adressen og bak det samme
tokenet:

```
POST /api/agent/v1/mcp
```

Transporten er **Streamable HTTP** i revisjonen `2025-06-18`, i den tilstandsløse
formen: én JSON-RPC-melding per POST, svaret som `application/json` på den samme
responsen. Pek en MCP-klient dit, med tokenet i den vanlige headeren:

```jsonc
{
  "mcpServers": {
    "slaids": {
      "type": "http",
      "url": "https://<domenet>/api/agent/v1/mcp",
      "headers": { "Authorization": "Bearer slaids_at_…" }
    }
  }
}
```

Verktøyene heter `slaids_<operasjon>` – `slaids_create_presentation`,
`slaids_inspect_slide`, `slaids_set_zone_text` og så videre. Prefikset er et
navnerom, ikke en del av navnet: en klient holder alle serveres verktøy i én flat
liste, og korte navn er noe to servere kan velge det samme av.

### Katalogen er den samme katalogen

Verktøylisten er ikke skrevet for hånd. Den bygges av det samme
operasjonsregisteret REST-katalogen kommer fra, så navn, beskrivelser, JSON Schema
og scopes er nøyaktig de Agent Core håndhever. Det finnes ikke ett eneste
operasjonsnavn som streng i MCP-laget, og en test håndhever det – en håndskrevet
liste ville ellers blitt oppdaget først den dagen den manglet en ny operasjon.

Det er heller ingen egen implementasjon under: begge transportene kaller de samme
to funksjonene (`authorizeOperation`, `performOperation`) i den samme rekkefølgen.
Samme operasjon gir samme svar og samme feilkode over REST og MCP, og en test går
gjennom hver eneste operasjon begge veier og sammenligner.

### Svarene

Et vellykket kall svarer med operasjonens eget objekt i `structuredContent` –
det samme REST legger i `data` – og den samme JSON-en som tekst, for en klient
som bare viser tekst:

```jsonc
{
  "content": [{ "type": "text", "text": "{ \"presentationId\": \"p_…\", … }" }],
  "structuredContent": { "presentationId": "p_…", "revision": "…", "slides": [ … ] },
  "_meta": { "slaids/revision": "…" }
}
```

**En avvisning et verktøy kom fram til er et resultat, ikke et unntak:**

```jsonc
{
  "isError": true,
  "content": [{ "type": "text", "text": "CONTENT_DOES_NOT_FIT: …" }],
  "structuredContent": {
    "error": { "code": "CONTENT_DOES_NOT_FIT", "message": "…",
               "details": { "slideId": "…", "nodeId": "…", "overflow": 42 } }
  }
}
```

Det er med vilje: en modell som ser `CONTENT_DOES_NOT_FIT` og hvor mye som ble til
overs, kan korte ned teksten. En JSON-RPC-feil ville i de fleste klienter blitt
«verktøykallet feilet», med det nyttige i et hjørne.

**Et rendret preview kommer som en image-blokk**, altså MCPs egen mekanisme for
visuelt innhold – den blokken en klient gir videre til en multimodal modell:

```jsonc
{
  "content": [
    { "type": "text", "text": "{ \"slideId\": \"s_…\", \"fontsReady\": true, … }" },
    { "type": "image", "data": "iVBORw0KGgo…", "mimeType": "image/png" }
  ],
  "structuredContent": {
    "slideId": "s_…", "pageKind": "authored-slide", "revision": "…", "scale": 1,
    "fontsReady": true, "warnings": [],
    "image": { "mimeType": "image/png", "width": 1600, "height": 900, "byteLength": 48213 }
  }
}
```

De samme bytene limt inn som tekst ville vært en halv megabyte tegn modellen
leser som tegn. `structuredContent` beskriver bildet og gjentar det ikke – bytes
der ville vært en andre kopi i alt som logger JSON.

### Hvor en feil havner

Skillet går på **om et ekte verktøy fikk bestemme**, ikke på hvor alvorlig feilen er:

| Hva som skjedde | Hvor svaret kommer |
| --- | --- |
| En operasjon kjørte og sa nei: `CONTENT_DOES_NOT_FIT`, `CONFLICT`, `PRESENTATION_NOT_FOUND`, `FORBIDDEN_SCOPE`, `STORAGE_FAILED` … | verktøyresultat med `isError: true` |
| Verktøyet finnes ikke (`UNKNOWN_OPERATION`) | JSON-RPC-feil `-32602` |
| Argumentene passer ikke verktøyets skjema (`INVALID_INPUT`) | JSON-RPC-feil `-32602` |
| Meldingen var aldri et gyldig kall: uparsbar JSON, ukjent metode, batch, `id: null`, `initialize` uten `clientInfo`, en `cursor` som er et tall | JSON-RPC-feil |

Feilobjektet er det samme uansett – i `structuredContent.error` på et resultat, og i
`error.data` på en JSON-RPC-feil – så koden og detaljene en agent handler på er de
samme REST returnerer. Referanseimplementasjonen trekker streken på samme sted, så
en agents feilhåndtering virker likt mot andre MCP-servere.

### Hva serveren ikke tilbyr

- **Ingen sesjon.** Ingen `Mcp-Session-Id` deles ut. Tokenet er identiteten på hver
  melding, og det eneste som må huskes mellom to kall – hvilken lesing en skriving
  gjøres mot – ligger allerede i presentasjonens `revision`. Det er dét som gjør
  endepunktet riktig på en plattform som kan svare fra to kalde instanser.
- **Ingen SSE-strøm.** Slaids sender verken notifikasjoner eller progresjon, så
  `GET` på endepunktet svarer `405` i stedet for å holde en tom forbindelse åpen.
  `DELETE` svarer det samme, siden det ikke er noen sesjon å avslutte.
- **Ingen resources og ingen prompts.** Hele flaten er semantiske operasjoner, og
  de er verktøy. En resource-liste over presentasjoner ville vært en annen måte å
  lese de samme dekkene på, med en annen kontrakt å holde i takt.
- **Ingen bildegenerering.** Som ellers i Slaids: et rasterbilde lastes opp ferdig,
  en figur skrives som SVG-markup.

### Versjon og Origin

**Slaids annonserer bare revisjonen den faktisk implementerer**, i dag `2025-06-18`
alene. Å annonsere `2025-03-26` ville lovet en klient at endepunktet tar imot
JSON-RPC-batcher, som det avviser; `2024-11-05` ville lovet den gamle
HTTP+SSE-transporten med to endepunkter som ikke finnes her. En nyere klient
forhandler seg ned – det er dét forhandlingen er til for – og den offisielle
klienten gjør nøyaktig det i `interop.test.ts`.

`MCP-Protocol-Version`-headeren valideres mot den samme listen. Mangler den, leses
den som den ene revisjonen serveren har – ikke som spesifikasjonens
`2025-03-26`-fallback, siden den ikke er implementert. En annen versjon gir `400`.

**`Origin` valideres**, som Streamable HTTP krever mot DNS rebinding — ved at
endepunktet avviser *enhver* forespørsel som bærer en. Alle vanlige MCP-klienter er
programmer, ikke nettlesersider, og sender ingen `Origin`; de berøres ikke.

Det kan se strengt ut, men den nærliggende sjekken – sammenlign `Origin` med
forespørselens egen vert – beskytter ikke mot noe. I angrepet den skal stoppe er
begge sider angriperens: siden ligger på `evil.example`, DNS-en for `evil.example`
peker om til denne serveren, og nettleseren sender `Host: evil.example` sammen med
`Origin: https://evil.example`. De matcher, og forespørselen slipper gjennom. Den
betrodde listen må komme fra et sted angriperen ikke styrer – og Slaids har ingen
browser-origin å betro, så den ærlige listen er den tomme. Skal en browser-basert
klient noen gang støttes, leses de betrodde origin-ene fra servermiljøet, aldri fra
forespørselen.

Sjekken skjer før kroppen leses, så en side aldri når en operasjon, langt mindre en
som skriver.

### Protokollen er skrevet for hånd

`@modelcontextprotocol/sdk` er en **devDependency, aldri en runtime-avhengighet**.
Serversiden av SDK-en bygger på Nodes `IncomingMessage`/`ServerResponse`, mens
plattformen her gir en web-`Request` og venter en `Response` – og en tilstandsløs
Streamable HTTP-server er noen få titalls linjer uansett.

Men en protokoll skrevet for hånd er en protokoll validert mot vår egen lesing av
spesifikasjonen, og det er nøyaktig det som kan være galt. Så SDK-en er testens
orakel i stedet: `src/server/mcp/interop.test.ts` starter en ekte HTTP-server og
kjører den offisielle klienten mot den. Klienten validerer hver melding mot
spesifikasjonens egne skjemaer, så et feilformet `initialize`-svar eller et
verktøyskjema som ikke er et objekt stopper der.

### Auditen er den samme auditen

Et `tools/call` skrives ned under operasjonens eget navn, med statusen feilkoden
ville hatt over HTTP – en `CONFLICT` er 409 i auditen uansett hvilken vei den kom
inn. Det gjør at REST og MCP kan leses i én spørring. Bare protokolltrafikken har
egne navn: `mcp:initialize`, `mcp:tools/list`.

## Arkitektur

```
src/
  domain/        headless kjerne: typer, geometry engine, layouttre, kommandoer,
                 Zod-schema, migrasjoner, referanser, farger, fit, validering,
                 revisjon
  agent/         Agent Core: transportuavhengige, semantiske operasjoner over
                 domenekommandoene (grunnlaget for både REST og MCP)
  render/        rendret preview: appens egne slide-komponenter og stilark,
                 headless, pluss rasteriseringen i en ekte Chromium. Importeres
                 aldri av appen, og bare fra én fil i server/
  server/        transportlagene over Agent Core. Importeres aldri av appen – en
                 egen test håndhever det
    agent/       REST: autentisering, scopes, audit, binærtransport, og
                 invoke.ts, som er det begge transportene faktisk kaller
    mcp/         MCP: JSON-RPC-konvolutten, verktøykatalogen bygget av
                 operasjonsregisteret, og Streamable HTTP-endepunktet
  persistence/   SlaidsRepository + Dexie/IndexedDB og Supabase, assets, .slaids-backup
  sharing/       klienten mot den offentlige delings-funksjonen
  supabase/      Supabase-klient, konfigurasjon og modusvalg
  state/         Zustand-store, autosave, DOM-måling, utklippstavle, delingsstatus
  ui/            React-komponenter (bibliotek, editor, slide-renderer, visning, delt visning)
  routing.ts     hva en URL betyr: arbeidsområde eller /s/<token>

api/
  agent/v1.ts    Vercel-inngangen til hele agent-API-et, REST og MCP, og den
                 eneste filen her: hver .ts-fil under api/ blir et offentlig
                 endepunkt. Én statisk funksjon på /api/agent/v1; all logikk
                 ligger i src/server/ og importeres som én ferdig bundel (se
                 «Servermiljø» og «Ruting av agent-API-et»)

supabase/
  migrations/    skjemaet, inkludert delingskolonnene, version-triggeren,
                 agenttokens og auditen
  functions/     slaids-share: den eneste offentlige inngangen

scripts/
  deploy-migrations.sh   kjører Slaids' migrasjoner uten å røre den delte historikken
```

Regler som gjelder overalt:

- **UI muterer aldri domeneobjekter direkte.** All strukturendring går gjennom
  typede kommandoer i `src/domain/commands/`, som returnerer `Ok`/`Err`.
- Domene-, geometri- og repository-lagene er React-uavhengige, slik at REST- og
  MCP-API-et er bygget på nøyaktig de samme kommandoene som editoren.
- Alt som lagres har `schemaVersion` og valideres med Zod ved innlasting.
- **Det finnes én slide-renderer.** Editoren, presentasjonsmodus, den delte
  visningen, filmstripen, den offscreen fit-målingen og agentens rendrede
  preview tegner alle `DeckPageView` under `src/styles/slide.css`. Previewet er
  ikke et unntak fra regelen – det er den skarpeste formen av den, siden det er
  det eneste som tegner den utenfor en nettleser.

## Ikke bygget ennå

Samarbeid er ikke «ennå ikke bygget», men et bevisst ikke-mål: deling er
publisering av en lesbar kopi, og det finnes ingen invitasjoner, roller eller
skrivetilgang for andre enn eieren.

Én kjent skjevhet står igjen: editorens opplastingsdialog lagrer fortsatt en SVG
en bruker velger uten å gå gjennom `domain/svg.ts`. Dører inn til assetlageret
bør på sikt være én dør.

Agentflaten har tre hull igjen mot editoren, alle bevisste: en agent kan *bruke*
bibliotekets mapper, men ikke opprette eller slette dem; tekstformatet en agent
skriver har ingen bildeblokk, så innfelte bilder i rik tekst kan bare leses;
og layoutmaler og idéflaten er utenfor med vilje – den første er en snarvei for
noen som bygger med musen, den andre en notatflate som aldri forlater
arbeidskopien.
