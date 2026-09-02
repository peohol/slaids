# CLAUDE.md – Slaids

Nettleserbasert presentasjonseditor med rigid, matematisk sonelayout.

## Normative kilder

- `IMPLEMENTATION_PLAN.md` er **eneste** normative spesifikasjon. Les den før strukturelle endringer.
- `docs/archive/VISION.original-2026-08-20.md` er historisk kontekst, **ikke** normativ.
- `VISION.md` i repo-roten er bare en peker til de to over, og har ikke krav i seg.

## Kjerneinvariants

- Fast logisk designrom: `1600 × 900`. Skaleres uniformt til viewport.
- Layout er et rekursivt tre: `split` har `children` og aldri `content`; `leaf` har `content` og aldri `children`.
- Kort og beholdere deler den samme `CardBody`: en beholder er et gjennomsiktig kort.
- `children.length === weights.length`; 2–10 barn; alle weights er endelige tall `> 0`.
- Nøyaktig ett globalt gap `G` mellom alt synlig innhold. Nesting skal aldri doble gap.
  Strukturelle noder har aldri egen margin/padding som påvirker layoutgeometri.
  Temaet skalerer `G` sammen med alle andre avstander (`spacing`) – det er
  fortsatt én avstand, bare en annen. `src/domain/metrics.ts` er eneste
  utledning av tema-skalerte tokens; geometrimotoren, DOM-en og estimatoren
  leser alle den samme.
- `src/domain/geometry.ts` er eneste sannhetskilde for rects – både rendering og hit-testing.
- Persistens har to moduser, og valget tas ett sted: `src/persistence/activeRepository.ts`.
  Finnes både `VITE_SUPABASE_URL` og `VITE_SUPABASE_PUBLISHABLE_KEY` er Supabase primærlagring;
  finnes ingen av dem er det IndexedDB via Dexie (lokal utvikling og tester). Dette er en
  **modus, ikke en fallback**: en konfigurert Supabase som er nede skal gi en forståelig feil,
  aldri stille lokal lagring – to konkurrerende sannhetskilder er verre enn en synlig feil.
  Aldri `localStorage` for presentasjoner/assets.
- Finnes **nøyaktig én** av variablene er det ingen modus, men en konfigurasjonsfeil: appen
  stopper med en oppstartsfeil og velger verken Supabase eller Dexie. Lokal lagring der ville
  betydd at produksjon stille skrev til nettleseren fordi en deploy-variabel manglet.
- I Supabase-modus kreves innlogging før bibliotek/editor monteres. Auth er Supabase Auth
  (delt prosjekt med Huskis) – aldri et eget bruker-/passordsystem. `owner_id` settes alltid
  fra den autentiserte sesjonen, og secret/service-role-nøkler skal aldri finnes i frontend.
- Utlogging bruker alltid `signOut({ scope: 'local' })`. Auth-prosjektet deles med Huskis, og
  global scope ville logget brukeren ut av Huskis på alle enheter.
- Å forlate editoren er et lagringspunkt. Autosave holder det ventende snapshotet i minnet
  og slutter å prøve på nytt når editoren unmountes, så «Tilbake» flusher først og blir
  stående hvis skrivingen ikke gikk igjennom. Ingen parallell flush i cleanup som kan race.
- Deling er **publisering, ikke samarbeid**, og bryter derfor ikke énbruker-modellen:
  en delt lenke gir ingen konto og ingen Auth-bruker, bare lesetilgang til én publisert
  kopi. Det finnes to dokumenter: den private arbeidskopien (`document`) og et sanitert
  snapshot (`shared_document`). Snapshotet bygges
  i `src/domain/sharing.ts` ved å liste opp hva som skal med – aldri ved å slette felter fra
  arbeidskopien, slik at et nytt felt på `Presentation` er privat til noen med vilje
  publiserer det. `sandbox`, `ideas`, `folderId`, `owner_id`, ubrukte filer og usiterte
  referanser forlater aldri arbeidskopien.
- `anon` har ingen tilgang til `slaids_presentations`. Den eneste offentlige inngangen er
  Edge Function-en `slaids-share`, som slår opp på token, svarer med snapshotet, og serverer
  en fil bare når nøyaktig det publiserte snapshotet lister den. Ingen listeform, ingen
  skrivetilgang, og samme generelle 404 for alt som ikke gir tilgang – ellers blir
  endepunktet en informasjonskanal. Service-role-nøkkelen finnes bare i funksjonens eget
  miljø, aldri i Vite, Vercel eller nettleseren.
- Delingsstatus er ikke en del av `Presentation`. Den bor på raden, og det er dét som gjør at
  den ikke kan angres med Ctrl+Z, ikke følger med `.slaids`-eksport/import, og ikke arves av
  en duplisering. En kopi starter alltid som ikke delt.
- `share_token` roteres både ved aktivering og ved deaktivering, så en tilbakekalt lenke
  aldri blir gyldig igjen. Publisering venter på at autosave har landet: en feilet lagring
  publiserer ingenting, og bryteren blir stående av.
- En ren endring av `is_shared`, `share_token` eller `shared_document` er ikke en redigering
  av dokumentet, og øker verken `version` eller `updated_at`. Ellers ville publisering gjort
  den åpne editorens kjente versjon utdatert og laget en falsk samtidighetskonflikt ved neste
  autosave. Den ekte optimistiske låsen gjelder fortsatt for `document`, `title`, `folder_id`
  og `slide_count`.
- Sidene i et dekk er `authored slides → avledede referansesider → avledet QR-side`. Bare den
  første gruppen er lagret. QR-siden er ikke en `Slide` og ligger aldri i
  `presentation.slides`; den er et eget medlem av `DeckPage`-unionen i `src/domain/pages.ts`
  og finnes bare mens delingen er på.
- **Alt** under `/s/` er offentlig og går aldri gjennom `AuthGate` – grensen er stien, ikke
  tokenet. En avkortet eller feilskrevet lenke tilhører den som fikk den, og skal møte
  «Denne delingslenken er ikke aktiv», aldri eierens innlogging. Et syntaktisk umulig token
  besvares lokalt, uten et kall til delings-endepunktet. `src/Root.tsx` velger rute én gang,
  over porten, og den delte visningen monterer ingen privat komponent. Bilder i delt visning
  hentes gjennom delings-endepunktet, aldri gjennom det autentiserte repositoryet – valget
  tas av `AssetSourceProvider`, ikke av en gren inne i rendereren.
- Supabase-prosjektet er delt med Huskis og mdeditz, men `supabase_migrations.schema_migrations`
  er prosjektglobal og inneholder deres migrasjoner. **`supabase db push` skal aldri kjøres
  herfra**, og verken `migration repair` eller `db pull` er svaret når den klager – begge
  skader en annen app. Slaids fører sin egen historikk i `public.slaids_migrations` via
  `scripts/deploy-migrations.sh`. Slaids eier bare `slaids_`-prefiksede objekter og sin egen
  Edge Function; `functions deploy --prune` ville slettet de andre appenes funksjoner.
- Slaids-migrasjoner skal være idempotente (`if not exists`, `create or replace`,
  `drop … if exists` før `create`). Det er dét som gjør at en fil kan kjøres på nytt – i SQL
  Editor, eller mot en base der historikken ikke er komplett – uten å gjøre skade.
- **Slaids genererer aldri bilder.** Ingen bildegenerering i appen, ingen ekstern
  bildetjeneste, ingen `generate_image(prompt)`. Et rasterbilde kommer inn ferdig
  (`upload_asset`), en figur kommer inn som SVG-markup (`create_svg_asset`), og
  begge blir helt vanlige assets som `set_zone_asset` plasserer. SVG saneres i
  `src/domain/svg.ts` uansett hvilken av de to dørene den kom gjennom, og lagres
  som reserialisert markup – aldri kallerens streng. Formatet avgjøres av bytene
  (`src/domain/imageBytes.ts`), ikke av hva kalleren kaller filen. Se
  `IMPLEMENTATION_PLAN.md` §44.
- Rich text lagres som ProseMirror/Tiptap JSON, aldri rå HTML. Ekstern paste normaliseres.
- Alt persistert data valideres med Zod og har `schemaVersion` + migrations.
- Content fit: en lovlig redigering skal aldri ende med at synlig innhold blir skjult.
  Den tilstanden som skal vises etter commit, er den som måles før commit – inkludert
  prospektiv geometri, prospektiv font (vent på webfont-readiness) og prospektiv
  citation-nummerering. Unntak hører hjemme i `src/domain/commands/fitGuard.ts`, med begrunnelse.

## Arkitekturregler

- **Ikke muter domeneobjekter direkte fra React.** All strukturendring går gjennom typed
  domenekommandoer i `src/domain/commands/`, som returnerer `Ok`/`Err` med typed feilkoder.
- Domain-, geometry- og repository-lagene er headless og React-uavhengige (gjenbrukes senere av REST/MCP).
- `src/agent/` (Agent Core) er agentflaten, og er transportuavhengig: ingen HTTP, ingen MCP,
  ingen modell- eller leverandørspesifikk kode. Operasjoner er semantiske og går gjennom
  domenekommandoene med fit-sjekkere påslått; en agent skriver aldri rå `ZoneContent`-JSON.
  Repository og fit-sjekkere injiseres via `AgentContext` – aldri importert direkte.
- Design-tokens (`G`, min-størrelser, typografi) bor i `src/domain/constants.ts` – ikke hardkod verdier i UI.

## Kommandoer

```bash
npm run dev          # Vite dev server
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest run
npm run build        # produksjonsbuild
npm run e2e          # Playwright (bygger og serverer selv)

# Databasen. Aldri `supabase db push` – se invarianten over.
SLAIDS_DB_URL=... ./scripts/deploy-migrations.sh --dry-run   # leser bare, endrer ingenting
SLAIDS_DB_URL=... ./scripts/deploy-migrations.sh

# Den offentlige lesefunksjonen. Aldri med --prune.
supabase functions deploy slaids-share --project-ref <ref>
```

I Vercel må **begge** `VITE_SUPABASE_URL` og `VITE_SUPABASE_PUBLISHABLE_KEY` være slått på
for både Production og Preview. Er de bare satt for Production, bygges PR-previews uten
noen av dem – og det er ikke en feil, det er lokal modus, så previewen kjører mot en tom
Dexie-base og ser tom ut.

Playwright laster ned egen nettleser. Finnes det allerede en Chromium i miljøet:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/sti/til/chrome npm run e2e`

## Verifikasjon

En UI-endring er ikke ferdig før den er kjørt i browser: start appen, klikk gjennom flyten,
sjekk console for feil, sammenlign DOM-geometri mot geometry engine og test reload-persistens.
Kjør `npm run typecheck && npm run lint && npm test` før commit.
