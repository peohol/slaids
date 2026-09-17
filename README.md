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
- Splits har 2–10 barn med eksplisitte forholdstall. Du kan be om hva du vil –
  `[1, 2]`, `[0.5, 1]` og `[2, 4]` beskriver samme layout – men det som lagres er alltid
  hele tall mellom 1 og 10: den nærmeste fordelingen som kan skrives ned
  (`src/domain/ratios.ts`).
- En ren geometry engine (`src/domain/geometry.ts`) regner ut alle rektangler.
  Det globale gapet `G` løses aritmetisk – `usable = L - G × (n - 1)` – slik at
  nesting aldri kan doble en avstand.
- Editor, miniatyrbilder, presentasjonsmodus og innholdsmåling bruker samme
  renderer og samme geometri.

## Funksjonalitet i dag

**Bibliotek**

- passordinnlogging for Slaids' ene personlige bruker når appen kjører mot Supabase (se «Lagring»)
- opprett presentasjon med tittel, startfarge og globale fonter
- åpne, gi nytt navn, dupliser (inkludert filer), slett til søppelkassen – med
  gjenoppretting, sletting for godt og automatisk tømming etter 30 dager
- hvert kort sier hvor mye plass presentasjonen tar: dokumentet pluss filene
- mapper, og flytting av presentasjoner mellom dem
- eksport og import av `.slaids`-sikkerhetskopi (zip med manifest, data og filer)
- agenttokens: lag, se og trekk tilbake nøklene en KI-agent bruker mot REST-API-et
  og MCP-serveren

**Agent-API**

- versjonert REST under `/api/agent/v1/`, med katalogen generert fra
  operasjonene selv
- **MCP-server på `/api/agent/v1/mcp`** med de samme operasjonene som verktøy,
  bak det samme tokenet – verktøylisten bygges av det samme registeret, og begge
  transportene kaller den samme koden. Selve verktøylisten er offentlig, så en
  klient kan skanne serveren før den har fått et token; alt som rører et dekk
  krever tokenet
- tilbakekallbare tokens med scopes; vanlig redigering gir ikke rett til å dele
- **bibliotekets livsløp**: lage og slette mapper, se dem, flytte en presentasjon
  mellom dem, duplisere en presentasjon med filene sine, og slette en – til
  søppelkassen, som i biblioteket – med scope-grensen tegnet per operasjon og en
  vaktet sletting
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

**Seksjoner**

- `+ Ny seksjon` ved siden av `+ Ny slide`: en side med en stor overskrift og en
  valgfri underoverskrift i piller, midtstilt – alene eller som par
- dekkets første slide er alltid en seksjon, så en presentasjon har alltid en
  forside; en seksjon kan slettes så lenge den etter overtar plassen
- hver seksjon velger **aksentfarge** og **bakgrunnsfarge**, og slidene fram til
  neste seksjon arver dem: overskrifter, kortheadere og bildetekster uten egen
  farge følger aksenten, og sidefargen er seksjonens
- en ny seksjon arver den forriges farger, så samme uttrykk gjennom dekket koster
  ingenting å beholde

**Interaktive slider (miniapper)**

- `+ Interaktiv` under de to andre: last opp **én selvstendig HTML-fil** med all
  CSS og JavaScript innebygget (maks 2 MiB, UTF-8), gi den et navn, og sliden
  viser en forside i dekkets design med knappen «Aktiver miniapp»
- appen kjører bare etter at noen trykker på knappen – i presentasjonen, i den
  delte visningen og på editorens scene – og starter på nytt hver gang;
  miniatyrer, rendret preview og eksport viser alltid forsiden og kjører aldri
  noe
- mens appen kjører eier den tastaturet og klikkene; «Avslutt miniapp» øverst
  til høyre er veien tilbake, og Escape avslutter ikke presentasjonen
- appen kjører i en sandkasset ramme uten nettverk, lagring, popups,
  nedlastinger eller tilgang til Slaids; eksterne skript, stilark, fonter og
  tjenester er ikke støttet i denne versjonen
- **appen arver presentasjonens design**: Slaids gir den seksjonens farger,
  dekkets to fontroller og et basisstilark som CSS-variabler, og legger
  webfontene inn i dokumentet som `data:`-URL-er — så en app som skriver
  `var(--slaids-accent)` følger temaet uten at noe lagres om det. Kontrakten er
  versjonert og beskrevet i [`docs/INTERACTIVE_MINIAPPS.md`](docs/INTERACTIVE_MINIAPPS.md)
- navn og fil endres i panelet ved scenen (en fil som avvises beholder appen);
  dupliser, slett, flytt og angre som for enhver annen slide; hele HTML-kilden
  følger med når presentasjonen deles

**Soneredigering**

- stiplede sonegrenser, slør med backdrop blur over valgt subtre, handlingsknapper
- hit-testing via geometry engine – klikk i gapet velger supersonen
- piltastnavigering opp/ned/venstre/høyre med wraparound, og klikkbar breadcrumb
- splitt sone (2–10 barn) med orientering, forholdstall og live geometri-preview.
  Feltene tar desimaler, tall under 1 og tall over 10; dialogen viser hvilket
  heltallsforhold det blir, og previewet er den layouten
- rediger eksisterende splitting; innhold som mister sonen sin kan reddes til sandkassen
- dra i gapet mellom subsoner for å justere forholdstall direkte. Dragingen er trinnløs,
  og ved slipp snapper layouten til nærmeste heltallsforhold – soner som var like og som
  separatoren ikke ligger inntil, forblir like
- minimumsstørrelse valideres for hele subtreet, ikke bare for det enkelte bladet

**Innhold**

- beholder (transparent), kort uten tittel, kort med tittel, bilde,
  kort med tittel og bilde
- 1–6 subfelt per kort med egne forholdstall, orientering og skillelinjer
- rik tekst via Tiptap: avsnitt, overskrift (pilledesign), fet/kursiv/understreket,
  punktlister, nummererte lister, sitat, kode, lenker og tabeller med rad-/kolonnekontroller
- bilder og SVG som filer i lagringen (Supabase Storage eller IndexedDB), med breddevalg i prosent
- bildeoptimalisering: permanent beskjæring til det synlige utsnittet,
  nedskalering til det sliden trenger, komprimering, fjerning av metadata og
  deduplisering – for ett bilde eller hele presentasjonen, uten synlig
  kvalitetstap (se `docs/IMAGE_OPTIMIZATION.md`)
- hver fil som lastes opp valideres før den lagres, og det gjelder uansett hvor
  den kom fra: et rasterbilde må være en hel, lesbar fil, og en SVG tolkes og
  saneres av Slaids' egen parser – skript, `onclick`, `javascript:`-lenker og
  referanser ut av dokumentet avvises med en forklaring, og det som lagres er
  den saniterte versjonen. En avvist fil lagres ikke halvveis: ingen fil i
  lagringen, ingenting i presentasjonen. Formatet leses av innholdet, ikke av
  filnavnet, så en `.svg` som egentlig er en PNG lagres som PNG-en den er
- et bilde som fyller en sone fyller den helt ut til kantene, med kortets hjørner
  og skygge, og **beskjæres** når formatet ikke passer: hover viser de skjulte
  delene utenfor rammen, og et dra flytter utsnittet, med en magnet i midten
- bildetekst over bildet – øverst, i midten eller nederst – midtstilt, i en tonet
  boks med backdrop-blur som følger seksjonens aksentfarge til noen velger en annen
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

**Minstemål og negativt rom**

Hvor liten en sone kan være avhenger av hva som står i den, ikke av ett globalt
tall. `src/domain/contentSize.ts` svarer på ett spørsmål – «kan denne
innholdstypen tegnes i dette rektangelet?» – og alle inngangene bruker det
samme svaret: layout- og forholdstallsendringer, innholdsvelgeren på desktop og
mobil, drop-targets, validering og agent-API-et.

Innholdstypen **Negativt rom** tegner ingenting og har ingen minstestørrelse:
bevisst luft er et designgrep, og en luftsone kan være så smal komposisjonen vil.
En tom sone har heller ingen minstestørrelse — den tegner ingenting ennå — men
er noe annet: et hull som ikke er fylt, mot en beslutning som er tatt. Blir sonen
liten nok, er «Negativt rom» det eneste valget velgeren tilbyr, og den forteller
hvorfor de andre er utilgjengelige.

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

Sammenligningen gjøres per **region**, ikke per sone: et kort er en header *og*
en kropp, et bilde er en ramme *og* en bildetekst over den. Måles sonen som ett
verste tall, kan en korttittel vokse ut av headeren sin uten at tallet flytter
seg fordi kroppen allerede flommet over mer – og «aldri verre» blir «ingenting
skjedde». Det var hullet korttitlene kom gjennom, både i estimatoren og i
nettleseren, og det er tettet i begge.

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

Prosjektet trenger i tillegg fire innstillinger i Supabase-dashbordet. De
gjelder hele prosjektet og settes én gang:

| Innstilling | Sted i dashbordet | Verdi |
| --- | --- | --- |
| Site URL | Authentication → URL Configuration | `https://www.slaids.no` |
| Redirect URLs | Authentication → URL Configuration | `https://www.slaids.no/**` |
| OAuth 2.1 Server + Dynamic Client Registration | Authentication → OAuth Server | på |
| Authorization Path | Authentication → OAuth Server | `/oauth/consent` |

**JWT Signing Keys skal stå urørt.** Prosjektet signerer med sin egen ES256-nøkkel
og publiserer nøkkelsettet på `…/auth/v1/.well-known/jwks.json`; det er den
verifiseringen av OAuth-tokens bruker, og en symmetrisk algoritme nekter den å
bruke. En nøkkel fra et annet prosjekt skal aldri settes inn her.

Slaids har ikke et flerbrukersystem: bare én bestemt Supabase Auth-bruker er
tillatt. Innloggingsskjermen ber derfor bare om passord, og både app-gaten og RLS-
policyene avviser alle andre Auth-brukere. Supabase-prosjektet deles med
mdeditz, som ikke bruker Supabase Auth i det hele tatt, så det finnes ingen
konto- eller produktkobling til noen annen app. Utlogging bruker
`scope: 'local'`, slik at den bare avslutter Slaids-sesjonen i denne
nettleseren.

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

**Ikke bruk `supabase db push` herfra.** Slaids og mdeditz bor i det samme
Supabase-prosjektet, fra to uavhengige repoer, mens Supabases egen
migrasjonshistorikk, `supabase_migrations.schema_migrations`, er
**prosjektglobal**. Den inneholder begge appenes migrasjoner, blant annet
`20260806120000_mdeditz_store`, som ikke finnes i dette repoet.

`db push` leser den tabellen som om den var historikken til repoet du står i, så
herfra stopper den:

```text
Remote migration versions not found in local migrations directory.
```

og foreslår `supabase migration repair --status reverted 20260806120000` eller
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
prosjektet men ikke lokalt. `slaids-share` er den eneste funksjonen Slaids eier,
og `--prune` er et flagg som bare kan gjøre skade her.

Rekkefølgen mellom de to er ikke likegyldig når begge har endret seg: kjør
migrasjonene **før** funksjonen deployes. `slaids-share` filtrerer på kolonnen
`deleted_at` (søppelkassen), og en funksjon som spør etter en kolonne som ikke
finnes ennå svarer 404 på hver eneste delingslenke til migrasjonen er kjørt.

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

En installasjon som allerede kjører sjekkes utenfra, over ekte HTTP:

```bash
node scripts/mcp-smoke.mjs --base-url https://www.slaids.no
SLAIDS_TOKEN=slaids_at_… node scripts/mcp-smoke.mjs --base-url https://www.slaids.no
```

Uten token kjører den den offentlige halvdelen og avvisningene – nøyaktig det en
verktøyskanning ser – og med token også et ekte verktøykall og en sammenligning
mot REST-katalogen på den samme installasjonen. Den har ingen avhengigheter,
navngir ingen operasjon og skriver aldri ut tokenet. `SLAIDS_TOKEN` i miljøet
leses på samme måte som `--token`, og er å foretrekke: argumentlista til en
prosess er synlig for andre prosesser på maskinen.

Den samme runden kjøres fra Actions-fanen («MCP smoke test»). Den offentlige
halvdelen trenger ingenting; den autentiserte slås på med `authenticated` og
henter tokenet fra repo-secreten **`SLAIDS_AGENT_TOKEN`**. Et agenttoken skal
aldri limes inn som et workflow-input: et input er ikke en hemmelighetsmekanisme,
og GitHub lagrer og viser verdien sammen med kjøringen.

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
| `add_interactive_slide`, `set_interactive_slide`                       | en interaktiv slide fra én HTML-fil, og nytt navn eller ny fil på den; listes aldri med kilden |
| `get_interactive_contract`                                             | hva en miniapp skrives mot: designkontraktens versjon, CSS-variablene, flaten, grensene og hva sandkassen nekter |
| `list_sandbox_items`, `place_sandbox_item`, `duplicate_sandbox_item`, `delete_sandbox_item` | sandkassen: innhold en strukturendring flyttet ut, i stedet for å slette det |
| `set_theme`, `set_presentation_title`                                  | typografien og navnet på hele dekket          |
| `add_section`, `set_section`, `set_section_colors`                     | seksjonene, og fargene delene av dekket arver |
| `add_reference`, `update_reference`, `delete_reference`                | referansene citations peker på                |
| `delete_unused_references`                                             | rydder bort referanser ingenting siterer      |
| `validate_slide`, `validate_presentation`                              | leser og rapporterer, reparerer aldri         |
| `render_slide_preview`                                                 | tegner én side som PNG, slik publikum ser den |

For bilder finnes det nøyaktig to dører inn, to steder et bilde kan stå, to
operasjoner for å bestemme hvordan et bilde som fyller sonen er beskåret, og én
vei ut igjen:

| Operasjon           | Hva agenten sender                                     | Hva den får                    |
| ------------------- | ------------------------------------------------------ | ------------------------------ |
| `upload_asset`      | metadata + filinnhold (base64, bytes, blob)            | `assetId`                      |
| `create_svg_asset`  | `name` + `svgMarkup`                                   | `assetId`                      |
| `set_zone_asset`    | `assetId` + slide og sone                              | bildet som hele sonens innhold |
| `set_zone_text`     | en `image`-blokk med `assetId`, blant tekstblokkene    | bildet stående i teksten       |
| `set_image_focus`   | `x` og `y` mellom 0 og 1                               | utsnittet                      |
| `set_image_caption` | posisjon, tekst og farge                               | bildeteksten                   |
| `list_assets`       | `presentationId`                                       | filene, med `used`             |
| `delete_asset`      | `assetId`                                              | filen ut av dekket, bytene med |

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
- **Et bilde kan også stå inne i teksten.** Det er ikke en annen bildemodell,
  men en blokk til i det samme tekstformatet – den samme noden editoren skriver
  når noen setter inn et bilde i et tekstfelt. Blokken navngir en fil som
  allerede ligger i presentasjonen; bytes finnes aldri i tekstformatet:

  ```json
  {
    "presentationId": "p_…", "slideId": "s_…", "nodeId": "n_…",
    "expectedRevision": "…",
    "blocks": [
      { "type": "heading", "spans": [{ "text": "Resultatet" }] },
      { "type": "paragraph", "spans": [
          { "text": "Målingen", "bold": true },
          { "text": " peker samme vei" },
          { "citation": ["ref_1"] }
      ]},
      { "type": "image", "assetId": "as_…", "alt": "Figur 1", "widthPercent": 60, "align": "center" },
      { "type": "paragraph", "spans": [{ "text": "Kilden er beskrevet under." }] }
    ]
  }
  ```

  `widthPercent` er andelen av kolonnen bildet står i – 100 er hele feltet, og
  standarden er 50, som lar det stå tekst ved siden av. Høyden settes ikke:
  den følger av filens egne proporsjoner, lest ut av bytene da filen ble lagret.
  `inspect_slide` leser den samme blokken tilbake, så en agent kan lese, endre og
  skrive uten å konstruere noe den ikke selv har fått utlevert.
- **En figur er alltid innelukket av feltet sitt, og er derfor aldri det som
  ikke får plass.** Et bilde tegnes aldri høyere enn feltet det står i, uansett
  hvor høy filen er – et portrettfotografi i full bredde fyller feltet i stedet
  for å flyte ut av det. Fit-gaten måler det samme taket, så den avviser aldri
  en figur den ekte rendereren tegner helt fint. Det som *kan* bli avvist, er
  teksten rundt: en linje over en figur som fyller feltet har ingen steder å
  gjøre av seg, og da svarer kallet `CONTENT_DOES_NOT_FIT` med hvor mye som ble
  til overs – smalere figur, eller kortere tekst, og neste forsøk går gjennom.
  At de to målingene faktisk er enige er ikke et resonnement: en test
  sammenligner den hodeløse målingen med en ekte Chromium.
- **Filen må være presentasjonens egen.** `assetId` slås opp i dekkets egen
  filliste før noe skrives; en id fra en annen presentasjon finnes ikke der og
  gir `ASSET_NOT_FOUND` (404) med id-ene som ikke ble funnet. Å *vise* en fil som
  allerede finnes krever bare `presentations:write` – ingen bytes skrives, leses
  eller fjernes – mens `upload_asset` og `create_svg_asset` fortsatt krever
  `assets:write`. Referansen er den samme som editorens, så `delete_asset` nekter
  å slette en fil som bare står inline, og en duplisering peker kopien på kopiens
  egen fil.
- **Ingen bildegenererende operasjon** – ingen `generate_image(prompt)` som
  sender prompten videre til en bildeleverandør. Skal Slaids noen gang generere
  et bilde, er det en endring av `IMPLEMENTATION_PLAN.md` §44 først.
- Uansett dør blir resultatet et helt vanlig asset: bytene i lagringen, en
  `AssetRef` i dokumentet, `isVector: true` for SVG, og visning gjennom `<img>`
  og en Blob-URL – aldri injisert markup.
- **«Uansett dør» gjelder også editoren og `.slaids`-import.** Reglene over er
  ikke agentens regler, men Slaids' regler: en SVG en bruker velger i
  opplastingsdialogen, og en SVG som ligger i en backup noen sender deg, går
  gjennom nøyaktig den samme parseren og lagres som nøyaktig de samme bytene.
  En backup er ekstern input og kan ikke brukes til å gå rundt regelen. Det
  eneste som varierer er hvordan et *rasterbilde* måles: nettleseren kan lese
  størrelsen på formater den hodeløse validatoren ikke kan (AVIF), og en backup
  bærer størrelsen som ble lest den gangen filen først ble lagret.
- Sone-id-en agenten plasserer i finner den med `inspect_slide`, som beskriver
  sonene med geometry engine-ens egne mål – ikke ved å få utlevert dokumentet.

### Planlagte bilder og bildedeponering

Slaids-agent-API-et genererer ikke rasterfiler. Standardflyten er at agenten
reserverer bildesoner, skriver bildeplan og felles bildekontekst, og Slaids
genererer den samlede bildebriefen. Når brukerbestillingen forutsetter
rasterbilder, skal den endelige bildegenereringen vente til presentasjonen er
ferdig validert og bildesonene er stabile; klienten henter da en fersk sluttbrief
fra den endelige presentasjonstilstanden. Har vertsklienten innebygd
bildegenerering, skal den skrive sluttbriefen ut i samme samtale og starte
bildegenereringen umiddelbart; verktøyresponsen alene er ikke handoff. Hvis
klienten ikke kan sende briefen direkte, kan den fortsatt kopieres manuelt. Uten
en egen filbro tilbake til Slaids går de ferdige bildefilene fortsatt via
bildedeponeringen.

| Operasjon                                | Hva den gjør                                                        |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `plan_deck_images`                       | hele bildeplanen: én oppføring per bildesone som venter på en fil    |
| `get_image_brief`                        | den genererte, ferdige bestillingen, kontrollene og deponeringsstatusen |

Agenten reserverer en sone ved å gi den innholdstypen `image` eller
`titled-image-card` uten fil, og beskriver motivet i bildeplanen. Slaids
nummererer bildene i dekkets rekkefølge, måler aspect ratio fra sonens faktiske
geometri, skriver plassholderteksten «Sett inn bilde 3 her» i sonen og genererer
den samlede briefen. Aspect ratio skrives aldri i fritekst av agenten.

Det samme kallet åpner **bildedeponeringen**, og da ser brukeren dette:

1. Presentasjonen åpnes, og en dialog forteller at den har *N* bildeplasser som
   kan fylles automatisk. Enten «Generer og legg inn bilder», eller «Gå til
   editoren» – det siste avslutter ingenting, og knappen for bildebriefen fører
   tilbake hit når som helst.
2. Bildebriefen kopieres med én knapp og limes inn der bildene lages. Under den
   står de samme bildene som en nummerert liste med format og motiv.
3. Bildene lagres som **`1`, `2`, `3` … opp til *N***, med den filendelsen de
   får: `1.png`, `2.jpg`, `3.webp`. Formatene kan gjerne blandes. `01.png`,
   `bilde1.png` og `1a.png` godtas ikke, og to filer med samme nummer meldes som
   en konflikt – ingenting gjettes.
4. «Bildene er klare» åpner deponeringen: filene dras inn eller velges, en
   statusliste viser hva som er på plass, hva som mangler og hva som er feil, og
   «Fullfør» er deaktivert til nøyaktig 1…*N* er der uten feil.
5. Alle filene lastes opp, hvert bilde havner i den sonen det ble bestilt for,
   og plassholderteksten forsvinner.

Endrer brukeren strukturen slik at koblingen brytes – sletter en av de
nummererte bildesonene, tømmer den eller gjør den om til tekst – advarer appen
om at den automatiske innsettingen avsluttes for godt. Bekreftes det, blir dekket
et helt vanlig dekk; avbrytes det, skjer ingenting. En ferdig eller avsluttet
deponering kan aldri startes på nytt.

Noen ting til er verdt å vite om hvordan laget oppfører seg:

- **Agenten styrer temaet, ikke bare innholdet.** `get_presentation` bærer
  de to fontene, luften og skriftstørrelsen, og `set_theme`
  setter dem – gjennom den samme kommandoen som temamodalen, så en temaendring
  som ville skjult innhold blir avvist på samme måte, i sin helhet, uten at noe
  lagres. Luft og skriftstørrelse flytter i tillegg geometrien, så de måles to
  ganger: en endring som ville gjort soner mindre enn det innholdet i dem
  trenger avvises med `ZONE_TOO_SMALL` selv om ikke ett tegn ville blitt
  borte – et kort bruker headeren og paddingen sin uansett hvor kort teksten
  er. Tomme soner og soner satt til negativt rom har ingen minstestørrelse, så
  de stopper ingenting: de tegner ingenting som kunne blitt skjult.
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
- **`slideId` er en side, ikke bare en slide.** En vanlig slide, en seksjon
  (forsiden er den første), eller id-en til en avledet referanseside. En id som ikke finnes gir
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

# Sett et bilde inn i teksten. Filen må allerede ligge i presentasjonen –
# assetId-en kommer fra upload_asset eller create_svg_asset – og bredden er
# andelen av kolonnen. Høyden følger av filens egne proporsjoner.
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"presentationId":"p_…","slideId":"s_…","nodeId":"n_…","expectedRevision":"…",
          "blocks":[{"type":"paragraph","spans":[{"text":"Figuren viser tre trinn."}]},
                    {"type":"image","assetId":"as_…","alt":"Figur 1","widthPercent":60}]}' \
     "$SLAIDS_API/operations/set_zone_text"
```

### Samtidighet over ledningen

Hver lesing svarer med `revision`. Send den tilbake som `expectedRevision` på
neste mutasjon, så blir kallet avvist med `409 CONFLICT` i stedet for å
overskrive noen som skrev i mellomtiden.

Ett unntak, med vilje: å *trekke tilbake* en delingslenke sjekker ingen revisjon
og leser ikke dokumentet. En gammel revisjon – eller et dokument som ikke lar seg
lese – skal aldri kunne holde en offentlig lenke i live.

### Biblioteket: mapper, kopier og sletting

Seks operasjoner arbeider på presentasjonen utenfra i stedet for inni den, og de
bruker bibliotekets egne regler – ikke en parallell modell for API-et.

```bash
# Hvilke mapper finnes?
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{}' "$SLAIDS_API/operations/list_folders"

# Lag en. Svaret er { "folder": { "id": "fl_…", "name": "…", "createdAt": "…" } }.
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"name":"Kundemøter"}' "$SLAIDS_API/operations/create_folder"

# Slett den igjen. Presentasjonene i den blir liggende, uten mappe.
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"folderId":"fl_…"}' "$SLAIDS_API/operations/delete_folder"

# Legg dekket i en mappe. `null` flytter det ut til rotnivå igjen.
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"presentationId":"p_…","folderId":"fl_…"}' \
     "$SLAIDS_API/operations/move_presentation"

# Kopier hele dekket, filene inkludert, og gi kopien et navn
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"presentationId":"p_…","title":"Variant for styret"}' \
     "$SLAIDS_API/operations/duplicate_presentation"

# Slett – til søppelkassen – mot revisjonen du så
curl -H "Authorization: Bearer $SLAIDS_TOKEN" -H 'Content-Type: application/json' \
     -d '{"presentationId":"p_…","expectedRevision":"…"}' \
     "$SLAIDS_API/operations/delete_presentation"
```

**Scopene er ikke de samme for de fire**, og forskjellene er med vilje:

| Operasjon                | Krever                                    |
| ------------------------ | ----------------------------------------- |
| `list_folders`           | `presentations:read`                      |
| `create_folder`          | `presentations:write`                     |
| `delete_folder`          | `presentations:write`                     |
| `move_presentation`      | `presentations:write`                     |
| `duplicate_presentation` | `presentations:read` + `presentations:write` + `assets:write` |
| `delete_presentation`    | `presentations:write` + `assets:write`    |

De to mappeoperasjonene har det minst privilegerte **eksisterende** scopet som
faktisk dekker dem, og det er ikke et nytt mappescope: en mappe er ikke en fil,
så `assets:write` ville delt ut filstoret på kjøpet, og ingenting her publiseres.
`delete_folder` *er* en presentasjonsskriving – den fjerner `folderId` fra hvert
dekk i mappen – og `create_folder` lager beholderen `move_presentation` allerede
arkiverer dekk i med nøyaktig det samme scopet. Ingen av de to leser: kvitteringen
til `delete_folder` er `{ "folderId": "…", "deleted": true }` og bærer verken
mappens navn eller hva som lå i den.

En kopi svarer med kopien slik `get_presentation` ville lest den – derfor
lesescopet – og lagrer én ny fil for hver fil kilden har, derfor `assets:write`.
En sletting setter både dokumentet og hver eneste fil under det på 30 dagers
klokke – de går for godt når søppelkassen tømmes – og det er nøyaktig de to
tingene de to skrivescopene beskytter. Filscopet gjelder begge
veier: autoriteten som legger en fil inn i lageret er den samme som tar den ut,
så et token uten `assets:write` kan verken laste opp, kopiere eller slette filer.
`sharing:write` kreves av ingen av dem: ingenting her publiserer noe, og en
sletting tar en publisert lenke *ned*.

**En sletting er en flytting til søppelkassen**, den samme som i biblioteket:
presentasjonen forsvinner fra `list_presentations`, er `PRESENTATION_NOT_FOUND`
for hver operasjon etterpå – også en ny sletting – og kan gjenopprettes i
biblioteket i 30 dager. Deretter går dokumentet, slidene, filradene, bytene i
lagringen og en eventuell delingslenke for godt, og lenken er død hele tiden
den ligger der. Slettingen er vaktet mot revisjonen operasjonen leste, også når
du ikke oppgir en, og en id som ikke finnes svarer `PRESENTATION_NOT_FOUND` i
stedet for et stille `ok`. Kvitteringen er
`{ "presentationId": "…", "deleted": true }` – ingen `revision`, siden det
ikke finnes et dokument igjen å skrive mot.

**En kopi er selvstendig.** Filene kopieres i stedet for å deles, så kopien
overlever at originalen slettes, og hver id inne i dokumentet – slide, sone,
innhold, subfelt, sandkasse – er ny. Går noe galt underveis, blir det ingen kopi
i det hele tatt: en kildefil som står i dokumentet men mangler i lagringen
avviser hele dupliseringen og ruller den tilbake, og det samme gjør en
lagringsfeil – også når selve kopien rakk å bli skrevet før feilen kom. Du får
aldri et halvferdig dekk med bilder som ikke kan lastes. Kopien arver aldri delingen: den starter
som ikke delt, som en duplisering i biblioteket. `expectedRevision` gjelder
kilden og betyr «kopier nøyaktig den lesingen jeg så».

**En mappe må finnes.** En `folderId` som ikke finnes avvises med
`FOLDER_NOT_FOUND` (404) før noe skrives – et dekk i en mappe som ikke finnes
ville ikke vært synlig noe sted, verken på rotnivå eller i en mappe. Det gjelder
alle tre dørene som navngir en mappe: `create_presentation`, `move_presentation`
og `delete_folder` tar den samme sjekken, så de kan ikke bli uenige om hvorvidt
mappen er der. Å slette en mappe som ikke finnes er derfor `FOLDER_NOT_FOUND` og
ikke et stille `ok` – begge lagrene sletter på id og bryr seg ikke om at id-en
ikke er der. Å flytte et dekk til mappen det allerede ligger i er en lovlig no-op
som ikke flytter revisjonen.

**En sletting av en mappe rører ikke presentasjonene i den.** De blir liggende, på
rotnivå – nøyaktig det biblioteket lover brukeren når man sletter en mappe der.
Det er én operasjon fordi det er ett kall helt ned: begge lagrene fjerner
`folderId` fra hvert dekk i mappen, både i dokumentet og i kolonnen oversikten
filtrerer på, i én transaksjon. I Supabase er den transaksjonen databasefunksjonen
`slaids_delete_folder` – **den krever at migrasjonene er kjørt**
(`scripts/deploy-migrations.sh`), og sier det med rene ord hvis de ikke er det.
`create_folder` tar bare `name` (trimmet, ikke tomt, høyst 200 tegn – den samme
grensen editoren har) – id-en lager Slaids – og `delete_folder` bare `folderId`.
Ingen av dem tar `expectedRevision`: en mappe er ikke et dokument og har ingen
revisjon å skrive mot.

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

Over JSON – og dermed over MCP, som ikke har noen annen meldingsform – er
`content` **et objekt, ikke en streng**:

```json
{ "presentationId": "p_abc", "name": "figur.png",
  "content": { "encoding": "base64", "data": "iVBORw0KGgo…" } }
```

`{"encoding":"text","data":"<svg …>"}` er den andre halvdelen, for tekstformater.
En data-URL er også gyldig som `data`.

Grensen er `SLAIDS_AGENT_MAX_REQUEST_BYTES`, 4 MB som standard, og den gjelder
hele forespørselen. Base64 er en tredjedel større enn filen, så en MCP-klient
kommer opp i taket ved rundt 3 MB fil – og over MCP finnes det ingen annen
meldingsform å bytte til, så svaret sier det rett ut og oppgir den største
filstørrelsen som fortsatt får plass. Over REST er veien videre de to formene
over, der ingenting escapes.

### Agenttokens

Tokens lages i biblioteket, under **Agenttokens**. Et token er

- 32 tilfeldige bytes, generert i din egen nettleser;
- lagret bare som SHA-256, så det kan ikke vises igjen – kopier det med én gang;
- navngitt, med opprettelsestid, valgfri utløpstid og tidspunkt for siste bruk;
- tilbakekallbart når som helst, med umiddelbar virkning.

Det sendes som `Authorization: Bearer slaids_at_…`.

**ChatGPT kan ikke ta imot et slikt token.** En egendefinert MCP-app der tilbyr
ingen legitimasjon eller OAuth, og ingenting imellom – så for ChatGPT er svaret
[OAuth](#oauth-å-koble-slaids-til-chatgpt), ikke et agenttoken. Alle andre
klienter, og hele REST-API-et, bruker agenttokens som før.

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

Hvert autentisert kall skriver én rad i `slaids_agent_audit`: hvilken familie
legitimasjonen kom fra (`agent_token` eller `oauth`), hvilket token (id og navn,
aldri tokenet selv) eller hvilken OAuth-klient (`client_id`, som er offentlig og
reiser i nettleserens adresselinje uansett), tidspunkt, operasjon, presentasjon,
om det gikk, og feilkoden. Et OAuth-kall får aldri en oppdiktet tokenrad: en
logg som sier noe usant er verre enn en som sier mindre. Også katalogoppslag (`index`, `catalogue`) og forespørsler til en
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

**OAuth er av med mindre du slår det på**, og bryteren er én variabel:

```bash
# Påkrevd for OAuth. Supabase-bruker-ID-ene som får koble seg på Slaids.
# Er den tom, finnes det ingen autorisasjonsserver: metadatadokumentet svarer
# 404, utfordringen peker ingen steder, og et JWT avvises som et hvilket som
# helst annet ukjent token. Ingenting annet i API-et endrer seg.
SLAIDS_AGENT_OAUTH_OWNERS=<uuid>[,<uuid>…]

# Valgfrie.
SLAIDS_PUBLIC_ORIGIN=https://www.slaids.no  # adressen metadataen navngir
SLAIDS_AGENT_OAUTH_CLIENTS=<client_id>[,…]  # bare disse OAuth-klientene
SLAIDS_AGENT_OAUTH_SCOPES='presentations:read presentations:write assets:write'
SLAIDS_AGENT_OAUTH_AUDIENCE=<aud>[ <aud>…]  # hvis du setter en egen med en hook
```

`SLAIDS_AGENT_OAUTH_AUDIENCE` **erstatter** standardmottakeren, den legges ikke
til. Uten variabelen godtas Supabases egen `authenticated`; med den godtas
nøyaktig det som står der og ingenting annet. Det er hele poenget med å sette
den: `authenticated` står på hvert eneste brukertoken prosjektet utsteder, så en
smalere mottaker *ved siden av* den ville ikke vært smalere i det hele tatt.

Skal du gå over til en egen mottaker med en Custom Access Token Hook, lever
tokens av begge slag i inntil en time. Da navngir du begge – `'authenticated
https://www.slaids.no/api/agent/v1/mcp'` – og fjerner den første når timen har
gått. Listen er overgangen, uttrykt, og bare så lenge du mener den.

Utstederen og nøkkelsettet utledes av `SLAIDS_SUPABASE_URL` og har ingen egne
variabler: autorisasjonsserveren og databasen *er* det samme prosjektet, og to
variabler som må stemme overens er en måte for dem å slutte å gjøre det på.

`SLAIDS_PUBLIC_ORIGIN` er verdt å sette i produksjon. En ressurs-ID er en fast
streng i OAuth, og uten den leses adressen av forespørselen – som er riktig på
Vercel, der `slaids.no` svarer `308` til `www.slaids.no` lenge før noe når koden,
men som gjør at en vert i en header bestemmer hva Slaids kaller seg.

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
`20260902190000_slaids_agent_api.sql`, og kolonnene for OAuth-kall med
`20260905190000_slaids_agent_oauth_audit.sql`. Se «Deploye Slaids-migrasjoner».

**`SLAIDS_SUPABASE_URL` og `VITE_SUPABASE_URL` må peke på det samme
prosjektet.** Agent-API-et leser sin variabel ved oppstart, nettleseren får sin
inn i bundelen under byggingen, og de er to verdier som må stemme overens. Gjør
de ikke det, feiler ingenting: editoren viser eierens dekk fra det ene
prosjektet, mens agenten oppretter, leser og validerer i det andre – hvert
kall går gjennom, `list_presentations` er bare tomt, og auditraden havner i
den samme feil databasen, så selv loggen er enig med seg selv. Derfor nekter
oppstarten nå, med begge prosjektreferansene i meldingen. Det er verdt å ha
etter en prosjektflytting, som er akkurat når den gamle verdien fortsatt
ligger igjen i et dashbord.

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

De samme operasjonene er også MCP-verktøy, på den samme adressen og med det samme
tokenet:

```
POST /api/agent/v1/mcp
```

**Bruk adressen uten omdirigering.** For denne installasjonen er det
`https://www.slaids.no/api/agent/v1/mcp`: `slaids.no` svarer `308` videre til
`www`, og det er en annen origin. En klient følger omdirigeringen, men **taper
`Authorization` på veien** – Fetch-standarden krever at headeren fjernes ved en
kryss-origin-omdirigering – så tokenet aldri når fram, og hvert kall som trenger
det svarer `401` uten at noe ser galt ut. Discovery virker likevel, siden den
ikke trenger token, så feilen ser ut som «verktøyene er der, men ingenting
virker». `scripts/mcp-smoke.mjs` stopper på en slik omdirigering og navngir
adressen du skal bruke i stedet.

Transporten er **Streamable HTTP** i revisjonen `2025-06-18`, i den tilstandsløse
formen: én JSON-RPC-melding per POST, svaret som `application/json` på den samme
responsen.

Det finnes to måter å legitimere seg på, og hvilken du bruker avgjøres av
klienten din, ikke av Slaids:

- **Et agenttoken** (`slaids_at_…`) for enhver klient som kan få en fast streng:
  Claude Desktop, en editor, et skript, `curl`, og hele REST-API-et. Ingenting
  om dette er endret.
- **OAuth** for klienter som ikke tilbyr det – ChatGPT er den viktigste av dem.
  Se «[OAuth: å koble Slaids til ChatGPT](#oauth-å-koble-slaids-til-chatgpt)».

En klient av den første sorten peker du dit med tokenet i den vanlige headeren:

```jsonc
{
  "mcpServers": {
    "slaids": {
      "type": "http",
      "url": "https://www.slaids.no/api/agent/v1/mcp",
      "headers": { "Authorization": "Bearer slaids_at_…" }
    }
  }
}
```

### Discovery er offentlig, operasjonene er ikke

**MCP discovery er offentlig; Slaids-operasjoner er autentiserte og
scope-gatede.** `initialize`, `ping`, `tools/list` og notifikasjonene besvares
uten legitimasjon; `tools/call` krever nøyaktig den legitimasjonen og de scopene
et REST-kall krever, og uten den svarer endepunktet `401` med
`WWW-Authenticate`. Hele REST-API-et er uendret: hver rute der krever fortsatt
en legitimasjon.

Avvisningen sies to steder i det samme svaret, og det er ikke overdrivelse:
statuslinjen er `401` med utfordringen i headeren, som spesifikasjonen krever og
som en SDK-klient gjør om til en påloggingsflyt, og kroppen er det vanlige
Slaids-resultatet med den samme utfordringen i
`_meta["mcp/www_authenticate"]`, som er der klientene med «mixed
authentication» leter. Ingen av dem er en innrømmelse til én bestemt klient –
det er den samme utfordringen sagt på de to måtene klienter leser den.

Grunnen er rekkefølgen en klient bygges i. En egendefinert MCP-app i ChatGPT
skanner serveren for verktøy **når appen opprettes** – før, og uavhengig av, at en
sluttbruker kobler på kontoen sin. Krever `initialize` et token, blir appen
publisert med tom verktøyliste: ChatGPT kjenner igjen integrasjonen, men har ingen
Slaids-verktøy å tilby. Det samme gjelder inspektørverktøy og enhver annen «skann
serveren, koble på kontoen etterpå»-klient. MCPs egen autorisasjonsspesifikasjon
er valgfri og ligger på transportnivå, så dette er innenfor protokollen – den
låser bare *svaret*: `401` når et token kreves og mangler, `403` for manglende
scopes.

Katalogen kan være offentlig fordi den er produktmetadata. Den kompileres av
operasjonsdefinisjonene i bundelen – navn, beskrivelse, JSON Schema, påkrevde
scopes – uten å ta imot en kaller, og en anonym forespørsel får byte for byte det
samme svaret et token får. Ingen presentasjonstitler, mapper, filer, tokens,
eierdata eller auditrader er nåbare uten token, og en anonym melding skriver ingen
auditrad (det finnes ingen å tilskrive den). Et token som *er* sendt, verifiseres
uansett metode – et tilbaketrukket token blir aldri stille nedgradert til anonym
tilgang, og forsøket havner i eierens audit.

En klient som ennå ikke har et token kan altså se hele katalogen:

```bash
curl -sS -X POST https://<domenet>/api/agent/v1/mcp \
     -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Verktøyene heter `slaids_<operasjon>` – `slaids_create_presentation`,
`slaids_inspect_slide`, `slaids_set_zone_text` og så videre. Prefikset er et
navnerom, ikke en del av navnet: en klient holder alle serveres verktøy i én flat
liste, og korte navn er noe to servere kan velge det samme av.

### OAuth: å koble Slaids til ChatGPT

**ChatGPT tar ikke imot en API-nøkkel.** En egendefinert MCP-app der har to
valg: ingen legitimasjon, eller OAuth. Å lime inn et `slaids_at_…` er altså ikke
noe du *kan* gjøre i ChatGPT, uansett hvor gjerne du skulle ville – så Slaids er
også en OAuth-ressursserver, med Supabase Auth som autorisasjonsserver.

Det er den samme påloggingen du allerede bruker i Slaids. Det opprettes ingen ny
bruker, ingen ny konto og ingen ny passordbase.

#### Slik ser det ut for deg

1. Du legger til Slaids som en egendefinert MCP-app i ChatGPT, med adressen
   `https://www.slaids.no/api/agent/v1/mcp`. ChatGPT leser verktøylisten med én
   gang – uten pålogging, siden discovery er offentlig.
2. Første gang du ber ChatGPT gjøre noe med presentasjonene dine, sier den at
   Slaids krever pålogging.
3. Du blir sendt til Slaids' egen samtykkeside på `www.slaids.no`, logger inn
   slik du pleier, og godkjenner at ChatGPT får jobbe med dekkene dine.
4. ChatGPT får et tidsbegrenset token og fornyer det selv. Du gjør ingenting mer.
5. ChatGPT ser bare **dine** presentasjoner – de samme du ser i biblioteket.

#### Hva som skjer under

Slaids gjør nøyaktig det en OAuth-ressursserver skal gjøre, og ikke mer:

- **Peker på autorisasjonsserveren.** Et dokument etter RFC 9728 ligger på
  `https://www.slaids.no/.well-known/oauth-protected-resource/api/agent/v1/mcp`
  (og på rot-adressen `/.well-known/oauth-protected-resource`, som
  spesifikasjonen ber klienter prøve som nummer to). Det er offentlig – det er
  jo det man leser *fordi* man ikke har en legitimasjon ennå – og det navngir
  Supabase-prosjektets `/auth/v1` som autorisasjonsserver. Derfra finner klienten
  selv authorization- og token-endepunktene, PKCE og eventuell dynamisk
  klientregistrering.
- **Sier fra i `WWW-Authenticate`.** Et kall uten legitimasjon svarer `401` med
  `Bearer realm="slaids-agent", resource_metadata="…"`, som er pekeren RFC 9728
  §5.1 definerer. Var det et token som ble avvist, står `error="invalid_token"`
  der også; var det ingen, står det ikke, fordi ingenting ble avvist.
- **Sier hvilke verktøy som krever hva.** Hvert verktøy i katalogen bærer
  `securitySchemes: [{ "type": "oauth2", "scopes": [...] }]`, med operasjonens
  egne scopes. Det er dét en klient med «mixed authentication» leser for å vite
  at den må be om pålogging før den kaller – og listen er utledet av
  `operation.scopes`, ikke skrevet ned et sted til.
- **Verifiserer tokenet selv.** Signaturen sjekkes mot prosjektets JWKS
  (asymmetrisk, ES256), og utsteder, mottaker og utløp mot det installasjonen er
  satt opp med. Ingenting leses ut av et token som ikke er verifisert. Mottakeren
  er `authenticated` – det Supabase utsteder – med mindre installasjonen har
  navngitt en smalere i `SLAIDS_AGENT_OAUTH_AUDIENCE`, som da er den eneste som
  godtas.

#### Scopene er de samme

Supabase' OAuth-server støtter ikke egendefinerte scopes ennå. Et OAuth-token får
derfor **et standardsett** som installasjonen bestemmer, og standarden er de tre
redigerende: `presentations:read`, `presentations:write`, `assets:write`.
`sharing:write` er ikke med – vanlig redigering gir aldri rett til å publisere –
så en ChatGPT-tilkobling kan bygge dekk, men ikke legge dem ut på en offentlig
lenke uten at du sier fra. Sett `SLAIDS_AGENT_OAUTH_SCOPES` hvis du vil ha det
annerledes.

Bærer tokenet *selv* Slaids-scopes en dag – Supabase har det på veikartet, og en
Custom Access Token Hook kan gjøre det i dag – er det tokenet som gjelder, og
aldri noe mer enn det. Håndhevingen etterpå er den samme koden som for et
agenttoken: `authorizeOperation` vet ikke hvilken familie kalleren kom fra.

#### Hva som må slås på

OAuth er **av** i en installasjon som ikke har fått en eierliste. Det er med
vilje: agent-API-et holder en nøkkel som går forbi row level security, og
«hvilken som helst bruker av prosjektet» ville vært en videre dør enn
nettleseren har – prosjektet står åpent for registrering, og eierlisten er den
samme låsen som RLS-policyene bruker.

Fire ting må være på plass, og ingen av dem skjer av seg selv. Fram til de er
det, oppfører API-et seg nøyaktig som før: agenttokens virker, discovery er
offentlig, og et JWT avvises som et hvilket som helst annet ukjent token.

1. **Migrasjonen.** `20260905190000_slaids_agent_oauth_audit.sql` gir
   auditloggen kolonnene et OAuth-kall skrives i. Se «Deploye
   Slaids-migrasjoner».
2. **Autorisasjonsserveren**, i Supabase-dashbordet for Slaids' eget prosjekt,
   under Authentication → OAuth Server:
   - slå på **OAuth 2.1 Server**. Er den av, svarer autorisasjonsserverens
     metadata `feature_disabled`, og ingen klient kommer forbi pålogging;
   - slå på **Dynamic Client Registration**. ChatGPT registrerer seg selv som
     klient, og uten den finnes det ingen `client_id` å godkjenne;
   - sett **Authorization Path** til `/oauth/consent`;
   - la **JWT Signing Keys** være. Prosjektet signerer allerede med ES256 og
     publiserer nøkkelsettet på `…/auth/v1/.well-known/jwks.json`; det er den
     verifiseringen bruker, og en symmetrisk algoritme nekter den å bruke.
3. **Site URL**, under Authentication → URL Configuration, satt til
   `https://www.slaids.no`. Supabase bygger adressen til samtykkesiden av
   **Site URL + Authorization Path**, så de to sammen er det som gjør
   `https://www.slaids.no/oauth/consent` til autorisasjonsendepunktet. Se
   «Samtykkesiden ligger på Slaids' eget domene» under.
4. **Servervariablene i Vercel** (Settings → Environment Variables, for
   Production), uten `VITE_`-prefiks. `SLAIDS_AGENT_OAUTH_OWNERS` med
   Supabase-bruker-ID-en som skal få koble seg på – den samme eieren
   RLS-policyene er festet til, `SLAIDS_OWNER_ID` i `src/supabase/access.ts` –
   er hele på-knappen. `SLAIDS_PUBLIC_ORIGIN=https://www.slaids.no` er *ikke*
   påkrevd – uten den leses adressen av forespørselen – men bør settes i
   produksjon, av grunnen som står under «Servermiljø». **Ikke sett
   `SLAIDS_AGENT_OAUTH_AUDIENCE`:** Supabase utsteder `aud: "authenticated"`,
   og en annen verdi ville avvist hvert eneste token prosjektet faktisk lager.
   Variabler leses ved oppstart, så deployen må kjøres på nytt etterpå –
   Deployments → ⋯ → Redeploy, eller en ny merge til `main`.

   ID-en finnes i Supabase under Authentication → Users, og skal være den
   samme som `SLAIDS_OWNER_ID`. Er de ulike, er det ikke eierlisten som er
   feil: `AuthGate` slipper bare den ene uuid-en inn i arbeidsflaten, og RLS
   er festet til den samme, så da er editoren allerede stengt for eieren og
   konstanten er det som skal rettes. Én uuid, tre steder som må være enige –
   kontrollér den der før du limer den inn i Vercel.

#### Samtykkesiden ligger på Slaids' eget domene

Supabase bygger adressen til samtykkesiden av **Site URL + Authorization Path**,
ikke av en full adresse man kan skrive inn: «The authorization path is combined
with your Site URL … to create the full authorization endpoint URL.» Det finnes
nøyaktig én Site URL per prosjekt, og den bestemmer hvilket domene som får være
autorisasjonsflate for hele prosjektet.

Slaids' prosjekt har `https://www.slaids.no` som Site URL og `/oauth/consent`
som Authorization Path, og autorisasjonsendepunktet blir dermed
`https://www.slaids.no/oauth/consent`. mdeditz deler prosjektet, men bruker ikke
Supabase Auth i det hele tatt, så det finnes ingen annen app som har noe å tape
på at Site URL peker på Slaids.

Det var ikke alltid sånn. Da Slaids lå i det samme Supabase-prosjektet som
Huskis, var Site URL `https://huskis.no` – Huskis bruker den som fallback i
Auth-flyter som ikke sender `redirectTo` selv – og samtykkesiden måtte nås via
en `redirects`-regel i Huskis' `vercel.json` som sendte `/oauth/consent` videre
til `www.slaids.no` med `authorization_id` i behold. Slaids har sitt eget
prosjekt nå, så omveien er borte: regelen i Huskis gjør ingenting for Slaids
lenger og kan fjernes når Huskis-repoet ryddes.

På Slaids-siden ligger `/oauth/consent` bak `AuthGate`: eieren logger inn som
vanlig – med passord, uten omdirigering, så forespørselen overlever
påloggingen – og ser deretter samtykkeskjermen for den samme
`authorization_id`-en.

#### Slik verifiserer du at det virker, i rekkefølge

1. **Uten legitimasjon**, fra hvor som helst:

   ```bash
   node scripts/mcp-smoke.mjs --base-url https://www.slaids.no --expect-oauth
   ```

   – eller «MCP smoke test» under Actions, som kjører det samme. Se etter:

   ```text
   ok    protected resource metadata — ressursen er https://www.slaids.no/api/agent/v1/mcp
   ok    den samme metadataen på rot-adressen — identisk
   ok    autorisasjonsserveren finnes og er slått på — https://<ref>.supabase.co/auth/v1, PKCE S256
   ok    dynamisk klientregistrering er på — på (en tom registrering avvises med 400, …)
   ok    401-utfordringen peker på metadataen — peker på dokumentet
   ok    verktøyene sier at de krever OAuth — 54 verktøy, alle med oauth2
   ```

   Den ser forskjell på «OAuth 2.1 Server er ikke slått på i Supabase»,
   «Dynamic Client Registration er av» og «installasjonen har ingen eierliste».

   **`--expect-oauth` gjør det siste til en rød kjøring i stedet for en
   hoppet-over linje**, og det er verdt å ha på for produksjon: en
   installasjon uten eierliste svarer glad på hele oppdagelsen – håndtrykket
   går, verktøylisten kommer – og stopper først når et verktøy faktisk skal
   brukes. En grønn kjøring som hoppet over OAuth ville sagt at ingenting er
   galt. I workflowen er `expect_oauth` på som standard; slå den av for en
   installasjon som med vilje bare tar agenttokens.
2. **Hele flyten, som en ekte klient**, fra din egen maskin og uten ChatGPT:

   ```bash
   node scripts/mcp-oauth-client.mjs --base-url https://www.slaids.no
   ```

   Skriptet registrerer seg som klient (det er den dynamiske registreringen i
   bruk), skriver ut en adresse du åpner i nettleseren, tar imot koden på
   `127.0.0.1` når du har gitt tilgang på samtykkesiden, bytter den i et token
   og gjør ett ekte, autentisert `tools/call`. Går det gjennom, er alt som
   gjenstår for ChatGPT ChatGPT. `--print-token` skriver tokenet på siste
   linje, for `SLAIDS_OAUTH_TOKEN` i smoke-testen eller secreten
   `SLAIDS_OAUTH_ACCESS_TOKEN` i Actions; det utløper innen en time.
3. **ChatGPT.** Settings → Apps & Connectors → Advanced settings → slå på
   **Developer mode**. Så Create: navn «Slaids», MCP Server URL
   `https://www.slaids.no/api/agent/v1/mcp`, Authentication **OAuth**, og la
   client id og secret stå tomme – ChatGPT registrerer seg selv. Verktøylisten
   dukker opp med én gang. Første gang du ber om noe – «list presentasjonene
   mine i Slaids» – sender ChatGPT deg gjennom påloggingen over, og kaller
   deretter `slaids_list_presentations` med et OAuth-token.
4. **Auditloggen** sier det samme fra innsiden:

   ```sql
   select at, principal_kind, client_id, operation, status
   from public.slaids_agent_audit
   order by at desc
   limit 10;
   ```

   Radene skal ha `principal_kind = 'oauth'`, `token_id` som `null`, og en
   `client_id` som stemmer med ChatGPT-klienten under Authentication → OAuth
   Apps i Supabase. Vil du at bare den klienten skal slippe inn, er det
   `SLAIDS_AGENT_OAUTH_CLIENTS`.

En godkjent app trekkes tilbake fra Supabase (Authentication → brukeren →
OAuth grants), og et token slutter å virke innen en time uansett.

#### Hele reisen, testet

`src/server/mcp/journey.test.ts` går den veien en ekstern agent faktisk går, og
gjør det over den transporten en fremmed bruker: en ekte socket, den offisielle
MCP-klienten, et ekte ES256-token verifisert mot et publisert nøkkelsett, og
previewet tegnet av en ekte Chromium over appens egne stilark. Den oppretter en
presentasjon, leser den tilbake, setter tema, legger til slides og seksjoner,
deler soner og endrer forholdstall, skriver tekst med en citation som peker på
en ekte referanse, laster opp en PNG som base64 og setter den i en sone, flytter
innhold mellom to slides, inspiserer, validerer slide og dekk, rendrer, leser
*alt* tilbake over en **ny tilkobling** – og sletter dekket til slutt, og
sjekker at det er borte.

Ved siden av den ligger feilene en agent møter: ukjente id-er på tre nivåer,
ukjent verktøynavn, input som ikke passer skjemaet, manglende scope, utdatert
`expectedRevision`, fil som ikke finnes, innhold som ikke får plass, en annen
eiers presentasjon, og et OAuth-token som er forfalsket, utløpt eller
fraværende. Og en sveip som kaller **hvert eneste verktøy** gjennom den ekte
transporten, så en operasjon som legges til senere ikke kan virke i testene
uten å virke gjennom transporten.

Det eneste som ikke er produksjon der, er hvor radene havner: et Dexie-lager i
stedet for Supabase, bygget per eier nøyaktig som `agentContextFor` bygger ett
per principal. Supabase-siden av det er `supabaseRepository.test.ts`, og
selve installasjonen er `scripts/mcp-smoke.mjs` over.

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

Agentflaten har to hull igjen mot editoren, begge bevisste: en mappe kan lages,
listes, fylles og slettes, men ikke gis nytt navn – det kan en agent komme
utenom ved å lage mappen den vil ha og flytte dekkene dit; og layoutmaler og
idéflaten er utenfor med vilje – den første er en snarvei for noen som bygger med
musen, den andre en notatflate som aldri forlater arbeidskopien.
