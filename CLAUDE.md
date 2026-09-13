# Slaids — Claude Code instructions

Slaids er en nettleserbasert presentasjonseditor med rigid, matematisk sonelayout.

## Start her

1. Les relevant kode før du foreslår eller gjør endringer. Ikke gjett om kode du ikke har åpnet.
2. `IMPLEMENTATION_PLAN.md` er **eneste normative produkt- og arkitekturspesifikasjon**. Les relevante deler før strukturelle endringer.
3. `VISION.md` er bare en peker. `docs/archive/VISION.original-2026-08-20.md` er historisk kontekst, ikke normativt.
4. Bruk eksisterende typer, domenekommandoer, tester og validering som executable documentation. Hvis kode og plan ser ut til å motsi hverandre, undersøk før du endrer noe; ikke oppfinn en tredje regel her.
5. Når du lager eller endrer en miniapp: les `docs/INTERACTIVE_MINIAPPS.md`, start fra `examples/interactive-miniapps/starter.html`, og følg forfatterkontraktens nettleser- og layoutkontroller. Riktige temavariabler og en grønn build er ikke tilstrekkelig verifikasjon.
6. Når du endrer agentens presentasjonsdesign, agentinstruksjoner eller eksempeldekk: les `docs/AGENT_PRESENTATION_DESIGN.md`. Designguiden beskriver hvordan innholdets logiske struktur skal drive sonetreet; den er veiledning, ikke en parallell produktspesifikasjon.

## Arbeidsmåte

- Gjør den minste sammenhengende endringen som løser oppgaven. Ikke refaktorer, generaliser eller legg til fleksibilitet uten at oppgaven krever det.
- Bevar én sannhetskilde. Ikke kopier domeneregler, skjemaer, konstanter, operasjonslister eller geometri inn i nye lag når de kan importeres eller avledes.
- Domenelogikk skal ikke legges i React, REST- eller MCP-adaptere. Strukturendringer går gjennom typed domenekommandoer i `src/domain/commands/`.
- `src/agent/` er transportuavhengig Agent Core. `src/server/agent/` og `src/server/mcp/` er adaptere. `src/server/` skal aldri importeres av klientkoden.
- Rendering, hit-testing og fit skal bruke prosjektets eksisterende felles geometri/rendering; ikke bygg parallelle implementasjoner.
- Valider ved systemgrenser. Ikke legg defensiv validering mellom interne lag som allerede har en typed kontrakt.
- Tester skal verifisere den generelle regelen, ikke bare eksempelet som utløste endringen. Ikke hardkod mot testdata og ikke svekk/fjern tester for å få grønt resultat.
- Midlertidige filer og hjelpeskript skal fjernes før oppgaven avsluttes.

## Viktige, tverrgående invariants

Dette er bare de få reglene som Claude må ha i kontekst på nesten alle oppgaver. Detaljene og begrunnelsene hører hjemme i `IMPLEMENTATION_PLAN.md` og koden.

- Logisk designrom er `1600 × 900`; viewport skalerer det uniformt.
- Layout er et rekursivt tre: `split` har `children`, `leaf` har `content`; `children.length === weights.length`; weights er heltall 1–10 og kvantiseres sentralt.
- Det finnes nøyaktig ett globalt gap mellom synlig innhold. Strukturelle noder skal ikke introdusere ekstra layoutavstand.
- `src/domain/geometry.ts` er sannhetskilden for rects.
- Rich text lagres som ProseMirror/Tiptap JSON, ikke rå HTML. Persisted data valideres med Zod og versjonerte migrasjoner.
- En lovlig commit skal ikke skjule synlig innhold. Mål den prospektive tilstanden før commit; fit-unntak skal være eksplisitte og begrunnede i fit-guarden.
- Persistens velges ett sted i `src/persistence/activeRepository.ts`: Supabase når begge nødvendige variabler finnes, ellers Dexie når ingen finnes. Delvis Supabase-konfigurasjon er en feil, ikke en fallback. Presentasjoner/assets lagres aldri i `localStorage`.
- Supabase Auth er den eneste brukerautentiseringen. Secret/service-role-nøkler skal aldri inn i frontend eller `VITE_*`.
- Deling er publisering av et sanitert snapshot, ikke samarbeid. Offentlig lesing skal aldri gi tilgang til den private arbeidskopien.
- Agentoperasjoner skal være semantiske, bruke de samme domenekommandoene som editoren og deklarere/håndheve scopes serverside. REST og MCP skal dele Agent Core, ikke kopiere domenelogikk.
- Eksterne assets går gjennom `src/domain/assetIngress.ts`; SVG saniteres før lagring. Slaids genererer ikke bilder: raster lastes opp, SVG kan opprettes som markup.

## Verifikasjon

Etter kodeendringer, kjør de smaleste relevante testene underveis. Før en ferdig kodeendring leveres, kjør normalt:

```bash
npm run typecheck
npm run lint
npm test
```

Kjør `npm run build` når endringen berører bygg, Vercel/serverkode, bundling eller avhengigheter. Kjør relevante Playwright-tester for UI-flyt; en UI-endring er ikke ferdig bare fordi unit-testene er grønne. Sjekk også browser-konsollen og reload/persistens når det er relevant.

Vanlige kommandoer:

```bash
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e
```

## Operasjonelle sikkerhetsgrenser

- Supabase-prosjektet deles med mdeditz, som har sine egne migrasjoner i den prosjektglobale historikken. **Kjør aldri `supabase db push`, `migration repair` eller `db pull` for å deploye Slaids-migrasjoner.** Bruk `scripts/deploy-migrations.sh`, som fører Slaids' egen historikk i `public.slaids_migrations`.
- Deploy aldri Supabase-funksjoner med `--prune`. Slaids eier bare sine egne `slaids_`-objekter og sin egen Edge Function.
- Agent-API-hemmeligheter er servervariabler uten `VITE_`-prefiks.
- Ikke legg flere `.ts`-entrypoints under `api/` uten å verifisere Vercel-rutingen og deployment-testene.

## Vedlikehold av denne filen — viktig

`CLAUDE.md` er et kort, høysignal prosjektbrief som lastes inn i hver Claude Code-sesjon. Den er **ikke** arkitekturdokumentasjon, changelog, feiljournal, scratchpad eller et sted å lagre begrunnelsen for hver implementasjonsdetalj.

- **Ikke endre `CLAUDE.md` som del av vanlig feature-, bugfix- eller refaktoreringsarbeid.** Endre den bare når brukeren uttrykkelig ber om å endre prosjektinstruksene, eller når en varig, tverrgående arbeidsregel faktisk har endret seg.
- Når en ny regel foreslås, spør først: Kan den håndheves i typer, kode, test, lint eller CI? I så fall gjør det der. Er den produkt-/arkitekturspesifikasjon? Da hører den hjemme i `IMPLEMENTATION_PLAN.md`. Er den lokal for ett subsystem? Dokumenter den nær subsystemet. Bare varige instrukser Claude trenger på tvers av oppgaver hører hjemme her.
- **Ikke append en ny regel bare fordi Claude gjorde én feil.** Rett årsaken i kode/test/verktøy når mulig. Legg bare til en instruks hvis samme feilklasse realistisk kan gjenta seg og ikke kan håndheves mekanisk.
- Ikke legg inn løste bughistorier, PR-spesifikke detaljer, midlertidige migreringssteg, konkrete feilmeldinger eller lange designbegrunnelser.
- Ved redigering: erstatt eller kondenser eksisterende tekst fremfor å legge til en overlappende regel. Fjern foreldede regler samtidig.
- Hold filen under **200 linjer**. Hvis den nærmer seg grensen, flytt detaljer til den normative planen, subsystem-dokumentasjon eller mekaniske tester før noe nytt legges til.
- Unngå duplisering: én regel skal ha én autoritativ plassering. `CLAUDE.md` kan peke til den, men skal ikke utvikle en parallell spesifikasjon.
