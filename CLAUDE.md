# CLAUDE.md – Slaids

Nettleserbasert presentasjonseditor med rigid, matematisk sonelayout.

## Normative kilder

- `IMPLEMENTATION_PLAN.md` er **eneste** normative spesifikasjon. Les den før strukturelle endringer.
- `docs/archive/VISION.original-2026-08-20.md` er historisk kontekst, **ikke** normativ.
- `VISION.md` i repo-roten er bare en peker til de to over, og har ikke krav i seg.

## Kjerneinvariants

- Fast logisk designrom: `1600 × 900`. Skaleres uniformt til viewport.
- Layout er et rekursivt tre: `split` har `children` og aldri `content`; `leaf` har `content` og aldri `children`.
- `children.length === weights.length`; 2–10 barn; alle weights er endelige tall `> 0`.
- Nøyaktig ett globalt gap `G` mellom alt synlig innhold. Nesting skal aldri doble gap.
  Strukturelle noder har aldri egen margin/padding som påvirker layoutgeometri.
- `src/domain/geometry.ts` er eneste sannhetskilde for rects – både rendering og hit-testing.
- Persistens: IndexedDB via Dexie. Aldri `localStorage` for presentasjoner/assets.
- Rich text lagres som ProseMirror/Tiptap JSON, aldri rå HTML. Ekstern paste normaliseres.
- Alt persistert data valideres med Zod og har `schemaVersion` + migrations.

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
