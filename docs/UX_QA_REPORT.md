# Kvalitetsrapport for UX-forbedringene (U0–U7)

**Dato:** 31.10.2026  
**Arbeidspakke:** U7 – helhetlig kvalitetssikring i [UX_IMPROVEMENT_PLAN.md](UX_IMPROVEMENT_PLAN.md)  
**Grunnlag:** [UX_BASELINE.md](UX_BASELINE.md) (før), [UX_DESIGN_SYSTEM.md](UX_DESIGN_SYSTEM.md), [MOBILE_WORKSPACE.md](MOBILE_WORKSPACE.md), IMPLEMENTATION_PLAN.md § 44.5–44.6  
**Utgangspunkt:** `main` etter U6 (81141a5)

Rapporten skiller mellom tre slags utsagn:

- **Målt:** gjengitt fra en automatisert test eller beregning i repoet, som kan kjøres på nytt.
- **Vurdert:** et faglig skjønn fra gjennomgang av grensesnittet, uten målt brukeratferd.
- **Krever brukertest:** et spørsmål som bare ekte brukere kan svare på. Ingen brukertester er gjort i U0–U7, og ingen tider eller feilrater er oppgitt.

## 1. Kort konklusjon

U0–U7 kan anses som ferdigstilt. Vanlige oppgaver krever like mange eller færre trykk enn før, med tre bevisste unntak der en ekstra menyåpning erstattet anonyme ikonknapper. Alle kjente røde og ustabile tester var feil i testautomatiseringen, ikke i produktet, og er rettet uten å svekke forventningene. U7 fant og rettet åtte tilgjengelighetsmangler (N18–N25), to av dem etter gjennomgang av PR-en. Presentasjonsdata, rendering, geometri, fit-regler, angre/gjør om og agent-API er ikke endret av UX-programmet. **Slaids Dev MCP trenger ingen oppdatering.** Gjenværende svakheter er avgrenset og foreslått som egne oppgaver (§ 9).

## 2. Testresultater

| Kontroll | Før U7 (main 81141a5) | Etter U7 |
| --- | --- | --- |
| `npm run typecheck` | Grønn | Grønn |
| `npm run lint` | Grønn | Grønn |
| `npm test` (Vitest) | 2796 bestått, **1 feilet** (`fitParity.test.ts`, korttittel) | 2816 bestått, 0 feilet |
| `npm run build` | Grønn | Grønn |
| `npx playwright test` (fem prosjekter) | 375 bestått, **4 feilet**, 7 hoppet over | 396 bestått, 0 feilet, 0 ustabile, 18 hoppet over |
| Visuell regresjon (`SLAIDS_VISUAL=1`) | 1 test, **uten lagrede referansebilder i repoet** | 12 tester, 28 referansebilder, stabile ved ny kjøring |

Testene som hoppes over er de 12 opt-in visuelle testene (kjøres med `SLAIDS_VISUAL=1`, se nedenfor) og seks kompakte tester som bare gjelder berøring eller en bestemt bredde (for eksempel pinch med mus). Ingen er hoppet over for å få grønt. CI (`.github/workflows/test.yml`) kjører typecheck, lint, Vitest og build, ikke Playwright; E2E-tallene over er kjørt lokalt i skyutviklingsmiljøet.

## 3. Røde og ustabile tester (oppdrag 6)

Alle fem var **testautomatisering**, ikke produktfeil. Ingen forventning er svekket; to er strammet inn.

| Test | Symptom | Årsak | Rettelse |
| --- | --- | --- | --- |
| `fitParity.test.ts` – korttittel | Estimert og målt bredde skilte seg mer enn toleransen | Målingen startet før nettfontene var lastet, så nettleseren målte med reservefont. Toleransen var dessuten absolutt, mens avviket vokser med linjelengden. | Venter på fontene med den samme `waitForFonts` som rasteriseringen bruker (nå eksportert fra `render/chromium.ts`). Toleransen er nå en andel av linjen, og testen krever i tillegg at estimatet aldri er *mindre* enn målingen – den konservative retningen fit-regelen er bygd på. |
| `filmstrip-insert.spec.ts` – sett inn mellom to slider | Knappens posisjon ble målt midt i inngangsanimasjonen | Måling før animasjonen var ferdig | Ny hjelper `motionSettled` venter til endelige animasjoner i stripen er ferdige før målingen. |
| `richtext.spec.ts` – aksent | Hjørneradien stemte ikke med halve høyden | Testen sammenlignet høyden i skjermpiksler (`getBoundingClientRect`, etter at scenen er skalert) med radien i slidens egne piksler | Begge måles i slidens piksler (`offsetHeight`). Forventningen er den samme. |
| `compact.spec.ts` – dra-sortering i flerkolonnevisning (telefon liggende) | Draget startet mens oversikten fortsatt rullet | `scrollTo` uten å vente på at rullingen hadde stoppet | Ny hjelper `scrollSettled`; testen ruller til toppen og venter til posisjonen er 0. |
| `fit-context.spec.ts` – en sitering må få plass | Feltet var ikke fullt etter faste 40 tastetrykk | Testen antok et fast antall tegn som fyller sonen | `topUpToCapacity` skriver til editoren nekter to ganger på rad, i stedet for et fast antall. Kapasitetsregelen som testes, er uendret. |

Den estimerte titteltekstbredden i `domain/fit.ts` er bevisst konservativ (tegnbredde 0,52 em). Å kalibrere den ville endre hvor mye tekst agent og editor slipper inn, og er derfor ikke gjort i U7 (se § 9).

## 4. Oppgavematrisen før og etter (oppdrag 1–2)

**Målt** av `e2e/task-matrix.spec.ts`, som gjør oppgavene i dagens grensesnitt og teller trykk siden faktisk mottar (desktop 1600 × 1000, mus; skriving og filvalg er ikke talt, som i baseline). Testen feiler hvis en oppgave senere krever flere trykk enn i dag.

| Oppgave | Før (baseline) | Nå | Endring |
| --- | --- | --- | --- |
| Ny presentasjon | 2 | 2 | Lik |
| Ny slide | 2 | 2 | Lik, men knappen heter nå «Ny slide» og sier hvor siden havner |
| Kort med tittel | 2 | 1 | **Bedre:** valget står med navn i den tomme sonen |
| Rediger tekst | 1 | 1 | Lik |
| Angre / gjør om | 1 | 1 | Lik |
| Del en sone | 4 | 4 | Lik (inkluderer bytte til sonemodus) |
| Endre størrelse | 2 | 2 | Lik, forklaringen er foldet inn |
| Avansert sonestørrelse (tallfelt) | 1–2 | 2 | Lik |
| Sett inn bilde og erstatt fil | 3–4 | 2 | **Bedre:** filvalget åpner seg selv; «Bilde fra fil» er atskilt fra innholdstypen |
| Flytt / dupliser slide | 1 | 2 | **Bevisst +1:** fire små ikoner per miniatyr ble én navngitt meny (U5). Flytting kan også gjøres med dra og slipp. |
| Finn bildebrief | 1 | 2 | **Bevisst +1:** ett av sju like ikoner ble en navngitt menyoppføring (U2) |
| Vis | 1 (utenfor vinduet ved 1025–1180 px) | 1, alltid synlig | **Bedre:** målt i `toolbar.spec.ts` og `responsive.spec.ts` |
| Finn «kopier presentasjons-ID» | 1 | 2 | **Bevisst +1:** et `<>`-ikon ble en navngitt oppføring i «Flere handlinger» (U5) |
| Del og kopier lenke | 2 | Ikke målbar lokalt | Krever Supabase. Knappen står alltid rett før «Vis» og sier hvorfor den er av (`sharing.spec.ts`, `accessibility.spec.ts`) |

Planens spørsmål i § 8, med type svar:

| Arbeidsflyt | Svar | Type |
| --- | --- | --- |
| Ny presentasjon og ny slide | «Ny slide» står som stripens brede knapp med plassering; tom sone viser innholdsvalgene med navn | Målt (tester) + vurdert |
| Kort med tittel | Én innholdstype-meny med ikon og navn i linje, inspektør og kompakt; valgt type er markert | Målt (`toolbar.spec.ts`, `contentKinds.test.ts`) |
| Bilde og erstatt fil | «Innholdstype» og «Bilde fra fil» er to ulike kontroller med ulike ikoner | Målt (klikk) + vurdert (forståelse) |
| Del sone og endre forhold | Segmentert «Innhold \| Soner», fiolett sonemodus, forholdstall vises som tall | Målt (aria-pressed, visuelle referanser) + vurdert |
| Marker og formater tekst | Tekstlinjen navngir feltet og viser gjeldende formatering og justering | Målt (`text-toolbar.spec.ts`) |
| Angre/gjør om | Uendret, historikk intakt også over shell-bytte | Målt (`workspace.spec.ts`) |
| Reorganiser uten dra | Meny med Flytt opp/ned fra knapp, høyreklikk, Shift+F10 og berøring | Målt (`filmstrip`-, `compact.spec.ts`) |
| Del og kopier lenke | Tilstanden er synlig og begrunnet; selve delingen er ikke testet lokalt | Målt delvis; resten krever Supabase |
| Mobil stående/liggende | Samme funksjoner, tilstand beholdes ved rotasjon | Målt (`compact.spec.ts`, `workspace.spec.ts`, `responsive.spec.ts`) |
| Sjeldne funksjoner | Finnes med navn i menyer i stedet for anonyme ikoner, ett trykk lenger unna | Målt (klikk) + **krever brukertest** (oppdagbarhet) |

Om oppgavene oppleves enklere, tar kortere tid eller gir færre feil, er **ikke målt** og krever brukertest.

## 5. Tilgjengelighet (oppdrag 4)

Nye automatiserte kontroller:

- `e2e/accessibility.spec.ts` kjører axe-core (WCAG 2.2 A/AA og beste praksis) på åtte desktoptilstander (innholdsmodus, tekstredigering, to menyer, sonemodus, ny-slide-dialogen, forsiden og biblioteket) og på telefonens scene og fire paneler. Den tester også tastaturrekkefølge og synlig fokus i hovedlinjen, begrunnelser for utilgjengelige knapper med mus og med tastatur (som verktøytips og som tilgjengelig beskrivelse), at en lenke i en slide ikke blir et tabstopp i miniatyren, at valgt tilstand alltid har `aria-pressed`/`aria-current`, redusert bevegelse og høy kontrast (`forced-colors`).
- `src/styles/chromeTokens.test.ts` leser fargetokenene fra `global.css` og krever 4,5:1 for tekst på alle flater (også valgt flate), 3:1 for blekk, aksent og statuskanter, og 4,5:1 for hvit tekst på fylte knapper. I tillegg simulerer den protanopi, deuteranopi og tritanopi og krever at de tre blekkfamiliene (innhold, sone, bilde) holder seg tydelig atskilt (ΔE ≥ 20).

Nye funn i U7, alle rettet:

| ID | Funn | Rettelse |
| --- | --- | --- |
| N18 | Utilgjengelige knapper i hovedlinjen (sonemodus, «Overskrift» og «Bilde fra fil» på forsiden; «Del» i lokal modus) viste ingen grunn: en deaktivert knapp tar verken imot musepekeren eller tastaturfokus, så verktøytipset åpnet seg aldri, og en omsluttende flate (første forsøk) hjalp bare musen. | Alle knapper som gir grunnen i et verktøytips, er nå `aria-disabled` i stedet for `disabled` (felles `unavailable()` i `src/ui/components/unavailable.ts`): de er tabstopp, verktøytipset åpner seg ved fokus som ved hover og er knappens tilgjengelige beskrivelse, og trykk, Enter og mellomrom avvises før knappens egen handling. Det gjelder hovedlinjen, tekstlinjen, menyknappene, sonens ikonrad og valgene i en tom sone. Teksten er den samme som kompaktens verktøyfane skriver under raden (felles `pictureFileEntry`, `titleZoneEntry`, `zoneModeReason` i `toolbarMenus.ts`). |
| N19 | I høy kontrast-modus var det ikke synlig hvilken menyoppføring tastaturet sto på. | `Highlight`-ramme på markert oppføring og fargerute. |
| N20 | Fargerutene i inspektøren ble presset til 20,8 px med mus, under WCAG 2.5.8 (24 px). | Rutene deler radens bredde og er inntil 28 px på alle pekere; raden brytes i stedet for å krympe. |
| N21 | Presentasjonstittelen i hovedlinjen var 20 px høy. | Minst 24 px. |
| N22 | Inspektør og slideoversikt var landemerker uten navn, og kompaktpanelets grupper ble lest som fire navnløse regioner. | «Inspektør», «Slideoversikt», scenen som hovedområdet «Slide»; kompaktgrupper er navngitte grupper. |
| N23 | Hver miniatyr i slideoversikten leste opp hele slidens tekst for skjermleseren. | Miniatyren er `inert`: skjult for hjelpemidler og uten tabstopp; knappen bærer navnet «Slide 3» osv. |
| N24 | Valgt farge i paletten var bare synlig som hake; inspektørens «Innholdstype» og typenavnet ble lest som ett ord. | `aria-pressed` på valgt rute; mellomrom mellom etikett og navn. |
| N25 | En lenke i en slides tekst ble et tabstopp inne i miniatyrens knapp, der Enter fulgte lenken i stedet for å åpne sliden (og etter N23 var tabstoppet i tillegg skjult for skjermleseren). | Samme `inert` som N23. Testet med en presentasjon med en ekte lenke. |

## 6. Responsivitet (oppdrag 5)

`e2e/responsive.spec.ts` kontrollerer at verken bibliotek eller editor kan rulles sideveis, og at «Vis» og veien tilbake alltid er synlige, i sju størrelser: 1600 × 1000, 1366 × 768, 1025 × 768, 1180 × 820 med berøring, 900 × 760 med mus (kompakt), 412 × 892 og 892 × 412 (telefon). På desktop gjøres det med tekstfokus og i sonemodus, på kompakt med hvert av de fire panelene åpent. Dette kommer i tillegg til de eksisterende kontrollene:

- hovedlinjen og tekstlinjen får plass ved 1025, 1180 og 1366 px, også med fingerstore kontroller (`toolbar.spec.ts`, `text-toolbar.spec.ts`);
- skjermtastaturet skjuler ikke primærhandlingen, og dialoger holder seg over det (`compact.spec.ts`);
- rotasjon og bytte mellom desktop og kompakt beholder modus, valgt sone, ulagret redigering og angrehistorikk (`workspace.spec.ts`);
- alle knapper er minst 44 × 44 px på berøring (`compact.spec.ts`).

Hele kompaktsuiten kjøres i tre prosjekter (telefon stående, telefon liggende, smalt vindu med mus).

## 7. Visuell regresjon av appgrensesnittet (oppdrag 3)

`e2e/visual-chrome.spec.ts` (opt-in, `SLAIDS_VISUAL=1`) tar 25 referansebilder av selve grensesnittet:

- **Desktop 1600:** bibliotek, hovedlinje, inspektør og slideoversikt i innholdsmodus, tekstlinje med aktiv formatering, hovedlinje og inspektør i sonemodus, menyene «Presentasjon», «Innholdstype» og slidemenyen på forsiden, og forsidens utilgjengelige sonehandlinger.
- **Smal desktop:** hovedlinje og tekstlinje ved 1366 og 1025 px.
- **Stor berøringsskjerm:** hele editoren ved 1180 × 820.
- **Telefon:** scenen og panelene stående (412 × 892) og liggende (892 × 412).

Hvert bilde dekker én flate, så en endring i én flate feiler én forventning. Toleransen er 1 % av pikslene, og nye kjøringer mot de lagrede referansene består. Den eksisterende `visual.spec.ts` (slideinnhold) hadde ingen lagrede referansebilder i repoet og sammenlignet derfor ingenting. Referansene er nå lagt inn.

## 8. Presentasjonsintegritet (oppdrag 7)

- **Kode:** U0–U6 endret bare `src/ui/` og `src/styles/`. Ingen filer under `src/domain/`, `src/agent/`, `src/server/`, `src/render/`, `src/persistence/`, `api/` eller `supabase/` er endret (`git diff 5a9f266..81141a5`). U7 eksporterer to eksisterende hjelpere fra `src/render/chromium.ts` til testbruk, uten å endre oppførselen.
- **Data:** skjema, migrasjoner og lagringsformat er uendret. Lagring og gjenoppretting etter reload er dekket av eksisterende E2E-tester, også i kompakt visning.
- **Rendering og geometri:** hele Vitest-suiten (geometri, fit, rendering, migrasjoner og agentkjerne) er grønn. `visual.spec.ts` har nå referansebilder av slideinnhold i innholdsmodus, presentasjonsmodus og sonemodus.
- **Fit:** fit-reglene er uendret. `fitParity` er strammet inn (§ 3).
- **Angre/gjør om:** uendret og dekket, også over shell-bytte og rotasjon.
- **Agent-API og MCP:** ingen operasjoner, skjemaer, scopes eller instruksjoner er endret. Agentens journey-, interop- og instruksjonstester er grønne.

## 9. Gjenstående svakheter og forslag til senere oppgaver

Ingen av punktene hindrer at U0–U7 kan avsluttes. De foreslås som egne, avgrensede oppgaver:

1. **Sonefiolett og valgblått ved rød-grønn fargesvikt.** Ved protanopi og deuteranopi ligger sonemodusens fiolette blekk nær valgt-blått. Farge er ikke eneste signal (modus har segment og understrek, valgt har kant og `aria-pressed`), så det er ikke et WCAG-brudd. Det bør likevel justeres i designsystemet og legges til i `chromeTokens.test.ts`.
2. **Landemerke for tekstlinjen og menyene.** axe-regelen `region` (beste praksis, ikke WCAG) er slått av i testen fordi tekstlinjen og flytende menyer står utenfor landemerker. Det er ufarlig, men kan ryddes.
3. **Kalibrering av fit-estimatet for titler.** Estimatet er bevisst konservativt. Om det skal strammes inn, er en produktbeslutning fordi det endrer hvor mye tekst agent og editor slipper inn.
4. **Fysiske enhetstester.** Røyktestene i MOBILE_WORKSPACE.md § 16 (ekte iOS/Android, skjermtastatur, Apple Pencil) gjenstår; alt her er kjørt i emulert Chromium.
5. **Brukertest.** Oppdagbarheten av sjeldne funksjoner i menyer og forståelsen av innholds- og sonemodus bør prøves med 3–5 brukere, med baseline-matrisen som oppgaveliste.
6. **Paletten i inspektøren** er høyere enn før fordi rutene ikke lenger krymper under 24 px. Vurder en sammenleggbar palett hvis plassen blir et problem.
7. **E2E i CI.** Playwright kjøres ikke i GitHub Actions. Å legge til en (eventuelt delvis) E2E-jobb ville fange regresjoner tidligere.

## 10. Begrensninger

- Alle tester er kjørt i Chromium på Linux i et skymiljø med lokale fonter. Safari, Firefox og ekte mobile enheter er ikke testet.
- Deling og publisering kan ikke testes uten Supabase; den lokale testen dekker bare at knappen er ærlig om dette.
- Fargesynssimuleringen er en modell (Machado m.fl. 2009), ikke en test med personer med fargesvikt.
- axe-core finner omtrent en tredjedel av WCAG-problemer automatisk. Skjermleseropplevelsen med NVDA, VoiceOver og TalkBack er ikke testet manuelt.
- Trykktellingen måler antall handlinger, ikke tid, forståelse eller feil.

## 11. Konklusjon

UX-forbedringsprogrammet U0–U7 kan **anses som ferdigstilt**. Målene i planens § 1 er oppfylt så langt de kan måles uten brukertest: færre eller like mange trykk for vanlige oppgaver, ett tilstandsspråk med `aria-pressed`, synlige begrunnelser, ingen overflyt fra telefon til desktop, 44 px berøringsflater, og kontrast som oppfyller WCAG AA. Dette er nå holdt fast av automatiserte tester. Ingen funksjoner er tapt. Tre sjeldne handlinger ligger ett trykk lenger unna, i bytte mot navngitte menyoppføringer.

**Slaids Dev MCP trenger ingen oppdatering.** MCP-verktøyene, instruksjonene og agent-API-et er uendret gjennom hele programmet. Agenten arbeider på presentasjonsmodellen og ikke på grensesnittet, og ingen av UX-endringene berører de begrepene eller operasjonene agenten bruker.
