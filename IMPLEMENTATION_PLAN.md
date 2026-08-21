# Slaids – implementeringsplan

> **Status:** Normativ teknisk og produktmessig plan for første utviklingsfase.  
> **Erstatter:** `VISION.md` som aktiv spesifikasjon. Den opprinnelige visjonen skal arkiveres, ikke slettes.  
> **Mål:** Gjøre Slaids raskt operativt som en faktisk presentasjonseditor, samtidig som fundamentet er robust nok til senere Supabase-, API- og agentintegrasjon.

---

## 1\. Produktmål

Slaids er en desktop-først, nettleserbasert presentasjonseditor for å lage, lagre og vise 16:9-presentasjoner.

Produktet skal **ikke** forsøke å gjenskape PowerPoint. Hovedstyrken skal være det motsatte av fri plassering: innhold skal tvinges inn i et matematisk, konsistent layoutsystem som gjør presentasjoner ryddige, geometrisk stabile og visuelt konsistente.

Kjerneideen er:

1. Hver slide har et fast logisk 16:9-rom.
2. Slidens hovedområde består av et rekursivt tre av soner.
3. Soner deles ved eksplisitte forholdstall.
4. Innhold finnes kun i bladsoner.
5. Alt innhold holder seg innenfor sonen sin.
6. Samme globale gap skal gjelde mellom faktisk innhold uavhengig av hvor dypt layoutet er nestet.
7. Presentasjonens bakgrunn og fonter er globale for presentasjonen, ikke per slide.
8. Editor og presentasjonsmodus skal bruke samme geometriske sannhetskilde.

### Ikke-mål i første fase

Følgende skal ikke forsinke en operativ editor:

- mobilredigering;
- PowerPoint-eksport;
- Supabase;
- innlogging;
- flerbrukerfunksjoner;
- REST-API;
- MCP-server;
- agenttokens;
- avansert ekstern integrasjon.

Disse skal kunne legges til senere uten at domenemodellen må skrives om.

---

## 2\. Prioriteringsprinsipp

Første store PR skal være en **maksimal vertikal slice**, ikke en ren scaffold- eller arkitektur-PR.

Det viktigste tidlige spørsmålet er om den constrained layout-editoren faktisk fungerer godt å bruke. Derfor skal vi få et ekte UI som kan testes manuelt så tidlig som mulig.

Første milepæl er at brukeren kan:

1. åpne appen;
2. opprette en presentasjon;
3. velge bakgrunn og fonter;
4. opprette slides;
5. velge med/uten tittel;
6. splitte soner med forholdstall;
7. neste soner;
8. legge inn kort/beholdere;
9. skrive og redigere tekst;
10. bytte og reorganisere slides;
11. reloade nettleseren uten datatap;
12. vise presentasjonen i presentasjonsmodus.

Når dette fungerer, skal agenten **ikke stoppe**. Den skal fortsette ned den prioriterte backlogen så langt det er teknisk forsvarlig innen samme PR.

---

## 3\. Teknologistack

Anbefalt første stack:

| Lag               | Valg                      | Begrunnelse                                                   |
| ----------------- | ------------------------- | ------------------------------------------------------------- |
| App               | React + TypeScript + Vite | Egnet for kompleks klientinteraksjon og rask iterasjon        |
| TypeScript        | `strict: true`            | Reduserer skjult state-/modellfeil                            |
| Runtime-skjema    | Zod                       | Validering, schemaVersion og senere import/API                |
| Rich text         | Tiptap / ProseMirror      | Strukturert dokumentmodell, egne nodes, tabeller og citations |
| UI-primitiver     | Radix Primitives          | Robuste dialoger, popovers, tooltips, slider osv.             |
| Drag-and-drop     | dnd-kit                   | Kontrollerbar DnD, sensors og DragOverlay                     |
| Lokal persistence | IndexedDB via Dexie       | Bedre enn localStorage for strukturert data og Blobs          |
| Unit tests        | Vitest                    | Domenelogikk og geometri                                      |
| E2E/browser       | Playwright                | Reelle arbeidsflyter, browser-geometri og screenshots         |

State-bibliotek (Zustand/Redux e.l.) er sekundært. Det avgjørende er at UI-et **ikke muterer domeneobjekter direkte**.

---

## 4\. Fast logisk koordinatsystem

Alle slides skal ha samme logiske dimensjoner:

```ts
export const SLIDE_WIDTH = 1600
export const SLIDE_HEIGHT = 900
```

Editorviewporten kan være større eller mindre, men sliden rendres i dette designrommet og skaleres uniformt til tilgjengelig plass.

Konsekvenser:

- samme geometri på laptop og stor monitor;
- presentasjonsmodus og editor deler samme layout;
- browserens aktuelle CSS-piksler blir ikke sannhetskilden;
- hit-testing kan konvertere pointer-koordinater til 1600×900-koordinater;
- unit tests kan teste layout uten browser.

---

## 5\. Sonemodell: én entydig invariant

Layoutet skal representeres som et rekursivt `split | leaf`-tre.

```ts
type LayoutNode = SplitNode | LeafNode

type SplitNode = {
  id: string
  kind: 'split'
  axis: 'x' | 'y'
  weights: number[]
  children: LayoutNode[]
}

type LeafNode = {
  id: string
  kind: 'leaf'
  content: ZoneContent | null
}
```

### Harde regler

- En `SplitNode` har barn og **aldri innhold**.
- En `LeafNode` kan ha innhold og **aldri barn**.
- `children.length === weights.length`.
- En split har minst 2 og maks 10 barn.
- Alle vekter er endelige tall `> 0`.
- Roten for hovedområdet kan ikke slettes.
- Layouttreet normaliseres etter strukturelle endringer.

Dette fjerner tvetydigheten rundt «sone med både innhold og subsoner».

### Splitting av en leaf med innhold

Hvis en leaf med eksisterende innhold splittes:

1. leaf erstattes atomisk av en split;
2. nye leaf-barn opprettes;
3. eksisterende innhold må enten:
   - flyttes til ett eksplisitt valgt barn dersom `canFit()` godkjenner det; eller
   - flyttes til Sandbox;
4. ingen mellomtilstand med både barn og innhold er tillatt.

### Sletting

Ved sletting av et barn:

- søsknenes tilgjengelige plass fordeles på nytt ved samme vekter/prinsipp;
- dersom en split står igjen med ett barn, kollapses splitten automatisk til dette barnet;
- subtree-sletting skal være eksplisitt og håndteres atomisk;
- destruktive handlinger skal ha trygg bekreftelse når innhold går tapt.

---

## 6\. Geometry engine: produktets viktigste tekniske kjerne

Det globale gapkravet skal løses matematisk, ikke ved å håpe at nestede CSS-grid/margins oppfører seg riktig.

Definer et globalt design-token:

```ts
export const G = 24
```

Den eksakte verdien er justerbar senere. Arkitekturen skal ikke avhenge av `24`.

En ren funksjon beregner rektangler:

```ts
computeLayoutRects(
  node: LayoutNode,
  rootRect: Rect,
  gap: number
): Map<NodeId, Rect>
```

For en split langs én akse med tilgjengelig lengde `L`, `n` barn og vekter `w_i`:

```text
usable = L - G * (n - 1)
unit = usable / sum(weights)
childLength[i] = unit * weights[i]
```

Barna plasseres sekvensielt med **nøyaktig `G` mellom seg**.

### Viktig semantikk

`G` måles mellom layout-/border-bokser. Box shadows regnes ikke som geometri.

Strukturelle noder skal ikke innføre egne margins/padding som dobler gap ved nesting.

### Krav til geometry engine

Den skal:

- være ren og deterministisk;
- være uavhengig av React;
- returnere rect for hver node;
- validere at ingen leaf går utenfor parent;
- håndtere flyttall robust;
- ha omfattende unit tests;
- brukes av både rendering og hit-testing;
- senere kunne brukes av API/agentvalidering.

---

## 7\. Minimumsstørrelse og maksimal nesting

Det skal ikke være en vilkårlig maksdybde som «4 nivåer».

Splitting stoppes når geometri gjør resultatet ubrukelig.

Startverdier:

```ts
export const MIN_ZONE_WIDTH = 180
export const MIN_ZONE_HEIGHT = 120
```

Disse er design-tokens og må kunne justeres.

En foreslått split kan bare committes dersom alle nye leaf-/subtree-rektangler består minimumsvalideringen.

Hvis valgt sone har innhold, må mottakerbarnet i tillegg bestå `canFit()`.

---

## 8\. Tittelsone

Den opprinnelige visjonen beskrev tittelen som innholdsdrevet i høyde. Dette skaper ustabil geometri og bør unngås.

Tittelsone skal derfor være deterministisk:

- én linje;
- fast fontstørrelse;
- fast line-height;
- fast `TITLE_ZONE_HEIGHT`;
- ingen manuelle linjeskift;
- ingen individuell fontformatering;
- tekst som ikke får plass skal ikke kunne committes;
- citations kan tillates i tittelen.

Sliden har enten:

```text
[ title zone ]
G
[ main zone  ]
```

eller bare:

```text
[ main zone ]
```

Når tittelen fjernes, ekspanderer hovedområdet automatisk. Layouttreets relative forhold beholdes.

---

## 9\. Soneredigeringsmodus

Appen har to hovedmodi:

1. **Innholdsredigering**
2. **Soneredigering**

I soneredigering:

- alle sonegrenser visualiseres tydelig, f.eks. stiplet;
- hover/selection legger et translucent overlay og moderat backdrop blur over valgt subtree;
- valgt node får en tydeligere outline;
- innhold skal være visuelt dempet slik at strukturen står i fokus;
- handlingsknapper vises over overlayet.

### Handlinger på valgt node

Relevante handlinger:

- velg/endre innholdstype;
- flytt innhold til Sandbox;
- splitt leaf;
- rediger eksisterende split;
- tøm node/subtree;
- slett node/subtree der det er lov.

Handlinger som er semantisk umulige skal være disabled eller skjult.

---

## 10\. Hit-testing og navigering i hierarkiet

Hit-testing skal baseres på geometry engine, ikke kompliserte overlappende DOM-elementer.

Prosedyre:

1. konverter pointer fra viewport til slide-koordinater;
2. finn alle node-rects som inneholder punktet;
3. velg dypeste treff;
4. dersom punktet ligger i gapet mellom barn, vil parent-rect inneholde punktet mens child-rects ikke gjør det;
5. parent velges dermed naturlig.

Dette realiserer ideen om å kunne «treffe supersone via gap» uten z-index-hacks.

### Tastaturnavigering

Når en node er valgt:

- `ArrowUp`: parent;
- `ArrowDown`: første child dersom node er split;
- `ArrowLeft`: forrige sibling med wrap;
- `ArrowRight`: neste sibling med wrap.

I tillegg anbefales en liten breadcrumb:

```text
Rot > 2 > 1
```

Hver ancestor i breadcrumb skal kunne klikkes.

---

## 11\. Splitt-modal

Splitt-dialogen skal vise valgt sone med riktig aspektforhold og live preview.

### Kontroller

1. **Orientering**
   - `x`: side ved side;
   - `y`: over/under.
   - default velges basert på om sonen er bredere eller høyere.
2. **Antall barn**
   - min 2;
   - maks 10;
   - heltall.
3. **Forholdstall**
   - ett input per barn;
   - default 1;
   - tillat positive desimaltall;
   - normalisering er matematisk, ikke lagringsmessig nødvendig:
     - `[1, 2]`, `[0.5, 1]` og `[2, 4]` er geometrisk ekvivalente.

### Live preview

Endringer skal forhåndsvises umiddelbart.

«Bruk»-knappen er disabled hvis:

- input er ugyldig;
- et barn blir mindre enn minimum;
- eksisterende innhold ikke kan plasseres lovlig.

---

## 12\. Redigering av eksisterende splits

Samme modal/prinsipp brukes til å endre:

- orientering;
- antall barn;
- vekter.

Endringer må være atomiske og valideres før commit.

Dersom antall barn reduseres og fjernede subtrees har innhold:

- brukeren må få et eksplisitt valg om å flytte dette til Sandbox eller slette;
- appen skal ikke stille miste innhold.

Direkte drag handles for ratios kan implementeres senere, etter at den numeriske modellen er stabil.

---

## 13\. Innholdstyper

En leaf kan ha `content: null` eller én `ZoneContent`.

Første operative innholdstyper:

### 13.1 Container

Usynlig wrapper:

- transparent bakgrunn;
- ingen box shadow;
- ingen visuell kortflate;
- ingen ytre padding som påvirker layoutgap;
- kan inneholde subfelt med RichDoc, eller ett bilde/SVG som fyller sonen.

Tekstfarge velges automatisk mot slidebakgrunn.

En beholder er et gjennomsiktig kort: tekstsiden bruker den samme
`CardBody`-en et kort bruker, med de samme kommandoene og de samme
skillelinjene. Ett subfelt er det en beholder var før. Skillelinjene følger
tekstfargen bakgrunnen tilsier (hvit eller svart, delvis gjennomsiktig),
mens et korts skillelinjer er nøytralt grå uansett headerfarge – en
skillelinje er struktur, ikke dekorasjon.

### 13.2 Untitled card

Kort uten separat header:

- avrundede hjørner;
- box shadow;
- bakgrunnsfarge;
- intern padding;
- RichDoc i body.

Skyggen er en helt vanlig ytre `box-shadow` som faller ned i gapet rundt
kortet. Inneslutningsregelen (§17) handler om *innhold*, og klippingen hører
derfor hjemme på innholdsboksen, som er nøyaktig sonens boks — ikke på
sone-elementet. Da er sonen selv uklippet, og skyggen har plass. Det koster
ingen layout: en skygge er maling, så kortet fyller fortsatt sonen nøyaktig
og det er fortsatt én avstand mellom to kort. Skyggen holdes innenfor `G`,
slik at to naboskygger møtes i gapet i stedet for å nå hverandres kort.

### 13.3 Titled card

Kort med:

- headerområde;
- bodyområde;
- ingen egen kortflate under de to: header og body bærer hver sin farge og
  sine egne hjørner, ellers blandes den underliggende flaten inn i den
  antialiaserte kanten mellom dem og legger seg som en lys strek langs
  fargepanelet — særlig fordi sliden tegnes i en brøkdels skala, som lander
  den rette overkanten på en halv piksel;
- kontrollert typografi;
- støtte for flere body-subfields.

Body-subfields skal ha intern layoutsemantikk som ikke blandes med slide-sonetreet.

---

## 14\. Farger og kontrast

Presentasjonen har global bakgrunnsfarge.

Kort kan bruke en begrenset, deterministisk palett.

Forslag fra visjonen:

- hue: `0°, 30°, …, 330°`;
- saturation: `25%`;
- lightness: `20%, 40%, 60%, 80%`;
- samt svart og hvitt.

Tekst på bakgrunn velges mellom svart og hvitt ved å beregne kontrast og velge alternativet med høyest kontrast.

Tekstskygge kan brukes dekorativt på mørke bakgrunner, men skal ikke være forutsetningen for lesbarhet.

---

## 15\. Presentasjonstema

Når en ny presentasjon opprettes velges:

1. tittel;
2. global bakgrunnsfarge;
3. font for titler/overskrifter;
4. font for brødtekst.

Disse gjelder globalt i presentasjonen.

Det skal ikke være mulig å få tilfeldig fontmiks per slide.

Designet skal være token-basert:

```ts
type PresentationTheme = {
  backgroundColor: string
  headingFontFamily: string
  bodyFontFamily: string
  /** Luft: én multiplikator på alle avstander. */
  spacing: number
  /** Skriftstørrelse: én multiplikator på all typografi. */
  fontScale: number
}
```

Fontvalg bør starte med et kontrollert sett vanlige system-/Windowsfonter og et begrenset sett webfonter. Unngå å gjøre fontsystemet til et stort prosjekt i første PR.

**Luft** og **skriftstørrelse** er to skalaer, ikke to lister med tall.
`spacing` ganger opp alle avstander samlet – det globale gapet, slide-
innrykket, kortpolstringen, avstanden mellom subfelt og mellom tekstblokker.
At de flyttes samlet er det som holder ett-gap-invarianten sann på hvert
trinn: gapet er fortsatt én avstand, bare en annen. `fontScale` ganger opp
all typografi, inkludert boksene hvis høyde er diktert av typografi
(tittelsonen og kortheaderen), så større tekst aldri havner i en boks bygget
for mindre.

Utledningen fra basistokens hører hjemme ett sted (`src/domain/metrics.ts`),
og geometrimotoren, DOM-en og den hodeløse estimatoren leser alle den samme
utledningen – ellers glir de fra hverandre. Begge skalaene er derfor
fit-relevante: en temaendring som ikke er en font må måle decket på nytt på
samme måte som en font gjør.

Temaet kan lagres som standard for nye presentasjoner. Det er en lokal
preferanse (localStorage, som vindusgeometri), ikke presentasjonsdata, og
valideres på vei ut igjen.

---

## 16\. Rich text

Bruk Tiptap/ProseMirror og lagre dokumentet som strukturert JSON, ikke rå HTML.

### Første RichDoc-scope

Støtt minst:

- paragraphs;
- headings med Slaids-kontrollerte nivåer;
- bold;
- italic;
- underline dersom ønskelig;
- bullet lists;
- ordered lists;
- links;
- line breaks;
- justering (venstre/midt/høyre) per blokk, også for et bilde som står
  mellom teksten;
- senere citations og tabeller.

Titler – både slidetittel og korttittel – er midtstilt som standard: en
tittel er en etikett, ikke et avsnitt. Justering lagres på dokumentet som
den samme inline-stilen begge rendringene skriver, så editoren og sliden
ikke kan bli uenige.

Innhold justeres også loddrett (topp/midt/bunn) i feltet det står i. Det er
en egenskap ved feltet, ikke ved teksten.

### Ekstern paste

Vanlig paste fra nettsider/Word skal **ikke importere tilfeldig fremmed styling**.

Default:

- ignorer ekstern CSS/font/font-size;
- parse tekst og enkel struktur;
- konverter til native Slaids/Tiptap-noder;
- ha «paste as plain text»-atferd som sikker basis.

Strukturell kopiering av hele Slaids-kort/innhold skal være en egen intern clipboard-semantikk.

---

## 17\. Content fit / overflow

Dette er en hard produktinvariant:

> Innhold skal ikke bli semantisk lagret som «gyldig ferdig innhold» dersom vesentlig innhold ikke er synlig innenfor sonen.

Vi skiller mellom:

### Visuell containment

Alt *innhold* rendres med clip/hidden slik at ingenting en sone holder males
utenfor den. Klippet ligger på innholdsboksen, som har nøyaktig sonens
størrelse; sone-elementet selv klipper ikke, slik at et korts skygge kan falle
i gapet. Sliden klipper: en skygge kan havne i gapet, aldri utenfor sliden.

### Semantisk fit

En sentral funksjon:

```ts
canFit(content, rect, context): FitResult
```

`context` er den **prospektive** rendringskonteksten: temaet som skal gjelde
etter commit, og siteringsnummereringen decket får etter commit. Den
tilstanden som skal vises etter commit, er den som måles før commit.

skal etter hvert brukes av:

- typing;
- paste;
- Sandbox DnD;
- structural paste;
- splitting med eksisterende innhold;
- ratioendringer;
- globale fontendringer.

For RichDoc kan appen bruke en offscreen/static render med identiske typografiske parametre.

### Første operative iterasjon

Det er akseptabelt at tidlig prototype først:

- tydelig markerer overflow under aktiv redigering;
- blokkerer strukturelle handlinger som å flytte innhold til en for liten target.

Men full `canFit()`-håndheving skal være første prioritet etter den operative vertikale slicen.

Ved streng typing-validering kan «last valid document»-mønster brukes, men IME/composition må ikke brytes ved rollback midt i composition.

---

## 18\. Lokal lagring

Ikke bruk `localStorage` som hoveddatabase for presentasjoner.

Bruk:

```text
IndexedDB
  ↓
Dexie
```

Begrunnelse:

- asynkront;
- strukturert;
- bedre egnet til større datasett;
- kan lagre Blobs;
- langt bedre egnet når bilder/SVG kommer.

`localStorage` kan brukes til små UI-preferanser som:

- vindusposisjon;
- sist valgte mode;
- ikke-kritiske lokale toggles.

### Repository-abstraksjon

UI skal avhenge av et interface:

```ts
interface SlaidsRepository {
  listPresentations(): Promise<PresentationSummary[]>
  loadPresentation(id: string): Promise<Presentation>
  savePresentation(presentation: Presentation): Promise<void>
  deletePresentation(id: string): Promise<void>
}
```

Først:

```text
SlaidsRepository
  └─ DexieSlaidsRepository
```

Senere:

```text
SlaidsRepository
  ├─ DexieSlaidsRepository
  └─ SupabaseSlaidsRepository
```

---

## 19\. Schema, versjonering og migrations

Fra første persistente format:

```ts
type Presentation = {
  schemaVersion: 1
  id: string
  ...
}
```

Zod brukes ved innlasting/import.

Ha et eksplisitt migrationslag selv om første versjon bare har `v1`.

Målet er at tidlige testpresentasjoner ikke blir permanent uleselige når modellen utvikles.

---

## 20\. Autosave

Endringer skal lagres fortløpende.

Krav:

- debounced autosave for hyppige editorendringer;
- eksplisitt save-status:
  - `Saved`
  - `Saving…`
  - `Save failed`;
- aldri markere «Saved» før repository-kallet faktisk er fullført;
- reload-test skal være en del av E2E.

---

## 21\. Presentation library / startside

Første UI må ha en enkel startside med:

- liste/grid over presentasjoner;
- opprett ny;
- åpne;
- rename;
- delete med bekreftelse;
- sist endret;
- eventuelt duplicate.

Mappeorganisering kan komme senere.

---

## 22\. Editor shell

Editoren skal minst ha:

- top toolbar;
- slide-filmstrip/sidebar;
- sentral slide stage;
- bottom toolbar/statusområde;
- enkel indikator for innholdsmodus vs sonemodus;
- autosave-status.

UI skal være desktop-/laptop-optimalisert. Ingen tid skal brukes på mobilredigering.

---

## 23\. Slidehåndtering

Støtt tidlig:

- opprett slide;
- velg med/uten tittel;
- delete;
- duplicate;
- reorder;
- navigering mellom slides.

Reorder bør bruke dnd-kit eller en enkel deterministisk mekanisme.

---

## 24\. Presentasjonsmodus

Presentasjonen skal kunne vises direkte i nettleseren.

Krav:

- samme slide-renderer/geometri som editoren;
- UI chrome skjules;
- keyboard:
  - neste/forrige slide;
  - Escape ut;
- sliden skaleres uniformt til viewport;
- ikke bygg separat «presentasjonslayout».

---

## 25\. Sandbox

Sandbox er et globalt arbeidsområde for innhold som midlertidig ikke ligger på en slide.

Formål:

- unngå at innhold må slettes ved strukturendring;
- flytte innhold mellom soner/slides;
- håndtere splitting/sletting trygt.

Krav:

- et item beholder typed `ZoneContent`;
- ikke render hele objektet i full størrelse under drag;
- bruk en liten `DragOverlay`;
- target-zoner markeres bare som gyldige hvis:
  - target er leaf;
  - target er tom eller handlingen eksplisitt støtter erstatning;
  - innholdstypen er kompatibel;
  - `canFit()` godkjenner plassering når streng fit er implementert.

Sandbox kommer rett etter content-fit i prioritert backlog.

---

## 26\. Bilder og SVG

Rasterbilder og SVG lagres som assets i IndexedDB/Dexie.

Metadata og binærdata skal skilles logisk.

SVG skal beholdes vektorbasert, men vises som asset via `<img>`/Blob URL som sikker default, ikke injiseres som vilkårlig rå HTML/SVG markup.

Innhold refererer til `assetId`, ikke store base64-strenger i presentasjons-JSON.

Et bilde kan settes inn enten i et tekstfelt, sammen med teksten, eller som
innhold som fyller hele sonen. Hvor det havner spørres om, det utledes ikke
av hvilken modus editoren tilfeldigvis står i.

Et nytt bilde får bredden som faktisk er ledig i feltet, og kan dras i
størrelse etterpå. Bare bredden dras – høyden følger av aspektforholdet – så
bildet kan aldri forvrenges, og draget stopper ved den ledige plassen i
sonen. Fit-vakten har fortsatt siste ord.

---

## 27\. Intern clipboard

Skill mellom:

1. tekst-clipboard inne i RichDoc;
2. Slaids-strukturell clipboard i sonemodus.

I sonemodus kan Ctrl/Cmd+C/X/V kopiere/flytte én `ZoneContent`-enhet.

Internt format må:

- ha en MIME-/formatversjon;
- valideres med Zod;
- ikke tillate korrupte node-ID-referanser;
- generere nye IDs ved kopi når nødvendig;
- bevare asset-referanser.

---

## 28\. Referanser og citations

Referanser identifiseres med stabile interne IDs.

Citation-node lagrer:

```ts
type CitationAttrs = {
  referenceIds: string[]
}
```

Den lagrer **ikke synlige tall**.

En derived pass gjennom presentasjonen bestemmer nummerering etter første forekomst.

Eksempel:

```text
reference A → 1
reference B → 2
reference C → 3
```

Flyttes slides, beregnes mappingen på nytt.

### Komprimering

Sekvenser på minst 3 kan komprimeres:

```text
1, 2, 3, 5, 6, 8, 9, 10
→ 1–3, 5, 6, 8–10
```

To tall på rad beholdes som `5, 6`.

### Referanseslides

Referanseslides skal være **derived**, ikke manuelt lagret som vanlige slides.

Hvis referanselisten ikke får plass ved definert minimumsfont:

- generer flere referenceslides;
- ikke krymp teksten vilkårlig.

---

## 29\. Layout templates

Templates inneholder kun layoutstruktur, aldri slideinnhold.

Krav:

- lagre gjeldende layout som template;
- templates finnes på tvers av presentasjoner;
- opprett slide fra template;
- delete;
- edit via egen layout-only editor/modal;
- ingen RichDoc/assets i template.

Templates persisteres separat fra presentasjoner.

---

## 30\. Ideas

Ideas-panelet kan porteres konseptuelt fra `peohol/mdeditz`.

Bevar prinsippet:

- innholdsdata eies av presentasjonen;
- vindusgeometri/posisjon er lokal UI-state;
- ett tydelig kategorinivå;
- kategorier har en rekkefølge og kan dras om;
- en idé trenger ingen kategori;
- en kategori er en overskrift, ikke en beholder som eier det den står over:
  sletter man den, blir idéene liggende – ukategorisert;
- fargekoding som skiller kategoriene, og som følger idéene under dem;
- DnD der det er nyttig.

Ikke kopier mdeditz-arkitekturen blindt; portér ønsket UX og atferd inn i Slaids' typed domene.

---

## 31\. Tabeller

Tabeller bør bygges som en kontrollert Tiptap-extension senere i første store PR dersom kapasitet.

Krav:

- ikke fri HTML;
- kontrollert theme/styling;
- tabellen må respektere `canFit()`;
- paste av tabeller normaliseres til native struktur.

---

## 32\. Mapper

Presentation folders er nyttig, men ikke en tidlig blokkering.

Kan implementeres etter:

- editor;
- persistence;
- references/templates/Ideas hvis kapasitet.

Hold foldermodellen enkel og uavhengig av layoutdomenet.

---

## 33\. Backup/import før Supabase

Lokal nettleserlagring kan gå tapt.

Implementer derfor relativt tidlig et lokalt `.slaids`-format.

Forslag:

- zip/container eller JSON + assets;
- manifest med formatversjon;
- presentation data;
- nødvendige assets;
- Zod-validering ved import;
- migrer ved behov.

Forsøk også:

```ts
navigator.storage.persist()
```

når dette er hensiktsmessig, men backup må fortsatt eksistere.

---

## 34\. Domain commands

All strukturendring skal gå gjennom eksplisitte domenekommandoer.

Eksempler:

```ts
splitLeaf(...)
updateSplit(...)
deleteLayoutNode(...)
clearLayoutNode(...)
setZoneContent(...)
moveZoneContentToSandbox(...)
placeSandboxItem(...)
insertCitation(...)
```

UI skal ikke gjøre direkte dyp mutasjon.

Kommandoer validerer state og returnerer typed errors, f.eks.:

```text
NODE_NOT_LEAF
NODE_NOT_SPLIT
INVALID_WEIGHTS
ZONE_TOO_SMALL
CONTENT_DOES_NOT_FIT
TARGET_OCCUPIED
ROOT_CANNOT_BE_DELETED
INVALID_CONTENT
```

Dette er fundamentet for senere agent-API.

---

## 35\. Undo/redo

Undo/redo er svært nyttig i en editor og bør innføres tidlig nok til at destruktive operasjoner ikke blir frustrerende.

Anbefaling:

- command-/transaction-orientert historikk;
- gruppér teksttyping på en fornuftig måte;
- strukturelle operasjoner som split/delete/move skal være atomiske undo-trinn;
- persistence lagrer aktuell state, ikke hele undo-historikken.

Hvis full undo/redo blir for stort i første pass, skal modell- og kommandolaget i det minste ikke gjøre senere implementasjon vanskelig.

---

## 36\. Golden-path slide

Denne sliden er hovedtesten for produktets kjerne:

```text
┌──────────────────────── title ────────────────────────┐
│                                                       │
└───────────────────────────────────────────────────────┘
                         G
┌───────────────────┐ G ┌──────────────────────────────┐
│                   │   │            SVG               │
│   titled card     │   │                              │
│                   │   └──────────────────────────────┘
│ heading/body      │                  G
│ ─────────────     │   ┌──────────────────────────────┐
│ heading/body      │   │       untitled card          │
│                   │   │       description            │
└───────────────────┘   └──────────────────────────────┘
        2                         3
```

Struktur:

- title;
- main x-split `2:3`;
- høyre leaf y-split `1:2`;
- venstre titled card;
- to subfields i venstre body;
- fritekst i transparent top-right container;
- untitled bottom-right card.

Automatiserte geometriasserts:

```text
slide edge → content              == G
title → main                      == G
left → right                      == G
top-right → bottom-right          == G
```

I tillegg:

- nesting introduserer aldri ekstra gap;
- ingen leaf går utenfor slide;
- ingen ferdig content overflow-er.

Dette skal være både unit-/geometry-testet og, når funksjonene finnes, en Playwright golden path.

---

## 37\. Første operative vertikale slice – obligatorisk minimum

Claude Code skal først få dette helt operativt:

1. React + TypeScript strict + Vite.
2. Scripts for dev/build/typecheck/lint/test.
3. Zod schema v1 og migrationsramme.
4. Domainmodell.
5. Pure geometry engine.
6. Omfattende geometry unit tests.
7. Dexie/IndexedDB repository.
8. Autosave og save-status.
9. Presentation library/startside.
10. New-presentation modal.
11. Editor shell.
12. 1600×900 stage med uniform scaling.
13. Slide create/delete/duplicate/reorder.
14. Title/no-title.
15. Sonemodus.
16. Geometry-basert hover/hit-testing.
17. Hierarkinavigering med keyboard.
18. Split leaf 2–10.
19. Ratio inputs.
20. Live preview.
21. Minimumsstørrelsesvalidering.
22. Redigering av eksisterende split.
23. Delete/clear.
24. Tree normalization.
25. Container.
26. Untitled card.
27. Titled card.
28. Grunnleggende Tiptap RichDoc.
29. Body-subfields.
30. Reload persistence.
31. Presentasjonsmodus.
32. Representative Playwright E2E-tester.
33. Golden-path geometri for funksjonene som er tilgjengelige.

Dette er minimumsgrensen for at appen kan kalles «operativ».

---

## 38\. Ikke stopp ved minimum – prioritert fortsettelsesbacklog

Når minimum er nådd, fortsett i denne rekkefølgen:

1. strict content fit / overflow engine;
2. Sandbox;
3. DnD og fit-aware targets;
4. raster/SVG assets;
5. structural clipboard + ekstern plain/native paste;
6. references/citations + derived reference slides;
7. layout templates;
8. Ideas;
9. tables;
10. folders;
11. lokal `.slaids` backup/import;
12. font-polish;
13. direct ratio drag handles;
14. undo/redo dersom ikke allerede implementert;
15. mer E2E/geometri/visuell regresjon;
16. generell UX-polish.

«Simple shapes» stod på denne listen og er tatt ut igjen etter fysisk
testing: en figur er ikke det denne editoren er til for – et bilde settes
inn som et bilde – og verktøyet kostet mer i modell, migrasjon og UI enn det
ga. Skulle det komme tilbake, kommer det som en asset-type, ikke som en egen
payload og en egen inline-node.

Agenten skal bare stoppe når:

- denne listen er reelt fullført; eller
- videre arbeid er blokkert av eksterne credentials/tjenester; eller
- det kreves en reell produktbeslutning planen ikke avgjør; eller
- videre endringer i samme PR objektivt vil øke risikoen mer enn verdien.

«Kan gjøres senere» er ikke en gyldig stopgrunn for arbeid som fortsatt er konkret gjennomførbart innen backlogen.

---

## 39\. Self-verification

For hvert større UI-steg skal agenten:

- starte appen;
- bruke browser/Playwright der tilgjengelig;
- klikke gjennom sentrale workflows;
- inspisere console;
- ta representative screenshots;
- sammenligne DOM/stage-geometri med geometry engine;
- teste reload;
- verifisere destruktive flows;
- rette feil før neste større feature.

En UI-feature er ikke ferdig bare fordi JSX/CSS ser plausibel ut.

---

## 40\. Tester

### Unit

Minst:

- splitgeometri;
- nested splitgeometri;
- weights;
- floating-point edge cases;
- min size;
- tree normalization;
- delete/collapse;
- domain command errors;
- schema validation;
- migrations.

### E2E

Minst:

- opprett presentasjon;
- opprett slide;
- title toggle;
- split;
- nested split;
- rediger ratio;
- legg inn kort;
- skriv tekst;
- slide navigation;
- reload persistence;
- presentasjonsmodus.

### Visuell regresjon

Bruk Playwright screenshots selektivt for representative states. Hold baselines i konsistent miljø.

---

## 41\. Før PR

Kjør og bestå:

```text
typecheck
lint
unit tests
production build
Playwright E2E
geometry checks
representative screenshots
console-error check
```

I tillegg:

- søk etter TODO/FIXME/stubs;
- review state corruption;
- review stale IDs;
- review destructive flows;
- review overflow;
- review persistence;
- review race conditions rundt autosave;
- review asset lifecycle/object URLs når assets finnes;
- kjør gjerne separat review-subagent og rett reelle funn;
- oppdater README med faktisk status og utviklingskommandoer.

---

## 42\. CLAUDE.md

`CLAUDE.md` skal være kort, repo-spesifikk og tokenøkonomisk.

Den bør inneholde:

- normative kilder (`IMPLEMENTATION_PLAN.md`);
- kjerneinvariants;
- viktige commands/tests;
- «ikke muter domene direkte»;
- krav om browser-verifikasjon;
- ikke dupliser hele planen.

Unngå en voksende «dagbok» i `CLAUDE.md`.

---

## 43\. Senere Supabase

Supabase skal ikke bygges nå, men repository-abstraksjonen gjør byttet enkelt.

Senere:

```text
UI/domain
   ↓
SlaidsRepository
   ├─ Dexie
   └─ Supabase
```

Når Supabase kommer:

- bruk Supabase Auth, ikke et hjemmelaget passordsystem;
- browser-eksponerte tabeller beskyttes med RLS;
- service-role/secret keys skal aldri ligge i frontend;
- assets legges i private Storage buckets med riktige policies.

---

## 44\. Senere REST/MCP-agent-API

Agent-API-et skal bygges **oppå de samme domenekommandoene som UI-et**.

Ikke la agenter simulere mouse clicks eller skrive vilkårlig intern JSON.

Ønsket arkitektur:

```text
                React UI
                   │
                   ▼
            Domain commands
              ▲         ▲
              │         │
             REST      MCP
```

Eksempler på semantiske agentoperasjoner:

```text
slaids_create_presentation
slaids_add_slide
slaids_split_zone
slaids_adjust_split
slaids_set_zone_content
slaids_add_reference
slaids_upload_asset
slaids_validate_presentation
```

Ikke ha `slaids_write_arbitrary_json` som primær mekanisme.

Senere autentisering for agenter bør bruke separate, revokerbare tokens med scopes, expiry/audit-metadata og bare hashed tokenrepresentation server-side.

---

## 45\. Arkivering av original visjon

Når denne planen legges inn i repoet:

```text
VISION.md
  ↓
docs/archive/VISION.original-2026-08-20.md

+ IMPLEMENTATION_PLAN.md
```

Originalen skal bevares som historisk produktdokument, men ikke lenger være normativ.

---

## 46\. Kilder som informerte tekniske valg

Disse ble brukt i researchen som lå til grunn for planen:

- MDN – IndexedDB: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- MDN – Storage quotas/eviction: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- MDN – Web Storage: https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API
- MDN – CSS scale(): https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/transform-function/scale
- MDN – SVG as an image: https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image
- Dexie docs: https://dexie.org/docs/
- Radix Primitives: https://www.radix-ui.com/primitives/docs/components
- Tiptap custom nodes / node views: https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/node
- dnd-kit DragOverlay: https://docs.dndkit.com/api-documentation/draggable/drag-overlay
- Playwright snapshots: https://playwright.dev/docs/next/test-snapshots
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Supabase docs: https://supabase.com/docs
- MCP tools spec: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP TypeScript SDK: https://ts.sdk.modelcontextprotocol.io/
- Claude Code best practices: https://code.claude.com/docs/en/best-practices

---

## 47\. Definisjon av suksess for første fase

Første fase er vellykket når Slaids er noe brukeren faktisk kan åpne og arbeide i, ikke bare et teknisk fundament.

Det skal være mulig å lage en reell presentasjon med flere slides og komplekse nestede layouts, skrive innhold, reloade uten å miste data og presentere resultatet – mens geometry engine garanterer at den sentrale «samme gap overalt»-ideen holder.

Backend, auth og agent-API kommer etter at selve editorparadigmet er bevist i praksis.
