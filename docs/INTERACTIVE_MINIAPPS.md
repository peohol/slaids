# Interaktive slider: å skrive en miniapp for Slaids

Dette er den normative forfatterkontrakten for interaktive slider — for mennesker
og for KI-agenter. Én HTML-fil blir én slide. Publikum ser en forside med navnet
og en play-knapp; trykker de på den, kjører appen i hele slideflaten til noen
avslutter den.

Kontrakten finnes også som data: agentoperasjonen `get_interactive_contract`
svarer med versjonen, variabelnavnene, flatestørrelsen, grensene og
begrensningene, slik at en agent kan spørre i stedet for å lese.

---

## 1. Formatet

**Én selvstendig `.html`-fil.** All CSS og JavaScript ligger inline i filen.
Bilder, lyd og fonter appen bruker selv, må ligge i filen som `data:`- eller
`blob:`-URL-er.

- Gyldig UTF-8. Et byte order mark fjernes; en UTF-16-fil avvises.
- Maks **2 MiB** per fil, målt i byte av UTF-8 (ikke i tegn).
- Maks **6 MiB** miniapp-kilde i én presentasjon til sammen.
- Filnavnet må slutte på `.html`.

Filen lagres som data i presentasjonen. Slaids kjører den aldri selv: ikke i
miniatyrer, ikke i rendret preview, ikke i eksport, ikke på en server. Den kjører
bare i nettleseren til noen som har trykket på play-knappen.

## 2. Flaten

Appen tegnes i presentasjonens designrom: **1600 × 900** logiske piksler,
skalert uniformt til skjermen sammen med resten av dekket. Skriv layouten i det
rommet — `100%`, `vh`/`vw` og piksler betyr det samme her som i en slide, og
`21px` er like høyt i appen som i en tekstsone ved siden av.

Appen fyller hele sliden. Slaids tegner én ting oppå: knappen «Avslutt miniapp»
øverst til høyre. Legg ikke noe kritisk akkurat der.

## 3. Designkontrakten

Slaids injiserer presentasjonens design i dokumentet før filen leses: et sett
CSS-variabler med dekkets farger, fonter og mål, og et basisstilark bygget på
dem. Variablene er hentet fra **seksjonen sliden ligger i**, så appen følger den
delen av dekket automatisk.

**Skriv mot variablene, aldri mot konkrete verdier.** En app som skriver
`var(--slaids-accent)` følger med når noen bytter farge på seksjonen eller font
på presentasjonen — uten at noe i filen endres. En app som skriver `#bfccd9`
gjør ikke det.

### Variablene

| Variabel | Hva den er |
| --- | --- |
| `--slaids-background` | Sidefargen appen tegnes på |
| `--slaids-text` | Tekstfargen som har kontrast mot den |
| `--slaids-muted` | Sekundær tekst |
| `--slaids-accent` | Seksjonens aksentfarge |
| `--slaids-accent-text` | Tekstfargen som har kontrast mot aksenten |
| `--slaids-surface` | En hevet flate (kort, panel) på bakgrunnen |
| `--slaids-border` | Skillelinjer og rammer |
| `--slaids-heading-font` | Fontstakken for overskrifter |
| `--slaids-body-font` | Fontstakken for brødtekst |
| `--slaids-font-size` | Brødtekst |
| `--slaids-font-size-small` | Bildetekst-størrelse |
| `--slaids-font-size-heading` | Mellomoverskrift |
| `--slaids-font-size-title` | Tittel |
| `--slaids-line-height` | Linjehøyde for brødtekst |
| `--slaids-heading-line-height` | Linjehøyde for overskrifter |
| `--slaids-gap` | Dekkets ene gap — også `body`-luften |
| `--slaids-padding` | Innvendig luft i et kort |
| `--slaids-block-spacing` | Avstand mellom tekstblokker |
| `--slaids-radius` | Hjørneradius |
| `--slaids-shadow` | Slagskyggen kort har |

### Fontene

Presentasjonen har to fontroller: **overskrift** og **brødtekst**. Bruk rollene,
ikke fontnavn — hvilken font en rolle er, bestemmer den som eier dekket.

For Slaids' garanterte webfonter legger Slaids selv fontfilene inn i
sandkassedokumentet som inlinede `@font-face`-regler med `data:`-URL-er. Appen
laster altså ingenting: den *har* fonten. For lokale fonter (Calibri, Segoe UI)
gjelder det samme som ellers i Slaids — de er maskinens eller ikke, og
fontstakken faller tilbake som den skal.

```css
h1 { font-family: var(--slaids-heading-font); }
body { font-family: var(--slaids-body-font); }
```

### Basisstilarket

Slaids stiler vanlige semantiske elementer på forhånd — `h1`–`h6`, `p`, lister,
`button`, `input`, `textarea`, `select`, `range`, `progress`, `fieldset`,
`table`, `article` — bare med variablene over. En liten app som er en overskrift,
et avsnitt og en knapp ser derfor ut som en del av presentasjonen uten én linje
CSS.

Basisstilarket bruker bare elementselektorer, og appens eget `<style>` leses
etter det. Én klasse i appens CSS slår hva som helst her. Overstyr fritt.

`body` får `padding: var(--slaids-gap)`. En app som skal gå helt ut i kanten,
setter `body { padding: 0 }`.

### Versjonen

Kontrakten er versjonert, og versjonen lagres på sliden. Denne teksten beskriver
**v1**. Endrer Slaids senere hva en ustilet miniapp ser ut som, blir det en ny
versjon: v1-arket serveres uendret til hver slide som står på 1, og en app
flyttes bare hvis noen flytter den. En lagret fil blir aldri skrevet om.

## 4. Hva sandkassen nekter

Appen kjører i en ramme nettleseren holder helt atskilt fra Slaids: egen, opak
origin, uten tilgang til siden rundt. Dette virker ikke, og det er med vilje:

- **Nettverk.** `fetch`, `XMLHttpRequest`, WebSocket, `sendBeacon`, og eksterne
  bilder, stilark, fonter og skript.
- **Eksterne ressurser** i det hele tatt. Alt må ligge i filen.
- **Lagring.** `localStorage`, `sessionStorage`, informasjonskapsler, IndexedDB.
  Appen starter tom hver eneste gang.
- **`eval` og `new Function`.** Skript og stiler må stå inline.
- **Navigasjon, popup-vinduer, nedlastinger, skjemainnsending og modale
  dialoger** (`alert`, `confirm`, `prompt`).
- **Kamera, mikrofon, posisjon, skjermdeling, utklippstavle, fullskjerm,
  pekerlås.**
- **Kontakt med Slaids.** Appen kan ikke lese eller endre presentasjonen, og
  `postMessage` til Slaids gjør ingenting.

Appen starter på nytt hver gang den aktiveres. Det finnes ingen måte å ta vare
på tilstand mellom to kjøringer — skriv appen slik at det er greit.

## 5. Tilgjengelighet

- Bruk semantisk HTML. En knapp er en `<button>`, et felt har en `<label>`.
- Alt som kan klikkes, skal kunne nås med tastatur. Fokus går inn i appen med
  én gang den starter, så tastaturet er appens.
- Gi ikoner og bilder tekstalternativ (`aria-label`, `alt`).
- Ikke fjern fokusmarkeringen. Basisstilarket tegner en tydelig en fra
  `--slaids-accent`.
- Ikke la farge alene bære betydning: publikum ser dette på en projektor.
- Tekst skal være stor nok til å leses bakerst i rommet. `--slaids-font-size` er
  målt for det.

## 6. Interaksjonsmønstre som fungerer

- **Én ting av gangen.** Sliden er én idé; miniappen er én interaksjon.
- **Stor og direkte.** Store treffflater, tydelige tilstander, ingen menyer å
  lete i. Publikum ser skjermen på avstand, og den som betjener den står ofte
  ved siden av.
- **Umiddelbar tilbakemelding.** Et trykk skal gjøre noe synlig med en gang.
- **Tåler å bli avbrutt.** Appen kan bli avsluttet når som helst, og starter
  tom neste gang.
- **Ingen tidsavhengighet mellom kjøringer.** Ingen «fortsett der vi slapp».
- Vanlige former: en teller, en avstemning uten backend, en simulering man kan
  skru på, en sortere-/matche-øvelse, en formel med skyveknapper, en
  stegvis demonstrasjon, en timer.

## 7. Når en interaktiv slide *ikke* er svaret

- **Når innholdet er tekst eller bilde.** En vanlig slide er lettere å lage,
  lettere å endre, søkbar, og den skalerer og måler seg selv. En miniapp som
  bare viser tre kulepunkter er en dårlig slide.
- **Når noe skal lagres.** Svar fra salen, resultater, framgang — ingenting
  overlever at appen avsluttes.
- **Når den trenger data utenfra.** Ingen API-er, ingen live-tall, ingen
  innlogging.
- **Når den er hele undervisningen.** En miniapp er ett poeng i et dekk, ikke et
  læringsopplegg i seg selv.
- **Når publikum ikke skal røre den.** Skal ingen interagere, er en animasjon
  eller et bilde ærligere.

Pedagogisk er en interaktiv slide på sitt beste når **manipulasjonen er
poenget**: når det å skru på en parameter og se hva som skjer er lettere å forstå
enn en setning om det samme.

## 8. Et fullstendig eksempel

```html
<!DOCTYPE html>
<html lang="nb">
<head>
<meta charset="utf-8">
<title>Renters rente</title>
<style>
  /* Layouten er appens. Fargene og typen er dekkets. */
  main { display: grid; gap: var(--slaids-gap); place-content: center; height: 100%; }
  output { font-family: var(--slaids-heading-font); font-size: var(--slaids-font-size-title); }
</style>
</head>
<body>
  <main>
    <h1>Renters rente</h1>
    <label for="years">År: <output id="shown">10</output></label>
    <input id="years" type="range" min="1" max="40" value="10">
    <output id="sum" aria-live="polite"></output>
  </main>
  <script>
    const years = document.getElementById('years')
    const shown = document.getElementById('shown')
    const sum = document.getElementById('sum')
    function draw() {
      shown.textContent = years.value
      sum.textContent = `10 000 kr blir ${Math.round(10000 * 1.05 ** years.value)} kr`
    }
    years.addEventListener('input', draw)
    draw()
  </script>
</body>
</html>
```

Ingen farger, ingen fontnavn, ingen nettverk — og den ser ut som resten av
dekket, i hvilken som helst seksjon, med hvilket som helst tema.

## 9. For agenter

- `get_interactive_contract` — versjonen, variabelnavnene, flaten, grensene og
  begrensningene, som data.
- `add_interactive_slide` — ny slide fra en fil. Send filen som `html` (JSON-
  streng) eller som `content` (base64/tekst over JSON, rå bytes over REST). En
  fil nær grensen bør sendes som `content`: JSON escaper innholdet, og en escapet
  fil kan bli større enn forespørselsgrensen.
- `set_interactive_slide` — nytt navn og/eller ny fil. En fil som avvises,
  endrer ingenting; appen som ligger der, blir stående.
- `get_presentation` og `inspect_slide` beskriver sliden med navn, filnavn,
  størrelse og kontraktversjon — aldri med kilden.

Skriv appen mot variablene og fontrollene. Da trenger agenten verken å kjenne
fontnavn eller fargeverdier, og appen følger temaendringer av seg selv.
