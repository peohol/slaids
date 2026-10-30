# U0 – Baseline og informasjonsarkitektur

**Dato:** 30.10.2026  
**Del av:** [UX_IMPROVEMENT_PLAN.md](UX_IMPROVEMENT_PLAN.md), arbeidspakke U0  
**Grunnlag:** kildekodegjennomgang, eksisterende tester og skjermbilder tatt med Playwright (Chromium, Dexie-modus) av en nyopprettet presentasjon med én todelt slide (kort med tittel + tomt bilde).  
**Begrensning:** Ingen observerte brukertester. Klikktall er sporet i koden og i nettleseren, ikke målt på brukere. Berøring på stor flate er bare testet som emulert `hasTouch` i 412 × 892 og 892 × 412, ikke på fysisk nettbrett.

Skjermbildene ligger i [`docs/ux/baseline/`](ux/baseline/). Ett sett er tatt i hver viewport fra planens liste: 1600 × 1000, 1366 × 768, 1180 × 820, 1025 × 768, 900 × 760 (kompakt med mus), 412 × 892 og 892 × 412 (telefon med berøring).

## 1. Hvor handlingene ligger i dag

Gruppert etter nivåene i planens § 4.1. «Overflate» viser alle inngangene til samme kommando.

| Nivå | Handling | Overflater i dag |
| --- | --- | --- |
| Presentasjon | Gi nytt navn | Tittel i hovedlinjen; kompakt verktøy |
| Presentasjon | Tema, maler, referanser, bildebrief, optimaliser bilder | Sju like ikonknapper uten tekst til høyre i hovedlinjen; kompakt verktøyliste med tekst |
| Presentasjon | Del (hemmelig lenke) | Bryter «Del AV/PÅ» i hovedlinjen; kompakt verktøy |
| Presentasjon | Vis (F5) | Primærknapp i hovedlinjen; kompakt toppbar |
| Presentasjon | Kopier presentasjons-ID, eksport, dupliser, slett | Fem ikonknapper på bibliotekkortet |
| Slide | Ny slide / inndeling / miniapp | Tre ikonknapper i filmstripens bunn; «+» mellom miniatyrer |
| Slide | Flytt opp/ned, dupliser, slett | Fire ikonknapper under hver miniatyr; drag; slidekontekstmeny |
| Slide | Overskriftssone av/på | «Overskrift»-bryter i hovedlinjen |
| Valgt sone | Splitt, flytt innhold, til sandkassen, tøm, slett, sett inn bilde, flere valg | Inspektørens knappeliste; ikonrad over sonen i sonemodus; sonekontekstmeny |
| Valgt sone | Endre innholdstype | Seks ikonknapper i hovedlinjen; inspektøren; velger i tom sone; kontekstmeny; kompakt verktøyliste; ikonraden i sonemodus |
| Valgt sone | Størrelse / forholdstall | Inspektøren (knapper, tallfelt og en lang forklaring); drag i mellomrom |
| Valgt innhold | Kort-/tittelfarge, bildetekst, bildefil, subfelt | Inspektøren; innholdskontekstmeny |
| Aktivt tekstfelt | Formatering, lister, justering, lenke, tabell, symbol, referanse | Tekstverktøylinjen; tekstkontekstmeny |
| Hjelpeverktøy | Idéer, sandkasse, hurtigtaster | Ikonknapper blant presentasjonsverktøyene; «Hurtigtaster» i statuslinjen; kompakt verktøy |

## 2. Oppgavematrise (baseline)

Desktop med mus, 1600 × 1000. Klikk = trykk på kontroller; skriving og filvalg er ikke talt.

| Oppgave | Klikk i dag | Vei | Vanskelig valg / risiko |
| --- | --- | --- | --- |
| Ny presentasjon | 2 | «Ny presentasjon» → navn → «Opprett» | – |
| Ny slide | 2 | Filmstrip-ikon → «med/uten overskrift» | Ikonene for slide, inndeling og miniapp har ingen tekst |
| Kort med tittel | 2 | Velg sone → «Kort med tittel» i tom sone | I hovedlinjen er det seks nesten like rektangel-ikoner (F02) |
| Sett inn bilde og erstatt fil | 3–4 | Velg sone → bildeknapp → velg fil → plassering | Bildeknappen og innholdstypen «Bilde» hadde samme ikon (§ 4.2) |
| Rediger tekst | 1 | Klikk i feltet | – |
| Del en sone | 4 | Velg sone → «Splitt sone» → antall/forhold → «Bruk» | – |
| Endre størrelse | 2 | Velg delsone → «Gjør bredere» | Forklaringen er ni linjer permanent tekst (F06) |
| Flytt / dupliser slide | 1 | Ikon under miniatyr | Fire like små ikoner per miniatyr |
| Angre / gjør om | 1 | Ikon eller Ctrl+Z / Ctrl+Shift+Z | – |
| Del og kopier lenke | 2 | «Del» → kopier | Ikke tilgjengelig i lokal modus (vises deaktivert) |
| Vis | 1 | «Vis» eller F5 | **Knappen er utenfor vinduet ved 1025–1180 px (N1)** |
| Finn «kopier presentasjons-ID» | 1 | Bibliotekkortets `<>`-ikon | Ikonet sier ikke hva det gjør |
| Finn bildebrief | 1 | Dokumentikon blant sju like | Kan forveksles med referanser (samme silhuett) |
| Finn avansert sonestørrelse | 1–2 | Inspektørens tallfelt | – |

## 3. Funn utover planens F01–F10

| ID | Funn | Bevis | Status |
| --- | --- | --- | --- |
| N1 | Hovedlinjen flyter over på smal desktop: ved 1180 px er «Vis» halvt synlig, ved 1025 px er både «Del» og «Vis» utenfor vinduet, og presentasjonstittelen krymper til én bokstav. | `baseline/desktop-1180x820.png`, `baseline/desktop-1025x768.png` | **Løst i U2** |
| N2 | Modusvalget («Innhold/Soner») og av/på-bryteren «Overskrift» hadde identisk aktiv stil. En modus («hvilken») og en bryter («på/av») så like ut. | `baseline/desktop-1600-text-editing.png` | Løst i U1 (segmentert kontroll) |
| N3 | Hvit tekst på primærknappen («Vis», «Ny presentasjon») hadde kontrast 3,2:1; fareknappen 3,9:1; feiltekst 4,0:1. Alle under 4,5:1. | Beregnet fra tokenverdiene | Løst i U1 |
| N4 | Flere valgknapper viste valgt tilstand bare visuelt, uten `aria-pressed`: modus, «Overskrift», innholdstype i inspektøren, bildetekstplassering, subfeltretning. | `TopToolbar.tsx`, `Inspector.tsx` | Løst i U1 for disse; tekstverktøylinjen gjenstår (U4) |
| N5 | Kontekstmenyen brukte samme blå for «markøren er her» og ingenting ekstra for «dette er valgt»; valgt innholdstype mistet sitt eget ikon og ble bare en hake. | `ContextMenuHost.tsx` | Løst i U1 |
| N6 | På berøring fikk små ikonknapper 44 × 38 px i stedet for 44 × 44 px fordi `.btn--sm`-regelen overstyrte høyden (plan § 6). | `global.css` | Løst i U1 |
| N7 | «Lagrer …» ble vist i advarselsfarge, selv om lagring ikke er et problem. | `editor.css` | Løst i U1 |
| N8 | I inspektøren ble ikonet presset bort på knapper med lang tekst («Flytt innholdet til en annen sone»), og teksten går ut over kanten. | `baseline/desktop-1600-zone-mode.png` | Ikonet løst i U1, tekstbredden i U3 (lange navn brytes under seg selv) |
| N9 | Hovedlinjen markerte ikke hvilken innholdstype valgt sone har; heller ikke den kompakte listen eller ikonradens meny (bekrefter F03). | Skjermbilder + kode | Løst i U1 |

## 4. Valgt informasjonsarkitektur

Prinsippet er planens § 4.1: hver handling har ett nivå, og hvert nivå har én fast flate. Det som er hyppig får direkteknapp, det som er sjeldent samles i navngitte menyer.

### 4.1 Hovedverktøylinjen (U2)

```
[‹] Tittel  Lagret  │ [Innhold|Soner] Overskrift │ ↶ ↷ │ ▣ Kort med tittel ▾  ⊕ Bilde fra fil │ … │ Presentasjon ▾  Verktøy ▾ │ Del │ ▶ Vis
```

- **Venstre, alltid synlig:** tilbake, tittel (krymper med ellipse, men aldri under ca. 8 tegn) og lagringsstatus.
- **Modus:** den segmenterte kontrollen fra U1. «Overskrift» blir værende som bryter ved siden av, siden den gjelder sliden som helhet og brukes ofte.
- **Valgt sone:** én knapp som viser gjeldende innholdstype med ikon og navn og åpner «Endre innholdstype». Den erstatter de seks ikonknappene. «Bilde fra fil» er en egen knapp med eget ikon, så «gjør sonen til bilde» og «velg en fil» aldri forveksles.
- **Presentasjon ▾:** tema, maler, referanser, bildebrief og optimaliser bilder, med tekst.
- **Verktøy ▾:** idéer, sandkasse (med antall) og hurtigtaster.
- **Høyre, alltid synlig:** «Del» og «Vis». Når bredden ikke strekker til, er det menyene som krymper til ikoner, ikke disse.

**Vurderte alternativer:**

| Alternativ | Hvorfor ikke |
| --- | --- |
| Faner («Sett inn», «Utforming» …) som i Office | Gjemmer hyppige handlinger bak et fanevalg og gjør Slaids til PowerPoint, som planen sier er ikke-målet |
| Minimal hovedlinje, alt i inspektøren | Inspektøren er 244 px bred og handler om valgt sone; presentasjonsverktøy hører ikke hjemme der |
| Beholde dagens rad og bare fargelegge | Løser ikke overflyten (N1) eller F01; farge på 20 like knapper blir konfetti |

### 4.2 Inspektøren (U3)

Rekkefølgen følger det brukeren oftest gjør med et valg:

1. **Hode:** «Valgt: Sone 2 · Bilde», med stien (breadcrumb) under. Tom tilstand: «Ingen sone er valgt. Klikk en sone på sliden, eller bruk piltastene.»
2. **Innhold:** innholdstype (som i dag), deretter det som hører til typen: farge, bildetekst, bildefil, subfelt.
3. **Sone:** splitt, flytt innhold, til sandkassen, tøm, og «Slett sone» sist og rødt.
4. **Størrelse:** knappene for bredere/smalere og forholdstallene; den lange forklaringen flyttes bak «Hvordan virker dette?».

### 4.3 Kontekstmenyer

Byggerne i `ui/editor/contextMenu/` beholdes. Fast rekkefølge i hver meny: det valgte innholdet → sonen → utklippstavle → farlige handlinger sist. Navn, ikon, farge og valgt-markering hentes fra de samme kildene som inspektøren (`contentKinds.ts`, `textActions.ts`), slik U1 nå gjør for innholdstypene.

### 4.4 Kompakt arbeidsflate (U6)

De fire fanene beholdes. «Tekst» og «Soner» bærer samme farge som desktopens to moduser (innført i U1), slik at det er synlig at «Soner» også er en modus (F07). Verktøyfanen grupperes som desktopens to menyer: «Presentasjon» og «Verktøy».

### 4.5 Bibliotek og filmstripe (U5)

Hele kortet åpner presentasjonen. «Dupliser», «Kopier presentasjons-ID», «Last ned sikkerhetskopi» og «Flytt til søppelkassen» samles i en «Flere handlinger»-meny. Filmstripens «Ny»-knapper får tekst («Ny slide» som hovedknapp, inndeling og miniapp i en meny ved siden av).

## 5. Forhold som trenger en produktbeslutning

1. **«Overskrift» i hovedlinjen eller på slidenivå?** Anbefaling: behold i hovedlinjen ved siden av modusvalget. Den brukes ofte og gjelder hele sliden.
2. **Skal «Kopier presentasjons-ID» bort fra kortets forside?** Anbefaling: ja, inn i «Flere handlinger». Den brukes i hovedsak når en KI-agent skal få tilgang.

Alt annet i denne arkitekturen bevarer dagens funksjoner og hurtigtaster og er dekket av planens rammer.
