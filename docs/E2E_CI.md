# Nettlesertester i CI

Playwright-suiten (`e2e/`, `playwright.config.ts`) kjøres av GitHub Actions i to størrelser, fra `.github/workflows/e2e.yml`. Enhetstestene, typesjekken, linten og byggingen kjøres som før av `.github/workflows/test.yml`.

| Kjøring | Når | Hva | Tid (målt) |
| --- | --- | --- | --- |
| **PR-utvalget** | Hver pull request, og for hånd med `suite: pr` | Testene merket `@pr` (51 kjøringer i seks prosjekter) | ca. 2,5 min testtid, ca. 5 min med bygg og installasjon |
| **Hele suiten** | Hver natt kl. 02:17 UTC mot `main`, og for hånd fra Actions-fanen (`suite: full`) | Alle tester i alle seks prosjekter, også de visuelle referansebildene (`SLAIDS_VISUAL=1`) | ca. 25 min testtid |
| **Referansebilder** | Bare for hånd fra Actions-fanen (`suite: referansebilder`) | Tar de visuelle referansebildene på nytt og laster dem opp som artefaktet `referansebilder` | ca. 2 min |

## Regler som gjelder begge

- **Ingen nye forsøk.** `retries: 0`. En test som bare består av og til, er rød og skal synes som rød. Det finnes ingen karantene, og ingen test hoppes over for å få grønn CI. De eneste `test.skip` i suiten er betingelser om miljøet testen gjelder (berøring mot mus, én kolonne mot flere) og de opt-in visuelle testene, som den nattlige kjøringen slår på.
- **Samme konfigurasjon som lokalt.** CI bruker `playwright.config.ts` uendret, med nettleseren Playwright-versjonen i låsefilen hører til. Appen bygges på nytt for hver kjøring – to ganger: i lokal modus for nesten hele suiten, og i Supabase-modus for innloggingstestene (`supabase-auth`), der en stubbet Supabase (`e2e/supabaseStub.ts`) svarer på alle kall. Ingen kjøring når et ekte Supabase-prosjekt eller sender e-post.
- **Lesbare feil.** Med `CI` satt rapporterer Playwright også som `github` (feilmeldingen står som merknad på linjen i testfilen) og som HTML. Ved feil lastes artefaktet `playwright-rapport-pr` eller `playwright-rapport-full` opp i 14 dager: HTML-rapporten (`index.html`) med skjermbilde, konsoll og Playwright-spor (trace) for hver feilet test, og `test-results/` med de rå filene, også bildeforskjellene fra en visuell test. Jobbsammendraget forklarer hvor de ligger. Et spor åpnes med `npx playwright show-trace trace.zip` eller på <https://trace.playwright.dev>.

## Hva PR-utvalget dekker

Utvalget er minstelisten for E2E i `IMPLEMENTATION_PLAN.md` § 40, pluss én kontroll av hver flate som ellers bare den nattlige kjøringen ville sett. Det er valgt fordi det er bredt, ikke fordi testene er stabile: hele suiten er grønn, og alle tester holdes til samme krav.

Taggene i testfilene er sannhetskilden. `npx playwright test --list --grep @pr` skriver ut nøyaktig hva som kjøres. Tabellen under er en oversikt per fil; `scripts/e2eCi.test.ts` feiler hvis den og taggene kommer ut av takt.

<!-- e2e-pr-files:start -->
| Fil | Hva PR-kontrollen sjekker |
| --- | --- |
| `library.spec.ts` | Opprette, åpne og liste en presentasjon; den åpne presentasjonen huskes etter omlasting |
| `editor.spec.ts` | Legge til, duplisere, flytte og slette slider; navigere mellom slider; slå tittel av og på; tittel og brødtekst overlever omlasting; fet skrift fra tekstlinjen; kort med tittel; angre og gjør om |
| `golden-path.spec.ts` | Hele gullstien med nøyaktig ett mellomrom overalt |
| `zones.spec.ts` | Dele en sone, nøstet deling uten ekstra mellomrom, endre forhold fra inspektøren |
| `zone-compression.spec.ts` | Et skille dratt på tvers komprimerer hele raden inn i negativt rom i samme forhold, en ny komprimering gjenbruker det, og angre/gjør om tar både størrelser og struktur; en sone uten steder å forskyves komprimeres symmetrisk på tvers ved et drag inni den; det som lagres ved slipp er det som ble vist rett før, også for små drag (40–160 px, symmetrisk og ensidig) og for tekst nær fit-grensen, som aldri klippes av et trinn; en sone som endres innenfra mellom luft, viser og lagrer samme trinn begge veier; en gruppe som allerede er `n : a : n` gjenbruker sin egen luft når den komprimeres igjen fra begge sider, både under draget, etter slipp og gjennom angre/gjør om, og kan vokse tilbake til ingen luft; Shift trykket og sluppet midt i et drag bytter mellom komprimering fra begge sider og fra én, og for et skille mellom å skalere halvdelene og å flytte grensen, og det som lagres er det som vises |
| `soft-minimum.spec.ts` | En sone med tekst holder ved den myke minstegrensen før den slipper, lagres mindre enn teksten trenger, tegner teksten forminsket og helt innenfor sonen med oransje markering og forklaring i inspektøren; angre, gjør om og omlasting gir samme geometri og samme tilstand |
| `subfield-drag.spec.ts` | En delestrek mellom to delfelt dras i vanlig innholdsredigering til et helt trinn, og det som ble vist, er det som lagres, overlever omlasting og presenteres med nøyaktig samme inndeling |
| `split-preview.spec.ts` | Delingsdialogens forhåndsvisning av den nøstede 2 + 3-inndelingen: to heltrukne soner, tre stiplede underinndelinger, hele sonen synlig uten rulling |
| `split-flow.spec.ts` | Delingsdialogen fjerner soner med nøstet innhold: sier hvilke soner og hvor mye innhold, redder det til sandkassen, og angre/gjør om tar hele endringen i ett steg |
| `zone-consistency.spec.ts` | Hver vei inn i delingsdialogen (inspektør, ikonrad, sonemeny, forholdstallmeny) viser samme sone, sti og handling, og fokus går tilbake til det som åpnet den, men tar ikke fokus fra noe som allerede har fått det |
| `present.spec.ts` | Presentasjonsmodus med tastatur og Escape; samme innhold som i editoren |
| `auth.spec.ts` | Innlogging med engangskode (sifrene sender inn selv), feil kode med nytt forsøk, «Hold meg innlogget» overlever at nettleseren lukkes og ellers ikke, ut og inn uten at en lagret presentasjon går tapt, deaktivering stenger en åpen økt |
| `card-look.spec.ts` | Skygger slås av og på og huskes; tittel og innhold i et kort med tittel forminskes hver for seg og merkes hver for seg, likt i redigering og presentasjon; utseendet kan velges med tastaturet |
| `sharing.spec.ts` | «Del» står før «Vis» og er avslått lokalt; en delingsadresse går utenom innloggingen og viser ingen presentasjon |
| `workspace.spec.ts` | Modus, ulagret redigering og angrehistorikk overlever bytte mellom desktop og kompakt |
| `accessibility.spec.ts` | axe-revisjonen (WCAG 2.2 A/AA) av bibliotek og editorens tilstander, i mørkt og lyst utseende |
| `appearance.spec.ts` | Et valgt utseende (lyst) går foran systemets og huskes etter omlasting |
| `interactive.spec.ts` | En miniapp kjører bare mellom Aktiver og Avslutt |
| `interactive-security.spec.ts` | Miniapprammen har nøyaktig sandkassen og innholdspolicyen som er avtalt |
| `compact.spec.ts` | Kompakt arbeidsflate, tekstlista til skriveflaten og lagring etter omlasting, i alle tre kompaktprosjektene (telefon stående, telefon liggende, smalt vindu med mus) |
<!-- e2e-pr-files:end -->

## Hva bare den nattlige kjøringen dekker

Alt annet, rundt 380 kjøringer: resten av sone-, fit-, tekst-, bilde-, miniapp- og kompakttestene, kontekstmenyer, hurtigtaster, justering, temaer, oppgavematrisen (`task-matrix.spec.ts`), responsivitet, og de 18 visuelle testene med 39 referansebilder (`visual.spec.ts`, `visual-chrome.spec.ts`).

En rød nattlig kjøring betyr at noe på `main` er brukket eller ustabilt. Den rettes som en vanlig feil, i en egen PR; den skal ikke dempes ved å fjerne testen fra kjøringen.

## Endre utvalget

Legg til `{ tag: '@pr' }` som andre argument til `test(...)`, og nevn filen i tabellen over hvis den er ny. Hold utvalget til flyter som en anmelder ellers måtte prøve for hånd, og hold kjøretiden rundt to–tre minutter. En test som tas ut av utvalget, kjøres fortsatt hver natt.

## Visuelle referansebilder

Referansebildene ligger i `e2e/*.spec.ts-snapshots/` og er **tatt på GitHub-runneren** (Ubuntu 24.04, Chromium fra Playwright-versjonen i låsefilen). Grensesnittet tegnes med systemfonten, som ikke er den samme på en utviklermaskin, så bildene sammenlignes bare der de ble tatt: i den nattlige kjøringen. Lokalt kan `SLAIDS_VISUAL=1 npx playwright test visual` derfor vise forskjeller i tekst som ikke er feil.

En tilsiktet endring i grensesnittet krever nye referansebilder:

1. Push endringen til grenen.
2. Kjør **Nettlesertester** for hånd fra Actions-fanen på den grenen med `suite: referansebilder`.
3. Last ned artefaktet `referansebilder`, pakk det ut over `e2e/`, se over bildene og commit dem sammen med endringen.
