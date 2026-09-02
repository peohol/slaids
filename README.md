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

**Agent-API**

- versjonert REST under `/api/agent/v1/`, med katalogen generert fra
  operasjonene selv
- tilbakekallbare tokens med scopes; vanlig redigering gir ikke rett til å dele
- binær filopplasting uten base64, og `409 CONFLICT` når noen skrev først
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
  `placeSandboxItem`, `splitLeaf`, `addSlide`).
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
| `npm test`          | Vitest (domene, geometri, schema, persistens) |
| `npm run e2e`       | Playwright (bygger og serverer selv)          |

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
fylle dem med tekst, legge inn referanser og sitere dem, plassere bilder, og be
om en eksplisitt sluttkontroll – uten React, museklikk eller databasetilgang:

| Operasjon                                                              | Hva den gjør                                  |
| ---------------------------------------------------------------------- | --------------------------------------------- |
| `create_presentation`, `add_slide`, `duplicate_slide`, `move_slide`, `delete_slide` | bygger dekket                     |
| `inspect_slide`, `get_presentation`, `list_presentations`              | finner id-er, geometri, tekst og revisjon     |
| `split_zone`, `adjust_split`, `delete_zone`, `clear_zone`              | soneinndelingen                               |
| `set_zone_text`, `set_zone_card`, `set_vertical_alignment`, `set_slide_title` | innholdet                              |
| `add_reference`, `update_reference`, `delete_reference`                | referansene citations peker på                |
| `validate_slide`, `validate_presentation`                              | leser og rapporterer, reparerer aldri         |

For bilder finnes det nøyaktig to dører inn:

| Operasjon          | Hva agenten sender                          | Hva den får      |
| ------------------ | ------------------------------------------- | ---------------- |
| `upload_asset`     | metadata + filinnhold (base64, bytes, blob) | `assetId`        |
| `create_svg_asset` | `name` + `svgMarkup`                        | `assetId`        |
| `set_zone_asset`   | `assetId` + slide og sone                   | plassert innhold |

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

Tre ting til er verdt å vite om hvordan laget oppfører seg:

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

Se `IMPLEMENTATION_PLAN.md` §44 for hele kontrakten.

## REST-API for agenter

Agent Core er nåbar utenfra, versjonert fra første dag:

```
GET  /api/agent/v1                    hva dette er, og hvor katalogen ligger
GET  /api/agent/v1/operations         alle operasjoner, med JSON Schema og scopes
POST /api/agent/v1/operations/<navn>  kjør én operasjon
```

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
| `422`  | forstått, og avvist av reglene (`CONTENT_DOES_NOT_FIT`, `UNSAFE_SVG` …)   |
| `502`  | lagringen svarte ikke                                                     |
| `503`  | serveren er ikke satt opp mot Supabase                                    |

Skillet mellom `400` og `422` er poenget: `400` betyr «du sendte tull», `422`
betyr «Slaids sa nei». Å sende det samme på nytt hjelper bare i det første
tilfellet.

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
```

### Samtidighet over ledningen

Hver lesing svarer med `revision`. Send den tilbake som `expectedRevision` på
neste mutasjon, så blir kallet avvist med `409 CONFLICT` i stedet for å
overskrive noen som skrev i mellomtiden.

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
| `assets:write`         | laste opp bilder og lage SVG-figurer                   |
| `sharing:write`        | publisere en presentasjon på en delingslenke           |

**Vanlig redigering gir ikke rett til å publisere.** Et token som skal bygge
slides trenger ikke `sharing:write`, og får det ikke med mindre du krysser det
av. Håndhevingen skjer serverside på hver forespørsel, ut fra det samme feltet
katalogen publiserer.

Et token er en delegasjon fra Slaids-eieren, ikke en ny bruker: raden navngir
eieren, og det er derfra `owner_id` kommer på hver skriving.

### Audit

Hvert agentkall skriver én rad i `slaids_agent_audit`: hvilket token (id og
navn, aldri tokenet selv), tidspunkt, operasjon, presentasjon, om det gikk, og
feilkoden. Tabellen har ingen kolonne slideinnhold, filbytes eller hele
forespørsler kan havne i. Et tilbakekalt token som brukes igjen skrives også
ned – det er dét en audit er til for – mens et token ingen har sett før ikke
gjør det, siden det ikke er noen å tilskrive raden.

### Servermiljø

REST-laget kjører som en Vercel-funksjon (`api/agent/v1/`) og krever to
servervariabler, som **ikke** skal ha `VITE_`-prefiks:

```bash
SLAIDS_SUPABASE_URL=https://<ref>.supabase.co   # eller SUPABASE_URL
SLAIDS_SUPABASE_SECRET_KEY=sb_secret_…          # eller SUPABASE_SERVICE_ROLE_KEY
SLAIDS_AGENT_MAX_REQUEST_BYTES=4194304          # valgfri; standard 4 MB
```

Nøkkelen går forbi row level security, og hører derfor bare hjemme i
servermiljøet. Alt som heter `VITE_*` bygges inn i nettleserbundelen – finner
oppstarten den samme nøkkelen under et slikt navn, nekter den å starte i det
hele tatt, fordi nøkkelen da allerede er offentlig og må roteres. Uten
variablene svarer API-et `503` og sier hvilken som mangler; en server har ingen
IndexedDB å falle tilbake på.

Tabellene `slaids_agent_tokens` og `slaids_agent_audit` kommer med migrasjonen
`20260902190000_slaids_agent_api.sql`. Se «Deploye Slaids-migrasjoner».

`npm run build` bygger serverfunksjonen til én fil, `src/server/generated/agentApi.js`,
og Vercel-inngangen importerer den. Det er ikke en optimalisering: plattformen
kompilerer hver `.ts`-fil for seg og lar Node løse importene mellom dem, og
TypeScript skriver modulnavn ut ordrett – så `from './handler'` blir stående, og
Nodes ESM-resolver har verken filtypegjetting eller index-oppslag. Uten
bundelen svarer funksjonen `ERR_UNSUPPORTED_DIR_IMPORT` ved første kall, med en
grønn deploy bak seg. `scripts/check-agent-bundle.mjs` laster bundelen i vanlig
Node og kaller den som en del av byggingen, så nøyaktig den feilen stopper her i
stedet for i produksjon.

## Arkitektur

```
src/
  domain/        headless kjerne: typer, geometry engine, layouttre, kommandoer,
                 Zod-schema, migrasjoner, referanser, farger, fit, validering,
                 revisjon
  agent/         Agent Core: transportuavhengige, semantiske operasjoner over
                 domenekommandoene (grunnlaget for REST og senere MCP)
  server/        REST-laget over Agent Core: autentisering, scopes, audit.
                 Importeres aldri av appen – en egen test håndhever det
  persistence/   SlaidsRepository + Dexie/IndexedDB og Supabase, assets, .slaids-backup
  sharing/       klienten mot den offentlige delings-funksjonen
  supabase/      Supabase-klient, konfigurasjon og modusvalg
  state/         Zustand-store, autosave, DOM-måling, utklippstavle, delingsstatus
  ui/            React-komponenter (bibliotek, editor, slide-renderer, visning, delt visning)
  routing.ts     hva en URL betyr: arbeidsområde eller /s/<token>

api/
  agent/v1/      Vercel-inngangen til REST-laget; all logikk ligger i src/server/,
                 og importeres som én ferdig bundel (se «Servermiljø»)

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
- Domene-, geometri- og repository-lagene er React-uavhengige, slik at et senere
  REST/MCP-API kan bygges på nøyaktig de samme kommandoene.
- Alt som lagres har `schemaVersion` og valideres med Zod ved innlasting.

## Ikke bygget ennå

MCP-server og rendret preview er bevisst utenfor scope i denne fasen. Begge
legges oppå Agent Core uten å endre domenemodellen, og MCP-laget henter
operasjonsnavn, JSON Schema og scopes fra det samme registeret REST bruker.

Samarbeid er ikke «ennå ikke bygget», men et bevisst ikke-mål: deling er
publisering av en lesbar kopi, og det finnes ingen invitasjoner, roller eller
skrivetilgang for andre enn eieren.
