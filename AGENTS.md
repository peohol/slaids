# Slaids – instruksjoner for kodeagenter

Slaids er en nettleserbasert presentasjonseditor med matematisk sonelayout. Disse reglene gjelder alle kodeagenter som arbeider i repoet.

## Før hver oppgave

- **Les alltid den nyeste versjonen av `AGENTS.md` og `README.md` i repoet før du begynner.** Hent oppdatert `main`; ikke stol på filinnhold fra tidligere samtaler. Skaff deg oversikt over hele README og les delene som er relevante for oppgaven grundig. Ved avvik, les også versjonen i arbeidsgrenen.
- Les berørt kode før du foreslår eller gjør endringer. Ikke gjett om kode du ikke har åpnet.
- `IMPLEMENTATION_PLAN.md` er **eneste normative produkt- og arkitekturspesifikasjon**. Les relevante deler før strukturelle endringer. `README.md` beskriver dagens løsning; `VISION.md` er bare en peker.
- Ved miniapper: les `docs/INTERACTIVE_MINIAPPS.md` og bruk `examples/interactive-miniapps/starter.html`. Verifiser funksjon og utseende i nettleseren, ikke bare bygg.
- Ved arbeid med agentens presentasjonsdesign, instruksjoner eller eksempeldekk: les `docs/AGENT_PRESENTATION_DESIGN.md`.

## Språk og samarbeid

- **Skriv på norsk bokmål** i all agentkommunikasjon, PR-titler og -beskrivelser, GitHub-saker og -kommentarer, kodekommentarer, dokumentasjon og andre tekstfiler du skriver. Behold eksisterende navn på kodeelementer, API-felter, filbaner og kommandoer. Ikke oversett eksterne standarder, ordrette sitater eller innhold som uttrykkelig skal være på et annet språk. Ikke omskriv eldre engelsk tekst bare for å endre språk.
- Skriv for menneskelige samarbeidspartnere som **ikke har lest chatten eller oppdragsprompten**. Forklar kort hva arbeidet skal løse og hva som faktisk er endret. Unngå unødvendig teknisk sjargong, lange utgreiinger og henvisninger som bare gir mening i samtalen.
- **Start alltid PR-beskrivelsen med hensikten**: hvilket behov eller problem endringen gjelder. Beskriv deretter kort de viktigste endringene, hva som er kontrollert, og eventuelle kjente begrensninger. Oppgi faktisk gjennomførte tester; ikke påstå at noe er testet uten at det er gjort.
- GitHub-kommentarer og gjennomganger skal være korte, konkrete og forståelige. Ved feil: angi hva som er galt, konsekvensen og hva som må rettes.
- Når du handler gjennom en persons GitHub-konto slik at bidraget kan se ut til å komme fra mennesket, **oppgi hvilken kodeagent som skrev PR-en eller kommentaren**. Ikke utgi deg for kontoeieren.

## Arbeidsmåte

- Gjør den minste sammenhengende endringen som løser oppgaven. Ikke legg til generell fleksibilitet eller refaktorering uten behov.
- Bevar én sannhetskilde: gjenbruk domeneregler, typer, geometri og validering. Domenelogikk hører ikke hjemme i React-, REST- eller MCP-adaptere; strukturendringer går via `src/domain/commands/`.
- `src/agent/` er transportuavhengig Agent Core. `src/server/agent/` og `src/server/mcp/` er adaptere; klientkode skal ikke importere `src/server/`.
- Tester skal verifisere den generelle regelen, ikke bare ett eksempel. Ikke svekk tester for å få grønt resultat. Fjern midlertidige filer før levering.

## Viktige tekniske grenser

- Sonegeometri beregnes sentralt i `src/domain/geometry.ts`. Bevar prinsippet om ett globalt gap; ikke lag parallelle geometri-, rendrings- eller innholdstilpasningssystemer.
- En gyldig redigeringsoperasjon skal ikke skjule synlig innhold. Bruk eksisterende innholdsmåling og fit-kontroll, og følg eventuelle eksplisitte unntak i `IMPLEMENTATION_PLAN.md`.
- Persistens velges i `src/persistence/activeRepository.ts`: Supabase når nødvendige variabler er satt, ellers Dexie når ingen er satt. Delvis konfigurasjon skal gi feil, ikke stille fallback. Ikke lagre presentasjoner eller filer i `localStorage`.
- Supabase Auth er eneste brukerautentisering. Deling publiserer et renset snapshot, aldri den private arbeidskopien. REST og MCP deler domenelogikk og håndhever tillatelser på serveren.
- Eksterne filer går gjennom `src/domain/assetIngress.ts`; SVG skal renses før lagring.

## Verifikasjon

- Kjør relevante smale tester underveis. Før en ferdig kodeendring leveres, kjør normalt `npm run typecheck`, `npm run lint` og `npm test`.
- Kjør `npm run build` når bygg, avhengigheter, server eller Vercel berøres. Ved UI-endringer, kjør relevante `npm run e2e`-tester og kontroller i nettleseren.

## Operasjonelle sikkerhetsgrenser

- Supabase deles med mdeditz. **Bruk aldri `supabase db push`, `migration repair` eller `db pull` til Slaids-migrasjoner.** Bruk `scripts/deploy-migrations.sh` og Slaids' egen historikk i `public.slaids_migrations`.
- Deploy aldri Supabase-funksjoner med `--prune`. Slaids eier bare egne `slaids_`-objekter og egen Edge Function.
- Hemmeligheter og service-role-nøkler skal aldri til frontend eller variabler med `VITE_`-prefiks. Ikke legg nye `.ts`-filer under `api/` uten å verifisere Vercel-rutingen.

## Vedlikehold av AGENTS.md

- Endre bare filen etter uttrykkelig ønske om nye prosjektinstruksjoner, eller ved reell endring av varige, tverrgående regler.
- Hold denne filen kort (helst langt under 200 linjer). Detaljer hører hjemme i normativ plan, kode, tester eller oppgavespesifikk dokumentasjon. Ikke kopier historikk, løste feil eller subsystemdetaljer hit. Ikke importer hele `README.md` med `@README.md`: det ville laste hele den lange filen inn i hver sesjon.
