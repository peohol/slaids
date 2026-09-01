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
- Design-tokens (`G`, min-størrelser, typografi) bor i `src/domain/constants.ts` – ikke hardkod verdier i UI.

## Kommandoer

```bash
npm run dev          # Vite dev server
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest run
npm run build        # produksjonsbuild
npm run e2e          # Playwright (bygger og serverer selv)
```

Playwright laster ned egen nettleser. Finnes det allerede en Chromium i miljøet:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/sti/til/chrome npm run e2e`

## Verifikasjon

En UI-endring er ikke ferdig før den er kjørt i browser: start appen, klikk gjennom flyten,
sjekk console for feil, sammenlign DOM-geometri mot geometry engine og test reload-persistens.
Kjør `npm run typecheck && npm run lint && npm test` før commit.
