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

> **Oppdatert:** Supabase og innlogging er ikke lenger ikke-mål. Den operative
> editoren står, og Supabase er nå primær persistens i konfigurert produksjon –
> se § 18 og § 43. Domenemodellen ble ikke skrevet om: byttet skjedde bak
> `SlaidsRepository`, akkurat slik denne planen forutsatte. REST-API, MCP-server
> og agenttokens er fortsatt ikke-mål.
>
> **Oppdatert:** deling er bygget – se § 43.5. Det er ikke en flerbrukerfunksjon,
> og «flerbruker» er fortsatt et ikke-mål. Deling er publisering: en hemmelig
> lenke til en skrivebeskyttet kopi. Det finnes ingen invitasjoner, ingen roller,
> ingen skrivetilgang for andre enn eieren, og ingen katalog å finne delte
> presentasjoner i.

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
| Persistens (produksjon) | Supabase (Postgres + Storage) | Data følger Slaids' ene tillatte bruker; RLS avviser alle andre Auth-brukere |
| Persistens (lokal/test) | IndexedDB via Dexie | Bedre enn localStorage for strukturert data og Blobs          |
| Auth              | Supabase Auth             | Én fast personlig Slaids-bruker; ingen konto- eller produktkobling til Huskis |
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

## 8.5\. Forside

Hver presentasjon har **nøyaktig én forside**, og den er obligatorisk. Den er
første side i dekket, og ingen kommando kan slette den, flytte den eller lage en
til.

Det er ikke en regel en kommando må huske: forsiden er et **felt på
presentasjonen** (`cover` på `DeckSource`), ikke et element i `slides`. Da er
«alle presentasjoner har en forside» en egenskap ved typen, og «forsiden er
først» en egenskap ved `deckPages`.

Forsiden er heller ikke en `Slide`. Den har ikke noe layouttre, ingen soner,
ingen splitting og ingen soneredigering – bare to linjer og en farge:

```ts
type DeckCover = {
  title: TitleDoc
  subtitle: TitleDoc
  /** Fargen på pillene – og samtidig standardfargen for overskrifter. */
  pillColor: string
}
```

### De to linjene

- **Tittel** settes i nøyaktig samme størrelse som en slide-tittel
  (`TITLE_FONT_SIZE`), slik at dekket åpner i typografien det fortsetter i.
- **Undertittel** settes ett hakk under (`COVER_SUBTITLE_FONT_SIZE`) – et hakk,
  ikke en annen slags tekst.
- Begge er **alltid horisontalt midtstilt**, og de to er **samlet vertikalt
  midtstilt**. Midtstillingen er ikke et valg som lagres: `titleExtensions`
  fjerner justeringsattributtet helt for forsiden, så det finnes ingen annen
  tilstand å havne i – heller ikke via paste eller et framtidig API-kall.
- Hver linje er **én linje**, som en tittelsone: tekst som ikke får plass
  avvises, den klippes aldri. `computeCoverGeometry` eier bredden hver linje
  faktisk har (siden minus pillens egen polstring), og både fit-porten og
  `max-width` på pillen leser den samme.
- Forsiden kan **ikke sitere**. Et citation-nummer utledes av første forekomst
  blant *slidene*, så en citation på forsiden ville tegnet en tom pille.
  `CitationExtension` er derfor ikke med i forsidens skjema.
- En linje uten tekst tegner **ingen pille** når dekket vises. I editoren tegnes
  begge, ellers kan en tom undertittel aldri klikkes i.

### Pillefargen er dekkets standardfarge for overskrifter

Bakgrunnsfargen på forsidens piller er samtidig **standardfargen for de
pilleformede overskriftene i innholdet**. Tekstfargen utledes av kontrast, som
alle andre fargepar i Slaids.

Det avgjørende er hva «bruker standardfargen» betyr. Det betyr **ikke** at
overskriften har samme hex-kode som forsiden. Det betyr at ingen har valgt en
farge for den:

- en overskrift uten valgt farge lagrer **ingen** farge (`color: null`), og
  males av `--slaids-heading-pill`, som settes fra `cover.pillColor`;
- en overskrift som *har* fått en farge lagrer den, og beholder den.

Derfor treffer en fargeendring på forsiden hver eneste overskrift som følger
standarden – også de som lages senere – uten at ett eneste lagret dokument
endres, og uten at noe av dette kan angres bort som en dokumentendring.
Alternativet, å skrive standardfargen inn i dokumentet, ville gjort «ikke valgt»
og «valgte akkurat denne blåfargen» til det samme dokumentet, og da kunne ingen
av dem følge forsiden igjen.

Migrasjonen til v8 gjør nøyaktig dette for dokumenter som allerede finnes: en
lagret farge som er *nøyaktig* den gamle standarden fjernes (den var aldri et
valg), alle andre farger står urørt.

### Å opprette et dekk er også en redigering

Forsidens tittel starter som dekkets navn. Da er navnet ikke lenger bare
metadata i biblioteket – det er en linje som tegnes – og et navn som ikke får
plass på én linje ville blitt lagret som en klippet forside, i en tilstand den
aller neste redigeringen av den linjen ville avvist.

`createPresentation` forblir derfor en ren fabrikk (lasting, migrering og
import skal aldri stoppes av en fit-regel), mens kommandoen `createDeck` er
formen de to stedene et menneske eller en agent lager et dekk av tekst de nettopp
skrev. Den måler forsiden absolutt – det finnes ingen forrige tilstand å
regrediere fra – og avviser med samme feilkode som en for lang slide-tittel.

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

Standardfargen for de pilleformede overskriftene i innholdet er ikke en konstant
i paletten, men **forsidens pillefarge** – se §8.5. En overskrift uten valgt
farge lagrer ingen farge og følger den; en overskrift som har fått en farge,
beholder den.

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

En overskrift er en pille, og fargeattributtet er `null` når ingen har valgt noe.
Standarden lagres aldri i dokumentet – den kommer fra forsiden gjennom en
CSS-variabel – slik at «ikke valgt» og «valgte akkurat denne fargen» forblir to
forskjellige dokumenter. Se §8.5.

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

## 18\. Lagring

Slaids har to lagringsmoduser. Valget tas **ett sted** –
`src/persistence/activeRepository.ts` – og resten av appen ser bare
`SlaidsRepository`.

| Modus                  | Når                                                              | Implementasjon             |
| ---------------------- | ---------------------------------------------------------------- | -------------------------- |
| Supabase (produksjon)  | `VITE_SUPABASE_URL` **og** `VITE_SUPABASE_PUBLISHABLE_KEY` finnes  | `SupabaseSlaidsRepository` |
| Lokal (utvikling/test) | Ingen av variablene finnes                                         | `DexieSlaidsRepository`    |
| Konfigurasjonsfeil     | Nøyaktig én av variablene finnes                                   | ingen – appen stopper      |

Dette er en **modus, ikke en fallback**. En konfigurert Supabase som er nede skal
gi en forståelig feil; appen skal ikke begynne å skrive lokalt og lage to
konkurrerende sannhetskilder.

Et halvkonfigurert bygg er ingen av delene. Det er en deploy-feil, og Dexie er
aldri svaret på en deploy-feil: da ville produksjon stille skrevet til
nettleseren fordi en variabel manglet i Vercel. Appen monterer verken bibliotek
eller editor, og sier hvilken variabel som mangler.

### Lokal modus

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

Begge implementasjonene ligger bak det samme interfacet:

```text
SlaidsRepository
  ├─ DexieSlaidsRepository
  └─ SupabaseSlaidsRepository
```

Alt som leses fra en av dem kjøres gjennom den samme migrerings- og
valideringskjeden før det når domenelaget. En utdatert eller håndredigert rad i
Supabase skal gi en tydelig feil, ikke en ødelagt editor.

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
- reload-test skal være en del av E2E;
- å forlate editoren er et lagringspunkt. Det ventende snapshotet finnes bare i
  autosave-kontrolleren, og den slutter å prøve på nytt når editoren unmountes –
  så «Tilbake» flusher først og blir stående hvis skrivingen ikke gikk igjennom.
  Dette gjelder Slaids' egen navigasjon, der vi faktisk kan garantere det; å
  lukke fanen er fortsatt best effort via `pagehide`/`visibilitychange`.

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

> **Oppdatert:** presentasjonsmodus og den offentlige delte visningen er samme
> komponent, `PresentationPlayer` (§ 43.5). Den lokale varianten har «Avslutt»;
> den offentlige har ingen vei tilbake, fordi den ikke er montert i noe å gå
> tilbake til. Sidelisten er felles og inkluderer de avledede referansesidene og,
> når delingen er på, QR-siden.

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

Slaids lager ikke bilder selv, verken for et menneske eller for en agent. Hvor
et bilde kan komme fra, og hvordan SVG-markup fra en agent valideres og saneres
før den blir et asset, står i §44 – «Rasterbilder», «SVG som førsteklasses
agentformat» og «SVG-sikkerhet».

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

Idévinduet **er** mdeditz' idévindu. Det ble først portert konseptuelt, med egen
modell, farger og dnd-kit; det er nå en tro port av atferden i `peohol/mdeditz`
(`public/js/ideas.js`). Dette er en bevisst reversering: panelet finnes for det
man kommer på mens man jobber, og der er det gesten som avgjør om notatet blir
skrevet ned eller ikke.

Modellen:

- **én ordnet liste**, ett nivå dypt. En kategori er en rad ved siden av de løse
  idéene og holder idéer, aldri andre kategorier. At kategorien ligger *i* lista
  er hele poenget: en løs idé kan stå mellom to kategorier, ikke bare over dem;
- en idé er én linje, klippet på `MAX_IDEA_LENGTH`; lista tar `MAX_IDEAS` rader,
  kategorier medregnet;
- en kategori er en overskrift, ikke en beholder som eier det den står over:
  sletter man den, blir idéene liggende der overskriften stod;
- alt som kommer utenfra repareres ned til ettnivåsregelen i stedet for å
  avvises, så en liste som er blitt til noe annet ikke tar vinduet med seg;
- innholdsdata eies av presentasjonen; vindusgeometri/posisjon er lokal UI-state.

Atferden:

- **inline redigering**: klikk på teksten åpner et felt som vokser med den.
  Enter lagrer, Escape avbryter, klikk et annet sted lagrer. Tom tekst er ingen
  endring;
- **dra og slipp er håndskrevet, ikke dnd-kit**: trykk-og-hold på berøring, noen
  piksler med knappen nede på mus, placeholder som viser gapet, løftet kort som
  følger pekeren fritt (og derfor `position: fixed`), kantrulling og Escape som
  avbryter. Et fullført drag svelger klikket som ellers ville åpnet redigereren;
- **tastatur**: `Alt` + pil opp/ned flytter raden i beholderen sin, `Alt` +
  høyre/venstre tar en idé inn i og ut av kategorien over den;
- **vinduet** flyttes i overskriften og strekkes i åtte håndtak, holder seg
  innenfor `.editor__body` og skiller mellom ønsket og mulig størrelse, slik at
  en midlertidig klemt flate ikke overskriver valget.

Fargekoding er beholdt, og er det ene stedet Slaids går ut over mdeditz. Farge
gir mening her fordi lista skal leses på skrå mens man bygger, og den må da
koste ingenting i draget. Derfor:

- fargen ligger på **kategorien**, aldri på idéene. En idé hører til en liste,
  og lista eier fargen; å farge om en liste er én skriving som ikke rører et
  eneste notat;
- den arves ned som en CSS-variabel på kategoriraden. Idéene får den uten å
  bære den, og et løftet kort beholder den i lufta – `position: fixed` flytter
  hvor en rad **tegnes**, aldri hvor den står i treet;
- den males med `::before`, ikke med `background`, `border-color` eller
  `box-shadow`. Dra-tilstandene setter nettopp de tre på kortet, og en farge
  båret av noen av dem ville blitt visket ut i det man tok kortet opp – altså
  akkurat når det betyr noe å se hvor det kom fra;
- fargebrikka i overskriften er både fargen og måten å endre den på, og står i
  dra-sonens unntaksliste, slik at et trykk på den åpner paletten i stedet for
  å løfte kategorien.

Nye kategorier får den første fargen ingen andre bruker, i en rekkefølge som går
rundt fargesirkelen i sprang – ellers ville de tre første lista blitt rød,
oransje og gul: forskjellige, men ikke til å skille.

Avkryssing (`done`) er borte, som i mdeditz. En idé er et notat som står der til
det er brukt, og da slettes det.

Arkitekturen er fortsatt Slaids': modellen er rene funksjoner i
`src/domain/ideas.ts`, endringene går gjennom typed kommandoer i
`src/domain/commands/ideas.ts`, og `schemaVersion` 7 folder det gamle paret
`ideas`/`ideaCategories` sammen til den ene lista – med fargene i behold.

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

Punktene over står. Etter dem – og etter Supabase (§ 43) – er deling bygget som
en komplett vertikal skive: domene, migrasjon, repository, Edge Function, rute,
renderer og UI (§ 43.5).

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
- migrations;
- sanitert delingssnapshot: bare publiserbart innhold, ingen private arbeidsdata,
  bare nødvendige asset-metadata;
- sidemodellen: QR-siden kommer etter referansesidene og bare når deling er
  aktiv, og er avledet/skrivebeskyttet;
- delings-repositoryet: lese status, aktivere med nytt token, deaktivere med
  nullet snapshot og rotert token, reaktivere med et annet token, at lagring av
  en delt presentasjon oppdaterer snapshotet, at en ren delingsendring ikke rører
  dokumentversjonen, og at en Supabase-feil bobler opp i stedet for å bli en
  lokal antakelse;
- reglene i den offentlige lesefunksjonen: gyldig token og publisert fil gir
  tilgang, ugyldig token, deaktivert deling og en fil utenfor snapshotet gir det
  ikke;
- SVG-sanitiseringen: gyldig markup overlever reserialisering, skript,
  hendelsesattributter, eksterne referanser, CSS-escapes, CSS-funksjoner som
  henter noe, og egne entiteter avvises, ukjente elementer og attributter
  fjernes og rapporteres;
- bildevalidering: hvert støttet format som en ekte, dekodbar fil med riktig
  størrelse, og avvist når den samme filen er avkortet eller endret – med ekte
  bildefiler som testdata, ikke håndlagde filhoder;
- Agent Core: se testlisten i §44. Asset-kontraktene kjøres mot et ekte
  repository, ikke en stubb – kontrakten er at filen faktisk er lagret og at
  dokumentet peker på den.

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
- presentasjonsmodus;
- `/s/<token>` går utenom `AuthGate`, mens arbeidsområdet fortsatt er portet;
- delt visning uten editor-UI;
- `Del`-bryterens tilstander, kopiering av lenken, og at den avledede QR-siden
  kommer og går sammen med delingen.

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

## 43\. Supabase

Supabase er primær persistens i konfigurert produksjon. Byttet skjedde bak
repository-abstraksjonen, uten endringer i domenemodellen:

```text
UI/domain
   ↓
SlaidsRepository
   ├─ Dexie      (lokal/test – ingen Supabase-konfigurasjon)
   └─ Supabase   (produksjon – konfigurert og innlogget)
```

Slaids er en **énbruker-app**. Supabase-prosjektet er delt infrastruktur, men det
gir ingen konto- eller produktkobling til Huskis eller andre apper som bruker
samme prosjekt. Bare den faste Supabase Auth-brukeren definert av
`SLAIDS_OWNER_ID` kan bruke Slaids i produksjon; e-postadressen er bare
påloggingsidentifikatoren for denne brukeren, ikke selve autorisasjonsregelen.

Krav som gjelder:

- bruk Supabase Auth, ikke et hjemmelaget passordsystem;
- app-gaten skal bare slippe gjennom Slaids' faste Auth-bruker;
- browser-eksponerte tabeller beskyttes med RLS som både håndhever eierskap og
  den faste Slaids-brukeren;
- service-role/secret keys skal aldri ligge i frontend – bare
  `VITE_SUPABASE_PUBLISHABLE_KEY`;
- assets legges i private Storage buckets med policies som håndhever samme
  brukerbegrensning.

### Datamodell

Fire tabeller i `public`, alle med `owner_id uuid → auth.users`. RLS gir bare
Slaids' faste Auth-bruker tilgang, og bare til rader der `owner_id` samtidig er
den samme brukerens UUID:

| Tabell                  | Innhold                                                  |
| ----------------------- | -------------------------------------------------------- |
| `slaids_folders`        | mapper                                                    |
| `slaids_presentations`  | hele `Presentation` som `document jsonb`, pluss `title`, `folder_id`, `slide_count`, `version` |
| `slaids_templates`      | hele `LayoutTemplate` som `template jsonb`                |
| `slaids_assets`         | hele `AssetRef` som `ref jsonb` + `object_path` i Storage  |

Slides, soner og referanser normaliseres **ikke** ut i egne tabeller. Dokumentet
er domenemodellen Slaids allerede validerer og migrerer; en oppsplitting ville
lagt en andre, svakere kopi av de invariantene i databasen. De indekserbare
kolonnene finnes bare for at biblioteket skal kunne listes uten å laste ned hvert
dokument.

Binærdata ligger i den private bucketen `slaids-assets`, med sti
`<owner_id>/<presentation_id>/<asset_id>`. Storage-policyene krever både at første
ledd er den innloggede brukerens UUID og at denne UUID-en er Slaids' faste
tillatte Auth-bruker. Sletting av en presentasjon må også rydde Storage:
DB-metadata følger med via fremmednøkkelen, men Storage-objekter gjør det ikke.

Rekkefølgen er ikke likegyldig. Raden slettes først, filene etterpå. Motsatt vei
ville en feilet radsletting etterlatt en presentasjon som fortsatt vises og
fortsatt åpnes, men med bildene borte for godt. Å miste data noe fortsatt peker
på er verre enn å la ligge data ingenting peker på – og det siste ryddes av
`deleteOrphanAssets()`, som sammenligner presentasjonsmappene i bucketen mot
presentasjonene som finnes.

`owner_id` settes alltid fra den tillatte autentiserte sesjonen, aldri fra
brukerinput. Fremmednøklene er sammensatte – `(folder_id, owner_id)` og
`(presentation_id, owner_id)` – slik at eieren følger med referansen. Dette er
forsvar i dybden selv om Slaids bare har én tillatt bruker: en rad eller referanse
kan aldri flyttes til en annen Auth-identitet dersom tilgangsmodellen senere
endres eller data manipuleres utenfor klienten.

### Samtidighet

`slaids_presentations.version` økes av en trigger ved hver `UPDATE`. Repositoryet
skriver mot den versjonen det leste, slik at en fane med en gammel kopi får en
tydelig konfliktfeil i stedet for å overskrive en nyere versjon i stillhet.

En konflikt gjør aldri at repositoryet glemmer raden. «Vet ingenting om den» betyr
«ny», og en ny presentasjon settes inn – så å glemme den etter et tapt kappløp
ville gjort neste autosave-forsøk til et `INSERT` og gjenopprettet en presentasjon
en annen fane nettopp slettet, med referanser til filer slettingen tok med seg.
Etter at en rad én gang er sett som eksisterende, er det bare en ny lesing av
dokumentet som løser konflikten, og bare en sletting herfra som gjør den ny igjen.

### Migrasjoner

SQL-en for skjemaet ligger i `supabase/migrations/`, slik at en tom Supabase kan
gjenskape dagens skjema fra bunnen. En anvendt migrasjon skrives aldri om:
endringer kommer som en ny fil.

Prosjektet er delt infrastruktur, og det avgjør hvordan migrasjoner deployes.
Supabases egen historikk, `supabase_migrations.schema_migrations`, er
**prosjektglobal**: den inneholder Huskis' og mdeditz' migrasjoner også, og de
bor i andre repoer. `supabase db push` leser den som om den var historikken til
repoet den kjøres fra, og stopper derfor herfra med «Remote migration versions
not found in local migrations directory» – med to forslag som begge er feil for
dette oppsettet: `migration repair` skriver om en annen apps historikk, og
`db pull` drar en annen apps skjema inn i Slaids. Ingen flagg avgrenser
`db push` til én app.

Slaids fører derfor sin egen historikk, i sin egen tabell,
`public.slaids_migrations`, og `scripts/deploy-migrations.sh` er hele
mekanismen: hver ukjørte migrasjon, i filnavnrekkefølge, hver i én transaksjon
sammen med sin egen historikkrad. Den delte tabellen leses aldri og skrives
aldri, og en migrasjon som nevner den avvises før noe kjøres.

`--dry-run` er read-only i streng forstand: den sender ingen setning som endrer
noe. Historikktabellen bootstrappes først når kjøringen faktisk skal mutere,
rett før den første migrasjonen – ikke mens den svarer på hva som ville skjedd.
Finnes den ikke, regnes Slaids-historikken som tom, og alt gjenstår. En
tørrkjøring som måtte opprette en tabell for å kunne svare, ville ikke vært en
tørrkjøring.

Det er trygt for de andre appene fordi ingenting i Slaids' deploy er globalt:

- historikken Slaids skriver er `slaids_`-prefikset og bare Slaids';
- migrasjonene lager bare `slaids_`-prefiksede objekter;
- Edge Function-deploy rører ingen migrasjonshistorikk – men må kjøres **uten**
  `--prune`, som ville slettet de andre appenes funksjoner.

Migrasjonene skal være idempotente. Det er dét som gjør at en fil kan kjøres på
nytt – i SQL Editor, eller mot en base der Slaids' historikk ikke er komplett –
uten å gjøre skade.

### Verifisert mot ekte backend

Supabase-oppsettet er testet manuelt mot det ekte prosjektet, ikke bare mot
stubber: innlogging, reload/session-persistens, filer, mapper, import/eksport,
sletting, utlogging, samtidighetskonflikt mellom faner og enheter, nettverksbrudd
og en InPrivate-sesjon. Alt fungerte.

Den ene deploy-fella var Vercel-variablene, ikke koden: `VITE_SUPABASE_URL` og
`VITE_SUPABASE_PUBLISHABLE_KEY` må være slått på for **både Production og
Preview**. Er de bare satt for Production, får hver PR-preview ingen av dem – og
det er ikke en feil, det er lokal modus. Previewen kjører da mot en tom
Dexie-base og ser tom ut. Se § 18 for regelen: ingen variabler = bevisst lokal
modus, begge = Supabase-modus, nøyaktig én = hard konfigurasjonsfeil.

---

## 43.5\. Deling

Deling er **publisering, ikke samarbeid**. Det er skillet hele modellen hviler
på, og det er verdt å si eksplisitt hva det utelukker: ingen invitasjoner, ingen
roller, ingen skrivetilgang for andre, og ingen offentlig katalog. Man må kjenne
den ugjettbare lenken.

Det er også det som gjør deling forenlig med at Slaids er en énbruker-app
(§ 43): en delt lenke gir ingen konto, ingen Auth-bruker og ingen tilgang til
noe som helst annet – bare lesetilgang til én publisert kopi. `SLAIDS_OWNER_ID`
er fortsatt den eneste som kan logge inn, og fortsatt den eneste som kan endre
noe. Deling er den eneste veien noen andre ser noe i det hele tatt, og de ser en
kopi.

### To dokumenter

| Dokument                       | Hvem ser det    | Hva det inneholder                                       |
| ------------------------------ | --------------- | -------------------------------------------------------- |
| `document` (arbeidskopien)     | bare eieren     | hele `Presentation`: sandkasse, idéer, mappe, alle filer  |
| `shared_document` (snapshotet) | alle med lenken | tittel, tema, slides, siterte referanser, viste filer     |

`SharedPresentationSnapshot` bygges i `src/domain/sharing.ts` ved å **liste opp
hva som skal med**, aldri ved å slette felter fra arbeidskopien. Retningen er
poenget: et nytt felt på `Presentation` er privat helt til noen med vilje
publiserer det, i stedet for offentlig til noen husker å fjerne det.

Ut av snapshotet holdes `sandbox`, `ideas`, `folderId`, `owner_id`, editorstate,
maler, ubrukte assets og usiterte referanser. Traverseringen som avgjør hva som
er «i bruk» er den samme som resten av appen bruker – `splitReferences` for
siterte referanser, `slideAssetIds` for viste filer – ikke en andre
implementasjon som kan drive fra den første.

### Delingsstatus er ikke en del av domeneobjektet

Den bor på raden i databasen. Det er dét som gjør at den ikke kan angres med
Ctrl+Z, ikke er med i autosave-payloaden, ikke følger med `.slaids`-eksport eller
-import, og ikke arves av en duplisering. En kopi starter alltid som ikke delt,
og det følger av hvor tilstanden ligger – ikke av en regel noen må huske.

### Kolonner og invariant

`slaids_presentations` har `is_shared`, `share_token` og `shared_document`, med
en CHECK som binder dem sammen:

```text
is_shared = true   →  shared_document finnes
is_shared = false  →  shared_document er null
```

Delt og publisert er samme tilstand. Tilbakekalling er derfor én UPDATE, ikke en
opprydding som kan bli avbrutt halvveis.

`share_token` er en v4 UUID og roteres **både** ved aktivering og ved
deaktivering. En lenke som er trukket tilbake blir aldri gyldig igjen, og en ny
deling er alltid en ny adresse.

### Version-triggeren

`version` økes bare når selve det redigerbare dokumentet endres – `document`,
`title`, `folder_id` eller `slide_count`. En ren endring av delingsmetadata rører
verken `version` eller `updated_at`.

Uten det ville publisering gjort den åpne editorens kjente versjon utdatert, og
neste autosave ville meldt en samtidighetskonflikt for en endring brukeren nettopp
gjorde selv, i samme fane. Den ekte optimistiske låsen står uendret for
dokumentendringer.

### Snapshotet følger lagringen

Når en delt presentasjon lagres, skrives den private kopien og den saniterte
kopien i **samme** UPDATE. En vellykket lagring kan derfor ikke etterlate
publikum på en eldre versjon enn eieren nettopp skrev, og det finnes ikke noe
sekundært autosave-system som kan komme ut av takt.

Aktivering er et lagringspunkt: ventende autosave flushes først, og hvis den ikke
går igjennom publiseres ingenting. Snapshotet bygges fra det som faktisk ble
lagret, tokenet er nytt, og alt aktiveres i én skriving.

### Offentlig lesetilgang

`anon` har fortsatt **ingen** tilgang til `slaids_presentations`. Den eneste
offentlige inngangen er Edge Function-en `slaids-share`, som kjører med service
role på serversiden og svarer på nøyaktig to spørsmål:

```text
GET .../slaids-share?token=<token>              → det saniterte snapshotet
GET .../slaids-share?token=<token>&asset=<id>   → én fil dekket faktisk viser
```

Det finnes ingen listeform og ingen skriveoperasjon. Ugyldig token, tilbakekalt
deling, slettet presentasjon og en fil som ikke er i snapshotet gir alle den
samme generelle 404-en – ellers ville endepunktet vært en informasjonskanal om
hvilke tokens som er ekte. Svarene har `Cache-Control: no-store` og
`X-Robots-Tag: noindex, nofollow`; en cachet kopi ville overlevd tilbakekallingen
som skulle fjerne den.

Filene forblir private. Bucketen gjøres ikke offentlig, og det lages ingen
offentlig kopi: funksjonen henter fila selv, og bare når nøyaktig det publiserte
snapshotet lister den. Service-role-nøkkelen finnes bare i funksjonens eget miljø
– aldri i Vite, Vercel eller nettleseren.

Reglene som avgjør tilgang ligger i `supabase/functions/slaids-share/access.ts`,
adskilt fra Deno-inngangspunktet, slik at de kan testes som det de er.

### Ruter

```text
/                     → AuthGate → bibliotek/editor        (privat)
/s/<token>            → SharedPresentationView             (offentlig)
```

`src/Root.tsx` velger én gang, **over** `AuthGate`. Den delte visningen «hopper
over» derfor ikke porten – den rendres av et tre porten aldri var med i. Ingen
React Router: én grense er ikke nok til å rettferdiggjøre en ruter, men den er
nok til å rettferdiggjøre én ren, testet funksjon (`src/routing.ts`).

Grensen er **stien, ikke tokenet**. Alt under `/s/` blir på den offentlige siden,
også når tokenet er ødelagt: en lenke som ble avkortet i en chat, eller skrevet
av med et tegn for lite, tilhører den som fikk den, og de skal møte «Denne
delingslenken er ikke aktiv» – ikke eierens innloggingsskjerm, som de uansett
ikke kan komme forbi. Et token som umulig kan være riktig besvares lokalt, så en
skrivefeil aldri blir en forespørsel som ser ut som en gjetning på noens lenke.

`vercel.json` gjør to ting for den ruten: en SPA-rewrite, så en direkte
forespørsel til `/s/<token>` ikke gir 404, og `X-Robots-Tag: noindex, nofollow`
pluss `Referrer-Policy: no-referrer` som svarhoder. Hodene er poenget her:
`<meta>`-taggene visningen setter selv virker først etter at JavaScript har
kjørt, mens en crawler kan nøye seg med det første HTML-svaret.

### Sidene i et dekk

```text
forside → authored slides → avledede referansesider → avledet QR-side
```

De to første er lagret, de to siste ikke. QR-siden er ikke en `Slide` og ligger
aldri i `presentation.slides`; den er et eget medlem av `DeckPage`-unionen i
`src/domain/pages.ts`. Det authored slide-formatet forurenses ikke for å få plass
til den, og ingen kommando kan nå den – derfor kan den verken slettes, flyttes,
dupliseres eller redigeres. Den finnes så lenge delingen er på, og ikke lenger.

Forsiden er lagret og redigerbar, men er heller ikke en `Slide`: den er et felt
på presentasjonen og et eget medlem av den samme unionen, alltid først. Se
§8.5. Snapshotet publiserer den – den er en side publikum ser – men fortsatt
ved å liste den opp, ikke ved at noe arves.

I editoren vises den i filmstripen som en avledet, skrivebeskyttet side på samme
måte som referansesidene, med en forklaring om at den styres av `Del`.

### Én renderer

```text
PresentationPlayer          samme geometri, samme sidemodell
├─ PresentView              lokalt, med «Avslutt»
└─ SharedPresentationView   offentlig, uten vei tilbake
```

Den offentlige varianten skiller seg ved hva den *ikke* får: ingen `onExit`, og
ingenting rundt seg. Editorkrom er ikke skjult der – det er aldri importert.

Bilder løses gjennom `AssetSourceProvider`: privat editor og lokal visning bruker
repositoryet, delt visning bruker det offentlige endepunktet. Valget tas av hvor
komponenten er montert, ikke av en gren inne i rendereren, og en delt visning
forsøker derfor aldri den autentiserte veien.

### Sikkerhetsinvariants

1. `anon` får aldri generell `SELECT` på `slaids_presentations`.
2. Et share-token gir eksakt lesetilgang til én presentasjon.
3. Det finnes ikke noe API for å liste delte presentasjoner.
4. Privat `document` returneres aldri til `anon`.
5. `sandbox`, `ideas`, mapper og annet privat finnes ikke i snapshotet.
6. Asset-endepunktet serverer bare filer som er i akkurat det publiserte snapshotet.
7. Deling gir aldri skrivetilgang.
8. En deaktivert eller slettet presentasjon kan ikke leses via et gammelt token.
9. Reaktivering gir nytt token; det gamle forblir dødt.
10. Delingsmetadata utløser aldri en falsk dokumentversjonskonflikt.
11. Import og duplisering arver aldri delingsstatus eller token.
12. Ingen service-role-verdi havner i frontend-bundelen eller i Vercel.

---

## 44\. REST/MCP-agent-API

Slaids skal kunne styres programmatisk av KI-agenter. En agent skal kunne opprette og redigere presentasjoner med de samme mulighetene og de samme begrensningene som en bruker i editoren, uten å simulere museklikk eller kjenne den interne React-staten.

Målet er at en agent blant annet skal kunne:

- opprette en presentasjon;
- bygge slides;
- velge og endre layout;
- fylle soner med passe mengde tekst;
- bruke kort og containere;
- legge inn og sitere referanser;
- legge inn eksisterende bilder;
- lage SVG-figurer direkte;
- inspisere resultatet;
- oppdage overflow og andre ugyldige tilstander;
- korrigere presentasjonen iterativt.

### Arkitektur

Agent-API-et bygges **oppå de samme domenekommandoene som UI-et**:

```text
                    React UI
                       │
                       ▼
                Domain commands
                  ▲         ▲
                  │         │
             Agent Core     │
               ▲    ▲       │
               │    │       │
             REST  MCP      │
               ▲    ▲       │
               │    │       │
             KI-agenter ────┘
```

Mer presist:

```text
KI-agent
   ↓
REST eller MCP
   ↓
Agent Core
   ↓
domain/commands
   ↓
SlaidsRepository
   ↓
Supabase / Storage
```

Transportlagene REST og MCP skal være tynne. De skal ikke inneholde egne regler for layout, innhold eller persistens.

`Agent Core` skal være:

- React-uavhengig;
- transportuavhengig;
- modell-/leverandøruavhengig;
- bygget på `SlaidsRepository`;
- bygget på `src/domain/commands/`;
- testbart uten browser eller nettverk.

OpenAI-, Anthropic- eller andre leverandørspesifikke konsepter skal ikke inn i domenet eller Agent Core.

### Samme invariants som editoren

En agent får aldri en svakere eller alternativ versjon av Slaids' regler.

Dette gjelder blant annet:

- minimumsstørrelse på soner;
- split-invariants;
- layoutnormalisering;
- innhold som må få plass;
- titteltekst som må få plass;
- citation-nummerering og dens effekt på fit;
- asset-invariants;
- referanseintegritet;
- destruktive operasjoner;
- schema-validering;
- optimistisk samtidighet.

Alle mutasjoner skal gå gjennom eksisterende domenekommandoer eller nye domenekommandoer som også kan brukes av UI-et.

Det skal **ikke** finnes en generell operasjon som:

```text
write_arbitrary_json
```

eller tilsvarende.

Agenten skal heller ikke måtte sende eller forstå intern `Presentation`-, `LayoutNode`- eller ProseMirror/Tiptap-JSON for vanlige arbeidsoperasjoner.

### Semantisk Agent Core

Agent Core eksponerer semantiske operasjoner som beskriver **hva agenten ønsker å gjøre**, ikke hvordan den interne datamodellen skal muteres.

Eksempler:

```text
list_presentations
get_presentation
create_presentation

set_cover
set_cover_color

inspect_slide
add_slide
move_slide
duplicate_slide
delete_slide
set_slide_title

split_zone
adjust_split
delete_zone

set_zone_text
set_zone_card
set_zone_asset
set_vertical_alignment

add_reference
update_reference
delete_reference

upload_asset
create_svg_asset

validate_slide
validate_presentation
```

Dette er en konseptuell liste, ikke et krav om at alle navn må bli nøyaktig slik. Den endelige kontrakten skal være liten, ortogonal og stabil.

Agent Core skal ikke gjenskape handlinger som allerede uttrykkes godt gjennom én eksisterende domenekommando bare for å gjøre API-listen større.

### Agentvennlig tekstformat

Vanlig tekstinnhold skal ikke kreve at agenten konstruerer `RichDoc` manuelt.

Agentkontrakten skal tilby et enkelt format for eksempelvis:

- avsnitt;
- punktlister;
- nummererte lister;
- fet/kursiv der dette støttes;
- citations koblet til reference-ID.

Agent Core oversetter dette til Slaids' interne rich-text-format.

Intern editorrepresentasjon er en implementasjonsdetalj. En senere endring av rich-text-editor skal så langt mulig ikke være en breaking change i agent-API-et.

### Identifikatorer og inspeksjon

Alle objekter en agent må kunne referere til senere, skal returnere stabile ID-er.

For eksempel skal `inspect_slide` gjøre det mulig å oppdage:

- slide-ID;
- tittelstatus;
- hele layouttreet;
- node-/sone-ID-er;
- hvilken innholdstype hver leaf har;
- beregnet geometri for hver sone;
- relevante subfield-ID-er;
- assets og referanser som brukes;
- fit-status der den kan beregnes.

En agent skal kunne:

```text
inspect_slide
→ velge zoneId
→ split_zone(zoneId)
→ inspect_slide
→ velge ny zoneId
→ set_zone_text(zoneId, ...)
```

uten å kjenne React-state eller DOM-elementer.

### Fit og innholdsmengde

Fit-reglene er en sentral del av agent-API-et.

En agent skal ikke måtte gjette om tekst får plass.

Headless agentkall skal bruke de eksisterende deterministiske fit-checkerne som domenekommandoene støtter. Dersom en operasjon gjør at innhold ikke lenger får plass, skal hele operasjonen avvises atomisk.

Ingen delvis mutasjon skal lagres.

Fit-feil skal være maskinlesbare og så langt mulig opplyse om:

- feilkode;
- slide-ID;
- zone-/node-ID;
- hva som ikke får plass;
- beregnet overflow;
- eventuelt andre relevante diagnostiske data.

Dette gjør iterative arbeidsflyter mulig:

```text
set_zone_text
→ CONTENT_DOES_NOT_FIT
→ agenten forkorter teksten
→ set_zone_text
→ OK
```

### Validering

Agent Core skal tilby eksplisitte read-only valideringsoperasjoner.

`validate_slide` og `validate_presentation` skal aldri reparere eller mutere noe automatisk.

De skal kunne rapportere blant annet:

- ugyldig struktur;
- innhold som ikke får plass;
- tittel som ikke får plass;
- manglende asset;
- ugyldig reference-ID;
- andre brudd på domenets invariants.

Et vellykket mutasjonskall erstatter ikke validering av helheten. En agent skal kunne be om en eksplisitt sluttkontroll etter at en presentasjon er bygget.

### Visuell feedback

Strukturell validering er nødvendig, men ikke tilstrekkelig for gode slides.

Agentarkitekturen skal derfor kunne utvides med rendret preview av én slide eller hele presentasjonen.

Målet er at en multimodal agent senere skal kunne:

```text
bygg slide
→ validate_slide
→ render_slide_preview
→ se preview
→ vurdere komposisjon
→ justere
```

Preview skal bruke Slaids' virkelige renderer og geometri, ikke en separat agentrenderer.

Dette trenger ikke implementeres i første Agent Core-versjon. Kontrakten skal imidlertid ikke utformes slik at visuell feedback senere blir vanskelig.

Bygget. Se «Status: hva som er bygget» → «Fase 5: rendret preview».

### Assets

Slaids skal lagre agent-assets på samme måte som assets lagt inn via editoren.

Binærdata skal fortsatt ligge utenfor `Presentation`-JSON og registreres gjennom vanlig `AssetRef`.

Agent Core skal bruke `SlaidsRepository` for assetlagring og eksisterende domenekommandoer for registrering og plassering.

Agenten skal kunne:

```text
upload_asset
→ assetId

set_zone_asset(zoneId, assetId)
```

Assetopplasting og plassering er separate operasjoner. Et opplastet asset skal derfor kunne gjenbrukes og inspiseres før det plasseres.

### Rasterbilder

**Slaids skal ikke generere rasterbilder selv og skal ikke integreres med en ekstern betalt KI-bildetjeneste.**

Det skal ikke finnes noen Slaids-operasjon av typen:

```text
generate_image(prompt)
```

som sender prompten videre til OpenAI, Anthropic eller en annen bildeleverandør.

Hvis en KI-agent allerede kan generere et bilde i sitt eget miljø — for eksempel direkte i en chat — kan agenten sende den ferdige bildefilen til Slaids med `upload_asset`.

Flyten er:

```text
agenten genererer eller skaffer bildet
              ↓
         upload_asset
              ↓
           assetId
              ↓
       set_zone_asset
```

Slaids er dermed **mottaker, validerer, lagrer og renderer** bildet, men er ikke bildeleverandør.

Første støttede rasterformater bør være:

- PNG;
- JPEG;
- WebP.

Andre formater legges bare til ved et konkret behov.

Ingen ekstern bilde-URL skal være den permanente representasjonen av et slide-asset. Hvis et bilde skal inngå i presentasjonen, skal Slaids eie en lagret kopi.

### Transport av rasterassets

Agent Core skal arbeide med binærdata, ikke med transportformatet.

Transportlagene kan representere samme operasjon forskjellig:

- REST bør bruke vanlig binær-/multipart-upload;
- MCP kan bruke en støttet fil/resource-mekanisme eller base64 når det er nødvendig og størrelsen er rimelig.

Agent Core skal ikke være bundet til base64.

Størrelsesgrenser og tillatte MIME-typer skal valideres serverside.

### SVG som førsteklasses agentformat

SVG er et spesielt viktig format for KI-agenter fordi en agent kan lage en presis figur direkte som tekst uten en separat bildegenerator.

Agent Core skal derfor ha en eksplisitt operasjon tilsvarende:

```text
create_svg_asset
```

med minst:

```text
name
svgMarkup
```

Resultatet er et vanlig `assetId`.

Typiske bruksområder:

- skjematiske figurer;
- prosessdiagrammer;
- piler og relasjoner;
- tidslinjer;
- molekyl-/farmakologiske prinsippskisser;
- enkle anatomiske illustrasjoner;
- graflignende forklaringsfigurer;
- andre vektorillustrasjoner.

SVG skal ikke få en egen parallell presentasjonsmodell. Etter opprettelse er det et vanlig Slaids-asset med `isVector = true`.

### SVG-sikkerhet

SVG er aktivt XML-innhold og skal behandles som potensielt utrygt input.

`create_svg_asset` skal derfor validere og sanitere SVG før lagring.

Minst følgende skal ikke tillates:

- `<script>`;
- event-handler-attributter som `onclick`;
- vilkårlig JavaScript;
- `javascript:`-URL-er;
- utrygge eksterne ressurser;
- mekanismer som kan brukes til å laste eller kjøre fremmed aktivt innhold.

SVG-en som lagres og senere rendres, skal være den saniterte versjonen.

Sanitisering skal ha eksplisitte tester med ondsinnede eksempler. Regex alene skal ikke brukes som komplett SVG-sanitizer.

### Persistens og atomisitet

En agentoperasjon skal oppføre seg som en brukerhandling:

```text
load
→ domain command
→ validation
→ save
```

Hvis domenekommandoen eller lagringen feiler:

- skal ikke en delvis ny presentasjon bli stående;
- skal feilen returneres maskinlesbart;
- skal agenten kunne bestemme neste handling.

Komplekse semantiske agentoperasjoner som internt krever flere domenesteg skal enten:

1. gjennomføres atomisk; eller
2. uttrykkelig eksponeres som flere separate agentoperasjoner.

Agent Core skal ikke skjule en halvferdig mutasjon bak én operasjon som ser atomisk ut.

### Samtidighet

Agent-API-et skal bevare den optimistiske samtidighetskontrollen fra repository-laget.

En agent må kunne oppdage at presentasjonen er endret siden den sist ble lest.

Nettverkskontrakten skal derfor ha en revisjons-/versjonsmekanisme som gjør stale writes eksplisitte.

Ved konflikt:

- nyere data skal aldri overskrives automatisk;
- agenten skal få en maskinlesbar konfliktfeil;
- agenten skal lese presentasjonen på nytt før den forsøker en ny mutasjon.

### REST

REST er det generelle programmatisk tilgjengelige grensesnittet.

REST-laget skal:

- autentisere agenten;
- validere input;
- konvertere transport-DTO til Agent Core-input;
- kalle Agent Core;
- konvertere resultatet til stabilt API-format.

Det skal ikke duplisere domeneregler.

REST skal være versjonert fra starten, for eksempel under:

```text
/api/agent/v1/
```

Breaking changes skal gi ny API-versjon eller eksplisitt migreringsstrategi.

### MCP

MCP-laget skal eksponere de samme semantiske operasjonene som tools.

For eksempel:

```text
slaids_list_presentations
slaids_get_presentation
slaids_create_presentation
slaids_set_cover
slaids_set_cover_color
slaids_inspect_slide
slaids_add_slide
slaids_split_zone
slaids_adjust_split
slaids_set_zone_text
slaids_set_zone_asset
slaids_add_reference
slaids_upload_asset
slaids_create_svg_asset
slaids_validate_slide
slaids_validate_presentation
```

MCP skal være en adapter over Agent Core, ikke en separat implementasjon.

Det skal være mulig å sammenligne samme operasjon via REST og MCP og få semantisk samme resultat.

### Autentisering av agenter

Agent-API-et skal ikke bruke brukerens innloggingspassord som API-hemmelighet.

Agenter skal bruke separate, revokerbare tokens.

Tokenmodellen skal støtte:

- tilfeldig, kryptografisk sterkt token;
- bare hash av token lagres serverside;
- navn/beskrivelse, slik at brukeren ser hva tokenet brukes til;
- opprettelsestid;
- eventuell utløpstid;
- tidspunkt for siste bruk;
- eksplisitt tilbakekalling;
- scopes.

Aktuelle scopes kan være:

```text
presentations:read
presentations:write
assets:write
sharing:write
```

Vanlig presentasjonsredigering skal **ikke** automatisk gi rett til å publisere/dele presentasjoner.

Siden Slaids er en énbruker-app, skal agenttokens fortsatt bare gi tilgang til Slaids-eierens data. Tokenmekanismen er en delegasjon fra eieren, ikke et nytt flerbrukersystem.

### Audit

Agentmutasjoner skal kunne skilles fra vanlige UI-mutasjoner i relevante serverlogger/auditdata.

Minst følgende bør kunne spores:

- token/agent-identitet uten å lagre selve tokenet;
- tidspunkt;
- operasjon;
- presentation-ID;
- suksess/feil;
- relevante feilkoder.

Sensitive slideinnhold, binærfiler og komplette API-payloads skal ikke logges ukritisk.

### API-resultater

Agentresultater skal være stabile og maskinlesbare.

Prinsipp:

```text
success
data
revision/version
```

eller:

```text
error
code
message
details
```

Domenets eksisterende typed feilkoder skal gjenbrukes der de beskriver feilen korrekt.

Menneskelesbar `message` er nyttig, men agenten skal kunne reagere korrekt kun fra `code` og strukturerte `details`.

### Implementeringsrekkefølge

Agent-API-et bygges trinnvis.

#### Fase 1 — Agent Core

Bygg og test det headless, transportuavhengige laget.

Minst:

- lese/liste presentasjoner;
- opprette presentasjon;
- inspisere slides;
- grunnleggende slideoperasjoner;
- layoutoperasjoner;
- tekstinnhold;
- referanser;
- plassere eksisterende assets;
- validering.

Ingen REST/MCP er nødvendig for å bevise dette laget.

#### Fase 2 — Assets

Legg til:

- raster-upload;
- `create_svg_asset`;
- sanitization;
- assetplassering og inspeksjon.

Ingen ekstern bildegenerering.

#### Fase 3 — REST og agentautentisering

Legg til:

- versjonert REST;
- revokerbare scoped tokens;
- concurrency;
- audit;
- binær asset-upload.

#### Fase 4 — MCP

Eksponer Agent Core gjennom MCP-tools.

Ingen domenelogikk flyttes til MCP-laget.

Bygget. Se «Status: hva som er bygget» → «Fase 4: MCP over den samme
inngangen».

#### Fase 5 — Visuell feedback

Legg til en måte å rendere en slide til et bilde/preview som agenten kan inspisere.

Bruk den virkelige Slaids-rendereren.

Bygget. Se «Status: hva som er bygget» → «Fase 5: rendret preview».

### Tester

Agent Core skal ha egne unit-/integrasjonstester.

Minst:

- opprett presentasjon uten React;
- bygg en enkel slide programmatisk;
- split og nested split;
- tekst som får plass godtas;
- tekst som ikke får plass avvises uten delvis mutasjon;
- tittel som ikke får plass avvises;
- ugyldig/stale ID gir maskinlesbar feil;
- inspeksjon returnerer ID-er og geometri som kan brukes i neste kall;
- domenets minimumsstørrelser kan ikke omgås;
- citation-endringer kan ikke omgå fit-guard;
- stale write overskriver aldri nyere versjon;
- rasterasset kan lastes opp og plasseres;
- gyldig SVG kan opprettes og plasseres;
- utrygg SVG avvises eller sanitiseres deterministisk;
- SVG med script/event handlers kan aldri rendres som aktivt innhold;
- ugyldig assetreferanse avvises;
- REST og MCP gir semantisk samme Agent Core-resultat for samme operasjon;
- scopes håndheves serverside.

For fase 5 i tillegg:

- en enkel slide kan rendres;
- en slide med flere soner og tekst gjengis, med sonene på nøyaktig de rect-ene
  geometrimotoren gir editoren;
- bilder og SVG-assets inngår korrekt, som den samme `<img>` editoren tegner;
- en fil lageret ikke har rapporteres framfor å mangle stille;
- ukjent presentasjon og ukjent side gir den eksisterende, handlingsbare
  feilsemantikken (`PRESENTATION_NOT_FOUND`, `SLIDE_NOT_FOUND` med sidene som
  finnes);
- `presentations:read` alene holder, og et ugyldig eller manglende token avvises
  fortsatt med det samme 401-et;
- REST og MCP peker på den samme underliggende previewfunksjonen, og svarer med
  de samme bytene og det samme strukturerte resultatet;
- MCP-resultatet valideres mot den offisielle SDK-en og inneholder faktisk
  visuelt innhold en agent kan konsumere – en `ImageContent`-blokk, ikke base64
  i en tekstblokk;
- preview-generering muterer aldri presentasjonen eller revisjonen;
- deployment-testen følger et binært previewsvar gjennom den kompilerte
  `vercel.json`-rutingen, og håndhever at nettleserbinærene er pakket med
  funksjonen;
- bundeltesten laster den deployede filen i vanlig Node, med
  `react-dom/server`, `puppeteer-core` og `@sparticuz/chromium` som eksterne
  importer Node må klare å løse, og sjekker at appens eget stilark faktisk ligger
  i den.

Og minst én integrasjonstest som kjører den ekte løkken: bygg en slide gjennom
MCP med den offisielle klienten over en ekte socket, legg inn tekst og en SVG,
hent previewet, og verifiser at det er en gyldig, ikke-tom PNG på 1600 × 900 med
mer enn én farge der innholdet ligger – og at bildet endrer seg når dekket gjør
det.

### Ferdigkriterium

Agentfunksjonen er ikke ferdig bare fordi en agent kan lage gyldig JSON.

En komplett agentarbeidsflyt skal til slutt kunne:

```text
opprette presentasjon
→ bygge slides
→ inspisere struktur og geometri
→ fylle innhold
→ legge inn referanser
→ laste opp bilde eller lage SVG
→ korrigere fit-feil
→ validere hele presentasjonen
→ inspisere rendret resultat
```

uten:

- React;
- museklikk;
- direkte databasetilgang;
- direkte mutasjon av intern JSON;
- leverandørspesifikk KI-kode i Slaids;
- ekstern betalt bildegenerering.

Hele løkken er nåbar, siste linje inkludert. `src/render/agentLoop.test.ts`
kjører den: den offisielle MCP-klienten over en ekte socket, mot en ekte
Chromium, og leser pikslene tilbake for å slå fast at bildet faktisk viser
sliden – og endrer seg når dekket gjør det.

### Status: hva som er bygget

Fase 1, 2, 3, 4 og 5 er på plass:

- `src/agent/` – Agent Core. `registry.ts` er katalogen og den ene veien inn
  (`runOperation` kaster aldri); `types.ts` er konteksten, konvolutten og
  feilkodene; `presentation.ts` er load → revisjonssjekk → domenekommandoer →
  save, med fit-sjekkerne som aldri utelates; `text.ts` er det agentvennlige
  tekstformatet; `assetStore.ts` er den ene veien et asset kommer inn;
  `operations/` er selve operasjonene.
- Lesing: `list_presentations`, `get_presentation`, `inspect_slide`,
  `list_assets`, `validate_slide`, `validate_presentation`.
- Lesing (forts.): `get_sharing`, `render_slide_preview`.
- Skriving: `create_presentation`, `set_cover`, `set_cover_color`, `add_slide`,
  `duplicate_slide`, `move_slide`,
  `delete_slide`, `set_slide_title`, `split_zone`, `adjust_split`, `delete_zone`,
  `clear_zone`, `set_zone_text`, `set_zone_card`, `set_vertical_alignment`,
  `add_reference`, `update_reference`, `delete_reference`, `upload_asset`,
  `create_svg_asset`, `set_zone_asset`.
- Ingen av dem inneholder domenelogikk. Manglet det en kommando, ble den laget i
  `src/domain/` og brukes av begge: `src/domain/validation.ts` (read-only
  invariantsjekk) og `src/domain/revision.ts` (revisjonen).
- Inndataskjemaene er strenge (`z.strictObject`). Et felt som ikke finnes er en
  feil, ikke noe som stille forsvinner – en skrivefeil i `expectedRevision` ville
  ellers vært en samtidighetssjekk som stille ikke skjedde.
- `src/domain/svg.ts` – en ekte parser, ikke regex, mot en allowlist, med
  reserialisering fra det parsede treet: det som lagres er bare det Slaids
  faktisk forsto. `UNSAFE_SVG` for det som prøver å kjøre eller hente noe,
  `INVALID_SVG` for det som ikke er en brukbar SVG.
- `src/domain/imageBytes.ts` og `src/domain/imageFile.ts` – to trinn, ikke ett:
  det første sniffer format ut av bytene, det andre går gjennom hele filen.

#### Validering er to spørsmål, ikke ett

Et filhode sier hva noe vil kalles. Det sier ingenting om at resten finnes: en
avbrutt nedlasting og åtte bytes PNG-signatur sniffer begge som bilder, og
lagrer man en av dem, får man en slide som viser et ødelagt bilde akkurat idet
noen presenterer. Derfor er sniffing (`imageBytes.ts`) skilt fra validering
(`imageFile.ts`), og et rasterasset lagres bare når hele filen er gått gjennom:

- **PNG** – chunk-kjeden med CRC per chunk, IHDR først, IDAT til stede, IEND
  sist, og ingenting etter.
- **JPEG** – markørkjeden, med entropidata skannet til neste ekte markør, SOF og
  SOS til stede og EOI på plass.
- **GIF** – blokk-kjeden med underblokker, minst én bilderamme, og
  avslutningsmerket.
- **WEBP** – RIFF-lengden mot filens faktiske lengde, chunkene gått gjennom
  (bildedataene er ikke første chunk i en fil med fargeprofil), og en chunk som
  faktisk bærer bildet: `VP8X` beskriver bare lerretet.

Størrelsen tas alltid fra bitstrømmen. Den er aldri en parameter kalleren
sender: en påstand om størrelse er ikke en verifikasjon av at filen er et
bilde, og et rasterasset med ukjent størrelse lagres ikke i det hele tatt.

Tre bevisste avvik fra teksten over, med begrunnelse:

- Rasterformatene er PNG, JPEG, GIF og WEBP. GIF er med for paritet med
  editorens opplastingsdialog og `.slaids`-import; to dører inn til det samme
  assetlageret skal ikke ha hver sin liste over hva som er lov.
- **AVIF gjenkjennes, men lagres ikke i agentveien.** Størrelsen ligger i en
  `ispe`-boks som hører til ett av flere items i containeren, og velger man feil
  item, får man feil størrelsesforhold. Til det er parset ordentlig, er nei
  bedre enn et bilde vi har gjettet formen på. Editoren tar fortsatt imot AVIF,
  fordi nettleseren dekoder det der.
- SVG saneres uansett hvilken dør den kom inn gjennom, ikke bare i
  `create_svg_asset`. En SVG lastet opp som fil er den samme filen som en SVG
  postet som markup, og skal møte de samme reglene.

#### CSS i SVG

`<style>` lagres ikke. Et CSS-dokument kan ikke valideres til den standarden
resten av sanitiseringen holder uten en ekte CSS-parser: `url` kan skrives med
escapes slik at bokstavene aldri står der, og funksjoner som `image-set()` tar
en URL som en ren streng uten `url()` rundt. Å etterligne en CSS-parser med
mønstre er hvordan det forrige hullet oppsto.

Elementet fjernes og rapporteres, slik alt annet denne filen ikke kan gå god
for behandles – ikke avvises. Illustrator, Inkscape, matplotlib og D3 legger
alle ved en `<style>`-blokk, og en fil fra verden skal fortsatt kunne lagres.
Prisen er at stilingen som lå der ikke overlever, og `report.removedElements`
er det som sier fra, slik at en figur som kommer tilbake ustylet aldri er en
stille overraskelse.

`style`-attributtet lever videre, med en verdikontrakt som kan håndheves: ingen
CSS-escapes, og bare funksjoner fra en allowlist – `url()` inn i samme dokument,
farge-, `calc`-, transform-, basisform- og filterfunksjoner. Alt annet avvises.
Attributter som holder tekst (`aria-label`, `id`, `class`, `lang`) leses ikke
som CSS i det hele tatt: «Figur f(x)» er en etikett, ikke et funksjonskall.
Vanlige figurer – fill, stroke, opacity, font, transform, interne gradients,
filters og clipPaths – er uberørt.

#### Registrering er to skrivinger

Filen lagres først, dokumentet som peker på den etterpå. En feilet andre
skriving er ikke bevis for at serveren ikke skrev: Supabase kan committe raden
og miste svaret på veien tilbake, og en tilbakerulling som stoler på feilen
sletter da bytes den lagrede presentasjonen allerede peker på.

Svaret leses, ikke antas: står assetet i den lagrede presentasjonen, landet
skrivingen, og filen blir stående; står det ikke der, er filen ubrukt og kan
fjernes; er presentasjonen borte, kan ingenting peke på filen; kan basen ikke
leses heller, beholdes filen, og id-en kommer tilbake i
`details.retainedAssetId`. En ubrukt fil koster lagring, en manglende fil som en
slide peker på koster sliden. Filen slettes uansett sammen med presentasjonen.

#### Transportkontrakten er ikke runtime-skjemaet

`upload_asset` tar imot base64, tekst, `Uint8Array` og `Blob` in-process. Bare
de to første kan ligge i en JSON-forespørsel, så det publiserte JSON Schema-et
beskriver bare dem; REST oversetter sin egen binære form til bytes før den
kaller inn. Skjemaet genereres med `unrepresentable: 'throw'`, slik at en type
som ikke lar seg uttrykke i JSON Schema stopper genereringen i stedet for å bli
publisert som et tomt `{}` som lover ingenting og godtar alt.

#### Tekstformatet er en grense, ikke en oversettelse

`src/agent/text.ts` er det eneste stedet ProseMirror/Tiptap-JSON møter
agentkontrakten. En agent sender navngitte blokker – `paragraph`, `heading`,
`quote`, `bullets`, `numbered` – med spans som er tekst, et linjeskift eller en
citation med reference-ID-er. Alt er Zod-validert, og objektene er strenge, så
en feilskrevet nøkkel er en avvisning og ikke et felt som ikke gjør noe.

Bevisst ikke markdown: en markdown-parser er en andre, uformell grammatikk med
egne kanttilfeller, og feilene den gjør er stille – feil struktur, ikke en feil.

To ting formatet ikke kan uttrykke, og hva som skjer med dem:

- **Struktur editoren kan lage og formatet ikke kan** – tabell, kodeblokk,
  innfelt bilde, nøstet liste. Lesing gir en `unsupported`-blokk som navngir
  noden og bærer teksten dens, slik at en agent ser at noe er der og at det ville
  bli erstattet. Den er ikke en del av det en agent kan *sende*: å finne på en
  skrivevei for en form formatet ikke modellerer er der stille ødeleggelse
  begynner.
- **Nummeret på en citation.** Citationen lagrer ID-er; nummeret utledes av
  første forekomst gjennom hele dekket ved rendring. En agent skriver ID-er og
  leser ID-er tilbake. Citationer som havner inntil hverandre slås sammen på vei
  inn, akkurat som i editoren, slik at det som måles er det som tegnes.

`href` er protokollbegrenset i selve skjemaet (http, https, mailto). Den statiske
rendereren lager en ekte `<a href>` av en link-mark, så en `javascript:`-lenke må
avvises før den blir et dokument – ikke etterpå.

Justering hører til linja, ikke til teksten, og følger derfor blokken: `align` på
et avsnitt eller en overskrift, og `align`/`titleAlign` på operasjonene som setter
en tittel. Utelates den, beholdes justeringen tittelen allerede hadde – en agent
som er bedt om å endre ordene har ikke bedt om å midtstille dem tilbake til
venstre.

#### Revisjon er ikke en ny lås

`src/domain/revision.ts` er en kort digest av dokumentet. `get_presentation`,
`inspect_slide` og enhver mutasjon svarer med den, og enhver mutasjon kan ta imot
den som `expectedRevision`.

Den erstatter ikke den optimistiske låsen i repository-laget og er ikke en andre
lås ved siden av den. De dekker to forskjellige vinduer:

- repositoryets `version`-guard dekker øyeblikket mellom lasting og skriving inne
  i én operasjon. Det er den som avgjør om en skriving lander.
- revisjonen dekker det mye lengre vinduet mellom at en agent *leser* og
  *bestemmer seg*. En agent kan inspisere en slide, tenke, og komme tilbake et
  minutt senere; dokumentet den resonnerte om kan være borte da, og ingen
  skrivetidssjekk kan se det, fordi selve skrivingen er utledet av en helt fersk
  lesing.

Derfor sammenlignes en oppgitt revisjon mot dokumentet som nettopp ble lastet,
før noen kommando kjøres, og en mismatch er `CONFLICT` framfor en overskriving.
Digesten regnes over dokumentet slik det *lagres* – nøkkelrekkefølge ignoreres,
og `undefined` behandles som JSON behandler det – slik at revisjonen en mutasjon
svarer med er den samme som neste lesing gir.

Selve skrivingen er i tillegg alltid låst mot revisjonen operasjonen leste, ikke
bare når kalleren ba om det: to samtidige agentkall kan begge passere sin egen
forhåndssjekk, og da er det skrivingen som må hindre at den andre lander oppå den
første. `SlaidsRepository.savePresentation` tar derfor en valgfri `SaveGuard`,
og begge implementasjonene måtte gjøre noe for å holde den:

- **Dexie** har ingen versjon å låse mot og sammenligner i stedet mot det lagrede
  dokumentet inne i den samme `rw`-transaksjonen som skriver. Uten transaksjonen
  er det ingen lås: begge kan lese, begge kan bli enige om at dokumentet er det
  de lastet, og den andre `put`-en vinner likevel.
- **Supabase** har en versjon, men *hvilken* versjon er hele poenget. Raden har
  én versjon, og `knownVersions` flytter seg framover på hver skriving. Det er
  riktig for editorens autolagring, som eier dokumentet og alltid lagrer det
  nyeste den har – og feil for en vaktet lagring: to operasjoner leser versjon 1,
  den første lagrer og etterlater kartet på 2, og den andre ville da voktet sitt
  versjon-1-dokument med versjon 2 og overskrevet den første. Guarden slås derfor
  opp mot versjonen *den navngitte lesingen* kom fra. En vakt en senere skriving
  kan friske opp, er ingen vakt.

Begge veier er den samme atomiske betingede skrivingen i basen – `.eq('version',
…)` i UPDATE-en, eller sammenligningen inne i IndexedDB-transaksjonen – aldri en
ubevoktet les-så-skriv. Editorens autosave skriver fortsatt ubetinget: den eier
dokumentet den redigerer.

#### Fit-feil er handlingsbare

En avvisning bærer `slideId`, `nodeId`, `overflow`, sonens `rect` og `subject`
(`zone-content` eller `slide-title`). Kommandoene fyller inn det de vet;
agentlaget fyller inn det bare kalleren visste, og overstyrer aldri en `rect`
kommandoen selv oppga: målte den mot en subsone som ikke finnes i dokumentet
ennå, er det den som gjelder, ikke sonen slik den står nå. Det er dét som gjør løkken
`set_zone_text → CONTENT_DOES_NOT_FIT → kortere tekst → set_zone_text` mulig uten
gjetting: overflow sier hvor mye som ikke fikk plass, rect hvor mye plass det var.

#### Atomisitet uten transaksjon

Domenekommandoer er rene: de tar en presentasjon og returnerer en ny. En
sammensatt operasjon som `set_zone_card` (konverter, del i subfelt, sett
korttittel, sett farge) kjeder dem i minnet med `applySteps` og lagrer én gang.
Feiler et hvilket som helst steg, ble ingenting lagret – ikke fordi det rulles
tilbake, men fordi det aldri ble skrevet.

#### Fase 3: REST, tokens, scopes og audit

`src/server/agent/` er transportlaget, og `api/agent/v1.ts` er Vercel-inngangen
til det – seks linjer som leser `process.env` og kaller inn. Alt som *bestemmer*
ligger i `src/server/agent/`, injisert inn i `handleAgentRequest`, slik at «REST
er tynt» er en egenskap ved koden: filen kan ikke nå en database, en klokke
eller en miljøvariabel på egen hånd.

```
GET  /api/agent/v1                    hva dette er, og hvor katalogen ligger
GET  /api/agent/v1/operations         katalogen, fra describeOperations()
POST /api/agent/v1/operations/<navn>  én operasjon
```

**Hvordan de tre adressene finner fram.** Filnavnet er hele ruten: én statisk
funksjon på `/api/agent/v1`, og alt under den kommer inn gjennom en eksplisitt
rewrite i `vercel.json` (`/api/agent/v1/:__slaidsPath*`). Det er ikke en
stilpreferanse. En `[...path]`-catch-all ble utvidet av plattformen, utenfor
repoets syn, og det den faktisk dekket var ett ledd: katalogen svarte, mens
`/api/agent/v1/operations/<navn>` fikk Vercels egen tekst-404 og aldri nådde
`serveAgentApi`. Ruting som står skrevet i repoet kan testes; ruting som utledes
av et filnavn kan bare observeres i produksjon.

En rewrite kan ikke bære ekstra ledd inn i en statisk funksjon, så den bærer dem
som en query-parameter – plattformens egen oppførsel for en `:param*`-kilde.
`agentApiUrl` i `src/routing.ts` setter adressen sammen igjen *og fjerner
parameteren* før ruting: query-strengen er operasjonsinput for en råopplasting,
og et felt plattformen la til ville blitt avvist av et strengt skjema.
`src/server/agent/deployment.test.ts` går den veien en adresse med to ledd
faktisk går –
`vercel.json` kompilert med Vercels egen `convertRewrites`, videre inn i
funksjonens URL, gjennom ruteren og ut som operasjonens eget svar.

Katalogen er ikke en andre, håndholdt kopi av kontrakten: navn, summary, JSON
Schema og `requiredScopes` kommer alle ut av operasjonene selv. Alt er `POST`,
også lesingene – argumentene er ett objekt med ett strengt skjema, og å dele dem
mellom query-streng og kropp ville gjort kontrakten til to kontrakter.

**Scopes ligger på operasjonen, ikke i transporten.** `defineOperation` krever
feltet, så en operasjon lagt til senere kan ikke arve «det minst privilegerte
tokenet har» ved å tie. `registry.test.ts` holder den andre halvdelen: en
mutasjon må be om et skrivescope, en lesing må ikke, og `sharing:write` tilhører
nøyaktig én operasjon. `handler.test.ts` genererer én test per operasjon per
påkrevd scope, så flaten er dekket den dagen den vokser.

`set_sharing` og `get_sharing` finnes fordi et scope som ikke gjelder noe ikke
er håndhevet. Publisering går gjennom den samme `SharingRepository` editoren
bruker, med den samme sanerte snapshotbyggeren, og publiserer dokumentet slik
det er *lagret* – en agentmutasjon er lagret før den svarer, så det finnes ingen
ulagret editor å komme foran. Uten en offentlig backend er svaret
`SHARING_UNAVAILABLE`, aldri en lenke som ser levende ut.

De to retningene er bevisst asymmetriske, og asymmetrien *er* sikkerheten.
Publisering er vaktet, fordi et snapshot er et bilde av én bestemt versjon.
Tilbaketrekking er det ikke: den leser ingenting og sjekker ingen revisjon, fordi
verken en `expectedRevision` som er blitt gammel mens agenten tenkte, eller et
dokument som ikke lar seg lese, skal kunne holde en offentlig lenke i live.
Repositoryet tar det samme valget, av den samme grunnen.

**Tokens.** 32 bytes fra plattformens CSPRNG, generert i eierens egen nettleser
og vist én gang; det som lagres er SHA-256. Ingen server holder noen gang et
brukbart token, heller ikke den som laget det. Oppslaget er en indeksert likhet
på hashen, så det finnes ingen hemmelighetssammenligning i JavaScript å lese
timing ut av — og ingen grunn til salt eller work factor, siden inndataene er
256 bit uniform tilfeldighet. Modellen ligger i `src/persistence/agentTokens.ts`,
delt mellom nettleseren som lager tokens og serveren som sjekker dem, fordi to
kopier av «hva er et token» er én kopi for mye.

Manglende, feilformet, ukjent, tilbakekalt og utløpt gir alle det samme 401-et
med den samme setningen. «Dette tokenet finnes, det er bare trukket tilbake» er
noe bare eieren skal få vite, og et endepunkt som sier det svarer på spørsmål på
vegne av den som stjal tokenet. Eieren får det i auditen i stedet.

**Auditen** er én rad per autentisert kall – alle, ikke bare operasjonene:
katalogoppslag (`index`, `catalogue`) og forespørsler til en ukjent adresse
(`unknown_route`) også, fordi et stjålet tokens første trekk er å spørre hva det
får lov til. Formen er lukket: `audit.ts` bygger raden, og hvert felt er en
skalar. Det finnes ingen vei fra en forespørselskropp til en
lagret rad, fordi ingenting her tar imot en. Tabellen har ingen kolonne
slideinnhold, filbytes eller payloads kan havne i – §44 ber om den
tilbakeholdenheten, og et skjema uten et sted å putte dem er hvordan den
overlever at noen har dårlig tid. Et *gjenkjent* token som avvises skrives ned
med grunnen (`TOKEN_REVOKED`, `TOKEN_EXPIRED`); et token ingen har sett før gjør
det ikke, siden det ikke er noen å tilskrive raden og en uautentisert skriving
er en måte å fylle noen andres tabell på.

**Binærtransport.** `multipart/form-data` parses av plattformens egen parser
(kroppen pakkes tilbake i en `Response` og `formData()` gjør jobben – en
håndskrevet multipart-parser er et format med flere kanttilfeller enn det ser
ut), og alt som ikke er JSON eller multipart er selve filen, med feltene i
query-strengen. Begge ender i `{ encoding: 'bytes' }` før Agent Core kalles.
Transportlaget har ingen liste over hvilke operasjoner som tar imot en fil:
sender du bytes til en operasjon uten `content`-felt, er det det strenge skjemaet
som sier nei.

**Statuskodene** er en total `Record` over hver eneste feilkode. En ny kode
stopper byggingen her til noen har bestemt hva den betyr over HTTP; en
default-gren ville stille svart `500` på en ny fit-feil, som en agent leser som
«serveren er ødelagt» i stedet for «forkort teksten». Skillet mellom `400` og
`422` er dét den er til for: «du sendte tull» mot «Slaids sa nei».

**Serverklienten holder en secret key og går forbi row level security.** Derfor
gjør `SupabaseSlaidsRepository` to ting når den er pinnet til en eier: `owner_id`
kommer fra pinnen i stedet for fra `auth.getSession()`, og hver spørring
filtreres på den. Filteret RLS ville lagt på må skrives ned når RLS er omgått,
ikke antas. I nettleseren finnes ingen pin, ingen filter legges til, og RLS er
fortsatt det eneste som bestemmer.

`readAgentApiConfig` nekter å starte hvis nøkkelen også finnes under et
`VITE_`-navn. Da ligger den allerede i nettleserbundelen, og det eneste riktige
svaret er å rotere den – ikke å starte som om den ikke gjorde det. Uten
konfigurasjon svarer API-et `503` og navngir variabelen som mangler: en server
har ingen IndexedDB å falle tilbake på, så det finnes ingen lokal modus å velge
stille.

#### Funksjonen deployes som én fil, ikke som kildetreet

Vercel kompilerer hver `.ts`-fil for seg og lar Node løse importene mellom dem.
TypeScript skriver modulnavn ut ordrett – det har aldri skrevet dem om – og
Nodes ESM-resolver har verken filtypegjetting eller index-oppslag. En
`api/`-fil som importerer `src/server/agent` direkte er derfor en fil som
typechecker, linter, består alle testene, deployer grønt, og svarer
`ERR_UNSUPPORTED_DIR_IMPORT` på hver eneste forespørsel. Å stave ut filnavnet
flytter bare feilen én import dypere ned, siden hele `src/` er skrevet
ekstensjonsløst.

`vite.agent-api.config.ts` bygger derfor Agent Core og REST-laget til én fil
uten en eneste relativ import igjen; bare `zod` og `@supabase/supabase-js` står
igjen som bare specifiers, som Node og avhengighetssporingen håndterer.
`scripts/check-agent-bundle.mjs` importerer resultatet i vanlig Node og kaller
det som en del av byggingen – nøyaktig den veien som var brutt – så feilen
stopper i byggingen i stedet for i produksjon.

`src/server/` importeres aldri fra resten av `src/`, og `boundary.test.ts`
håndhever det. Feilen ville vært stille: en import fra en UI-fil ville kompilert,
bestått hver test, og dratt hele operasjonsregisteret og statustabellen inn i
bundelen alle besøkende laster ned.

#### Fase 4: MCP over den samme inngangen

MCP ligger på `POST /api/agent/v1/mcp` – i den samme Vercel-funksjonen, bak det
samme tokenet, med den samme auditen. Ikke som en besparelse, men fordi alt over
autentiseringen faktisk *er* det samme; det som skiller begynner etterpå, og det
ligger i `src/server/mcp/`.

**Transporten er Streamable HTTP i revisjonen `2025-06-18`, tilstandsløs.** Én
JSON-RPC-melding per POST, svaret som `application/json` på den samme responsen.
Det som er utelatt er utelatt med vilje, ikke uferdig:

- **ingen SSE-strøm.** En server åpner en for notifikasjoner, progresjon og
  spørsmål den selv stiller. Slaids sender ingen av delene – hver operasjon er
  ett kall med ett svar – så en strøm ville vært en åpen forbindelse uten noe å
  si. `GET` svarer `405`, som er nøyaktig det spesifikasjonen ber om fra en
  server uten strøm.
- **ingen sesjon.** Ingen `Mcp-Session-Id` deles ut, så det er ingen å gjenoppta
  og ingen å avslutte (`DELETE` er `405` av samme grunn). Tokenet er identiteten
  på hver melding, og den eneste tilstanden mellom to kall – hvilken lesing en
  skriving er gjort mot – ligger allerede i presentasjonens `revision`. Det er
  dét som gjør endepunktet riktig på en plattform som kan svare på to meldinger
  fra to kalde instanser.
- **ingen batcher.** Fjernet fra protokollen i 2025-06-18-revisjonen. En array er
  derfor ikke en batch vi avslår, det er en meldingsform som ikke finnes lenger,
  og å si det er mer nyttig enn å kjøre det første elementet i den.

**Bare én revisjon annonseres, og det er den som er implementert.** Listen var en
stund lengre, og det var en feil snarere enn raushet: `2025-03-26` ville lovet en
klient at endepunktet tar imot JSON-RPC-batcher, som det avviser, og `2024-11-05`
ville lovet den gamle HTTP+SSE-transporten med et eget SSE-endepunkt og et eget
POST-endepunkt, som ingen av delene finnes her. En klient tror på det den får, og
går i gang med å bruke det. Så `negotiateProtocolVersion` svarer aldri med noe som
ikke står i `SUPPORTED_MCP_PROTOCOL_VERSIONS`, `MCP-Protocol-Version` valideres mot
den samme listen, og en manglende header leses som den ene revisjonen serveren har –
ikke som spesifikasjonens `2025-03-26`-fallback, som ville vært den samme løgnen én
gang til. En nyere klient forhandler seg ned; `interop.test.ts` viser den offisielle
klienten gjøre nøyaktig det.

**`Origin` valideres**, som Streamable HTTP krever mot DNS rebinding, og
valideringen er å avvise enhver forespørsel som bærer en.

Den nærliggende sjekken – sammenlign `Origin` med forespørselens egen vert – er
verdiløs her, og verre enn verdiløs fordi den ser ut som beskyttelse. I angrepet den
skal stoppe er *begge* sider angriperens: siden serveres fra `evil.example`, DNS-en
for `evil.example` peker om til denne serveren, og nettleseren sender da
`Host: evil.example` sammen med `Origin: https://evil.example`. De matcher, og
forespørselen slipper gjennom. En sjekk som sammenligner en forespørsel med seg selv
beviser ingenting om den; det betrodde settet må komme fra et sted angriperen ikke
styrer.

Det stedet er vanligvis en konfigurert liste. Slaids trenger ingen, fordi det ikke
finnes en browser-origin å betro: **en MCP-klient er et program, ikke en side.** Den
offisielle SDK-en over Node, Claude Desktop, en editor, et skript – ingen av dem
sender `Origin`, og ingenting i Slaids' egen nettleserapp snakker med dette
endepunktet i det hele tatt. Den ærlige listen er den tomme, og å avvise enhver
`Origin` er den listen håndhevet. Det er dessuten den ene formen uten en
konfigurasjon en deploy kan glemme å sette og dermed åpne hullet igjen. Sjekken
kjører før kroppen leses, så en side aldri når en operasjon, langt mindre en som
skriver.

**Verktøykatalogen er operasjonskatalogen.** `mcpTools()` bygger den av
`describeOperations()`, den samme funksjonen REST-katalogen kaller: navn,
beskrivelse, JSON Schema og scopes er operasjonens egne. Prefikset `slaids_` er
et navnerom, ikke en del av navnet – en klient holder alle serveres verktøy i én
flat liste – og det bare navnet løses opp like godt, siden det er registeret som
avgjør hva som finnes. Annotasjonene utledes: `readOnlyHint` er `!mutates`, og
`openWorldHint` er usann fordi hver operasjon rører eierens egne dekk og ingenting
annet. `destructiveHint` er bevisst utelatt: å skille en sletting fra en
innsetting ville krevd et felt som ikke finnes på operasjonene, og å finne det opp
her som en liste over navn er nøyaktig den andre kontrakten dette laget er bygget
for å unngå.

Testen som bærer det er ikke at listene stemmer i dag, men at det ikke **finnes
ett eneste operasjonsnavn som streng** i `src/server/mcp/`. En håndskrevet liste
ville bestått den første testen og strøket på denne – og den ville uansett blitt
oppdaget først den dagen den manglet en ny operasjon.

**Paritet er én funksjon, ikke to nøye skrevne adaptere.**
`src/server/agent/invoke.ts` holder alt som skjer mellom «en kaller navnga en
operasjon» og «Agent Core svarte»: `authorizeOperation` (finnes den, og har
tokenet scopene den krever) og `performOperation` (kjør, og løft revisjonen ut av
svaret). Begge transportene kaller de to, i den rekkefølgen. Delingen i to er ikke
ryddighet: REST sjekker scopes *før* den leser kroppen, slik at en uautorisert
kaller ikke kan få serveren til å bufre megabyte for seg, mens MCP allerede har
argumentene når den kjenner verktøynavnet – de kom i den samme meldingen.
`parity.test.ts` går gjennom hver eneste operasjon over begge veier og
sammenligner svarene.

**En avvisning et verktøy kom fram til, er et resultat.** Manglende scope, stale
revisjon, noe som ikke finnes og innhold som ikke får plass kommer tilbake som et
verktøyresultat med `isError: true` og hele feilobjektet i
`structuredContent.error`, med den samme koden REST ville gitt. Det er dét som gjør
at modellen ser `CONTENT_DOES_NOT_FIT` og hvor mye som ble til overs, og kan korte
ned teksten – der en JSON-RPC-feil i de fleste klienter blir «verktøykallet feilet»
med det nyttige i et hjørne.

Streken går ved **om et ekte verktøy fikk bestemme**, ikke ved hvor alvorlig feilen
er. Et verktøy som ikke finnes (`UNKNOWN_OPERATION`) og argumenter som ikke passer
verktøyets publiserte skjema (`INVALID_INPUT`) er ikke noe Slaids veide og avslo –
ingenting kjørte, og ingenting kunne ha kjørt – så de er JSON-RPC-feil, sammen med
uparsbar JSON, en ukjent metode, en batch og `id: null`. Referanseimplementasjonen
klassifiserer nøyaktig de to første som `InvalidParams`, og å trekke streken et annet
sted ville gjort et skjemabrudd til noe som så ut som en vurdering. Feilobjektet er
det samme uansett – i `structuredContent.error` eller i `error.data` – så koden en
agent forgrener på er den samme begge veier og over begge transportene.
`NEVER_A_VALID_CALL` i `src/server/mcp/server.ts` er den ene listen som avgjør det.

**Konvolutten og metodenes parametre valideres hver for seg.** `jsonrpc.ts` svarer på
«er dette en velformet melding?», som er alt JSON-RPC har en mening om; MCP har mer.
`initialize` uten `clientInfo` er en gyldig JSON-RPC-forespørsel og en ugyldig
MCP-håndhilsning, og en `cursor` som er et tall er en klient som ber om side to og
ville fått side én av en server som bare ignorerte den. Så `requests.ts` leser hver
metodes parametre før noe dispatches, og en refusjon er en verdi der også.
`requests.test.ts` bruker spesifikasjonens egne skjemaer som orakel: alt leserne
godtar, godtar `@modelcontextprotocol/sdk` også.

**Auditen skiller ikke på transport.** Et `tools/call` skrives ned under
operasjonens eget navn, med statusen feilkoden ville hatt over HTTP – en
`CONFLICT` er 409 i auditen uansett hvilken vei den kom – så begge transportene
kan leses i én spørring, uten en ny kolonne og uten en migrasjon. Bare
protokolltrafikken har egne navn (`mcp:initialize`, `mcp:tools/list`).

**Protokollen er skrevet for hånd, og SDK-en er testens orakel.**
`@modelcontextprotocol/sdk` er en devDependency, aldri en runtime-avhengighet:
serversiden av den bygger på Nodes `IncomingMessage`/`ServerResponse`, mens
plattformen her gir en web-`Request` og venter en `Response`, og en tilstandsløs
Streamable HTTP-server er noen få titalls linjer uansett. Men en protokoll skrevet
for hånd er en protokoll validert mot vår egen lesing av spesifikasjonen, og det
er nøyaktig det som kan være galt. Så `interop.test.ts` starter en ekte
HTTP-server og kjører den offisielle klienten mot den: den validerer hver melding
mot spesifikasjonens egne skjemaer, så et feilformet `initialize`-svar eller et
verktøyskjema som ikke er et objekt stopper der i stedet for i den første
klienten noen prøver.

Til slutt: `scripts/check-agent-bundle.mjs` bygger verktøykatalogen inne i den
deployede bundelen, i vanlig Node, som en del av byggingen. Katalogen genereres
først når en klient spør, med `unrepresentable: 'throw'` – så en operasjon hvis
input ikke lar seg uttrykke i JSON Schema ville typechecket, deployet grønt og
svart 500 på den aller første `tools/list`. Nå stopper den i byggingen.

#### Fase 5: rendret preview

`render_slide_preview` gir en agent et PNG av én side i dekket, tegnet slik et
publikum ser den. Det er den ene tingen strukturell validering ikke kan svare
på: `validate_slide` sier om en slide er *lovlig*, ikke om den er god – om
blikket lander riktig, om et kort er knøttlite ved siden av nabokortet, om en
figur er beskåret på en måte tallene er helt fornøyde med. Løkken §44 ber om er
derfor `bygg → validate_slide → render_slide_preview → se → juster → rendre på
nytt`, og den er nå kjørbar.

**Det er den virkelige rendereren, ikke en til.** Markupen kommer fra
`DeckPageView` – den samme komponenten presentasjonsmodus, den delte visningen
og filmstripen tegner – inne i den samme `SlideRenderProvider`
`PresentationPlayer` bygger, under appens egne stilark, importert med `?inline`
fra `src/styles/`. Det finnes ingen geometri, ingen typografi, ingen fit-regel og
ingen layout i previewlaget: en regel som legges til i `slide.css` i morgen er i
previewet i morgen, uten at noen husker å oppdatere noe. `src/render/document.tsx`
eier bare *siden rundt* sliden, altså det nettleseren ellers får fra `index.html`
og `main.tsx`.

**Rasteriseringen er en ekte Chromium**, og alternativene ble vurdert og forkastet
med samme begrunnelse hver gang. En vektorrasterizer (resvg) kan ikke tegne HTML
i det hele tatt. En HTML-til-SVG-layoutmotor (satori, og dermed `@vercel/og`)
forstår et utsnitt av flexbox og ingen stilark, så previewet måtte uttrykkes på
nytt som inline-stiler den kjenner – som er nøyaktig den «separate
agentrendereren» §44 forbyr, og nøyaktig den som stille slutter å stemme med
editoren. Og å måle tekst uten en shaper er hvordan et preview ender med å være
uenig med fit-reglene det skal illustrere. Nettleseren er prisen for ekte visuell
paritet.

**`puppeteer-core` + `@sparticuz/chromium`, som vanlige avhengigheter.** Ingen
nedlasting ved kjøring, og ingen konfigurasjon på Vercel: pakken bærer sin egen
Chromium og pakker den ut i funksjonens `/tmp`. Binærene er brotli-blober som
leses via en sti utledet av `import.meta.url`, så *ingen importgraf nevner dem* –
`@vercel/nft` pakker JavaScript-en og ikke nettleseren, og resultatet ville
typechecket, bygget, deployet grønt og svart «the input directory does not exist»
på hver eneste preview. Derfor står de eksplisitt i `vercel.json`
(`includeFiles`), og `deployment.test.ts` håndhever det. Nettleseren gjenbrukes
per varm instans og startes på nytt hvis den er borte; å starte en per
forespørsel ville vært det meste av forespørselen.

**Driveren og nettleseren er pinnet sammen.** `puppeteer-core` er bygget mot én
bestemt Chrome-build, og `@sparticuz/chromium` *er* Chromium-versjonen – og følger
uttrykkelig ikke semver, så breaking changes kommer på patch-nivå. Ingen av pakkene
sjekker den andre, og et avvik feiler verken ved install, bygg eller oppstart: det
feiler på den CDP-kommandoen de to versjonene er uenige om, i produksjon, på én
kodevei. Det skjedde her én gang – `puppeteer-core@25.10.0` (Chrome 152) mot
Chromium 149, tre majorer fra hverandre, med alle tester grønne. Begge er derfor
pinnet uten `^`, og `browserVersions.test.ts` følger kjeden hele veien:
`package.json` → driverens eget mål → den installerte pakken → binæren, som blir
spurt hva den er. Den siste lenken er den som ikke kan diskuteres.

**Fontene hentes her, ikke i nettleseren.** Det opplagte – legge appens eget
`<link rel="stylesheet">` i dokumentet – virket, og kostet **tolv sekunder per
bilde**: en headless Chromium i en serverless-container henter stilarket og hvert
subset over en kald forbindelse, på hver side, fordi en sides HTTP-cache ikke er
noe neste invokasjon kan regne med. `src/render/fonts.ts` henter dem i stedet i
denne prosessen, én gang per varm instans, og baker dem inn som `data:`-URL-er.
Det tok tiden ned til rundt en tiendedels sekund – og gjorde en rendring
uavhengig av om en fontjeneste er nåbar i det øyeblikket. Bare
`fonts.gstatic.com` hentes fra: stilarket er et svar utenfra som navngir URL-er å
hente, som er formen på en request forgery, og en allowlist er svaret som ikke
er avhengig av at svaret oppfører seg. En familie som ikke kan hentes lenkes i
stedet, og `fontsReady: false` sier hva som skjedde framfor å fotografere
reservefonten i stillhet.

**Dokumentet henter ingenting og kjører ingenting.** Ingen script-tagg, statisk
markup, innbakte fonter, og en lagret SVG tegnet gjennom en `<img>` fra en
`data:`-URL – nøyaktig som i appen, så den kan ikke kjøre der heller. Bildene er
hentet *før* markupen bygges, fordi `renderToStaticMarkup` ikke kjører effekter:
en `useEffect`-basert URL-oppslag ville gitt et preview med «Laster figur …» der
figuren skulle vært. Det er dét `AssetUrlSource.resolveSync` er til for, og
`src/state/assetSources.ts` finnes fordi de to kildene nettleseren bruker drar
inn hver sin lagringsmekanisme – som ikke har noe å gjøre i modulgrafen til en
renderer som bare tegner en slide.

**Agent Core er fortsatt React-fritt.** Rendereren injiseres, på samme måte som
repositoryet og fit-sjekkerne: `src/agent/preview.ts` sier hva et preview *er*,
`AgentContext.preview` er der det kommer inn, og `src/render/` er
implementasjonen. En installasjon uten renderer svarer `PREVIEW_UNAVAILABLE` –
aldri et bilde av ingenting, og aldri en nest beste renderer som var lettere å
lenke. `PREVIEW_FAILED` er den andre halvdelen: nettleseren finnes, og dette
forsøket gikk galt. To koder fordi det er to forskjellige neste trekk.

**`src/server/` importerer `src/render/` fra nøyaktig én fil** –
`src/server/agent/index.ts`, deployment-sømmen der alle de andre injeksjonene
også blir virkelige. Hullet i veggen er med vilje, og `boundary.test.ts` spikrer
det til én fil og én retning: appen importerer aldri `src/render/`, og
`puppeteer-core` finnes ingen andre steder i `src/`. Klientbundelen er byte for
byte den samme som før fase 5.

**Bildet på ledningen er én verdi og to serialiseringer.** Operasjonen svarer med
et `AgentImage` – bytes, media-type og pikselstørrelse – og
`detachImage` i `src/agent/image.ts` deler svaret i «det JSON kan bære» og
«bildet». Den kalles fra `performOperation`, altså den ene funksjonen begge
transportene deler, så «det ligger et bilde i dette svaret» avgjøres én gang for
begge:

- **REST** svarer med bildet: `200`, `Content-Type: image/png`, bytene som
  kropp, og operasjonen og revisjonen i `X-Slaids-*`. Et par hundre kilobyte
  base64 inne i en konvolutt kalleren må pakke opp igjen er ikke en tjeneste. Hele
  det strukturerte svaret er ett `Accept: application/json` unna, med bildet som
  base64 i feltet operasjonen la det i – så ingenting en agent kan lese over MCP
  er utilgjengelig over REST.
- **MCP** svarer med en `ImageContent`-blokk, som er base64 pluss en media-type.
  Det er *den* blokken en klient gir videre til en multimodal modell; de samme
  bytene limt inn i en tekstblokk er en halv megabyte tegn den leser som tegn.
  `structuredContent` beskriver bildet og gjentar det ikke: bytes der ville vært
  en andre kopi i alt som logger JSON. `interop.test.ts` kjører den offisielle
  SDK-en mot en ekte socket, så blokkens form valideres mot spesifikasjonens eget
  skjema framfor mot vår lesning av den.

**Previewet er en lesing.** `presentations:read` alene holder, ingenting lagres,
og revisjonen svaret bærer er den lesingen bildet viser – så en agent kan rendre,
tenke, og skrive mot den samme revisjonen uten å bli fortalt av sitt eget
skjermbilde at den er utdatert. Auditen får én rad under operasjonens eget navn,
og radformen er fortsatt lukket: det finnes ingen kolonne bildet kunne havnet i.

**Adresseringen er `presentationId` + `slideId`**, der `slideId` er en slide,
`__cover__` for forsiden, eller id-en til en avledet referanseside – oppslaget
går mot `deckPages`, den samme sidemodellen presentasjonsmodus blar gjennom. En
id som ikke finnes gir `SLIDE_NOT_FOUND` med id-ene som *finnes*, slik
`inspect_slide` gjør. QR-siden er ikke med: den finnes bare mens delingen er på,
og `get_sharing` er det som svarer på om den gjør det.

**`scale`** er piksler per logisk enhet, `1` som standard (1600 × 900, det
publikum ser). Lavere er knappen som betyr noe for en agent, fordi et bilde er
tokens; hele skaleringen er rasterizerens `deviceScaleFactor`, så layouten skjer
alltid i det designrommet Slaids er definert i og bare samplingen endrer seg. En
CSS-transform ville i stedet lagt ut sliden i én størrelse og strukket resultatet,
som ikke er det noen ser.

Én kjent skjevhet å rette: editorens opplastingsdialog lagrer fortsatt en SVG en
bruker velger uten å gå gjennom `domain/svg.ts`. Dører inn til assetlageret bør
på sikt være én dør.

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

Supabase-persistens og personlig innlogging er nå på plass. REST/MCP-agent-API kommer etter at selve editorparadigmet er bevist i praksis.

> **Oppdatert:** første fase er nådd, og flere skiver er lagt oppå den uten at
> domenemodellen ble skrevet om: Supabase som primær persistens (§ 43), deling
> som publisering av en skrivebeskyttet kopi (§ 43.5), og agent-API-et (§ 44) i
> sin helhet – Agent Core, REST med tokens og scopes, MCP over den samme
> inngangen, og rendret preview en agent kan se på, tegnet av Slaids' egen
> renderer.
