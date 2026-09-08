# Bildeoptimalisering

Slaids kan gjøre bildefilene i en presentasjon mindre uten at noe på slidene
ser annerledes ut. Denne siden beskriver hva som skjer, hvor det skjer, og
hvordan funksjonen testes for hånd i nettleseren. Den normative
spesifikasjonen står i `IMPLEMENTATION_PLAN.md` §26, «Bildeoptimalisering».

## Hva som gjøres med et bilde

Hver rasterfil vurderes ut fra hvor den faktisk vises i dekket:

| Operasjon | Når | Hva som skjer |
| --- | --- | --- |
| **Permanent beskjæring** | Filen vises i nøyaktig én bilderamme, og rammen skjuler minst 1 % av pikslene | Pikslene utenfor rammen fjernes. Filen får rammens proporsjoner, og utsnittet sentreres, så bildet står nøyaktig der det sto. |
| **Nedskalering** | Filen har flere piksler enn den største visningen trenger ved 2 piksler per logisk piksel (`OPTIMIZATION_PIXEL_DENSITY`), med minst 10 % margin | Filen skaleres ned i trinn (halvering) til målstørrelsen. Aldri opp. |
| **Komprimering** | Fotografier, og piksler som allerede har vært gjennom en tapsgivende kodek | WebP (kvalitet 0,85) der nettleseren kan skrive det, ellers JPEG (0,88). Grafikk, tekst og skjermbilder forblir tapsfrie (PNG eller tapsfri WebP), og transparens beholdes alltid. |
| **Metadata** | Alltid når filen skrives på nytt; tapsfritt for JPEG/PNG/WebP som ellers ikke endres | EXIF, GPS, miniatyrbilder, XMP og kommentarer fjernes. Fargeprofil og orientering beholdes, fordi de påvirker hvordan bildet ser ut. |
| **Deduplisering** | To filer har identiske bytes (SHA-256 av de lagrede bytene, verifisert byte for byte) | Kopiene slås sammen til én fil. Skjer også ved opplasting: den samme filen lastet opp to ganger lagres én gang. En hash notert på referansen er aldri bevis alene; den brukes bare til å utelukke kandidater. |

SVG forblir SVG og rasteriseres aldri. Animerte GIF/APNG/WebP røres ikke, fordi
et redraw bare ville beholdt første bilde. Et resultat som ikke er mindre enn
originalen forkastes, og en ren omkoding uten pikselendring må spare minst 10 %.

**Delte filer.** En fil som vises flere steder dimensjoneres etter det største
stedet og beskjæres for ingen av dem. Beskjærer du én forekomst av en delt fil
(fra inspektøren), får det panelet sin egen fil; de andre beholder originalen.

## Hvor det skjer

Alt skjer i nettleseren, i en Web Worker (`src/state/imageWorker.ts`) med
`createImageBitmap` og `OffscreenCanvas`. Nettleseren har allerede
maskinvareakselererte dekodere for alle formatene Slaids lagrer, inkludert
AVIF som Node-bundelen ikke kan lese; ingen byte lastes opp for å behandles,
og ingen ekstern tjeneste er involvert. Uten worker-støtte kjører samme kode i
hovedtråden.

Rekkefølgen ved skriving er den som gjør operasjonen trygg:

1. de nye filene lagres under nye id-er, uten at noe peker på dem;
2. dokumentet skrives om og lagres;
3. først når lagringen har lyktes, slettes filene ingenting peker på lenger.

Feiler ett bilde, feiler bare det bildet. Feiler lagringen, beholdes både de
gamle og de nye filene — og de gamle ryddes bort av seg selv når autolagringen
kommer gjennom, ikke bare hvis det første forsøket lyktes. Slettingen sjekker
alltid mot den lagrede presentasjonen først, så en fil dokumentet fortsatt viser
blir aldri rørt. Forlater du editoren mens lagringen henger, står originalene
igjen — som er nøyaktig det den lagrede presentasjonen fortsatt peker på.
Operasjonen kan ikke angres med Ctrl+Z, og dialogen sier det; angrehistorikken
nullstilles.

## Manuell ende-til-ende-test

Testen kjøres i lokal modus (uten Supabase-variabler) med `npm run dev`, eller
mot en Supabase-konfigurert utgave; flyten er den samme. Bruk et virkelig
foto på 10–20 megapiksler fra en telefon, gjerne med GPS-data.

1. **Last opp et høyoppløselig foto.** Lag en ny presentasjon, gå til slide 2,
   velg «Bilde» i den tomme sonen og last opp fotoet. Noter
   originalstørrelsen: inspektøren viser under «Bildefil» filnavn,
   pikseldimensjoner og filstørrelse.
2. **Plasser det i en liten beholder.** Trykk Ctrl+E, splitt sonen i tre side
   ved side (`1 : 1 : 1`), og gå tilbake til innholdsmodus. Fotoet står nå i en
   ramme på under en tredjedel av sliden.
3. **Beskjær bort store deler.** Hold over bildet: de skjulte delene vises
   svakt utenfor rammen. Dra bildet til den ene siden så et hjørne av motivet
   er synlig og mesteparten er skjult.
4. **Noter filstørrelse og kvalitet.** Zoom gjerne inn med presentasjonsmodus
   (F5) på en høyoppløselig skjerm og se hvor skarpt utsnittet er.
5. **Kjør optimalisering.** Trykk «Optimaliser bildet …» i inspektøren.
   Dialogen viser hva som vil skje (permanent beskjæring, nedskalering,
   komprimering, metadata), original og ny størrelse, og advarselen om at de
   bortbeskårne delene slettes for godt. Trykk «Optimaliser».
6. **Verifiser:**
   - bildet ser likt ut på sliden, i miniatyren og i presentasjonsmodus;
   - hold over bildet igjen: ingen skjulte deler vises lenger, og bildet kan
     ikke dras (det fyller rammen nøyaktig);
   - inspektøren viser reduserte pikseldimensjoner (omtrent rammens bredde ×
     2) og en betydelig mindre filstørrelse;
   - last siden på nytt: presentasjonen åpner med det optimaliserte bildet, og
     biblioteket viser lavere lagringsbruk for presentasjonen;
   - i lokal modus: åpne DevTools → Application → IndexedDB → `slaids` →
     `assets` og se at det bare finnes én rad, med den nye id-en. I
     Supabase-modus: sjekk at det bare ligger ett objekt under
     `slaids-assets/<bruker>/<presentasjon>/`.
7. **Samme bilde flere steder.** Last opp det samme fotoet i to av de andre
   sonene. Den andre opplastingen gir meldingen «Presentasjonen hadde allerede
   denne filen», og `assets` inneholder fortsatt bare én rad for det.
   Optimaliser det smaleste av de to panelene fra inspektøren: dialogen sier at
   panelet får sin egen fil. Etterpå finnes to filer, og det andre panelet er
   uendret. Kjør så «Optimaliser bilder» (verktøylinjen): originalen skaleres
   ned etter det største panelet uten å beskjæres, og begge panelene viser den
   nye filen.
8. **Optimaliser hele presentasjonen.** Lag en presentasjon med mange bilder i
   ulike størrelser, gjerne noen skjermbilder (PNG) og noen fotografier
   (JPEG), og noen SVG-er. Trykk «Optimaliser bilder». Dialogen viser
   `Bilder: X → ca. Y`, forventet besparelse i prosent, og hvor mange som
   beskjæres, skaleres ned, komprimeres, får fjernet metadata, slås sammen og
   er optimale fra før. Ingenting er skrevet før du trykker «Optimaliser».
   Etterpå: skjermbildene er fortsatt tapsfrie (PNG/WebP), SVG-ene er uendret,
   og presentasjonens størrelse i biblioteket har gått ned tilsvarende.

Underveis skal nettleserkonsollen være fri for feil, og editoren skal være
responsiv mens analysen kjører (arbeidet skjer i en worker).

## Automatiserte tester

- `src/domain/imageOptimization.test.ts` — geometri, målstørrelse, beskjæring,
  planlegging (delt/fork), formatvalg, terskler.
- `src/domain/imageMetadata.test.ts` — tapsfri fjerning av metadata,
  orientering, animasjonsdeteksjon.
- `src/domain/commands/assetReplacement.test.ts` — dokumentkommandoene for
  erstatning og sammenslåing.
- `src/state/imageOptimization.test.ts` — orkestrering mot et ekte
  Dexie-lager: rekkefølge på skriving, feilisolasjon, dedupe, fork, stale
  analyse, og opprydding etter en lagring som først feilet.
- `src/state/autosave.test.ts` — arbeid som er satt til å kjøre etter neste
  skriving som lykkes.
- `src/persistence/assetDedupe.test.ts`, `src/state/assetUpload.test.ts`,
  `src/agent/assets.test.ts` — deduplisering ved begge dørene.
- `e2e/image-optimization.spec.ts` — hele flyten i Chromium med ekte piksler.
