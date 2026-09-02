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

- innlogging med e-post og passord når Slaids kjører mot Supabase (se «Lagring»)
- opprett presentasjon med tittel, global bakgrunnsfarge og globale fonter
- åpne, gi nytt navn, dupliser (inkludert filer), slett med bekreftelse
- mapper, og flytting av presentasjoner mellom dem
- eksport og import av `.slaids`-sikkerhetskopi (zip med manifest, data og filer)

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

Kontoene er de samme som i Huskis; Slaids oppretter ikke brukere selv. Utlogging
bruker `scope: 'local'`, så den avslutter bare Slaids-sesjonen i denne nettleseren
– ikke Huskis, og ikke andre enheter. Skjemaet
ligger i `supabase/migrations/` og kan kjøres med `supabase db push` mot et tomt
prosjekt:

- fire tabeller i `public` (`slaids_folders`, `slaids_presentations`,
  `slaids_templates`, `slaids_assets`), alle med `owner_id` og RLS som gir en
  bruker kun egne rader;
- en trigger som øker `version` og setter `updated_at` ved hver oppdatering, slik
  at en gammel kopi fra en annen fane får en tydelig konfliktfeil i stedet for å
  overskrive en nyere;
- den private bucketen `slaids-assets` med policies som binder hver fil til
  `<owner_id>/<presentation_id>/<asset_id>`.

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

## Arkitektur

```
src/
  domain/        headless kjerne: typer, geometry engine, layouttre, kommandoer,
                 Zod-schema, migrasjoner, referanser, farger, fit
  persistence/   SlaidsRepository + Dexie/IndexedDB og Supabase, assets, .slaids-backup
  supabase/      Supabase-klient, konfigurasjon og modusvalg
  state/         Zustand-store, autosave, DOM-måling, utklippstavle
  ui/            React-komponenter (bibliotek, editor, slide-renderer, visning)
```

Regler som gjelder overalt:

- **UI muterer aldri domeneobjekter direkte.** All strukturendring går gjennom
  typede kommandoer i `src/domain/commands/`, som returnerer `Ok`/`Err`.
- Domene-, geometri- og repository-lagene er React-uavhengige, slik at et senere
  REST/MCP-API kan bygges på nøyaktig de samme kommandoene.
- Alt som lagres har `schemaVersion` og valideres med Zod ved innlasting.

## Ikke bygget ennå

Deling av presentasjoner, REST-API, MCP-server og agenttokens er bevisst utenfor
scope i denne fasen. Repository-abstraksjonen og kommandolaget er laget slik at
de kan legges til uten å skrive om domenemodellen.
