# Mobil arbeidsflate

> **Status:** Arbeidsplan for mobiltilpasning. `IMPLEMENTATION_PLAN.md` er fortsatt eneste normative produkt- og arkitekturspesifikasjon. Før implementeringen merges skal den normative planen oppdateres slik at mobilredigering ikke lenger står som ikke-mål, og de varige reglene fra dette dokumentet som faktisk er implementert flyttes dit.
>
> **Mål:** Gjøre Slaids praktisk brukbar på telefon og smale nettbrett uten å gjøre desktopopplevelsen dårligere eller lage en egen mobilvariant av presentasjonsmodellen.

## 1. Produktretning

Slaids skal fortsatt være **desktop-først**, men ikke desktop-eksklusiv.

Desktop skal være stedet for rask, tett og presis presentasjonsbygging. Mobil skal optimaliseres for:

1. åpne og gjennomgå presentasjoner;
2. navigere raskt mellom slides;
3. rette og skrive tekst;
4. gjøre vanlige innholdsendringer;
5. velge soner og utføre strukturelle handlinger uten krav om presis dragging;
6. presentere og teste presentasjoner;
7. gjøre nok layoutarbeid til at mobilen faktisk er nyttig når PC ikke er tilgjengelig.

Mobil skal **ikke** forsøke å kopiere desktopens paneloppsett i mindre skala. Samme funksjon kan ha ulik betjening på desktop og mobil så lenge de bruker samme domeneoperasjoner og gir samme lagrede resultat.

## 2. Harde invariants

Mobiltilpasningen skal ikke introdusere en ny presentasjonsmodell eller en ny geometri.

Følgende er felles for desktop og mobil:

- logisk slide-rom er fortsatt `1600 × 900`;
- samme `Presentation`, `Slide`, layouttre, tema, assets og rich-text-format brukes;
- `src/domain/geometry.ts` og eksisterende rendering/fit er sannhetskilden;
- strukturelle endringer går gjennom eksisterende typed domenekommandoer;
- autosave, undo/redo, asset-håndtering og persistens er de samme;
- en presentasjon åpnet og endret på mobil skal se lik ut på desktop;
- viewportens størrelse må aldri bli lagret som presentasjonsdata;
- skjulte eller kompakte UI-varianter skal ikke brukes som målegrunnlag for `canFit()`.

Det skal ikke opprettes separate «mobile slides», mobile temaer eller mobilspesifikke layoutverdier i dokumentet.

## 3. Responsiv strategi

Mobilmodus skal bestemmes av **tilgjengelig arbeidsflate og inputegenskaper**, ikke user-agent-sniffing.

Bruk to uavhengige begreper:

- **compact workspace**: arbeidsflaten er for smal/lav til permanent filmstripe + stage + inspector;
- **coarse/touch input**: treffflater og interaksjoner må fungere uten presis mus.

Et stort nettbrett kan derfor få desktop-lignende plassering med touch-vennlige kontroller. En smal desktop-browser kan få compact workspace med mus.

Ikke bygg funksjonaliteten rundt et bestemt telefonmål eller ett magisk breakpoint. Bruk CSS/container queries der layout alene kan løses i CSS, og en liten delt hook/utilitet bare der React faktisk må vite at arbeidsflaten er kompakt.

Orientering er et layoutsignal, ikke apptilstand. Rotasjon skal ikke remounte editoren eller miste:

- valgt slide;
- valgt sone;
- åpent redigeringspanel;
- markør/tekstutvalg når nettleseren tillater det;
- ulagret kladd;
- undo/redo-historikk.

## 4. Mobil arbeidsflate

### 4.1 Liggende telefon

Liggende telefon er den viktigste visuelle editorflaten.

Standardoppsett:

- sliden/stagen får størst mulig areal;
- desktopens permanente filmstripe og inspector fjernes fra normal flyt;
- en smal, touch-vennlig kontrollrad eller kontrollsøyle gir tilgang til slides, sone/inspector, undo/redo, innhold, verktøy og presentasjon;
- kun ett større sidepanel/drawer vises om gangen;
- tekstverktøy vises bare når tekst faktisk redigeres;
- modaler og store verktøy kan bruke nesten hele skjermen.

Målet er at sliden ikke reduseres til et lite felt mellom flere permanente paneler.

### 4.2 Stående telefon

Stående telefon skal være **innholdsorientert**, ikke bare en smalere liggende editor.

Standardoppsett:

- kompakt slide-preview øverst;
- under preview vises en innholds-/soneoversikt eller kontekstpanel for valgt element;
- brukeren kan skifte til en «fokuser slide»-visning for større visuell inspeksjon;
- tekstredigering og inspector kan ta hele eller nesten hele skjermen;
- slideoversikt åpnes som drawer/fullskjermspanel.

Dette gjør stående mobil særlig egnet til tekst, innhold og raske rettelser.

### 4.3 Ett panel om gangen

På compact workspace skal filmstripe, inspector, Sandbox, Ideer og andre store verktøy ikke konkurrere om plass samtidig.

Det skal finnes en enkel sentral paneltilstand, for eksempel:

```ts
type CompactPanel =
  | 'slides'
  | 'inspector'
  | 'sandbox'
  | 'ideas'
  | 'more'
  | null
```

Eksisterende verktøystates kan fortsatt eie sitt eget innhold. Formålet er bare å sørge for at mobilskallet viser én stor arbeidsflate om gangen.

Å åpne ett panel lukker et annet. En modal/dialog står over dette og skal ikke nullstille underliggende utvalg.

## 5. Slideoversikt og navigasjon

`Filmstrip` skal fortsatt være samme logiske slideoversikt og bruke samme reorder/delete/add-operasjoner, men på compact workspace presenteres den som en drawer eller fullskjermsoversikt.

Mobilkrav:

- miniatyr + slide-/seksjonsinformasjon skal være lett å trykke på;
- legg til slide, seksjon og interaktiv slide skal være tilgjengelig uten hover;
- sletting skal være eksplisitt og bekreftes som i dag;
- slide-rekkefølge skal kunne endres uten at drag-and-drop er eneste vei;
- tilby knapp/meny for «Flytt før», «Flytt etter», eventuelt «Flytt til posisjon»;
- dragging kan beholdes som rask snarvei der det fungerer godt.

Sveip mellom slides kan brukes i gjennomgang/presentasjon, men skal ikke kapre fingerbevegelser under aktiv layout- eller innholdsredigering.

## 6. Sonevalg og layoutredigering

Mobilens største presisjonsproblem er små soner og smale split-grenser.

### 6.1 Valg først

Et vanlig trykk på en sone skal primært **velge** den. Det skal ikke samtidig starte flytting, resizing eller tekstredigering.

Når en sone er valgt, vises relevante handlinger i en touch-vennlig kontekstflate.

### 6.2 Fokusert sone

Det skal være mulig å «fokusere» en valgt sone:

- visningen zoomer/panner slik at sonen blir stor nok til trygg interaksjon;
- dette endrer bare editorens view transform, aldri lagret geometri;
- en tydelig kontroll returnerer til hel slide;
- dersom nesting gjør direkte tapping vanskelig, skal parent/child kunne velges fra inspector/soneoversikt.

### 6.3 Ingen viktig funksjon skal kreve dragging

Eksisterende drag-funksjoner kan beholdes, men mobil skal ha diskrete alternativer:

- split/rediger splitting via eksisterende split-dialog;
- endre relativ størrelse via større/mindre eller eksplisitt vektkontroll som fortsatt kvantiserer gjennom eksisterende regler;
- forskyvning/omfordeling via tydelige retningskontroller;
- flytt innhold via «Flytt til …» + valg av mål;
- flytt Sandbox-element via valg av mål, ikke bare drag/drop;
- slide-reorder via eksplisitt kommando i tillegg til drag.

Disse kontrollene skal kalle samme domenekommandoer som desktop.

## 7. Tekstredigering

Tekst inne i en nedskalert 1600×900-slide er ikke en god mobil skriveflate. Mobil skal derfor ha fokusert tekstredigering.

Når tekst aktiveres på compact workspace:

- åpne en lesbar skriveflate/fullskjerms editor eller et stort panel;
- behold samme Tiptap/ProseMirror-dokument og samme formatteringskommandoer;
- vis bare relevante formatteringskontroller;
- gi en enkel vei tilbake til slide-preview;
- bevar selection så langt browser/Tiptap gjør det robust.

**Fit-regelen endres ikke.** Den store skriveflaten må aldri bli sannhetskilde for om teksten passer. Commit/fit skal fortsatt valideres mot den virkelige sonen i det logiske slide-rommet med eksisterende målemekanisme.

Hvis ny tekst ikke får plass:

- kladden skal ikke forsvinne;
- brukeren skal få en tydelig beskjed;
- det skal være lett å gå tilbake og forkorte/formatere teksten;
- løsningen må ikke omgå fit-guarden eller tillate skjult innhold.

## 8. Skjermtastatur og synlig viewport

Skjermtastatur er en egen layouttilstand.

Bruk `window.visualViewport` når tilgjengelig for å vite hvor stor del av siden som faktisk er synlig. Ha en robust fallback når API-et ikke finnes.

Når tastaturet er åpent:

- aktive input/editorflater og primær «Ferdig»-handling må være synlige;
- faste verktøylinjer må ikke havne bak tastaturet;
- store sekundære flater kan skjules midlertidig;
- editoren skal ikke tolke endret viewport-aspect-ratio som en ny presentasjonstilstand;
- åpning/lukking av tastatur skal ikke remounte Tiptap eller miste kladd.

Bruk safe-area-insets for enheter med notch/home-indicator.

## 9. Touch- og pointerregler

Alle nye mobile kontroller skal bruke pointer-events fremfor separate mus/touch-kodeløp der det er praktisk.

Krav:

- sentrale treffflater skal normalt være minst omtrent 44×44 CSS-piksler;
- funksjoner som i dag bare finnes på hover må få synlig touch-vei;
- kontekstmenyer må kunne åpnes med trykk;
- langtrykk og dobbelttrykk kan være snarveier, aldri eneste vei;
- scrollområder må få scroll selv om de ligger nær drag-/gestureflater;
- aktiv interaktiv miniapp eier pointer/touch/wheel inne i sin runtimeflate;
- nettleserens pinch-zoom skal ikke blokkeres globalt.

## 10. Inspector, Sandbox, Ideer og modaler

### Inspector

På compact workspace åpnes inspector som drawer/fullskjermspanel. Samme inspectorinnhold og domeneregler skal gjenbrukes så langt det er hensiktsmessig.

For valgt sone skal de viktigste handlingene være øverst og ikke kreve at brukeren scroller gjennom hele inspector først.

### Sandbox

Sandbox skal fungere uten drag-and-drop:

1. velg Sandbox-element;
2. velg «Plasser»;
3. lovlige målsoner markeres eller listes;
4. trykk mål;
5. eksisterende fit-validering brukes.

Drag kan fortsatt støttes på større touchflater.

### Ideer

`IdeasWindow` skal på mobil være et panel/fullskjermsverktøy, ikke et fritt flytende vindu som må flyttes rundt.

### Modaler

Alle eksisterende dialoger må testes i små høyder og bredder. De skal:

- aldri være bredere/høyere enn synlig viewport;
- kunne scrolles internt ved behov;
- beholde header og viktige handlinger tilgjengelige;
- respektere safe area og skjermtastatur;
- ikke ha handlinger som bare kan nås med hover.

## 11. Biblioteket

Biblioteket er en del av samme mobile leveranse.

Krav:

- presentasjonskort/listing skal fungere på smale skjermer;
- opprett/åpne/importer/dupliser/slett og relevante menyvalg skal kunne brukes med touch;
- ingen horisontal sidescroll for normal bibliotekbruk;
- dialoger og menyer skal følge samme kompakte modalregler;
- desktoplayout beholdes uendret når plassen tillater det.

## 12. Presentasjonsmodus

Presentasjonsmodus skal være mobilvennlig i samme PR.

Krav:

- tydelig, trykkbar vei til forrige/neste slide;
- tydelig «Avslutt» uten Escape-tast;
- trykk på tom flate bør primært vise/skjule kontroller, ikke nødvendigvis alltid gå videre;
- swipe kan navigere når gesten starter utenfor interaktivt innhold;
- lenker, valgbar tekst, miniapper og andre interaktive elementer må ikke feiltolkes som slide-navigasjon;
- controls auto-hide kan brukes, men må enkelt hentes tilbake;
- fullskjerm kan tilbys når browseren støtter det, men må ikke være påkrevd.

## 13. Interaktive miniapper

Eksisterende miniapper har en `1600 × 900`-kontrakt. Denne hoved-PR-en skal **ikke** endre den kontrakten.

I mobil-PR-en skal vi bare sikre:

- at en interaktiv slide kan åpnes og aktiveres med touch;
- at avslutt-knappen er lett tilgjengelig og touch-vennlig;
- at Slaids ikke stjeler miniappens pointer/touch/wheel mens runtime er aktiv;
- at iframe/runtime skaleres korrekt til tilgjengelig mobilflate;
- at eksisterende miniapper fortsatt oppfører seg som før på desktop.

En senere, separat leveranse kan eventuelt innføre en opt-in responsiv miniappkontrakt der appen får reell mobil viewport. Det må i så fall spesifiseres sammen med agentinstruksjoner, starter-template og kompatibilitetsregler. Ikke gjør det implisitt i mobil-PR-en.

## 14. Teknisk struktur

Målet er å unngå både en gigantisk `EditorView`-if/else og en parallell mobil-editor.

Anbefalt retning:

1. Behold `EditorView` som eier av lasting, autosave, kommandoer og overordnet state.
2. Introduser en liten delt workspace/capability-hook for compact/coarse/visual viewport.
3. Trekk ut et tynt desktop- og compact-shell-lag der dagens trekolonneplassering og ny mobilplassering faktisk divergerer.
4. Gjenbruk eksisterende `Filmstrip`, `Inspector`, `EditorStage`, `SectionStage`, `InteractiveStage`, modaler og domenefunksjoner fremfor å kopiere innholdet.
5. Lag små mobile adapterkomponenter bare når desktopkomponenten er fundamentalt bundet til hover, drag eller permanent panelplassering.
6. Ikke kopier domeneregler inn i adapterne.
7. Ikke behold to komplette skjulte editortrær samtidig; skjult Tiptap/fit/DnD-DOM kan påvirke måling, fokus og ytelse.

Et mulig mønster er:

```text
EditorView
  ├─ DesktopEditorShell
  │   ├─ TopToolbar / TextToolbar
  │   ├─ Filmstrip
  │   ├─ Stage
  │   └─ Inspector
  └─ CompactEditorShell
      ├─ CompactToolbar
      ├─ Stage/preview
      └─ én aktiv drawer/panel
```

Shellene skal motta callbacks/view state fra samme eier; de skal ikke implementere hver sin editorlogikk.

## 15. Tilgjengelighet og tastatur

Mobiltilpasningen skal ikke degradere desktop-tastaturbetjening.

- eksisterende shortcuts beholdes på desktop;
- focus order må være logisk når drawer åpnes;
- drawer/modal skal bruke robust focus trap/return focus gjennom eksisterende Radix-primitiver der mulig;
- icon-only mobilknapper skal ha tilgjengelig navn;
- aktive/valgte tilstander skal være semantiske, ikke bare visuelle;
- reduced motion skal respekteres for større drawer/zoom-animasjoner.

## 16. Testing

Denne leveransen er UI-tung og skal ha egne mobile Playwright-prosjekter i tillegg til eksisterende desktop-Chromium.

Minimum automatisert dekning:

### Viewports

- moderne stående telefon;
- moderne liggende telefon;
- minst én kompakt bredde med mus for å bevise at responsiviteten ikke er UA-basert;
- desktopregresjon.

### Flyter

1. åpne bibliotek, opprette og åpne presentasjon;
2. velge slide fra mobil slideoversikt;
3. rotere/endre viewport uten å miste valgt slide/sone;
4. åpne inspector og utføre en vanlig sonehandling;
5. redigere tekst og verifisere at fit fortsatt håndheves;
6. åpne skjermtastatur-lignende lav viewport og verifisere synlige handlinger;
7. flytte slide uten drag;
8. plassere Sandbox-element uten drag;
9. bruke modal med liten viewport;
10. gå inn i presentasjonsmodus, navigere og avslutte uten tastatur;
11. aktivere og avslutte miniapp med touch/pointer;
12. reload og verifisere persistens;
13. desktop: eksisterende filmstrip/inspector/drag/shortcuts/presentasjonsflyter fungerer fortsatt.

Playwright kan ikke fullt ut simulere ekte iOS/Android-tastatur og alle touchdetaljer. Før merge skal det derfor også gjøres en kort manuell smoke-test på minst én fysisk Android-telefon og én WebKit/iPhone-lignende runtime dersom prosjektmiljøet har tilgang til det. Hvis fysisk iPhone ikke er tilgjengelig, dokumenter eksplisitt hva som er testet i WebKit og hva som gjenstår.

## 17. Akseptansekriterier

Hoved-PR-en er ferdig når:

- biblioteket er praktisk brukbart i stående og liggende mobil;
- editoren har en reell compact workspace, ikke bare sammenpressede desktop-paneler;
- sliden får klart mest plass i liggende compact mode;
- stående mode gir en brukbar innholds-/redigeringsflyt;
- slidevalg, sonevalg, inspector og vanlige strukturendringer kan gjøres med touch;
- ingen sentral handling krever drag;
- tekst kan redigeres lesbart og fit håndheves mot faktisk slidegeometri;
- skjermtastatur/lav viewport blokkerer ikke primær handling;
- presentasjonsmodus kan styres og avsluttes uten fysisk tastatur;
- miniapper kan aktiveres/avsluttes og får eie egne input-events;
- autosave, undo/redo og persistens er uendret i semantikk;
- desktopopplevelsen og eksisterende funksjoner har ingen vesentlig regresjon;
- relevante unit-/komponenttester, `typecheck`, `lint`, full unit-suite, build og mobile+desktop Playwright er grønne;
- `IMPLEMENTATION_PLAN.md` er oppdatert med den varige normative mobilspesifikasjonen og den gamle «mobilredigering er ikke-mål»-teksten er korrigert.

## 18. PR-strategi

### PR 1 — komplett mobil arbeidsflate

Gjør **hele hovedleveransen i én PR**:

- responsiv library;
- compact editor shell;
- liggende + stående arbeidsmåte;
- mobile toolbar/drawers;
- slideoversikt og ikke-drag reorder;
- touch-vennlig sonevalg og inspector;
- fokusert tekstredigering;
- ikke-drag Sandbox/flytt-flyter;
- VisualViewport/safe-area-håndtering;
- mobiltilpassede modaler/verktøy;
- mobil presentasjonsmodus;
- eksisterende miniapp-runtime på mobil;
- Playwright mobile prosjekter og E2E;
- normativ oppdatering av `IMPLEMENTATION_PLAN.md`.

Dette er én forståelig, ende-til-ende leveranse: «Slaids fungerer på mobil». Ikke splitt den opp bare fordi den berører mange komponenter.

Del bare PR-en dersom implementeringen avdekker en reell arkitektonisk avhengighet som bør kunne merges/rulles tilbake uavhengig, eller dersom PR-en blir så stor at korrekt review ikke lenger er realistisk.

### Eventuell PR 2 — responsiv miniappkontrakt

Bare dersom vi ønsker at nye miniapper skal kunne kjenne den fysiske mobilviewporten og selv bytte layout. Dette er en separat kompatibilitets-/forfatterkontrakt og er derfor faglig uavhengig av hoved-PR-en.

## 19. Bevisste ikke-mål for PR 1

- en egen native Android/iOS-app;
- full samarbeidsredigering;
- redesign av desktopeditoren utover det som trengs for delt kode;
- ny presentasjonsmodell;
- fri zoom/pan som lagres i dokumentet;
- å gjøre alle desktop-draggestures identiske på touch;
- å endre eksisterende miniapp-kontrakt fra 1600×900;
- å løse browserbegrensninger med user-agent-spesialtilfeller dersom standard webplattform kan brukes.
