# Interaktive slider: forfatterkontrakt for miniapper

Dette er den normative forfatterkontrakten for mennesker og KI-agenter som lager
miniapper til Slaids. Produkt- og arkitekturspesifikasjonen ligger fortsatt i
`IMPLEMENTATION_PLAN.md`. **Å arve riktige farger og fonter er nødvendig, men er
ikke tilstrekkelig til å levere en god miniapp. Layout og faktisk plassbruk må
også verifiseres.**

## 1. Obligatorisk arbeidsflyt for agenter

1. Les denne filen før du skriver HTML. Ved API-bruk: hent
   `get_interactive_contract` først. Den gir gjeldende kontraktversjon,
   variabelnavn, de obligatoriske strukturreglene, et minimalt startskall,
   flatestørrelse, bytegrenser og sikkerhetsbegrensninger — nok til å skrive
   en korrekt miniapp uten repotilgang. Operasjonens `documentation` peker hit
   for begrunnelsene og leveransekravene.
2. Start fra `examples/interactive-miniapps/starter.html`. Behold prinsippene
   for rot, rulleflate, avstandseierskap og fokus. Endre innholdet og den lokale
   layouten, ikke presentasjonens farger eller fontroller.
3. Bestem én hovedoppgave og ett tydelig hovedresultat. Skriv ned hvilke
   tilstander som skal vises, hvilken som krever mest plass, og om noe innhold
   med hensikt skal kunne rulles.
4. Kjør appen i en nettleser med **Slaids' injiserte basis-CSS og designverdier**,
   i en 1600 × 900 sandkasset ramme. En rå HTML-fil åpnet alene er ikke en
   representativ layouttest.
5. Gjennomfør kontrollene i §7. Rett feil, ta nye skjermbilder og kontroller
   igjen. Lever filen sammen med hva som faktisk er testet. Manglende tilgang
   til nettlesertest skal oppgis som manglende verifikasjon, aldri som bestått.

`system-test.html` er en testbenk med separate visninger, ikke en oppfordring
til å bygge kontrollpaneler med mange funksjoner på en undervisningsslide.
`starter.html` er utgangspunktet for vanlige miniapper.

## 2. Format og livsløp

Én selvstendig `.html`-fil blir én interaktiv slide. All CSS og JavaScript skal
ligge inline. Eventuelle bilder, lyd og egne fonter må være inkludert som
`data:`- eller `blob:`-URL-er, ikke eksterne avhengigheter.

- Gyldig UTF-8. Et byte order mark fjernes; UTF-16 avvises.
- Maks **2 MiB per fil**, målt i UTF-8-byte, ikke antall tegn.
- Maks **6 MiB miniapp-kilde per presentasjon** til sammen.
- Filnavnet skal slutte på `.html`.

Publikum ser først en forside med navn og aktiveringsknapp. Filen kjøres bare
etter eksplisitt aktivering i nettleseren. Miniatyrer, rendret preview, eksport
og servere kjører ikke appen. En ny aktivering er en **ny kjøring uten bevart
tilstand**. Ingen oppgave må avhenge av at appen får fullføre eller kan fortsette
neste gang.

## 3. Visuell kontrakt: en slide, ikke en liten nettside

### Informasjonsmengde og hierarki

- Vis én hovedoppgave om gangen, med ett dominerende resultat og de kontrollene
  som trengs for å påvirke det. En kort instruks er bedre enn et langt
  forklaringspanel.
- Bruk som standard høyst **to hovedområder ved siden av hverandre**, med felles
  kanter og konsekvent innvendig luft. Flere kontroller må begrunnes av den
  samme oppgaven. Et diagram, spillbrett eller en annen lokal interaksjonsflate
  kan naturligvis ha flere deler; dette er ikke tillatelse til å fylle resten
  av sliden med små paneler.
- Hjelp, feilsøkingsdata og sekundære oppgaver skal ikke konkurrere med
  hovedinnholdet. Vis dem i en egen tilstand ved behov. Behold resten i samme
  miniapp når det er én sammenhengende interaksjon.
- Ikke bruk mange like sterke knapper, gjentatte overskrifter, statusmerker
  uten funksjon, kort inni kort eller dekorative rammer rundt hver tekstbit.
- Når det blir trangt: fjern overflødig tekst, grupper bedre eller del i
  tilstander. **Ikke reduser skriftstørrelse, linjehøyde eller temaets luft
  vilkårlig for å presse inn mer.**

### Flaten og avslutningsknappen

Appens viewport er alltid **1600 × 900 logiske piksler**. Slaids skalerer hele
flaten uniformt. En liten fysisk skjerm gir derfor ikke automatisk en mindre
CSS-viewport inne i appen. `@media (max-width: 1050px)` er ikke en løsning på
plassmangel i en Slaids-slide. Ikke legg inn en ny skalering av hele appen.

Slaids tegner «Avslutt miniapp» oppå øvre høyre hjørne, som en liten og diskret
«×» med en større usynlig treffflate rundt seg – litt større på berøringsflater.
Startmalen reserverer konservativt et felt øverst og til høyre for overskriftens
innhold; målene står ett sted, som `INTERACTIVE_EXIT_CLEARANCE` i
`src/domain/interactiveStyle.ts`. Dette er malens sikkerhetsmargin, ikke en
målangivelse for Slaids-kontrollen; den faktiske kontrollen er klart mindre.
Kontroller den i editor og spiller; ingen kontroll, tekst eller fokusmarkering
skal havne under den.

### Avstander skal ha én eier

Bruk Grid/Flex til vanlig grensesnittlayout. Hver avstand skal bestemmes ett
sted, normalt av foreldrens `gap`:

| Avstand/egenskap | Kilde |
| --- | --- |
| Ytterluft og mellom hovedområder | `--slaids-gap` |
| Innvendig luft i et panel | `--slaids-padding` |
| Mellom sammenhørende tekst- og kontrollblokker | `--slaids-block-spacing` |
| Hjørner og eventuell skygge | `--slaids-radius`, `--slaids-shadow` |

En strukturell innpakning skal ikke introdusere ny padding eller marg, og ingen
avstand skal ha to eiere samtidig — tilfeldige marger oppå `gap` og `padding` er
den vanligste kilden til skjev luft. Hovedinnholdet skal være ryddig og
panel-/beholderbasert, og visuelt sentrert eller balansert der det passer;
asymmetrisk padding skal ha en semantisk grunn.

I eksplisitte stack/grid-layouts skal blant annet overskrifter, avsnitt, lister,
figurer og labels få `margin: 0` **innenfor appens rot**. Ellers legger
basisstilarkets marger seg oppå `gap`. Behold tilsiktet listeinnrykk.

Sett `min-width: 0` på krympbare Grid/Flex-barn og bruk
`minmax(0, 1fr)` for fleksible spor. Tekst og dynamiske resultater skal kunne
bryte linjer. Ikke bruk faste høyder på bokser som inneholder varierende tekst.
Absolutt posisjonering er for en avgrenset figur eller interaksjonsflate, ikke
for å plassere overskrifter, vanlige kort og kontroller. Ingen negative marger,
`translate`-justeringer eller tilfeldige pikselverdier for å lappe over feil flyt.
Eksplisitte mål for treffflater, fokusluft og avslutningsknappens friplass er
begrunnede unntak, ikke en alternativ avstandsskala.

### Ta høyde for den CSS-en appen faktisk får

Slaids injiserer basisstilarket **før** appens CSS. Det setter allerede
`body`-padding, typografi, overskrifts-/avsnittsmarger, label-marger og
kontrollutseende. Det gir også panelutseende til `article`, `section > section`
og `.slaids-card`. Derfor kan ekstra semantiske innpakninger ellers gi
utilsiktet dobbel padding og flere panelbakgrunner.

Bruk navngitte klasser til eksplisitt layout og overstyr lokalt. Ikke bruk
`all: unset`, ikke fjern fokusmarkeringer, og ikke erstatt hele basisdesignet.
Hvis appen bruker `hidden` til å bytte visning, må skjulte visninger faktisk tas
ut av layouten. Startmalens `#miniapp [hidden] { display: none !important; }`
hindrer at appens egne `display: grid`-regler overstyrer dette.

## 4. Rulling og plassgaranti

Hovedoppgaven og de nødvendige kontrollene skal passe uten rulling ved vanlige
innstillinger. Startmalen og testbenkens primærvisninger testes også ved de
største støttede skrift- og luftinnstillingene. Ekstra materiale kan være
uttrykkelig rullbart. Uventet innholdsvekst må aldri gjøre noe utilgjengelig.

Bruk **én navngitt vertikal rulleflate** for appens innhold, ikke flere
uavhengige rullebokser.

De obligatoriske strukturkravene — én tydelig rot, full og avgrenset høydekjede,
`box-sizing: border-box`, `html, body` uten default-marger, én navngitt vertikal
rulleflate med `min-height: 0` og `overflow-y: auto`, og avstandsvariablene
under — står **ett sted**: `INTERACTIVE_LAYOUT_RULES` i
`src/domain/interactiveStyle.ts`. Samme fil har `INTERACTIVE_STARTER_SKELETON`,
det minimale skallet som følger dem. Begge returneres av
`get_interactive_contract`, så en agent har dem uten å lese repoet, og
`examples/interactive-miniapps/starter.html` er det samme skallet med en
fungerende app i seg. Denne filen gjentar dem ikke; den forklarer hvorfor de
gjelder.

Rotens `overflow: hidden` er lovlig **bare fordi det finnes en avgrenset,
fungerende indre rulleflate som gjør alt innhold tilgjengelig**. Det er aldri
lov å bruke klipping for å få en overfylt side til å se ut som den passer.
Tilsvarende skal horisontal overflow måles; `overflow-x: hidden` er ikke et
bevis på at innholdet har plass.

Hele høydekjeden til rulleflaten må være avgrenset, og krympbare Grid/Flex-ledd
må ha `min-height: 0`. `overflow-y: auto` alene er ikke nok. Barn med vanlig
tekst skal vokse naturlig i rulleflaten, ikke krympes sammen av Flex.

Rulleflaten skal kunne fokuseres med tastatur, ha et tilgjengelig navn og gi
plass til fokusmarkeringer. Musehjul, berøring, Page Down og Tab til siste
kontroll skal fungere. Ikke avbryt `wheel` eller alle `touchmove`-hendelser på
dokumentnivå. Eventuell drag må avgrenses til sitt eget element og ha et
alternativ via tastatur eller native kontroller.

## 5. Farger, fonter og størrelser

Bruk variablene, **aldri egne konkrete tema- eller fontverdier**. De kommer fra
seksjonen sliden ligger i og presentasjonens fontroller og størrelsesvalg.
Farger alene skal ikke formidle betydning.

| Variabel | Rolle |
| --- | --- |
| `--slaids-background` | Sidebakgrunn |
| `--slaids-text` | Tekst med kontrast mot bakgrunnen |
| `--slaids-muted` | Sekundær tekst |
| `--slaids-accent` | Seksjonens aksentfarge |
| `--slaids-accent-text` | Tekst med kontrast mot aksenten |
| `--slaids-surface` | Panelbakgrunn |
| `--slaids-border` | Skillelinjer og rammer |
| `--slaids-heading-font` | Overskriftsfont |
| `--slaids-body-font` | Brødtekstfont |
| `--slaids-font-size` | Brødtekst |
| `--slaids-font-size-small` | Sekundær tekst/bildetekst |
| `--slaids-font-size-heading` | Mellomoverskrift |
| `--slaids-font-size-title` | Tittel |
| `--slaids-line-height` | Brødtekstens linjehøyde |
| `--slaids-heading-line-height` | Overskriftens linjehøyde |
| `--slaids-gap` | Globalt gap og ytterluft |
| `--slaids-padding` | Panelpadding |
| `--slaids-block-spacing` | Blokkavstand |
| `--slaids-radius` | Hjørneradius |
| `--slaids-shadow` | Slagskygge, eller `none` når skygger er slått av i temaet |

`body` får som standard `padding: var(--slaids-gap)`. En layout som selv eier
ytterluften, slik som startmalen, nullstiller denne paddingen.
Slaids inliner sine garanterte webfonter som `@font-face` med `data:`-URL-er.
Lokale fonter har vanlig fontfallback. Appen skal ikke hente fonter selv.
At en CSS-variabel finnes, beviser ikke at fontfilen ble lastet eller at den
riktige fonten ble brukt; dette må verifiseres visuelt og ved fonttesten når
webfonter er relevante.

Dette er stilkontrakt **v1**. Kontraktversjonen lagres på sliden. En forbedret
forfattermal eller strengere kvalitetskrav endrer ikke v1-basisstilarket eller
allerede lagrede HTML-filer. En observerbar endring i det injiserte
basisdesignet krever en ny stilkontrakt, ikke en stille endring under gamle
miniapper.

## 6. Interaksjon, tilgjengelighet og sikkerhet

Bruk ekte knapper og native kontroller når de løser oppgaven. Alle felt skal ha
labels, alle interaksjoner skal kunne nås med tastatur, og ikoner/bilder skal ha
tekstalternativer. Treffflater skal være romslige; startmalen bruker minst
48 logiske piksler på knapper. Behold synlig fokus. Bruk `aria-live="polite"`
på korte resultater der det hjelper, ikke på hele grensesnittet.

Egne hurtigtaster skal tilhøre en eksplisitt interaksjonsflate. De må ikke
stjele mellomrom fra en fokusert knapp, piltaster fra en range/select eller
tekstredigering fra input/textarea. Ikke endre Tab/Shift+Tab. Ingen global
snarvei skal utløse den samme handlingen i tillegg til kontrollens native
handling.

Appen har opak origin og starter på nytt ved hver aktivering. Følgende er ikke
tilgjengelig, og vanlig appkode skal ikke avhenge av det:

- Nettverk: `fetch`, XHR, WebSocket, `sendBeacon` og eksterne bilder, skript,
  stilark eller fonter. Alle nødvendige ressurser må følge filen.
- Lagring: `localStorage`, `sessionStorage`, cookies og IndexedDB.
- `eval` og `new Function`.
- Navigasjon, popup, nedlasting, skjemainnsending og `alert`/`confirm`/`prompt`.
- Kamera, mikrofon, posisjon, skjermdeling, utklippstavle, fullskjerm og pekerlås.
- Tilgang til eller endring av presentasjonen; `postMessage` til Slaids har
  ingen virkning.

Ingen tilstand kan bevares mellom kjøringer. Svar fra salen, innlogging,
live-data og varig framgang krever noe annet enn denne miniappmodellen.
Slaids' «Avslutt miniapp» skal forbli tilgjengelig, og Escape skal ikke avslutte
presentasjonen mens appen er aktiv.

Sikkerhetsdiagnostikk hører hjemme i de dedikerte testene. Et mislykket
nettverkskall eller en nektet popup er alene ikke bevis på en korrekt sandbox;
feilen kan skyldes nettverk, CORS eller nettleserinnstillinger. Ikke vis et
ubetinget «sikkerhet bestått» på det grunnlaget, og ikke legg slike tester inn i
vanlige undervisningsapper.

## 7. Leveransekriterier: måles og sees før levering

Test den mest plasskrevende tilstanden, ikke bare startsiden. Kontroller minst:

- **Geometri:** ingen overlapp mellom søsken, skjult tekst, horisontal overflow
  eller innhold under avslutningsknappen. Det skal være én aktiv visning.
  Kontroller både `scrollWidth/clientWidth` og faktiske elementrektangler;
  et pent første skjermbilde alene er ikke tilstrekkelig.
- **Tema:** lyst og mørkt, ulike fontbredder, standardverdier og de støttede
  ytterpunktene for skrift og luft fra `src/domain/metrics.ts`. Ikke frys disse
  grensene som en separat sannhetskilde. Appens farger og fontroller skal følge
  presentasjonen etter ny aktivering.
- **Skalering:** logisk 1600 × 900 både uforstørret og skalert ned i en fysisk
  mindre visningsflate. Ikke test bare en smal CSS-viewport som Slaids aldri
  gir appen.
- **Interaksjon og rulling:** mus, native tastaturhandlinger, fokus, lange
  inndata, grenseverdier og nye resultat-/feiltekster. Rull med musehjul og
  tastatur, nå siste kontroll og kontroller at bare den tilsiktede flaten
  flytter seg. Verifiser berøring når interaksjonen skal brukes slik.
- **Livsløp:** avslutt, aktiver på nytt, og bekreft initialverdiene. Kontroller
  «Avslutt miniapp» og vanlig navigasjon før/etter appen i editor og spiller;
  også delt visning dersom den berøres.

Ta skjermbilder og se på dem. Rett både målbare feil og unødvendig visuelt rot.
Ved endringer i repoets eksempler kjøres `e2e/interactive-authoring.spec.ts`
gjennom prosjektet `chromium-interactive`; det bruker repoets faktiske
basisstilark og rammebygger. De eksisterende `interactive.spec.ts` og
`interactive-security.spec.ts` dekker den komplette verts-/sikkerhetsflyten.
Eksempeltesten erstatter dem ikke.

**En grønn build/Vercel-deployment er ikke en layouttest.** En godkjent
HTML-opplasting betyr heller ikke at Slaids har verifisert appens utseende.
Dette er forfatterkrav og regresjonstester for eksemplene, ikke en automatisk
fit-guard for vilkårlig HTML fra andre kilder.

## 8. Agentoperasjoner

- `get_interactive_contract`: stilversjon, variabelnavn, de obligatoriske
  struktur-, rulle- og avstandsreglene, et minimalt startskall som følger dem,
  flate, bytegrenser, begrensninger og dokumentasjonssti. Den er nok til å
  skrive en korrekt miniapp uten tilgang til repoet; denne forfatterkontrakten
  gir begrunnelsene og leveransekravene i §7.
- `add_interactive_slide`: fil som `html` (JSON-streng) eller `content`
  (base64/tekst over JSON, rå bytes over REST). Velg `content` nær bytegrensen,
  fordi JSON-escaping ellers kan sprenge forespørselsgrensen.
- `set_interactive_slide`: nytt navn og/eller fil. Avvist fil endrer ingenting.
- `get_presentation` og `inspect_slide`: navn, filnavn, størrelse og
  stilkontraktversjon, ikke HTML-kilden.

Ikke bruk `render_slide_preview` som bevis for miniapp-layout: operasjonen
tegner bare den statiske forsiden. Miniappens aktive tilstand må testes i en
nettleser.
