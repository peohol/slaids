# Mobil arbeidsflate

> **Status:** Implementert. Dette er nå **subsystemdokumentasjon** for den
> kompakte arbeidsflaten: hvor ting ligger, hvorfor betjeningen ble som den ble,
> og hva som må røyktestes for hånd. De varige reglene er flyttet til
> `IMPLEMENTATION_PLAN.md` § 44.5, som fortsatt er eneste normative produkt- og
> arkitekturspesifikasjon. Der de to er uenige, gjelder planen.
>
> **Mål:** Gjøre Slaids praktisk brukbar på telefon og smale nettbrett uten å
> gjøre desktopopplevelsen dårligere eller lage en egen mobilvariant av
> presentasjonsmodellen.
>
> Dokumentet dekker to leveranser: den kompakte arbeidsflaten (PR 1, § 18), og
> oppfølgingen som gjorde selve slideområdet til noe man betjener med fingrene
> — sveip mellom slides, en slideoversikt som tar skjermen, pinch som zoomer
> stagen og ikke appen, tekstredigering rett i den fokuserte sonen, og
> tekstmarkering som bare finnes der tekst faktisk kan redigeres.

## 0. Hvor koden ligger

| Ansvar | Fil |
| --- | --- |
| compact/coarse/orientering/visualViewport, som rene regler | `src/ui/workspace/workspace.ts` |
| én abonnent på nettleseren; publiserer også `data-*` på `<html>` | `src/ui/workspace/WorkspaceContext.tsx` |
| hva et skall får utlevert | `src/ui/editor/shell/editorShell.ts` |
| dagens trekolonneflate | `src/ui/editor/shell/DesktopEditorShell.tsx` |
| én flate om gangen | `src/ui/editor/shell/CompactEditorShell.tsx` |
| topplinje, tabs, verktøyliste, tekstliste | `src/ui/editor/compact/` |
| den lesbare skriveflaten | `src/ui/editor/compact/FocusedTextEditor.tsx` |
| adressering, lesing, skriving og fit-måling av ett tekstfelt | `src/ui/editor/textTarget.ts` |
| «velg innhold, velg sone» for sandkasse og soneflytting | `src/ui/editor/placement.ts` |
| større/mindre og eksplisitte forholdstall | `src/ui/editor/ZoneSizeControls.tsx` |
| sonestien som parent/child-navigasjon | `src/ui/editor/ZoneBreadcrumb.tsx` |
| hvilket rektangel av sliden som fyller stagen | `src/ui/editor/stageView.ts` |
| sveip, pinch og panorering, som pointer events | `src/ui/editor/stageGestures.ts` |
| hvilket trinn av stigen editoren er på | `src/ui/editor/stageFocus.ts` |
| rammen og view-transformen alle fire stages deler | `src/ui/editor/StageSurface.tsx` |
| stagen med soner, som legger hit-testing oppå | `src/ui/editor/EditorStage.tsx` |
| seksjon, miniappforside og generert side | `SectionStage` · `InteractiveStage` · `ReadOnlySlideStage` |
| slideoversikt og desktopstripe, samme komponent | `src/ui/editor/Filmstrip.tsx` (`stripLayout`) |
| flytende vindu som ark på liten flate | `src/ui/components/FloatingWindow.tsx` |
| trykkbare kontroller i presentasjonsmodus | `src/ui/present/PresentationPlayer.tsx` |

To ting er verdt å vite før man endrer noe her:

1. **`FloatingWindow` er det samme vinduet på begge flater.** På compact tegnes
   det som et ark uten geometri, men markupen er uendret – `IdeasWindow` finner
   fortsatt `.floating-window__body` for scroll og autoscroll under dra.
2. **Compact viser `TextToolbar` bare når det finnes et felt å formatere.** Den
   er inne i skriveflaten, og over tabs-raden mens den fokuserte sonen faktisk
   skrives i. Ellers er den ikke der, fordi det da ikke er noe å formatere.

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

Orientering er et layoutsignal, ikke apptilstand.

**Slik ble det:** rotasjon *innenfor* samme arbeidsflate — enhver telefon —
remounter ingenting. Rotasjon som krysser terskelen (et nettbrett på 1180 × 820
mot 820 × 1180) bytter skall, og da bygges oppsettet om med vilje. Derfor ligger
ingen brukervalgt tilstand i skallet: `EditorView` eier både panelvalget og alt
annet, og `e2e/workspace.spec.ts` går fram og tilbake over terskelen for å holde
fast på det. Se `IMPLEMENTATION_PLAN.md` § 44.5.2.

Rotasjon skal ikke miste:

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

Det finnes én sentral paneltilstand, i `CompactTabBar`:

```ts
type CompactPanel = 'slides' | 'content' | 'zone' | 'tools'
```

**Avvik fra den opprinnelige skissen, med vilje.** Sandkassen og Ideer ble
*ikke* tatt inn i denne listen. De er allerede `FloatingWindow`, og det vinduet
tegner seg selv som et ark på en kompakt flate – så de eier fortsatt sitt eget
innhold og sin egen åpen-tilstand, og skallet holder dem fra å konkurrere med
panelet ved å utlede: mens et verktøyvindu er oppe vises ikke panelet, og å
åpne panelet lukker vinduet. Ingen effekt synkroniserer de to.

Til gjengjeld ble «content» en egen fane: tekstlista er selve arbeidsflaten på
en stående telefon, ikke et undervalg i inspector.

Fanen «Soner» *er* sonemodus. Å trykke den setter `mode`, og alle andre faner
setter den tilbake – ellers ville soneomriss stått på sliden mens tekstpanelet
var åpent, eller motsatt.

En modal/dialog står over dette og nullstiller ikke underliggende utvalg.

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

**Slik ble det – oversikten.** Panelet «Slides» ble navigasjon i stedet for et
sidepanel: det dekker hele kroppen under toppmenyen, og gjeldende slide vises
ikke samtidig. Å se en flik av én side hjelper ikke når man skal velge blant
tjue, og høyden er det eneste som gjør miniatyrene store nok til å kjennes
igjen.

Hvor mange sider som står ved siden av hverandre er regnestykke på boksen, ikke
et breakpoint: `stripLayout` deler den målte listebredden til en side får plass
halvannen gang i høyden. Stående telefon får da én side i full bredde, liggende
får fire, et smalt desktopvindu to — og desktopstripen, som er den samme
funksjonen på en 212 px bred kolonne, får nøyaktig den ene 168 px-miniatyren den
alltid har hatt. Det er den samme `Filmstrip`, de samme entry-ene, de samme
`moveSlide`/`duplicateSlide`/`deleteSlide`-kommandoene og de samme diskrete
flyttepilene; det eneste som er nytt er hvor stort en side tegnes.

Stagen blir liggende under oversikten i stedet for å skjules. En stage uten
størrelse måler teksten sin til å passe hva som helst, og det er det ene svaret
fit-regelen aldri må få.

Én detalj i gridet er verdt å kjenne: dnd-kit trenger en sorteringsstrategi som
passer formen. `verticalListSortingStrategy` forutsetter én kolonne og skyver
naboene rett opp og ned forbi den som dras; i en flerkolonneoversikt er neste
celle til *siden*. Oversikten bruker derfor `rectSortingStrategy` når den har
mer enn én kolonne, og stripen beholder listestrategien. Rekkefølgen etter slipp
kommer fra kollisjonsdeteksjonen og er riktig uansett, så testen måler
forskyvningen av naboen midt i draget — det er der forskjellen faktisk er.

**Slik ble det – sveipen.** Sveip endte ikke opp som noe bare
presentasjonsmodus har. På compact er slideområdet selv dekknavigasjon:

- sveip mot høyre er neste slide, mot venstre er forrige;
- én gest er nøyaktig én slide, avgjort når fingeren slippes — ikke mens den
  beveger seg, som ellers ville tatt flere sider på én bevegelse;
- terskelen er 56 px og sideveis må slå opp/ned med god margin, så et trykk som
  vaklet er fortsatt et trykk og et loddrett drag er ikke et sidebytte;
- gesten ligger på `.compact-stage`, ikke på hele skallet, så toppmeny, paneler
  og tabs aldri er med;
- `OWNS_ITS_GESTURE` holder knapper, lenker, felt som skrives i og en kjørende
  miniapp utenfor — og et sonedrag som allerede har startet stopper gesten der
  den er, så å dra en sonegrense sideveis ikke også blar;
- den kaller den samme «ett skritt langs dekket» som piltastene og hjulet
  (`stepDeck`), som først lukker en avledet side og så bruker `stepPage`. En
  generert referanseside er en *visning av* en slide, ikke en side i dekket, så
  uten den halvdelen ville et skritt skjedd usynlig bak den.

**Merk at retningen er motsatt av presentasjonsmodus.** Der er sveip mot venstre
«neste», slik en karusell pleier å være. I editoren ble det uttrykkelig bestilt
motsatt vei, og de to flatene er derfor ikke like. Om det skal harmoniseres, er
det én linje i `CompactEditorShell` og én i `PresentationPlayer`.

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

**Slik ble det: én stige med fire trinn.**

| Trinn | Hva som er på skjermen | Veien opp | Veien ned |
| --- | --- | --- | --- |
| sliden | hele siden, ingen markering | – | – |
| valgt sone | sonen har omriss på sliden | et trykk på sonen | et trykk på en annen |
| fokusert sone | sonen fyller stagen | «Fokuser sonen» | «Hele sliden» |
| tekstredigering | sonen er skriveflaten | «Rediger tekst» | «Ferdig» |

Bare det trinnet editoren faktisk er på har en kontroll på skjermen, så det er
aldri en rad med knapper å lese: det som vises sier hvor man er.

To ting er verdt å merke seg.

1. **Omrisset på trinn to er sonemodusens eget omriss.** `ZoneOverlay` fikk et
   `purpose`, ikke en tvilling: i `selection` tegner den bare den valgte sonens
   kant, uten hover, uten ratio-håndtak og uten verktøylinje. Uten det ville
   «valgt sone» vært et trinn uten noe å se på — og med hele sonemodusens
   chrome ville content mode sett ut som sonemodus.
2. **Trinnet er derivert, og det som ikke lenger gjelder kastes.** `liveFocus`
   leser fokuset mot slide, utvalg og om sonen i det hele tatt bærer tekst, hver
   render, så en angring som fjerner sonen, et sidebytte eller en rotasjon som
   bytter skall faller ned til det trinnet som er sant uten at noen effekt må
   oppdage det.
   Men *skjult* er ikke det samme som *borte*, og her må det være borte: et
   utvalg kan komme tilbake. Fokuserer man en sone, velger foreldresonen og så
   trykker på den første igjen, ville et fokus som bare var gjemt blitt gyldig
   på nytt og satt stagen i en visning ingen ba om. Det samme gjelder en pinch
   og en slide man kommer tilbake til. Derfor kastes begge i samme render de
   slutter å gjelde — et `setState` under render, som er Reacts eget svar på «juster
   tilstand når noe endrer seg», og som rendrer på nytt før noe males, slik at
   den forlatte visningen aldri vises et bilde.
   Selve tilstanden ligger i `EditorView`, høyt nok til å overleve at skallet
   byttes ut under den.

**Og én view-transform.** `stageView.ts` stiller ett spørsmål: *hvilket
rektangel av sliden fyller stagen?* Hel slide er `FULL_SLIDE`, fokusert sone er
sonens rect, og en pinch er det samme rektangelet delt på forstørrelsen og
klampet inni seg selv. Derfor konkurrerer ikke pinch og fokusering: pinchen
forstørrer det rektangelet fokuseringen valgte, og `viewportToSlide` treffer
riktig slidekoordinat i alle tilfellene fordi alle tre er den samme uniforme
skaleringen av det samme 1600 × 900-rommet.

Pinchen er forankret om fingrenes midtpunkt, klampes inni basisrektangelet, og
panoreres med to fingre under pinchen eller med én når visningen er forstørret.
Den er lagret i slidekoordinater sammen med en nøkkel for hvilken side og
hvilket trinn den hører til — så rotasjon beholder den, og et sidebytte kaster
den. Ingenting av den når dokumentet.

**Og den gjelder alle sidetyper.** Kravet er at en pinch *i slideområdet*
forstørrer sliden i stedet for appen, og en seksjon, en miniapps forside og en
generert referanseside er like mye slideområdet som en vanlig slide. Derfor ble
rammen trukket ut til `StageSurface`: den måler rommet, fitter siden inn i det,
og svarer på pinchen — én gang, for alle fire. Var den ikke det, ville
`touch-action` tatt nettleserens pinch fra tre sider som ikke hadde noe å gi
tilbake.

### 6.3 Ingen viktig funksjon skal kreve dragging

**Slik ble det:** hvilke soner som tilbys avgjøres ved å tørrkjøre
`moveZoneContent` eller `placeSandboxItem` og lese `Result`-en — ikke ved
`canAcceptContent`, som for en *flytting* måler et dokument operasjonen aldri
produserer (kilden beholder innholdet sitt, så citation-nummereringen blir en
annen). Se `IMPLEMENTATION_PLAN.md` § 44.5.4.

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

**Slik ble det: to veier inn, ett dokument.**

Den fokuserte sonen ble den primære skriveflaten. Når en tekstførende sone er
valgt og fokusert, er sonen allerede tegnet flere ganger så stor som på den hele
sliden — den *er* en lesbar skriveflate, og «Rediger tekst» gjør den til en.
`EditorStage` fikk `textEditing: 'all' | 'none' | 'selected'` i stedet for den
gamle boolske: desktop skriver i alle felt, compact i ingen mens hele sliden
vises, og i nøyaktig ett mens det ene er fokusert.

`FocusedTextEditor` ble værende, men som den andre veien inn: tekstlista
adresserer *felt*, ikke soner, og et felt som ikke ligger i en sone man kan
fokusere — slidetittelen, en seksjons to linjer — har ingen fokusert sone å
skrives i. Begge veier skriver gjennom `textTarget.ts`, altså de samme
domenekommandoene, den samme undo-merkelappen og den samme fit-målingen.

**Fit-regelen tålte flyttingen uendret, og det er ikke tilfeldig.** Målingen
skjer i layout — `scrollHeight` mot `clientHeight` i sonens virkelige
1600 × 900-boks — mens forstørrelsen er en `transform` på en forfar. En
transform flytter ingen layoutpiksler, så en sone som er tegnet tre ganger så
stor måler nøyaktig det samme. Teksten kan ikke snike seg inn fordi visningen er
større; `e2e/compact.spec.ts` skriver for mye i en fokusert sone og krever at
den samme meldingen kommer og den godtatte kladden blir stående.

Det autofokuseres ikke inn i feltet når trinn fire nås. iOS åpner ikke
tastaturet på et programmatisk `focus()` utenfor en brukergest, så et autofokus
ville virket på Android og ikke på iOS — og et trykk i teksten er uansett måten
man velger *hvor* man vil skrive.

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

**Slik ble det.** Alle gestene ligger i `stageGestures.ts` og er pointer events
og bare det — ingen touch-gren, ingen musegren, og derfor ingenting som kan
oppføre seg forskjellig på et smalt desktopvindu og en telefon. Hooken gir fra
seg `onPointerDown` som en React-handler og følger resten av gesten på
`window`, slik at en sveip kan fullføres utenfor stagen uten at
`setPointerCapture` stjeler klikket etterpå.

Den siste regelen ble presisert i praksis, og sagt flate for flate:

- `.compact-stage` — sveipeflaten rundt siden — får `touch-action: pan-y
  pinch-zoom`. Nettleseren skal ikke ta et vannrett drag og gjøre noe eget av
  det, men den beholder loddrett panorering og pinchen i lufta rundt sliden.
- `.stage-viewport[data-pinch]` får `touch-action: none`. Attributtet settes av
  `StageSurface` når den har fått et sted å legge en zoom — altså på alle fire
  stages på en kompakt flate, og på ingen av dem på desktop. Det er der pinchen
  er vår.
- `.interactive-runtime` tar `touch-action` tilbake, så en kjørende miniapp
  beholder alle sine egne gester.

Nettleserens effektive `touch-action` er snittet fra elementet under fingeren og
oppover, så den mest restriktive vinner: en pinch over sliden blir vår, en pinch
utenfor den — i topplinja, i et panel, i en dialog — blir nettleserens, og et
vannrett drag i slideområdet blir vårt.

En sveip som faktisk blar sluker også klikket som følger etter seg, med én
capture-lytter brukt én gang. Uten det ville fingeren, etter å ha bladd, valgt
den sonen den tilfeldigvis slapp over på den *nye* sliden.

## 9.5. Tekstmarkering

Et trykk, et langt trykk eller et drag på en sone skal aldri starte
nettleserens tekstmarkering. Markeringen gjør de samme gestene upålitelige
etterpå, fordi det neste trykket går med til å oppheve den — og på iOS kommer
callout-menyen på kjøpet.

**Slik ble det:** som én invariant i `global.css`, ikke som `preventDefault()`
spredt i komponentene. `body` har `user-select: none` og
`-webkit-touch-callout: none`; `input`, `textarea`, alt som er
`contenteditable="true"` og presentasjonsflaten `.present` tar den tilbake.
Regelen er dermed snudd og sagt positivt: **den eneste teksten som kan markeres,
er tekst som kan redigeres.**

To konsekvenser er verdt å kjenne:

1. En ikke-redigerbar Tiptap — som er det compact tegner sonetekst med når
   ingenting skrives i den — får `contenteditable="false"` av ProseMirror selv
   og er derfor ikke markerbar. Den blir det i samme øyeblikk sonen fokuseres og
   settes i redigering, uten at noe annet endres.
2. Presentasjonsmodus er unntatt med vilje. Publikum kopierer sitater ut av en
   slide, og spilleren skiller allerede mellom et trykk som etterlot en
   markering og et som ikke gjorde det (`endedASelection`).

Invarianten gjelder også desktop. Det er ikke en mobilregel som lekker: å
markere sonetekst med musa i editoren har aldri hatt noen nytte, og det var
tidligere en av måtene et sonedrag kunne ende med et blått felt over halve
sliden.

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

**Slik ble det:** `FloatingWindow` selv ble responsiv. På en kompakt flate
tegnes det som et ark langs bunnen, uten flytting, uten resize-håndtak og uten
lagret geometri – men med uendret markup, slik at `IdeasWindow` fortsatt finner
`.floating-window__body` for scroll og autoscroll under dra. Det var billigere
og mindre risikabelt enn å trekke innholdet ut av vinduet, og det ga Sandkassen
det samme uten en linje ekstra.

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

Slik ble det:

```text
EditorView                       eier lasting, autosave, kommandoer, dialoger
  │                              og bygger de tre store flatene én gang
  ├─ DesktopEditorShell          plassering, og bare plassering
  │   ├─ TopToolbar / TextToolbar
  │   ├─ Filmstrip · Stage · Inspector
  │   └─ StatusBar
  └─ CompactEditorShell          plassering, og bare plassering
      ├─ CompactTopBar
      ├─ Stage  (+ ett panel: Filmstrip | tekstliste | Inspector | verktøy)
      └─ CompactTabBar
```

Begge får nøyaktig det samme, `EditorShellProps`, og **nøyaktig ett av dem er
mountet**. `Filmstrip`, `Inspector`, `EditorStage`, `SectionStage`,
`InteractiveStage` og hver eneste modal er de samme komponentene på begge
flater; det som ble trukket ut er de få stedene hvor betjeningen faktisk måtte
divergere:

- `ZoneSizeControls` og `ZoneBreadcrumb` – diskrete tvillinger til to
  dragegester, og begge brukes også på desktop;
- `textTarget.ts` – å adressere ett tekstfelt, og å måle det mot den virkelige
  sonen;
- `placement.ts` – «velg innhold, velg sone», delt av sandkassen og av
  soneflytting; den tørrkjører kommandoen som ville gjort jobben, i stedet for
  å stille et lignende spørsmål med `canAcceptContent`;
- `compact/` – topplinje, faner, verktøyliste, tekstliste og skriveflate, som
  bare gir mening der det ikke er plass til desktopens toolbar;
- `stageView.ts`, `stageGestures.ts` og `stageFocus.ts` – hvilket rektangel av
  sliden som vises, hvordan fingrene endrer det, og hvilket trinn av stigen
  editoren er på. Alle tre er rene moduler uten React-avhengigheter utenom
  hooken, og ingen av dem vet noe om en telefon;
- `StageSurface.tsx` – rammen de tre settes sammen i. De fire stagene var fire
  kopier av de samme tre boksene (viewport, scaler, side), og det gikk bra helt
  til visningen sluttet å være fast: i det øyeblikket en pinch kunne endre den,
  betydde fire kopier en pinch som virket på én sidetype og forstørret hele
  appen på de tre andre. Nå eier rammen transformen, og hver stage eier bare
  det som står *i* den — og for den ene med soner, hva et trykk betyr.

Ingen av dem inneholder domeneregler. Der det stod på valget mellom et nytt
adapterlag og en ekstra prop på en eksisterende komponent, vant proppen:
`EditorStage` fikk `selectOnTap`, `textEditing`, `focusRect`, `zoom`,
`onZoomChange`, `onPlace` og `chrome` i stedet for en parallell mobil-stage,
`ZoneOverlay` fikk `purpose` i stedet for et eget utvalgsomriss, og `Filmstrip`
fikk `overview` i stedet for en egen mobil slideoversikt.

Sveipen ligger på `CompactEditorShell` og pinchen på `EditorStage`, og det er
med vilje: sveipen gjelder enhver side — en slide, en seksjon, en miniapps
forside, en generert referanseside — mens pinchen trenger stagens egen
`toSlidePoint` for å forankres. De er samme hook med forskjellige callbacks, og
de kolliderer ikke: sveipen krever én finger og gir opp i det en annen lander,
og et sonedrag som har tatt pekeren stopper propageringen før den når skallet.

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
13. desktop: eksisterende filmstrip/inspector/drag/shortcuts/presentasjonsflyter fungerer fortsatt;
14. sveipe fram og tilbake mellom slides, og ikke gjøre det med et trykk, et
    loddrett drag, en knapp eller en kjørende miniapp;
14b. dra-sortere i flerkolonneoversikten, og se naboen bli skjøvet sideveis;
15. åpne slideoversikten og se at den tar hele høyden, at sidene er brede, at
    lista scroller og at valg og flytting fortsatt er ett trykk;
16. pinche i slideområdet — på en slide, en seksjon, en miniappforside og en
    generert side — og se at bare stagen forstørres;
17. velge en sone gjennom en forstørret visning;
18. skrive rett i den fokuserte sonen, og se fit-guarden stoppe for mye tekst;
19. rotere med en fokusert sone og beholde den;
20. prøve å markere sonetekst uten å få lov, og markere i et felt og få lov.

### Hva som faktisk kjører

`playwright.config.ts` har fire prosjekter som dekker dette:

| Prosjekt | Flate | Hva det beviser |
| --- | --- | --- |
| `chromium` | 1600 × 1000, mus | desktopregresjon: hele den eksisterende suiten, uendret |
| `phone-portrait` | 412 × 892, touch | den innholdsorienterte flaten |
| `phone-landscape` | 892 × 412, touch | den visuelle redigeringsflaten |
| `compact-mouse` | 900 × 760, mus, `hasTouch: false` | at compact avgjøres av vinduet, ikke av en user-agent |

`e2e/compact.spec.ts` kjøres av de tre siste og dekker flytene over. Tastaturet
simuleres ved å overstyre `visualViewport.height` og fyre nettleserens egen
`resize` – nøyaktig det signalet appen faktisk leser.

Gestene kjøres med nettleserens egen input, ikke med syntetiske events:
`page.mouse` der kjøringen har mus, og Chromiums `Input.dispatchTouchEvent` der
den har finger — det siste er den eneste måten å få to fingre på, og den eneste
måten å oppdage at nettleseren tok pinchen i stedet for appen. Hvilken av de to
en kjøring bruker leses av appens eget `data-coarse`, ikke av prosjektnavnet.
Pinch-testene hopper over seg selv på `compact-mouse`, som per definisjon bare
har én peker; sveipetestene kjører der som alle andre steder, og er dermed også
beviset på at gesten ikke er touch-spesifikk.

Gestgjenkjenneren har i tillegg en rask enhetstest (`stageGestures.test.tsx`)
som sender pointer-sekvenser mot hooken i jsdom, og view-transformen og
fokusstigen er rene moduler med egne tester (`stageView.test.ts`,
`stageFocus.test.ts`, `filmstripLayout.test.ts`).

### Fysiske røyktester som gjenstår

Playwright kan ikke fullt ut simulere et ekte iOS/Android-tastatur eller alle
touchdetaljer. Før en større mobilendring merges bør følgende gjøres for hånd,
og er **ikke** dekket av suiten:

1. **Ekte skjermtastatur, Android (Chrome).** Åpne et tekstfelt fra Tekst-panelet,
   kontroller at «Ferdig» og formatteringslinjen står over tastaturet mens det
   animeres inn, og at kladden ikke mistes når det lukkes.
2. **Ekte skjermtastatur, iOS (Safari/WebKit).** Samme, pluss at siden ikke
   scroller seg selv bort fra feltet, og at `viewport-fit=cover` + safe area gir
   riktig luft rundt bunnlinjen på en enhet med home-indikator.
3. **Rotasjon med tastaturet oppe.** Valgt slide, valgt sone og kladd skal
   overleve.
4. **Pinch-zoom.** Inne i slideområdet skal pinch forstørre sliden og ingenting
   annet; utenfor det – på topplinja, i et panel, i en dialog – skal
   nettleserens egen zoom fortsatt virke. Dobbelttrykk-zoom er slått av
   (`touch-action: manipulation`).
5. **Miniapp med egne gester.** En app som selv bruker drag eller wheel skal ikke
   bla i dekket, og «Avslutt miniapp» skal være treffbar med tommelen.
6. **Sveip med tommelen, ikke med en presis peker.** En ekte tommel beveger seg
   i en bue og treffer sjelden vannrett. Terskelen (56 px, og sideveis må slå
   opp/ned med god margin) er satt for det, men bare en fysisk enhet kan si om
   den er riktig – og om en sveip som starter helt ute ved skjermkanten kommer i
   veien for nettleserens egen «tilbake»-gest.
7. **Langt trykk på sonetekst, iOS.** `-webkit-touch-callout: none` skal fjerne
   markerings- og delemenyen. Chromium-baserte runtimes kan ikke bekrefte det.
8. **Tastatur mens den fokuserte sonen skrives i.** Den nye skriveflaten er
   stagen selv: kontroller at «Ferdig» og formatteringslinja står over
   tastaturet, og at sonen ikke havner bak det.

WebKit er i skrivende stund ikke installert i prosjektmiljøet, så alt over er
kjørt i Chromium-baserte runtimes; iOS-spesifikk tastatur- og safe-area-atferd
gjenstår å bekrefte på en fysisk enhet.

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

### PR 1b — slideområdet som betjeningsflate

Oppfølgingen, også som én PR: sveip mellom slides, slideoversikt i full høyde
med brede miniatyrer, pinch-zoom lokal til stagen, direkte tekstredigering i den
fokuserte sonen, og tekstmarkering som en redigeringsaffordans. Alt gjennom de
samme kommandoene, den samme geometrien og den samme fit-regelen som før — det
som er nytt er hvor fingrene tar i dem.

## 19. Bevisste ikke-mål for PR 1

- en egen native Android/iOS-app;
- full samarbeidsredigering;
- redesign av desktopeditoren utover det som trengs for delt kode;
- ny presentasjonsmodell;
- fri zoom/pan som lagres i dokumentet;
- å gjøre alle desktop-draggestures identiske på touch;
- å endre eksisterende miniapp-kontrakt fra 1600×900;
- å løse browserbegrensninger med user-agent-spesialtilfeller dersom standard webplattform kan brukes.
