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
>
> **Oppdatert:** mobilredigering var et ikke-mål i første fase og er det ikke
> lenger. Slaids er fortsatt desktop-først, men ikke desktop-eksklusivt: den
> samme domenemodellen, geometrien og de samme kommandoene betjenes fra en
> kompakt arbeidsflate når vinduet er for lite til tre permanente kolonner – se
> § 44.5. Det ble ikke laget en egen mobil presentasjonsmodell, og ingenting av
> dette rørte dokumentformatet.

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
| Auth              | Supabase Auth             | Én fast personlig Slaids-bruker i Slaids' eget Supabase-prosjekt |
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
- Alle vekter er **hele tall mellom 1 og 10**. En lagret layout inneholder
  aldri desimaler, 0, negative tall eller tall over 10; ønsker som ikke er det
  kvantiseres til nærmeste lovlige forhold før de måles og lagres. Se §11.5.
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

Splitting stoppes når geometri gjør resultatet ubrukelig — og «ubrukelig»
avhenger av hva sonen skal inneholde, ikke av ett globalt tall.

### Minstemålet er innholdstypens

Det finnes ingen felles minstestørrelse alle blader må klare. Domenet svarer i
stedet på ett spørsmål, i `src/domain/contentSize.ts`:

> Kan denne innholdstypen tegnes i dette rektangelet?

- **Negativt rom** (§7.1) har ingen minstestørrelse. Det tegner ingenting, så
  ingen rektangel er for lite for det.
- **En tom sone** — `content: null` — har heller ingen. Den tegner heller
  ingenting; forskjellen på de to er hva de *betyr*, ikke hvor små de kan være.
- **Tekstbærende typer** (`container`, `untitled-card`, `titled-card`) trenger
  bredden en linje løpende tekst er lesbar i, og høyden av sitt eget krom pluss
  én linje: kortpadding, og for et kort med tittel også tittelfeltets høyde.
  Høyden er derfor avledet av temaets tokens og vokser med skriftstørrelsen.
- **Bildetyper** trenger flaten et bilde fortsatt er et bilde i.

De to tallene som er skjønn og ikke aritmetikk står igjen som tokens:

```ts
export const MIN_TEXT_WIDTH = 180
export const MIN_IMAGE_SIZE = 120
```

En foreslått split kan bare committes dersom hvert nytt leaf-/subtree-rektangel
er gyldig for det innholdet det faktisk har. Nye, tomme barn begrenser derfor
ingenting, og en split i luft er lovlig ved ethvert forhold stigen kan uttrykke.
Én ting gjelder uansett innhold: en split med `n` barn trenger plass til sine
`n - 1` mellomrom, ellers har barna ingen lengde i det hele tatt.

Hvis valgt sone har innhold, måles mottakerbarnet både mot innholdstypens
minstemål (`ZONE_TOO_SMALL`) og mot `canFit()` (`CONTENT_DOES_NOT_FIT`). De to
er ulike feil fordi de har ulik reparasjon: større sone, eller kortere tekst.

Den samme regelen brukes av layout- og ratio-kommandoene, innholdsvelgeren i
alle flater, drag/placement-targets, `validateSlideGeometry` og Agent Core. Det
finnes ingen egen implementasjon for editoren og en annen for agenten.

---

## 7.1\. Negativt rom

Bevisst luft er et designgrep, ikke en ugyldig layout. Innholdstypen
`negative-space`:

- har ingen tekst, filer, subfelter eller annen payload — det er definisjonen,
  ikke en utelatelse;
- tegner ingenting, hverken i editoren eller i presentasjonen;
- har ingen minstestørrelse og kan være vilkårlig liten.

**Tom sone og negativt rom er to forskjellige ting.** En tom sone (`content:
null`) er et hull forfatteren ennå ikke har fylt: editoren tilbyr
innholdsvelgeren i den, og `inspect_slide` rapporterer `empty: true`. Negativt
rom er en beslutning: velgeren er borte, og agenten leser
`contentKind: 'negative-space'`. De skilles overalt på om det finnes et
innholdsobjekt — aldri på hva sonen tilfeldigvis tegner.

Å konvertere innhold *til* negativt rom er den ene konverteringen som ikke kan
ta noe med seg. Den avvises derfor når sonen har noe å miste; «Tøm sone» parkerer
innholdet i sandkassen først, og den tømte sonen kan så gjøres til luft.

Å legge til innholdstypen krevde ingen migrasjon: ingen lagret dokument endrer
form, og et lagret tomt blad er fortsatt `content: null`.

---

## 8\. Tittelsone

Den opprinnelige visjonen beskrev tittelen som innholdsdrevet i høyde. Dette skaper ustabil geometri og bør unngås.

Tittelsone skal derfor være deterministisk:

- én linje;
- fast fontstørrelse;
- fast line-height;
- høyde = nøyaktig én linjeboks av sin egen type (`titleZoneHeightFor`);
- ingen manuelle linjeskift;
- ingen individuell fontformatering;
- tekst som ikke får plass skal ikke kunne committes;
- citations kan tillates i tittelen.

Høyden er bevisst *ikke* et eget tall. En sone høyere enn linjen ville lagt slark
over og under teksten som ingen har valgt: sliden ville lest som om den hadde én
avstand over tittelen og en annen overalt ellers. Å utlede den fra typografien
gjør dessuten «større tekst havner aldri i en boks bygget for mindre» sant ved
konstruksjon, i stedet for ved at to konstanter holdes i takt.

Det som blir igjen mellom glyfene og kanten av boksen er fontens egen
half-leading — noen få piksler, og en egenskap ved skriftsnittet snarere enn en
avstandsbeslutning. `TITLE_LINE_HEIGHT` ligger like over den største summen av
ascent og descent i fontkatalogen, så en aksent eller en underlengde aldri
klippes.

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

## 8.5\. Seksjoner og forsiden

En **seksjon** er en slide som åpner en del av dekket: en stor overskrift og en
valgfri underoverskrift i fargede piller, og de to fargene alt etter den tegnes
i. Den er en `Slide`, men ikke en med soner:

```ts
type SectionSlide = {
  id: string
  kind: 'section'
  title: TitleDoc
  subtitle: TitleDoc
  /** Piller her, og standardfargen for overskrifter fram til neste seksjon. */
  accentColor: string
  /** Sidefargen for denne siden og hver slide fram til neste seksjon. */
  backgroundColor: string
}

type Slide = ContentSlide | SectionSlide | InteractiveSlide
```

(Den tredje sorten, en miniapp fra én HTML-fil, er § 8.7.)

**Første slide er alltid en seksjon**, og det er dekkets forside. Det er ikke en
regel en kommando må huske: `slides` har typen

```ts
type DeckSlides = readonly [SectionSlide, ...Slide[]]
```

så «alle presentasjoner har en forside» er en egenskap ved typen, ikke ved
disiplinen til hver enkelt kommando. Den ene veien fra en vanlig liste til
`DeckSlides` er `asDeckSlides` i `src/domain/deckSlides.ts`, og hver kommando som
setter inn, fjerner eller stokker om slides ender der. Skjemaet stiller det
samme spørsmålet én gang på lagrede dokumenter, så en kastet `as Presentation`
etter en godkjent parse er en konstatering og ikke et håp.

Forsiden kan derfor godt slettes – så lenge seksjonen etter den overtar som
forside. Regelen er formulert om *resultatet*, ikke om posisjon 0, fordi «drop
den første delen av dekket» er noe en forfatter mener. `canDeleteSlide` er den
samme koden stilt som et spørsmål, slik at søppelbøtta i filmstripen og
kommandoen svarer det samme.

### De to linjene

- **Overskriften** settes i nøyaktig samme størrelse som en slide-tittel
  (`TITLE_FONT_SIZE`), slik at dekket åpner i typografien det fortsetter i.
- **Underoverskriften** settes ett hakk under (`SECTION_SUBTITLE_FONT_SIZE`) –
  et hakk, ikke en annen slags tekst – og er **valgfri**.
- Begge er **alltid horisontalt midtstilt**, og de er **samlet vertikalt
  midtstilt**. En seksjon med bare overskrift midtstiller derfor den ene linjen,
  og en med begge midtstiller paret; ingen av delene er skrevet ned noe sted, de
  faller ut av `justify-content: center` på siden. Midtstillingen er heller ikke
  et valg som lagres: `titleExtensions` fjerner justeringsattributtet helt, så
  det finnes ingen annen tilstand å havne i – heller ikke via paste eller et
  API-kall.
- Hver linje er **én linje**, som en tittelsone: tekst som ikke får plass
  avvises, den klippes aldri. `computeSectionGeometry` eier bredden hver linje
  faktisk har (siden minus pillens egen polstring), og både fit-porten og
  `max-width` på pillen leser den samme.
- En seksjon kan **ikke sitere**. Et citation-nummer utledes av første forekomst
  blant *innholdsslidene*, så en citation her ville tegnet en tom pille.
  `CitationExtension` er derfor ikke med i seksjonens skjema.
- En linje uten tekst tegner **ingen pille** når dekket vises. I editoren tegnes
  begge: den tomme pillen *er* plassholderen, og det eneste det går an å klikke
  på før en underoverskrift finnes.

### Fargene arves av slidene fram til neste seksjon

Hver side hører til seksjonen foran seg, og tegnes i dens to farger. Hvilken
seksjon som styrer en gitt side er noe bare dekket vet – som et citation-nummer,
eller hvor full fremdriftsindikatoren er – så det utledes én gang av siderekka
(`deckSectionColors` i `src/domain/pages.ts`) og ligger i `SlideRenderContext`.
De avledede sidene til slutt fortsetter den siste seksjonen: det er der leseren
er når de kommer dit.

- **`backgroundColor`** er sidefargen. Den lå før i temaet, som ett tall for hele
  dekket; den er en seksjons nå, av samme grunn som aksentfargen er det – et dekk
  leses som en rekke deler, og en del er det en forfatter fargelegger.
- **`accentColor`** maler pillene her, og er samtidig standardfargen for de
  pilleformede overskriftene, kortheaderne og bildetekstene i innholdet.

Det avgjørende er hva «bruker standardfargen» betyr. Det betyr **ikke** at
overskriften har samme hex-kode som seksjonen. Det betyr at ingen har valgt en
farge for den:

- en overskrift uten valgt farge lagrer **ingen** farge (`color: null`), og
  males av `--slaids-heading-pill`, som settes fra seksjonens `accentColor`;
- en overskrift som *har* fått en farge lagrer den, og beholder den.

Derfor treffer en fargeendring på en seksjon hver eneste overskrift i dens del av
dekket som følger standarden – også de som lages senere – uten at ett eneste
lagret dokument endres, og uten at noe av dette kan angres bort som en
dokumentendring. Alternativet, å skrive standardfargen inn i dokumentet, ville
gjort «ikke valgt» og «valgte akkurat denne blåfargen» til det samme dokumentet,
og da kunne ingen av dem følge seksjonen igjen.

Migrasjonen til v8 gjør nøyaktig dette for dokumenter som allerede finnes: en
lagret farge som er *nøyaktig* den gamle standarden fjernes (den var aldri et
valg), alle andre farger står urørt.

### En ny seksjon arver den forriges farger

`addSection` tar fargene fra seksjonen foran innsettingspunktet når kalleren ikke
oppgir dem. En forfatter som vil holde samme uttrykk gjennom hele dekket får det
ved å ikke gjøre noe; en som vil ha et nytt uttrykk bytter to fargeprøver.
Overskriften måles på vei inn – absolutt, som enhver annen plassering: en
seksjon som ikke fantes for et øyeblikk siden har ingen forrige tilstand å
regrediere fra.

### Å opprette et dekk er også en redigering

Forsidens overskrift starter som dekkets navn. Da er navnet ikke lenger bare
metadata i biblioteket – det er en linje som tegnes – og et navn som ikke får
plass på én linje ville blitt lagret som en klippet forside, i en tilstand den
aller neste redigeringen av den linjen ville avvist.

`createPresentation` forblir derfor en ren fabrikk (lasting, migrering og
import skal aldri stoppes av en fit-regel), mens kommandoen `createDeck` er
formen de to stedene et menneske eller en agent lager et dekk av tekst de nettopp
skrev. Den måler forsiden absolutt og avviser med samme feilkode som en for lang
slide-tittel.

### Migrering: v12 → v13

Forsiden var før et felt (`cover`) ved siden av `slides`, og bakgrunnsfargen ett
tall i temaet. Migrasjonen flytter begge inn i seksjonen den lager som dekkets
første slide, og gir hver eksisterende slide `kind: 'content'` – som er det de
alltid var. Ingenting ved et migrert dekk ser annerledes ut; det som endret seg
er hvor fargen kan endres fra.

---

## 8.6\. Fremdriftsindikator

Hver side unntatt forsiden har en fremdriftsindikator, og den er **obligatorisk**.
Forsiden er dekkets første slide, så «unntatt forsiden» er «unntatt den første
siden» – senere seksjoner er sider i flyten som alle andre og har en indikator.

At den ikke kan slås av er ikke en forenkling, det er hele poenget. Et valg
ville betydd at et dekk kunne bygges uten den og få den på etterpå – og da
mister hver eneste slide en stripe med plass de allerede er fulle av, på en
gang, uten at noen har redigert dem. Er den alltid der, reserverer
geometrimotoren stripen én gang, før noe innhold er plassert, og spørsmålet kan
ikke oppstå.

Formen er en lav stripe i bunnen av sliden:

```text
[ title zone ]
G
[ main zone  ]
G
[▓▓▓▓▓▓▓░░░░░]   ← PROGRESS_BAR_HEIGHT, helt ut til begge kanter
```

- Full slidebredde, helt inntil bunnkanten: ingen luft under og ingen på
  sidene.
- Nøyaktig én luft over seg, og det er dekkets eget gap. Reservasjonen i
  `computeMainRect` er derfor `PROGRESS_BAR_HEIGHT` og ikke
  `PROGRESS_BAR_HEIGHT + G`: gapet over den er bunninnrykket innholdsområdet
  allerede hadde.
- Høyden er en tykkelse og ikke en avstand mellom to ting, så `spacing` skalerer
  den ikke – på samme måte som den ikke skalerer en kortradius eller en
  skillestrek.
- En beholder i seksjonens aksentfarge med 30 % opacity, og en voksende del i den
  samme fargen med full opacity. De to er søsken i DOM-en, ikke forelder og
  barn: `opacity` gjelder for hele gruppen, så en voksende del inni en beholder
  på 30 % ville selv blitt 30 %.
- Rund i den enden som vokser, rett i den den vokser fra. Ingen skygge, ingen
  tall, ingen tekst.
- Den voksende delen beveger seg til sin nye posisjon over 600 ms med
  `ease-in-out` i stedet for å hoppe dit.

Hvor langt ut i dekket en side er, er noe bare dekket vet – nøyaktig som et
citation-nummer – så det ligger i `SlideRenderContext` ved siden av
`numbering`, utledet av `deckProgress(deckPages(...))`. Komponenten slår det opp
selv, så et kallsted sier bare *hvilken side* den tegner.

Indikatoren henger i sidens egen boks (`DeckPageView`), ikke inne i sliden. Det
er dét som holder den montert gjennom et sidebytte: sidetypene er forskjellige
komponenter, så React bytter ut selve visningen når dekket går fra siste slide
til QR-siden – og en indikator som fulgte med ville vært et nytt element uten
noen forrige bredde å animere fra. Nøyaktig det sidebyttet ville hoppet.

Tellingen følger sidene, ikke de lagrede slidene: **forsiden telles ikke**, den
første vanlige sliden er side 1, og den siste siden er full – uansett om det er
en vanlig slide, en referanseside eller QR-siden.

---

## 8.7\. Interaktive slider (miniapper)

En **interaktiv slide** viser én selvstendig miniapp fra én HTML-fil som
forfatteren laster opp. Publikum ser en forside i dekkets design – navnet,
merkingen «Interaktiv miniapp» og knappen «Aktiver miniapp» – og appen kjører
først når noen trykker på knappen, i en ramme som fyller slideflaten. «Avslutt
miniapp» øverst til høyre tar den ned igjen. Slaids kjører aldri filen selv:
ikke i miniatyrer, ikke på en server, ikke i en eksport.

### Modellen

```ts
type InteractiveSlide = {
  id: string
  kind: 'interactive'
  /** Det forsiden viser. */
  name: string
  /** Filnavnet, som tekst. */
  fileName: string
  /** Hele filen, som UTF-8-tekst. Lagres som data, kjøres aldri av Slaids. */
  html: string
  /** Designkontrakten filen ble skrevet mot. Se «Designkontrakten» under. */
  styleContract: InteractiveStyleContract
}

type Slide = ContentSlide | SectionSlide | InteractiveSlide
```

Ingen soner og ingen layouttre: sliden er ikke en `ContentSlide` med et tomt
tre, den er en tredje sort. `mapDeckSlides` i `src/domain/deckSlides.ts` krever
en gren per sort, så hvert sted som tidligere antok «ikke seksjon ⇒ innhold»
måtte si hva det mener om en interaktiv slide, og kompilatoren sier fra neste
gang en sort kommer til. Forsiden er fortsatt en seksjon (§ 8.5); en interaktiv
slide kan aldri stå først, og `withSlides` avviser det for enhver kommando.

Duplisering gir en kopi med ny id og samme navn, filnavn og kilde; sletting og
flytting er `deleteSlide` og `moveSlide` som for enhver annen slide. Fit-vakten
(`src/domain/commands/fitGuard.ts`) måler ingenting på den – det er ingen tekst
et fonttrinn kan dytte ut av en boks, og sliden kan ikke sitere – og det er
skrevet ned i vaktens kommandoliste som en bevisst utelatelse, ikke en glemt.
Geometrimotoren ser den aldri.

### Filen: hva som godtas

Én dør, `src/domain/interactive.ts`, for opplastingsdialogen, panelets «Erstatt
HTML-fil» og agentoperasjonene, så hva Slaids godtar ikke avhenger av hvem som
spør. Alt i den er datavalidering: filen dekodes og måles, aldri parses til et
dokument, aldri evalueres.

- **Én `.html`-fil**, etter navn, uansett hvordan endelsen er skrevet.
  `File.type` brukes ikke; navnet er en høflig sjekk som stopper feil fil før
  den leses, innholdet er det som valideres.
- **UTF-8**, dekodet strengt. Et UTF-8-merke hoppes over; en UTF-16-fil
  gjenkjennes på merket og avvises med beskjed om å lagre som UTF-8; en fil som
  ikke er gyldig UTF-8 (en Latin-1-eksport, et omdøpt binærformat) avvises i
  stedet for å lagres med hvert tegn som ikke lot seg lese erstattet.
- **Ikke tom**, ingen NUL-byte, og minst ett element (`<` fulgt av en bokstav
  eller `!`). Det er ikke en parse og ikke en sikkerhetssjekk: det fanger en
  tekstfil med feil navn før den blir en blank slide.
- **Innenfor grensen** `MAX_INTERACTIVE_HTML_BYTES` (2 MiB), målt i byte av
  UTF-8 på teksten som faktisk lagres – aldri `string.length`, som teller
  UTF-16-enheter og ville sluppet en fil av trebytetegn gjennom tre ganger for
  stor. Skjemaet måler det samme på lagrede dokumenter.
- **Innenfor budsjettet** `MAX_INTERACTIVE_HTML_TOTAL_BYTES` (tre filers verdi,
  6 MiB) for hele dekket, spurt *før* noe lagres. En utskifting måles med
  slidens egen kilde holdt utenfor. `findPresentationIssues` rapporterer
  `INTERACTIVE_BUDGET_EXCEEDED` på et dokument som likevel er over.
- Navn og filnavn trimmes, må ha innhold og er begrenset til 200 tegn. De vises
  som tekst, aldri som markup.

**Den samme døren gjelder et lagret dokument.** En `.slaids`-backup skrives
like lett for hånd som av Slaids, og importen går gjennom `migratePresentation`
rett til `repository.savePresentation` — uten å innom en eneste kommando. Derfor
stiller `validatePresentation` de samme spørsmålene om hver interaktive slide et
dokument holder (`storedInteractiveRefusal`), og om budsjettet for hele dekket,
i samme åndedrag som layouttre-invariantene. Reglene er ikke gjentatt der: det
er den samme funksjonen kommandoene kaller, spurt om det som allerede står
lagret. Et dokument som holder en slide kommandoene ville avvist, åpner ikke —
og blir dermed heller aldri lagret. `findSlideIssues` rapporterer det samme som
`INTERACTIVE_SOURCE_INVALID`, så `validate_presentation` finner det også.

Å passere døren sier at filen *kan lagres*. Det sier ingenting om hva appen
gjør når publikum starter den, og ingenting i modulen er en påstand om at filen
er trygg. Dialogen sier det samme til forfatteren, i fire setninger: alt appen
trenger må ligge i filen; den kjører bare etter «Aktiver miniapp» og starter på
nytt hver gang; hele kilden følger med når presentasjonen deles; aktiver bare
filer du stoler på.

Grensene mot transportene, og hvordan grensen faktisk holdes: agent-API-ets
standard kroppsgrense er 4 MiB (`src/server/agent/config.ts`), og Vercel tar
4,5 MB per forespørsel. En fil sendt som JSON-strengen `html` *escapes* på veien
— et anførselstegn, en omvendt skråstrek og et linjeskift blir to byte hver, et
kontrolltegn seks — så en fil på 2 MiB kan bli over 4 MiB som JSON. Å heve den
interne grensen løser det ikke, siden plattformen har sin egen.

Derfor tar `add_interactive_slide` og `set_interactive_slide` filen på begge
måter, gjennom nøyaktig den samme tagged union som `upload_asset`: `html` som
JSON-streng, eller `content` som fil — base64 eller tekst over JSON, og rå bytes
over REST, der kroppen *er* filen og feltene ligger i query-strengen. Ingenting
escapes da, så en fil på grensen trenger en kropp på grensen, og grensen Slaids
annonserer er en agenten faktisk kan nå. Bytene dekodes av den samme døren som
opplastingsdialogen bruker (streng UTF-8, BOM hoppet over, UTF-16 avvist ved
navn). Nøyaktig én av de to per kall: en forespørsel som bar filen to ganger,
har sagt to forskjellige ting. `REQUEST_TOO_LARGE` navngir veien som virker.

Når kroppen er filen, ligger de andre feltene i query-strengen — som tekst.
Transporten gjetter ikke typer på noens vegne; den vet ikke hvilken operasjon
som spurte etter hvilket felt, og en transport som gjettet ville vært en andre,
løsere grammatikk ved siden av skjemaene. Feltet sier det derfor selv, ett sted:
`index` tar et heltall eller sifrene i ett (`wholeNumberSchema`), så en fil som
*må* sendes som rå kropp fortsatt kan settes inn der den skal. Den publiserte
kontrakten er fremdeles et tall — det er hva en JSON- eller MCP-kaller sender,
og hva som kommer ut uansett vei.

Dokumentet lagres som én rad i Supabase, og budsjettet holder hele dokumentet
godt under det som er praktisk å autosave og publisere som snapshot.

### Kommandoene

`src/domain/commands/interactive.ts`: `addInteractiveSlide` (fil → navn →
budsjett → innsetting; en avvisning oppretter ingenting), `setInteractiveSlideName`
og `setInteractiveSlideHtml` (fil og filnavn sammen; id, plass og navn beholdes;
en avvisning gir det samme objektet tilbake, så appen som lå der beholdes).
Alle tre går gjennom `withSlides` og er vanlige, angrbare redigeringer. Sone- og
tittelkommandoer avviser sliden som `NOT_A_CONTENT_SLIDE`.

### Forside og kjøretid er to ting

`InteractivePageView` er forsiden: statisk markup i seksjonens farger og temaets
type — navnet, midtstilt, og én grønn, kvadratisk play-knapp med et inline
SVG-ikon under det. Ikke mer: en forside er det publikum ser mens noen bestemmer
seg for å starte appen, så den sier det ene de trenger og tilbyr det ene de kan
gjøre. Filnavnet hører til den som redigerer, og står i panelet. Knappen er grønn
og ikke seksjonens aksent, fordi «trykk her for å starte» er ett av få steder der
farge betyr noe før man har lest noe. Den tegnes av `DeckPageView` overalt en
side tegnes – filmstripen, scenen,
spilleren, den rendrede previewen, en eksport. Ikke én byte av appen er i den.
Knappen er en ekte `<button>` bare der en *aktivering* er gitt gjennom
`InteractiveActivation`-konteksten; ellers tegnes den samme formen inert
(`aria-hidden`). Om et render kan starte kode avledes altså aldri fra
`isStatic`, `pointer-events` eller hvor pekeren er: det er om treet har fått en
aktivering, og nøyaktig én komponent deler dem ut.

`InteractiveSlideSurface` er den komponenten. Den monteres to steder:
`PlayerPage` i `PresentationPlayer` – og dermed også i den delte visningen, som
er samme spiller – og `InteractiveStage` på editorens scene, så forfatteren kan
prøve appen der den redigeres. Miniatyrer, den skrivebeskyttede scenen og
serverens preview monterer den aldri.

Hver aktivering er en ny økt med egen nøkkel, så React bygger en ny
`InteractiveRuntime` og en ny ramme: appen starter på nytt hver gang, og ingen
tilstand fra en forrige kjøring finnes noe sted – ingenting av kjøretiden
lagres, autosaves, deles eller angres. Økten husker slidens id og kilde, og er
avledet «ikke lenger i live» i det sliden bytter fil under den (en utskifting,
en angring). Å forlate presentasjonen, bytte slide eller modus avmonterer
flaten, og med den rammen. Ved avslutning fjernes `<iframe>`-elementet – aldri
bare skjult – som er det som stopper appens dokument og hver timer i det;
fokus går tilbake til «Aktiver miniapp».

### Designkontrakten: hva appen arver

En miniapp kjører i en ramme nettleseren holder helt atskilt fra Slaids — ingen
delt origin, ingen delt DOM, intet delt stilark. Uten videre ville den derfor
blitt tegnet i nettleserens standarder: Times New Roman på hvitt, midt i et dekk
satt i Quicksand på mørkeblått. Slaids gir den i stedet dekkets design **som
data**, i den ene formen som krysser grensen: CSS-tekst, skrevet inn i
dokumentet Slaids bygger rundt filen.

Tre deler, i denne rekkefølgen, foran filen:

1. **Fontene.** `@font-face`-regler der hver fontfil ligger inne som en
   `data:`-URL. Rammen får ikke hente noe — det er hele poenget med den — så
   fontene må ankomme *som* dokumentet. Motoren er `src/fonts/inlineFaces.ts`,
   trukket ut av `render/fonts.ts`: den samme henteren, den samme
   gstatic-allowlisten og den samme cachen som den hodeløse
   previewrendereren bruker, slik at de to ikke kan bli uenige om hvilke vekter
   en familie har. Flaten ber om dem når *forsiden* monteres, ikke når noen
   trykker play, så de normalt er der lenge før. Og skulle noen rekke å trykke
   først, venter aktiveringen på svaret i stedet for å starte: rammen kan ikke
   hente en font selv, så en kjøring som begynte uten dem, beholder feil skrift
   så lenge den varer. Både forespørselen og svaret er nøklet til fontparet de
   hører til, slik at et fontbytte i dekket ikke kan besvares med forrige temas
   ansikter — et dokument der variablene navngir én familie og
   `@font-face`-reglene bærer en annen, ville falt tilbake uten å kunne hente
   forskjellen. Ventingen har to tak — henterens egen frist, og et kort tak på
   selve trykket — så et nett som ikke svarer, forsinker ingenting mer enn et
   øyeblikk. En familie som ikke kan hentes, utelates: variabelen
   navngir hele stakken, så appen faller tilbake nøyaktig som dekket gjør. En
   lokal font (Calibri, Segoe UI) hentes ikke — den er maskinens eller ingen,
   som ellers i Slaids.
2. **Variablene.** `:root`-erklæringer med de effektive fargene for *denne*
   sliden — den styrende seksjonens — og dekkets fontroller, typeskala og mål.
   Verdiene er dekkets egne tall fra `themeMetrics` og `constants.ts`, så en
   miniapp og sliden ved siden av er satt i samme type i samme størrelse.
   Lengder er i designrommets piksler: rammen *er* slidens 1600 × 900-boks.
3. **Basisstilarket.** Slaids' egen CSS for vanlig semantisk HTML, skrevet bare
   mot variablene. En app som er en overskrift, et avsnitt og en knapp ser ut
   som en del av dekket uten én linje CSS. Bare elementselektorer, og forfatterens
   `<style>` leses etter det, så én klasse i appens CSS slår hva som helst i det.

Alt dette er `src/domain/interactiveStyle.ts` (kontrakten) og
`src/ui/interactive/documentStyle.ts` (sammensetningen for én kjøring). Ingen ny
tillatelse trengs: `style-src 'unsafe-inline'` tillater reglene og
`font-src data:` tillater fontene, som begge allerede sto i policyen.

**Ingenting av dette skrives inn i forfatterens fil.** Stilen bygges ved
aktivering og kastes med rammen, så en omfarget seksjon eller en ny dekkfont slår
gjennom neste gang appen startes — uten at noe lagret er endret og uten noe for
angre å gå tilbake gjennom. Den fanges samtidig *med* kjøringen: en font som blir
ferdig lastet, eller en seksjon noen farger om mens appen kjører, bygger ikke
dokumentet på nytt under en app som er i gang.

#### Versjonert, fordi den er publisert

En app har ekte CSS som avhenger av hva variablene heter og av hva en ustilet
`<button>` ser ut som. Å endre noen av delene under en app som allerede finnes,
ville vært å endre appen. Derfor er kontrakten versjonert, og versjonen lagres
på sliden (`styleContract`, i dag `1`).

Kompatibilitetsstrategien er hele poenget med feltet: en endring en eksisterende
app kunne merke, blir en *ny* versjon. v1-arket blir stående nøyaktig som det er
og serveres videre til hver slide som står på `1`; en slide flyttes bare hvis
noen flytter den. Å legge til en versjon er ett tall i
`INTERACTIVE_STYLE_CONTRACTS`, ett ark i registeret ved siden av det, og en
migrasjon bare hvis den *lagrede* formen endres. Migrasjonen v14 → v15 satte
`styleContract: 1` på slidene som fantes fra før.

`docs/INTERACTIVE_MINIAPPS.md` er kontrakten i prosa for dem som skriver appene,
og `get_interactive_contract` er den som data for en agent som heller vil spørre.

### Låsen

`src/state/interactiveRuntime.ts` er ett faktum alle navigasjonshåndterere spør
om: kjører en miniapp nå? `InteractiveRuntime` holder låsen nøyaktig så lenge
rammen er montert. Spillerens tastatur-, klikk- og sveipehåndterere og
editorens tastatur- og hjulhåndterere står da av – piler, Space, PageUp/Down,
Home/End, klikk for neste side, Ctrl+E, F5, Ctrl+Z – uten `preventDefault`, så
Space og Enter på Slaids' egen avslutt-knapp fortsatt er et trykk på den.
Escape avslutter ikke presentasjonen mens appen kjører; «Avslutt miniapp» er
den ene veien ut, og den ligger utenfor rammen, over den, tegnet i skjermstørrelse
uansett slidens skalering.

Kontrollen er liten å se på og ikke liten å treffe, og det er to forskjellige
mål med vilje. Det synlige er en diskret «×» i øvre høyre hjørne – det eneste
som dekker appen – mens treffflaten rundt den er usynlig og større, og større
igjen på en coarse flate, der tallet er det felles `--touch-target`. Det
tilgjengelige navnet er fortsatt «Avslutt miniapp»; hover, tastaturfokus og
trykk gjør den utvetydig, og trykk fordi en finger ikke kan hovre;
safe-area-insets holder den innenfor skjermen. Hvilken peker som er i bruk
avgjøres ett sted (§ 44.5.2) – miniappsystemet har ingen egen deteksjon.

### Isolasjonsgrensen

Opplastet HTML er aldri Slaids' egen markup. Den lastes som data inn i en ramme
nettleseren holder atskilt fra siden rundt, og `src/ui/interactive/sandboxDocument.ts`
bygger den rammens dokument. Det er sikkerhetsgrensen, sagt på ett sted og
testet som data.

To rammer, ikke én:

- **Apprammen** holder filen, med `sandbox="allow-scripts"` og ingenting mer:
  opak origin (ingen tilgang til Slaids' lagring, økt eller DOM), ingen
  skjemaer, popups, toppnavigasjon, modaldialoger, nedlastinger, pekerlås,
  fullskjerm. `referrerpolicy="no-referrer"`, og en Permissions Policy som
  nekter kamera, mikrofon, geolokasjon, skjermdeling, betaling, USB, MIDI,
  utklippstavle og resten ved navn. Dokumentet bærer en Content Security Policy
  som nekter alt som utgangspunkt og tillater nøyaktig det en selvstendig fil
  trenger: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
  img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none';
  object-src 'none'; frame-src 'none'; worker-src 'none'; manifest-src 'none';
  form-action 'none'; base-uri 'none'`. Ingen nettverk: ikke `fetch`, XHR,
  WebSocket, beacon, eksternt skript, stilark, font, bilde, ramme, objekt eller
  worker; ingen `eval`; ingen `<base>`.
- **Innpakningen** er et lite dokument Slaids skriver selv, sandkasset likt, og
  apprammen er dens barn. Den finnes for den ene regelen appens egen policy
  ikke kan uttrykke: hvilke adresser apprammen får *navigere til*. `connect-src`
  stopper forespørsler, ikke navigasjoner, og en rammes egen `frame-src` sier
  ingenting om rammen selv – men *forelderens* gjør det. Innpakningens
  `frame-src 'none'` får nettleseren til å nekte hver navigasjon av apprammen –
  `location`, en lenke, et skjema, `<meta refresh>`, til internett eller til
  Slaids' egen origin – før forespørselen lages. Chromium viser deretter sin
  egen blokkeringsside i rammen; appen er borte, og «Avslutt miniapp» er veien
  tilbake.

Policyen står foran innholdet: et `srcdoc`-dokument arver forelderens policy,
så apprammen kjører under innpakningens policy fra første byte, før noe av
filen er parset, og kopien i appdokumentets eget `<head>` kan bare stramme
inn. Filen kan ikke løsne noe: en `<meta>` kan legge til en policy men aldri
lempe på en, `<base>` avvises av `base-uri 'none'`, og filens egne
`<meta http-equiv>` havner i `<body>` der parseren overser dem. Filen legges
inn som en escapet attributtverdi i innpakningens markup – det ene stedet
upålitelig tekst går inn, med den komplette escapingen for den konteksten – og
innpakningen settes som `srcdoc` på rammen Slaids monterer, som en egenskap,
ikke serialisert inn i noe. Aldri `innerHTML`, `dangerouslySetInnerHTML`,
`document.write` eller `eval`; aldri en URL på Slaids' origin som serverer den
opplastede filen; ingen `postMessage`-bro, ingen meldingslyttere, ingen token,
tilstand eller repository-tilgang i rammen.

Det som *ikke* beskyttes, sagt like tydelig: dette er ikke en nettverksbrannmur
– en `<link rel=preconnect>` kan fortsatt åpne en forbindelse som ikke bærer
noe, og nettleserens DNS er nettleserens; CPU, minne og lyd isoleres ikke; og
det er ikke et vern mot en feil i nettleserens sandkasse- eller
CSP-implementasjon. Det er nettleserens egen isolasjon, konfigurert så stramt
som en selvstendig app tillater. Chromium logger «Potential permissions policy
violation» i konsollen for hver funksjon `allow`-attributtet nekter; det er
kosmetisk, og e2e-vaktene ser bort fra det. Firefox og WebKit har ikke vært
kjørt i utviklingsmiljøet (se «Tester»).

### Migrering: v13 → v14 → v15

v14 endret ingen lagret data; versjonen finnes for at et dokument med en
`interactive`-slide aldri skal åpnes av en klient som ikke kjenner sorten.
v15 setter `styleContract: 1` på hver interaktive slide — den kontrakten alt som
finnes, ble skrevet mot — slik at neste endring i standard-CSS kan la dem være.
Skjemaet avviser en ukjent `kind`, en ukjent kontraktversjon, og en kilde,
et navn eller et filnavn kommandoene ville avvist.

### Lagring, deling og statisk rendering

Kilden er et felt i JSON som alt annet: begge lagringsmodusene, `.slaids`-
sikkerhetskopi og import, duplisering og reload bevarer den byte for byte uten
å kjøre den. Det publiserte snapshotet tar den med – det er det deling *er* for
denne sorten, og dialogen sier det. Eldre presentasjoner og snapshots åpner som
før. Den rendrede previewen (§ 44), miniatyrer og enhver eksport tegner
forsiden: ingen `<iframe>`, ingen `<script>`, ingen byte av kilden.

Agentflaten: `get_interactive_contract` (`presentations:read`) svarer med
kontraktversjonen, variabelnavnene — lest av tokenene selv, ikke listet ved siden
av dem — flatestørrelsen, grensene og hva sandkassen nekter, så en agent kan
oppdage at typen finnes og hva den skriver mot uten å kjenne en eneste font eller
farge.

Variablene er den lette halvdelen. Den som stille går galt er layout — en
høydekjede som ikke er avgrenset, flere konkurrerende rulleflater, en
avstandsskala funnet opp per element — og ingenting av det synes på det første
skjermbildet. Kontrakten svarer derfor også med `layout`, de obligatoriske
strukturkravene som tekst (én tydelig rot, avgrenset høydekjede,
`box-sizing: border-box`, `html, body` uten default-marger, nøyaktig én navngitt
vertikal rulleflate med `min-height: 0` og `overflow-y: auto`, at `overflow-x`
ikke er et bevis på at innholdet har plass, én eier per avstand gjennom
`--slaids-gap`/`--slaids-padding`/`--slaids-block-spacing`, panelbasert og
balansert hovedinnhold, og friplassen til «Avslutt miniapp»), og med `starter`,
de samme reglene som det minste skallet som følger dem. En agent på den andre
siden av MCP har ingen utsjekking å lese, så reglene leveres i stedet for å
henvises til.

Begge feltene er **additive forfatterdata og bumper ikke `styleContract`**.
Versjonen over beskytter runtime-CSS-en og tokenene en app som alt finnes kunne
merke; en regel eller et skall som beskriver hvordan en *ny* fil bør skrives,
endrer ingen lagret app. Sannhetskilden er `INTERACTIVE_LAYOUT_RULES`,
`INTERACTIVE_STARTER_SKELETON` og `INTERACTIVE_EXIT_CLEARANCE` i
`src/domain/interactiveStyle.ts`; `docs/INTERACTIVE_MINIAPPS.md` peker dit i
stedet for å kopiere dem, og eksemplene i `examples/interactive-miniapps/`
måles mot skallet.

`add_interactive_slide` og `set_interactive_slide` (begge
`presentations:write`) går gjennom nøyaktig de samme kommandoene, så en agents
fil møter den samme døren som et menneskes. `get_presentation` og
`inspect_slide` beskriver sliden med navn, filnavn og `htmlByteSize` – aldri
kilden – og `render_slide_preview` tegner forsiden.

### Editoren

`+ Interaktiv` under `+ Slide` og `+ Seksjon` i filmstripen. Dialogen tar én
fil (velg eller dra), viser navn og størrelse, foreslår filnavnet uten endelsen
som navn, viser avvisningen der den står og oppretter ingenting før filen har
passert og «Opprett» er trykket; avbryt oppretter ingenting. Sliden settes inn
etter gjeldende slide, som en vanlig slide. Panelet ved scenen gir nytt navn og
bytter fil (en fil som avvises beholder appen); begge er angrbare. Statuslinjen
kaller den «Interaktiv».

### Tester

Enhet: `src/domain/interactive.test.ts` (endelse, navn, dekoding, NUL,
elementkrav, bytegrense i UTF-8, budsjett),
`src/domain/interactiveStyle.test.ts` (variablene er dekkets egne tall og
seksjonens farger, de to fontrollene, basisarket som bare leser variabler og
bare bruker elementselektorer, ett ark per versjon, strukturreglene som sier
rulle-, høyde-, avstands- og box-sizing-kravene direkte, skallet som følger sine
egne regler med nøyaktig én rulleflate og uten egne farger eller fontstørrelser,
og eksemplene som fortsatt bærer skallets bærende regler),
`src/ui/interactive/documentStyle.test.ts` (fonter som `data:`-URL-er uten noe
igjen som peker på en vert, ingenting hentet for en systemstakk, tom CSS når en
font ikke kan hentes, rekkefølgen fonter → variabler → basisark),
`src/domain/commands/interactive.test.ts`
(innsetting og forsideregelen, navn, atomisk utskifting som gir samme objekt ved
avvisning, budsjett med og uten egen slide, duplisering som ikke kan sprenge
budsjettet, et dekk over budsjettet som fortsatt kan redigeres ned,
flytting/sletting, sonekommandoer), skjema og migrering, delingssnapshot, invariantsjekken,
Dexie og `.slaids`-rundtur byte for byte, store-oppførsel,
`src/ui/interactive/sandboxDocument.test.ts` (policyen som data, rekkefølgen,
escapingen, én ramme og ett skript uansett fil), `src/agent/interactive.test.ts`
(operasjonene, avvisninger med kode, ingen kilde i lister eller inspeksjon,
scopes, kontrakten som data med variabelnavn lest av tokenene selv og med
strukturreglene og startskallet levert direkte, filen sendt
som `content` i stedet for som JSON-streng), `src/render/document.test.tsx` (previewen er forsiden),
`src/ui/slide/interactive.test.tsx` (forside uten aktivering og uten merkelapp
eller filnavn; flaten monterer og avmonterer rammen, holder låsen, gir fokus
tilbake; appen får seksjonens farger og dekkets fontroller; en omfarget seksjon
slår gjennom ved neste kjøring uten å røre den lagrede filen, og bygger ikke
dokumentet på nytt under en app som kjører; et trykk som kommer før fontsvaret,
venter og får de inlinede `@font-face`-reglene i den *første* kjøringen, og et
trykk rett etter et fontbytte venter på den nye familien i stedet for å bli
besvart med den forrige) og
`src/ui/present/interactivePlayer.test.tsx` (spilleren uten `onExit` – den delte
visningen – eier tastene mens appen kjører).

Skjemagrensen og importen har sine egne: `src/domain/schema.test.ts` avviser et
navn, et filnavn eller en kilde kommandoene ville avvist, og et dekk over
budsjettet uansett hvordan det ble skrevet; `src/persistence/persistence.test.ts`
gjør det samme mot en håndredigert `.slaids`-fil, og sjekker at ingenting ble
lagret. Transporten har sine: `src/server/agent/handler.test.ts` sender
escaping-tung HTML nær grensen som JSON (avvist med `REQUEST_TOO_LARGE`, og
feilen navngir veien som virker) og den samme filen som rå kropp (går gjennom,
byte for byte), og setter en fil sendt som rå kropp inn på en oppgitt `index`
fra query-strengen — mens en posisjon som ikke er et tall avvises i stedet for
å gjettes.

E2E, Chromium: `e2e/interactive.spec.ts` (dialogen og avvisningene, forsiden
og miniatyren uten kjøring, presentasjon med aktivering, rammen som fyller
slideflaten, tastatur inn i appen, ingen sidebytte mens den kjører, avslutning
med samme side og fokus, ny kjøring med ny tilstand, ingen timer etter
avslutning, scenen med låste snarveier, nytt navn, utskifting, angre/gjør om,
reload, duplisering og sletting; og temaet: appen arver seksjonens farger,
dekkets to fontroller og basisstilarket mens appens egen CSS fortsatt vinner,
fontene ligger i dokumentet slik at rammen ikke ber om noe som helst, en treg
fontlast får play-knappen til å vente i stedet for å starte i reservefonten, og
en ny seksjonsfarge slår gjennom neste gang uten at filen endres) og `e2e/interactive-security.spec.ts`
(`e2e/apps/escape-app.html` forsøker alt over, med og uten brukeraktivering;
spec-en måler utenfra: ingen forespørsel når nettverkslaget, det som
rapporteres er nektet av policyen i rendereren, ingen popups, nedlastinger,
dialoger eller rammenavigasjoner, og siden rundt er urørt). Spesifikasjonene
kjøres i et eget Playwright-prosjekt med `--disable-features=IsolateSandboxedIframes`,
fordi Playwright ellers ikke ser den innerste rammen i Chromiums egen prosess
for sandkassede rammer; policyen og sandkassen håndheves av rendereren uansett
prosess. Den delte visningen mot en ekte backend, og Firefox og WebKit, er
ikke kjørt i utviklingsmiljøet og står som ubekreftet.

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
   - tillat positive desimaltall, tall under 1 og tall over 10 – feltene
     begrenses ikke mens man skriver;
   - tallene er relative: `[1, 2]`, `[0.5, 1]` og `[2, 4]` beskriver samme
     layout;
   - det som lagres er nærmeste hele forhold 1–10 (§11.5), og dialogen viser
     hvilket under feltene.

### Live preview

Endringer skal forhåndsvises umiddelbart.

Previewet – og minstemålskontrollen bak «Bruk» – kjøres på de **kvantiserte**
forholdstallene, ikke på de innskrevne: det dialogen viser skal være nøyaktig
det commit produserer.

«Bruk»-knappen er disabled hvis:

- input er ugyldig;
- et barn blir mindre enn minimum;
- eksisterende innhold ikke kan plasseres lovlig.


---

## 11.5\. Forholdstall er heltall 1–10

En ferdig layout lagres alltid med hele forholdstall mellom 1 og 10 – aldri
desimaler, aldri 0, aldri negative tall, aldri over 10. Dette gjelder uansett
hvordan forholdstallene ble satt: dra-håndtaket, «Rediger soner», en mal, en
import eller et agentkall.

### Hvorfor

Et forholdstall er noe forfatteren leser og skriver ned. `0.3125 : 0.625 :
0.3125` er ikke det, og det var akkurat den slags tall en sluppet
dra-operasjon lagret: pekeren stoppet et sted, og tallet ble stående. Med et
endelig sett lovlige forhold får dekket en stige å feste seg til – to layouter
som ser like ut skrives likt, og en drag-operasjon kan snappe til nærmeste
trinn i stedet for å bevare en tilfeldighet.

### Kvantiseringen

`src/domain/ratios.ts` er **eneste** implementasjon. Begge redigeringsmåtene går
gjennom den, og det gjør domenekommandoene også, slik at ingen vei rundt den kan
lagre noe annet.

Ønsket normaliseres først til proporsjoner `p_i = x_i / Σx`. Kvantiseringen
finner heltallene `r_i ∈ [1, 10]` der de normaliserte kandidatproporsjonene
`q_i = r_i / Σr` ligger nærmest, målt som `loss = Σ (p_i - q_i)²`.

Det er **ikke** avrunding av hvert tall for seg: `[0.25, 1.6, 3.14]` avrundet
individuelt er `[0, 2, 3]` – en sone borte, og en form ingen ba om. Det som
tilnærmes er fordelingen.

Søket er eksakt uten å være `10^n`. Med totalen `S = Σ r_i` låst er

```text
loss = (1/S²) · Σ (S·p_i - r_i)²
```

separabel, så for hver av de høyst 91 mulige totalene er beste vektor et lite
bounded knapsack-problem – velg `r_i ∈ [1, 10]` som minimerer en kostnad per
sone under `Σ r_i = S` – løst med dynamisk programmering over den løpende
summen. Hver lovlig vektor er et gyldig punkt i delproblemet for sin egen total,
så den beste av vinnerne er global beste.

Ved lik loss vinner den minste totalen: `1 : 2 : 1` foretrekkes framfor
`2 : 4 : 2`, som beskriver nøyaktig samme layout. Det gjør også kvantiseringen
stabil – en layout som allerede er lovlig kommer uendret tilbake i stedet for å
drive mot en større ekvivalent av seg selv. Resten brytes av den minste vektoren
i rekkefølge, så samme input gir alltid samme output.

### Dragging: trinnløst under, snapp ved slipp

Mens pekeren er nede kvantiseres ingenting. Layouten følger pekeren nøyaktig. Å
snappe underveis ville gitt et hakkete håndtak og målt fit på tilstander
forfatteren bare er innom.

Ved slipp kvantiseres hele fordelingen, med én tilleggsregel:

> Soner som hadde samme forholdstall før dragingen, og som gesten ikke skilte
> fra hverandre, skal ha samme forholdstall etterpå.

`2 : 5 : 3 : 3 : 3` med den første separatoren dratt vurderer altså bare
løsninger på formen `a : b : c : c : c`. Gruppene leses fra forholdstallene
**før** gesten – aldri fra midlertidige flyttallsbredder, som aldri er nøyaktig
like. Hvilke soner gesten frigjør fra regelen, avgjør gesten selv; se
`equalityKeysForDrag` og `equalityKeysForZoneDrag`.

Nærmeste trinn kan fortsatt bli avvist av minstemål eller fit-guarden. Da prøves
de nest nærmeste i tur (`RATIO_SNAP_CANDIDATES`), og først når alle er avvist
får forfatteren avvisningen fra det nærmeste – et håndtak som ikke gjør noe
fordi snappet bommet med en hårsbredd, leser som ødelagt.

En gest kan i tillegg si at noen trinn svarer den bedre enn nærhet alene kan
avgjøre. Forskyvning gjør det: hele løftet dens er at sonen beholder størrelsen,
og det gjør den helt fram til snappet, som ellers gjerne bytter en hårsbredd av
den mot en bedre helhet. `3 : 2 : 3` skjøvet mot høyre lander på `9 : 5 : 5`,
der midtsonen stille har vokst fra en firedel av splitten til 5/19 – nok til å
ses. `keepsZoneSize` plukker derfor ut trinnene som lar sonen beholde nøyaktig
sin andel, og de prøves først, i den rekkefølgen de ble rangert. Sammenligningen
er eksakt fordi begge sider av den er heltall. En preferanse innsnevrer bare
hvilket trinn som velges; finnes ingen, faller gesten tilbake til det nærmeste,
og den kan derfor aldri få en gest til å mislykkes.

### De tre gestene

Alle tre er rene funksjoner av forholdstallene splitten **startet** med, aldri
av forrige frames tall. Det er det som gjør at et langt drag ikke akkumulerer
avrundingsfeil, og at pekeren kan vandre og komme tilbake til nøyaktig samme
layout. Alle tre regner i vektenheter: antall barn endres ikke under et drag, så
gapene er konstante og vektrom og lengderom er proporsjonale.

**Grensedrag** (`draggedWeights`) – et trykk i mellomrommet mellom to soner.
Grensen følger pekeren, bare de to sonene den ligger mellom endres, og summen
deres er bevart, så resten av splitten står stille. Paret på hver side av
separatoren er unntatt fra likhetsregelen over: `2 : 2 : 5` med separatoren
mellom de to første dratt *skal* kunne ende med ulike tall, fordi det er nettopp
det forfatteren ba om.

**Symmetrisk resize** (`resizedWeights`) – et trykk *inni* en sone, dratt på
tvers av splittens retning. Hver side sonen har, gir fra seg – eller tar tilbake
– like stor del av endringen. En sone med naboer på begge sider flytter derfor
begge grensene sine like langt i hver sin retning: den endrer størrelse og blir
liggende der den lå. Sidene er sjelden like lange, så de skaleres med hver sin
faktor – og innenfor en side beholder hver sone sin andel, slik at forholdstall
gesten ikke handler om overlever den urørt.

En sone ytterst i splitten har bare én side, og den siden tar hele endringen.
Der finnes ingenting å være symmetrisk om: sonens ytterkant er splittens egen og
kan ikke flyttes. Den andre lesningen – at en slik sone ikke endrer størrelse i
det hele tatt – gjør den vanligste layouten som finnes gestløs, siden begge
sonene i en todeling er ytterste soner.

**Forskyvning** (`translatedWeights`) – samme trykk, dratt langs splittens
retning. Sonen beholder forholdstallet sitt; siden den beveger seg mot
komprimeres med nøyaktig det siden den forlater vokser med. Begge sider skaleres,
så begge beholder sine innbyrdes forhold.

Retningene er én gest tegnet to ganger, en kvart omdreining fra hverandre: en rad
vokser oppover, og den samme gesten på en kolonne – rotert med klokka – vokser
mot høyre. En rads sone forskyves mot venstre mot starten av splitten, og den
samme kvarte omdreiningen gjør «venstre» til «opp». Ingen retning velges særskilt
for kolonner; `zoneDragAmount` er hele rotasjonen.

Hvilken av de to gestene et drag inni en sone er, avgjøres av den dominerende
retningen og **låses** så snart bevegelsen er stor nok til å bety noe
(`ZONE_DRAG_THRESHOLD_PX`). Uten dødsonen ville en hånd som starter litt skjevt
vippet mellom modusene før den satte seg, og layouten ville hoppet med den.
Hit-testing skiller de to trykkene uten avstandsmåling: mellomrommet er dekket
av sitt eget håndtak, og et trykk der når aldri sonen under.

### Stoppbetingelser

Ingen gest avvises fordi den ble dratt for langt; den stopper der geometrien
stopper, og blir stående der. Grensen stopper ved naboens minstemål. En resize
stopper ved den *minste* av de to sidenes kapasitet – å fortsette inn i siden som
fortsatt har plass ville gjort operasjonen usymmetrisk halvveis og begynt å
forskyve sonen i stedet – eller ved sonens eget minstemål når det er den som
krymper. En forskyvning stopper når siden som komprimeres har nådd den første av
sine soners minstemål.

En sone ytterst i splitten kan ikke forskyves: det finnes verken plass å åpne
bak den eller noen til å ta plassen den forlater. Den kan derimot endre
størrelse, med den ene siden sin som mottaker – se over.

### Håndhevelse og bakoverkompatibilitet

- `splitLeaf` og `updateSplit` kvantiserer **før** de måler, så geometrien som
  valideres er geometrien som lagres. `addSlide` gjør det samme med et
  layouttre den får utenfra.
- Zod krever heltall 1–10 i `layoutNodeSchema`, og `validateTree` rapporterer
  alt annet som strukturbrudd.
- Migrasjon 11 → 12 skriver om lagrede dekk, og `validateLayoutTemplate` gjør
  det samme for maler, som ikke har noen `schemaVersion` å migrere på. Ingen
  eksisterende layout blir uleselig: den skrives om til det nærmeste den kan
  uttrykkes som, og en mal med gamle tall repareres i stedet for å forsvinne fra
  listen.
- Agent-API-et tar fortsatt imot vilkårlige positive vekter – kontrakten er
  uendret – og `inspect_slide` svarer med heltallene som faktisk ble lagret.

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

Direkte manipulasjon av ratios finnes, i tre gester: separatoren mellom to soner
kan dras, og et drag inni en sone endrer størrelsen på den symmetrisk (på tvers
av splitten) eller forskyver den (langs splitten). Under dragingen er bevegelsen
trinnløs, ved slipp snapper layouten til nærmeste lovlige forhold. Se §11.5.

---

## 13\. Innholdstyper

En leaf kan ha `content: null` eller én `ZoneContent`.

Første operative innholdstyper:

### 13.1 Container

Usynlig wrapper:

- transparent bakgrunn;
- ingen box shadow på selve beholderen;
- ingen visuell kortflate;
- ingen ytre padding som påvirker layoutgap;
- inneholder subfelt med RichDoc, og ingenting annet: et bilde som fyller
  sonen er sin egen innholdstype (§13.4), ikke en beholder med en annen hatt.

Beholderen maler fortsatt ingenting, men **et bilde som fyller sonen får
kortets dybde og kan få kortets hjørner** – se §26. Det er bildet som males,
ikke beholderen: en beholder med tekst er like usynlig som før.

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

### 13.4 Bilde

Et bilde som fyller en sone er et kort fylt til randen med bilde:

- avrundede hjørner og box shadow, som ethvert annet kort — et bilde skal stå
  blant kortene rundt seg, ikke lese som et hull skåret i sliden;
- ingen padding og ingen letterboxing: bildet dekker sonen helt ut til kantene;
- **beskjæres** når filens format ikke er sonens. Er bildets bredde:høyde
  større enn sonens, strekkes det til å fylle høyden og det som går utenfor på
  sidene skjules; er den mindre, gjelder det motsatte.

Beskjæringen sletter ingenting. `focus` er to tall mellom 0 og 1 — hvor i filen
vinduet står, `0.5` er midtstilt — så utsnittet er et *vindu inn i filen* og kan
flyttes når som helst. `object-fit: cover` og `object-position` gjør regnestykket;
`EditableImagePanel` utleder nøyaktig det samme for å tegne den skjulte delen på
riktig sted.

I editoren er utsnittet under pekeren: hover over et beskåret bilde viser de
skjulte delene utenfor rammen med redusert opasitet, markøren er en åpen hånd, og
et dra flytter filen bak vinduet. Midten har en magnet (`IMAGE_FOCUS_SNAP_PX`),
fordi midtstilt er utsnittet et bilde begynner i og det eneste som er umulig å
finne tilbake til for hånd. Hele draget er én kommando, så én Ctrl+Z setter
utsnittet tilbake.

Fordi et bilde alltid er beskåret til rammen sin, kan det aldri flyte over.
Det eneste fit-guarden har en mening om her er **bildeteksten**.

Et bilde kan også settes inn *inne i* en tekst, og de to veiene møtes i
opplastingsdialogen: «Fyll sonen» eller «I tekstfeltet». Om det siste er mulig,
avgjøres av feltets eget skjema (`acceptsInlineImage`), ikke av hvilken felttype
markøren står i. Bare `bodyExtensions` registrerer `slaidsImage`; en slide-tittel,
en seksjonslinje og en bildetekst er én linje tekst, og `titleExtensions` lar noden
være ute i stedet for å skjule en knapp. Å spørre editoren i stedet for å liste
felttyper er det som holder skjemaet og dialogen sammen: en liste svarer riktig i
dag, må vedlikeholdes for hånd den dagen en femte felttype dukker opp, og første
tegn på at ingen gjorde det er at `insertSlaidsImage` ikke finnes — kastet *etter*
at filen alt er lagret i presentasjonen.

### 13.5 Bildetekst

En valgfri tekst over bildet, i en beholder som

- alltid er horisontalt midtstilt;
- har valgfri bakgrunnsfarge med 30 % opasitet og 3px backdrop-blur. Fargen er
  `null` til noen velger en, og leser da seksjonens aksentfarge — samme arv som en
  overskrift og et titteldpanel. Teksten er hvit med skygge uansett: 30 % av en
  farge over et ukjent fotografi er ingen bakgrunn å regne kontrast mot;
- henger fra taket øverst (nedre hjørner avrundet), står på gulvet nederst
  (øvre hjørner avrundet), og er avrundet hele veien rundt i midten;
- vokser i bredden til den nærmer seg sonens vegger — det er alltid litt luft på
  sidene — og bryter så til en ny linje. En toppjustert bildetekst vokser nedover,
  en bunnjustert oppover, en midtstilt begge veier. Det går an å skrive helt til
  det ikke er plass til mer, og da avviser fit-guarden.

**Det finnes ikke en tom bildetekst.** En ny tar markøren, og en som forlates tom
fjerner seg selv. Det er dét som gjør det trygt at *enhver* tom bildetekst
autofokuseres: en tom kan bare være en helt fersk.

### 13.6 Kort med tittel og bilde

Et kort med tittel (§13.3) der innholdsfeltet i sin helhet er et bilde:

- tittelpanelet er alltid øverst, og er nøyaktig det samme panelet — samme høyde,
  samme fargearv;
- bildet fyller bodyen 100 %, uten padding og uten hvit flate under seg, og
  oppfører seg ellers som §13.4 i ett og alt;
- bildeteksten kan bare stå i midten eller nederst. Øverst ligger tittelpanelet
  allerede, og en bildetekst av samme form rett under det ville lest som en
  blekere andre-header.

De to bildetypene bærer den samme `ImagePanel`, så det finnes ett utsnitt, én
bildetekst og én renderer (`ImagePanelView`) for begge.

---

## 14\. Farger og kontrast

Bakgrunnsfargen settes per seksjon og arves av slidene fram til neste – se §8.5.
Et dekk med én seksjon har derfor én bakgrunnsfarge, slik det alltid har hatt.

Kort kan bruke en begrenset, deterministisk palett.

Forslag fra visjonen:

- hue: `0°, 30°, …, 330°`;
- saturation: `25%`;
- lightness: `20%, 40%, 60%, 80%`;
- samt svart og hvitt.

Tekst på bakgrunn velges mellom svart og hvitt ved å beregne kontrast og velge alternativet med høyest kontrast.

Tekstskygge kan brukes dekorativt på mørke bakgrunner, men skal ikke være forutsetningen for lesbarhet.

Standardfargen for de pilleformede overskriftene i innholdet er ikke en konstant
i paletten, men **seksjonens aksentfarge** – se §8.5. En overskrift uten valgt
farge lagrer ingen farge og følger den; en overskrift som har fått en farge,
beholder den.

---

## 15\. Presentasjonstema

Når en ny presentasjon opprettes velges:

1. tittel;
2. bakgrunnsfargen dekket starter i;
3. font for titler/overskrifter;
4. font for brødtekst.

Fontene gjelder globalt i presentasjonen. Bakgrunnsfargen gjør det ikke: den
settes på forsiden og arves av slidene fram til neste seksjon – se §8.5. Å lage
et dekk er nettopp øyeblikket der det bare finnes én seksjon, og derfor er ett
fargevalg fortsatt riktig spørsmål å stille her.

Det skal ikke være mulig å få tilfeldig fontmiks per slide.

Designet skal være token-basert:

```ts
type PresentationTheme = {
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

Begge skalaene er kontinuerlige i domenet. `SPACING_RANGE` og
`FONT_SCALE_RANGE` er de virkelige grensene, og fit-guarden avgjør hva som er
brukbart innenfor dem. Editoren tilbyr fire navngitte trinn på hver, fordi et
menneske vil ha knapper og ikke en glidebryter – men trinnene er et utvalg, ikke
en regel. De er derfor deklarert i `src/domain/metrics.ts` sammen med
intervallene (`SPACING_PRESETS`, `FONT_SCALE_PRESETS`), ikke i modalen: agent-
API-et siterer den samme listen når det forteller en agent hva «normal» er, og
én liste er det som holder de to fra å si forskjellige ting.

Begge stigene er forskjøvet oppover: det tetteste et dekk kan settes i er det
som en gang var «Luftig», og det luftigste er luftigere igjen enn det gamle
maksimum. Basistallene i `constants.ts` er ikke rørt – det som er flyttet, er
multiplikatoren, og det er det ærlige stedet å flytte den: en lagret `spacing`
betyr fortsatt nøyaktig det den betydde, den tilbys bare ikke lenger under det
nye gulvet.

Derfor er `DEFAULT_SPACING` ikke lenger det samme tallet som «basistokenene
uskalert». Et dekk som ble lagret før temaet hadde disse skalaene ble tegnet på
`NEUTRAL_SCALE`, og det er *det* en migrering fyller inn – aldri `DEFAULT_*`,
som er det et **nytt** dekk åpner i. Å gjenskape et lagret dekk og å style et
nytt er to forskjellige jobber, og de så bare like ut så lenge standarden
tilfeldigvis var nøytral. Stigene har siden flyttet seg forbi den nøytrale
verdien, så et slikt dekk kan ikke lenger tegnes nøyaktig som det var:
`repairPresentation` klemmer det opp til det tetteste temaet fortsatt tilbyr.
Det er en villet konsekvens av å heve gulvet, ikke et uhell – og det er derfor
verdien fortsatt har et navn: hva en migrering fyller inn er et faktum om
dokumentet, og hva klemmen så gjør med det er en egen beslutning.

Fontkatalogen (`src/domain/fonts.ts`) er på samme måte det ene stedet en font
er navngitt. Både editorens velger, den hodeløse estimatorens glyffbredder og
agentkontraktens publiserte fontenum leses ut av den.

Temaet kan lagres som standard for nye presentasjoner. Det er en lokal
preferanse (localStorage, som vindusgeometri), ikke presentasjonsdata, og
valideres på vei ut igjen.

---

## 16\. Rich text

Bruk Tiptap/ProseMirror og lagre dokumentet som strukturert JSON, ikke rå HTML.

En overskrift er en pille, og fargeattributtet er `null` når ingen har valgt noe.
Standarden lagres aldri i dokumentet – den kommer fra seksjonen gjennom en
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

Justering lagres på dokumentet som den samme inline-stilen begge rendringene
skriver, så editoren og sliden ikke kan bli uenige. Innhold justeres også
loddrett (topp/midt/bunn) i feltet det står i; det er en egenskap ved feltet,
ikke ved teksten.

### Standarden er midtstilt, begge veier

En slide er ikke en side med brødtekst: et felt holder noen få linjer i en boks
som stort sett er både høyere og bredere enn dem, og tekst festet i øvre venstre
hjørne leser som et uhell heller enn som en beslutning. Derfor er *midtstilt*
standarden et nytt felt starter fra – vannrett og loddrett – akkurat som en
slidetittel og en korttittel alltid har vært midtstilt: en tittel er en etikett,
ikke et avsnitt.

`DEFAULT_TEXT_ALIGN` og `DEFAULT_VERTICAL_ALIGN` i `src/domain/constants.ts` er
de to eneste stedene det avgjøres, og de leses som betydningen av **fravær** –
de skrives aldri inn i nytt innhold. Det er dét som gjør at standarden kan
flyttes uten å skrive om ett eneste lagret dokument, og at et felt noen
*har* justert beholder justeringen sin. Editoren, den statiske rendringen og
agentens lesing løser alle fravær gjennom de samme to konstantene.

Tiptaps egen justeringsattributt slår de to spørsmålene sammen, og må derfor
deles opp: verdien man konfigurerer som standard blir både attributtets
skjemastandard *og* den ene verdien hvis stil ikke skrives ut. Begge halvdeler
er gale her.

En skjemastandard er ikke «fravær»: ProseMirror fyller den inn i hver node, og
`editor.getJSON()` skriver den rett ut igjen – så `center` som skjemastandard
ville stemplet `textAlign: "center"` inn i hvert tidligere ujustert avsnitt
første gang noen skrev i feltet, altså akkurat det motsatte av det standarden er
til for. Attributten står derfor på `null`, som er måten dette kodebasen
allerede lagrer «ikke valgt» på – se overskriftspillens farge.

Og stilen skrives ut hver gang, fravær inkludert. Å utelate den ville gjort
editorens markup ulik `RichDocView` sin for nøyaktig én justering – den
vanligste – og den forskjellen er ikke kosmetisk: en overskriftspille er
`max-content` bred og et bilde er smalere enn spalten sin, så begge plasseres
med `margin-inline` gjennom selektorer som leser inline-stilen.

Verktøylinja spør et tredje spørsmål, og skal ha det tredje svaret: knappen som
lyser er den justeringen teksten *tegnes* med, ikke den som er lagret
(`alignmentIsActive`). Ellers ville et midtstilt avsnitt ingen har justert vist
ingen knapp som valgt.

**En justert listeboks flytter seg som én ting – kulepunkt og tekst sammen.**
Å justere avsnittet inne i punktet er ikke nok, og ser ødelagt ut: et
listemerke plasseres mot punktets egen innholdskant og ikke mot linja med ord
inne i det, så midtstilling flyttet teksten inn til midten og lot hvert eneste
kulepunkt bli igjen ytterst til venstre. Punktet krymper derfor rundt sin egen
tekst og skyves på plass med automatiske marger – samme svar som en
overskriftspille og et bilde får. Lista beholder innrykket sitt, og det er dét
som holder dette innenfor regelen om at ingenting en sone holder males utenfor
den: et punkt som er for langt til å krympe fyller spalten, og merket har
innrykket å henge i.

**En plassholder står der teksten den står for kommer til å stå.** Den er et
pseudoelement uten node å måle, så en flytende boks kan si `text-align: center`
og likevel males ytterst til venstre – som er nøyaktig det som skjedde: en
midtstilt tittel viste plassholderen sin til venstre og hoppet til midten ved
første tastetrykk. Den tegnes derfor som en blokk med høyde null, som arver
avsnittets `text-align` og følger den av seg selv, og som fortsatt koster
ingen plass i målingen.

### Autoerstatning mens man skriver

` - ` blir ` – `, `...` blir `…` og ` * ` blir ` · `, overalt hvor noen skriver
tekst: innholdsfelt, slidetittel, korttittel, en seksjons to linjer, en
bildetekst – og de to helt vanlige `<input>`-feltene som også ender opp på en
slide (ny seksjon, og referansens tittel og forfattere). `TEXT_SUBSTITUTIONS` er
den ene lista over hva som erstattes, og `substitutionPattern` den ene
beskrivelsen av hva en erstatning treffer; input-regelen i editoren og
`useTypedSubstitution` for et vanlig felt leser begge den samme.

**Et felt der man skriver må ta vare på mellomrommene sine.** Å kollapse dem er
ikke bare et rendringsvalg: et mellomrom sist på linja ville vært usynlig, så
nettleserens redigeringsmotor skriver et hardt mellomrom (U+00A0) i stedet, og
det som leses tilbake ut av DOM-en etterpå er kollapset på nytt. Det var dét som
i stillhet slo ut de to erstatningene som er bygget rundt et mellomrom: de
utløses på det avsluttende mellomrommet, altså nøyaktig det tegnet et
`white-space: nowrap`-felt ikke klarte å holde på, mens `...` – den ene regelen
uten mellomrom i seg – virket overalt hele tiden. Enlinjefelt settes derfor med
`white-space: pre`: én linje som før, men mellomrommene beholdes, akkurat som en
bildetekst alltid har gjort. Reglene tåler i tillegg det harde mellomrommet, så
de handler om hva som ble skrevet og ikke om hvordan feltet tilfeldigvis er
stylet.

Egenskapen er verdiløs uten en test som skriver på ordentlig:
`e2e/typography.spec.ts` bruker ekte tastetrykk i en ekte nettleser, i hvert av
feltene over. En simulert innsetting går en annen kodevei enn tastaturet og sier
ingenting om hvorvidt det å skrive virker – som er nøyaktig hvordan
titteltilfellet kunne rapporteres som dekket uten at noen noensinne hadde
skrevet i en tittel.

### Den tomme linjen på slutten er ikke innhold

Et felt justerer hele flyten sin, marger og tomme linjer inkludert. Derfor er
to ting som ser ut som ingenting nok til at «midtstilt» ikke blir midtstilt:

- **Ytterste marger.** Hver blokk bærer en avstand ned til blokken etter seg.
  Den første blokkens toppmarg og den siste blokkens bunnmarg skiller teksten
  fra ingenting, og skal derfor være null. Ellers havner halve avstanden under
  teksten som luft ingen har valgt.
- **Blanke linjer til slutt.** En blank linje mellom to avsnitt er en avstand
  forfatteren har valgt; en blank linje etter den siste er en linje med
  ingenting i. Den lagres aldri (`trimTrailingBlankLines`), verken når noen
  trykker Enter til slutt eller når et bilde settes inn – å sette inn en
  blokknode i et avsnitt splitter det og legger igjen nettopp en slik linje.

Editoren har den likevel, og må ha den: et bilde er en atom, så et felt som
slutter med et bilde har ingen plass å sette skrivemerket. Linjen finnes derfor
så lenge noen står i feltet, og gis tilbake i det de forlater det. Det er
`TrailingLineExtension` (StarterKits egen `trailingNode` er slått av, fordi den
skrev linjen inn i dokumentet). Regelen er «siste blokk kan ikke bære et
skrivemerke» (`!isTextblock`), ikke en liste med nodenavn.

At linjen forsvinner ved blur er ikke kosmetikk: innholdsmodus, sonemodus og
presentasjonsmodus tegner det samme dokumentet gjennom den samme rammen, og
fit-målingen leser den samme rammen – så et felt ingen står i må se ut nøyaktig
som sliden.

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

### En sone er flere steder som kan klippe

`FitResult` bærer både et samlet tall og en oppdeling per **region**: kortets
tittelfelt, hvert tekstfelt i kroppen, bildeteksten over et bilde. Regionen er
enheten fit-regelen sammenligner i, og det er ikke en detalj: måles en sone som
ett verste tall, kan en korttittel vokse ut av headeren sin uten at tallet
flytter seg — kroppen flommet allerede over mer — og «aldri verre» leses som
«ingenting skjedde». Det var hullet korttitlene kom gjennom.

Begge målerne rapporterer det samme: estimatoren deler opp per innholdstype, og
DOM-måleren leser `data-fit-part` på hver klippende boks. En enkeltlinjeboks
markeres i tillegg med `data-fit-axis="x"`: den er like høy som typen den er satt
i, så den kan bare feile sidelengs, og dekorasjonen rundt et citation-nummer
stikker ut vertikalt ved design.

**Boksen som klipper må være boksen som måles.** En klippende boks holder sin
egen overflow for seg selv, så et ekstra klipp inne i et tittelfelt gjorde at
headeren rapporterte null uansett hvor langt teksten stakk forbi den. Én linje
legges derfor ut i `max-content` med `100 %` som gulv, slik at den som ikke får
plass starter ved venstre kant og hele overflyten er på høyre side, der
`scrollWidth` faktisk ser den.

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

### Søppelkasse

Å slette en presentasjon fra biblioteket sletter ingenting. Den flyttes til
søppelkassen: `deletedAt` settes ved siden av dokumentet (`deleted_at` i
Supabase, et felt på Dexie-recorden), og dokumentet, filene og delingskolonnene
står urørt. Derfra kan den **gjenopprettes** – tilbake til biblioteket, i mappen
den lå i, med lenken den hadde – eller **slettes for godt**. Søppelkassen tømmes
automatisk etter `TRASH_RETENTION_DAYS` (30) dager, og kan tømmes for hånd.

Reglene, og hvor de bor:

- `deletedAt` er lagringsmetadata, ikke et felt i dokumentet. Editoren lagrer
  dokumentet den holder, og en lagring skriver aldri `deletedAt` – så et dekk som
  kastes fra én fane blir liggende i søppelkassen når en annen fane autolagrer
  det. Dexie bærer den lagrede verdien over ved `put`; Supabase-raden nevner
  aldri kolonnen i en lagring, og version-triggeren lar `version` og `updated_at`
  stå for en skriving som bare rører `deleted_at`.
- Repositoryet har `trashPresentation` (vaktet som `deletePresentation`),
  `restorePresentation`, `listTrashedPresentations` og `purgePresentation`.
  `listPresentations` er biblioteket alene, og de to listene overlapper aldri.
  `deletePresentation` er fortsatt den ubetingede permanente slettingen, og
  kalles nå bare av tilbakerullingen i en duplisering.
- **En presentasjon i søppelkassen kan ikke åpnes.** `loadPresentation` avviser
  den med `RepositoryNotFoundError`, så editoren åpner den ikke fra en husket id,
  og for agentflaten er den `PRESENTATION_NOT_FOUND` – ikke listet, ikke lest,
  ikke redigert, ikke kopiert og ikke slettet en gang til. Agentens
  `delete_presentation` er den samme flyttingen som biblioteket gjør, med de
  samme scopene; det finnes ingen agentoperasjon som ser søppelkassen.
- Den offentlige delingslenken er død så lenge presentasjonen ligger i
  søppelkassen (`slaids-share` filtrerer på `deleted_at is null`, og
  `publishedDocument` avviser raden i tillegg), og virker igjen når den
  gjenopprettes. Delingskolonnene roteres ikke: en sletting som kan angres skal
  kunne angres helt.
- Tømmingen ligger i `src/persistence/library.ts` (`purgeExpiredTrash`,
  `emptyTrash`), tar repositoryet som argument som resten av bibliotekreglene, og
  sletter én presentasjon om gangen med `purgePresentation` – aldri en egen
  slettesekvens, og aldri den ubetingede `deletePresentation`. Listingen er en
  lesing, og mellom den og slettingen kan en annen fane gjenopprette dekket; en
  ubetinget sletting ville da tatt en levende presentasjon med alle filene.
  `purgePresentation(id, deletedAt)` gjør «fortsatt i søppelkassen, kastet på
  akkurat dette tidspunktet» og slettingen til ett atomisk steg i lageret – én
  `DELETE`-setning med `id` og `deleted_at` i Supabase, én transaksjon i Dexie –
  og svarer `false` for en oppføring som ikke lenger er der (gjenopprettet,
  kastet på nytt, allerede slettet) uten å røre noe. Det samme kallet står bak
  «Slett for godt» på ett kort. Den automatiske tømmingen kjører når biblioteket
  åpnes, før listingen, slik orphan-sveipet gjør. Slaids har ingen serverklokke,
  og trenger ingen: en søppelkasse ingen ser på koster ingenting før noen ser på
  den.
- Å kaste noe som allerede ligger i søppelkassen starter klokken på nytt heller
  enn å avvises; det er den ene regelen begge lagrene kan uttrykke i én setning.
- **En slettet presentasjon gjenoppstår aldri fra en gammel editor.** En fane
  som fortsatt holder dekket etter at en annen fane har tømt søppelkassen,
  autolagrer mot en rad som er borte. Supabase avviser det allerede: en rad
  repositoryet har sett lagres med en vaktet `UPDATE`, og en `UPDATE` som ikke
  treffer er en konflikt, ikke en `INSERT`. Dexie holder nå det samme minnet
  (`knownIds`: id-er den har lest, listet eller lagret), og en lagring av en
  kjent id uten rad er en `RepositoryConflictError` – med eller uten vakt, siden
  vakten handler om revisjonen og dette om at raden finnes i det hele tatt. Bare
  en sletting gjennom det samme repositoryet glemmer id-en igjen, som
  tilbakerullingen i en duplisering er avhengig av.
- Import behandler en id i søppelkassen som opptatt, og importerer som kopi.

Kortet i biblioteket viser også hvor mye plass presentasjonen tar.
`PresentationSummary.byteSize` er dokumentets JSON i UTF-8 pluss `byteSize` for
hver fil dokumentet lister (`presentationByteSize` i `domain/presentation.ts`,
én regel). Dexie regner det ut ved listing; Supabase skriver det i kolonnen
`byte_size` ved hver lagring, som `slide_count`, og migrasjonen fyller den inn
for radene som fantes fra før uten å røre `document` – og dermed uten å flytte
`version`.

---

## 22\. Editor shell

Editoren skal minst ha:

- top toolbar;
- slide-filmstrip/sidebar;
- sentral slide stage;
- bottom toolbar/statusområde;
- enkel indikator for innholdsmodus vs sonemodus;
- autosave-status.

UI er desktop-først: den romslige trekolonneflaten er standarden, ikke en
variant av den lille. Den er ikke desktop-eksklusiv – når vinduet er for lite
til å holde filmstripe, stage og inspector samtidig, mountes et kompakt skall i
stedet for det romslige. Nøyaktig ett skall er mountet om gangen. Se § 44.5.

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
> komponent, `PresentationPlayer` (§ 43.5). Sidelisten er felles og inkluderer de
> avledede referansesidene og, når delingen er på, QR-siden.
>
> Siden er hele skjermen: ingen teller, ingen avslutt-knapp, ingenting tegnet
> oppå sliden. Hvor langt ut i dekket man er, er det fremdriftsindikatoren som
> sier (§ 8.6), og veien ut er Escape — som bare finnes der `onExit` gjør det,
> altså ikke i den delte visningen.
>
> Én side kan gjøre mer enn å tegnes: en interaktiv slide (§ 8.7) har en knapp
> som starter miniappen i en ramme over sliden. Mens den kjører eier appen
> tastatur, klikk og sveip – spilleren blar ikke, og Escape avslutter ikke
> presentasjonen – og «Avslutt miniapp», Slaids' egen knapp utenfor rammen,
> er den ene veien tilbake til siden.
>
> **Oppdatert:** der det ikke finnes noe tastatur finnes det knapper. På en
> kompakt eller coarse flate tegnes forrige, neste og avslutt som trykkbare
> kontroller som skjuler seg av seg selv og hentes tilbake med et trykk på
> sliden; med mus er et klikk på sliden fortsatt «neste». Sveip blar når gesten
> starter utenfor en lenke, en knapp eller en kjørende miniapp. Se § 44.5.7.

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

> **Oppdatert:** en agent har samme tilgang til sandkassen som editoren, gjennom
> `list_sandbox_items`, `place_sandbox_item`, `duplicate_sandbox_item` og
> `delete_sandbox_item` i § 44 – tynne innpakninger over de samme
> domenekommandoene (`placeSandboxItem` m.fl.) som drag-and-drop-flyten over
> bruker, aldri en egen agentkopi av reglene.

---

## 26\. Bilder og SVG

Rasterbilder og SVG lagres som assets i IndexedDB/Dexie.

Metadata og binærdata skal skilles logisk.

SVG skal beholdes vektorbasert, men vises som asset via `<img>`/Blob URL som sikker default, ikke injiseres som vilkårlig rå HTML/SVG markup.

Uansett hvilken inngang en SVG kommer gjennom – opplastingsdialogen,
agent-API-et eller `.slaids`-import – saneres den av `src/domain/svg.ts` før den
lagres, og det som lagres er reserialiseringen. Se «Én dør inn til
assetlageret» i §44.

Innhold refererer til `assetId`, ikke store base64-strenger i presentasjons-JSON.

Et bilde kan settes inn enten i et tekstfelt, sammen med teksten, eller som
innhold som fyller hele sonen. Hvor det havner spørres om, det utledes ikke
av hvilken modus editoren tilfeldigvis står i.

Et bilde som fyller sonen er sin egen innholdstype – se §13.4, som eier
beskjæringen, utsnittet og bildeteksten. Å velge en fil for en sone som
allerede viser et bilde bytter bare filen: utsnittet, bildeteksten og, på et
kort med tittel og bilde, tittelpanelet blir stående. Å erstatte hele innholdet
ville kastet bort tre ting brukeren ikke ba om å miste.

Et nytt bilde får bredden som faktisk er ledig i feltet, og kan dras i
størrelse etterpå. Bare bredden dras – høyden følger av aspektforholdet – så
bildet kan aldri forvrenges, og draget stopper ved den ledige plassen i
sonen. Fit-vakten har fortsatt siste ord. «Ledig plass» regnes mot flyten slik
den blir *etter* innsettingen: linjen splittingen legger igjen, bildets egen
marg, og margen den blokken som er sist nå får tilbake i det den slutter å være
sist.

### Et bilde som fyller sonen

Se §13.4. Et bilde beskjæres alltid til sonen, så elementet *er* sonen: hjørnene
en radius runder og omrisset en skygge følger er da sonens egne, og en vanlig
`box-shadow` på boksen er skyggen på bildet. Det var ikke sant så lenge et bilde
kunne vises helt — da var det letterboxet, boksen var større enn bildet, og både
radius og skygge måtte følge en boks som ble trimmet ned til bildet etter
størrelsesforholdet. Den maskineriet er borte med `contain`: det er ikke noe å
trimme lenger.

Slaids lager ikke bilder selv, verken for et menneske eller for en agent. Hvor
et bilde kan komme fra, og hvordan SVG-markup fra en agent valideres og saneres
før den blir et asset, står i §44 – «Rasterbilder», «SVG som førsteklasses
agentformat» og «SVG-sikkerhet».

### Bildeoptimalisering

En lagret fil er ofte langt større enn det sliden noen gang viser av den. Slaids
kan derfor gjøre bildefilene mindre – én fil fra inspektøren, eller alle filene
fra «Optimaliser bilder» i verktøylinjen – uten at noe på slidene ser annerledes
ut. Planleggingen er ren domenelogikk (`src/domain/imageOptimization.ts`), og
den bygger på nøyaktig samme geometri som tegner bildet: sonerektangelet fra
`geometry.ts`, minus tittelpanelet på et kort med tittel og bilde, og
`cover`-regnestykket i `src/domain/imageGeometry.ts` – den ene implementasjonen
editorens dra-utsnitt og optimalisereren deler.

**Hva som vises avgjør hva som beholdes.** For hver fil finnes alle stedene den
vises (`assetOccurrences`): bildepaneler med ramme og utsnitt, innlinjebilder
med sin andel av kolonnen, og sandkassen, som regnes som en hel slide fordi
ingen vet hvor innholdet lander. Nødvendig størrelse er den største visningen
ganger `OPTIMIZATION_PIXEL_DENSITY` (2 filpiksler per logisk piksel, for
høy-DPI-skjermer og moderat senere forstørring). En fil skaleres aldri opp, og
en nedskalering må fjerne minst 10 % av hver side (`MIN_DOWNSCALE_RATIO`) for å
være verdt en omkoding.

**Permanent beskjæring** gjelder bare en fil som vises i nøyaktig én
bilderamme, og bare når rammen skjuler minst `MIN_CROP_SHARE` av pikslene.
Kilden er `visibleSourceRect` – pikslene `object-fit: cover` faktisk setter på
skjermen – og målet får rammens proporsjoner (høyden avledes av bredden via
rammen, ikke rundes for seg), så filen *er* rammens form etterpå, `cover` har
ingenting å skjule, og utsnittet sentreres uten synlig hopp. En delt fil
beskjæres for ingen av stedene: det ett vindu skjuler kan et annet vise. Ber
brukeren om beskjæring av én forekomst av en delt fil, er det en **fork**: det
panelet får en egen fil, de andre beholder originalen.

**Format og komprimering** avgjøres av pikslene, ikke av filendelsen
(`encodingChoices`): transparens beholdes alltid; et fotografi – eller piksler
som alt har vært gjennom en tapsgivende kodek – går i WebP (kvalitet
`WEBP_QUALITY`) der nettleseren kan skrive det og JPEG ellers; grafikk, tekst og
skjermbilder forblir tapsfrie (PNG eller tapsfri WebP, den minste vinner).
Foto/grafikk leses av et utvalg piksler (`isPhotographic`), med terskler som
heller mot grafikk når det er tvil. En tapsgivende kilde omkodes bare når
pikslene uansett endres. SVG forblir SVG; animerte filer røres ikke. Et resultat
som ikke er mindre forkastes, og en ren omkoding må spare `MIN_RECODE_SAVING_RATIO`.

**Metadata** (EXIF, GPS, miniatyrbilder, XMP, kommentarer) forsvinner ved
redraw, og fjernes tapsfritt for JPEG/PNG/WebP som ikke trenger redraw
(`src/domain/imageMetadata.ts`). Fargeprofil og Adobe-fargetag beholdes;
orienteringen skrives tilbake som én tag, siden den bestemmer hva som er opp.
Det gjelder alle tre containerne som kan bære et EXIF-blokk – JPEGs `APP1`,
PNGs `eXIf` og WebPs `EXIF` – for den tapsfrie veien er per definisjon visuelt
invariant: alt annet i blokken beskriver bildet, mens orienteringen er en
instruksjon en renderer følger. Av samme grunn måler `readRasterImage` den
*tegnede* størrelsen i alle tre containerne, ikke bare i JPEG: en `AssetRef` skal
bety det samme uansett hvilken dør filen kom inn gjennom – nettleserens dekoder,
som snur bildet, eller bitstrømsmålingen – og et innlinjebilde tar formen sin
fra referansen. Den nye taggen skrives i den formen filen selv
brukte (med eller uten `Exif\0\0`-markøren), så ingen dekoder som kunne lese
originalen kan lese erstatningen feil.

**Deduplisering** er innholdsbasert: SHA-256 av de lagrede bytene, notert som
valgfri `AssetRef.contentHash` (uten skjemaversjonsbump – en referanse uten hash
er en fil ingen har hashet ennå). Den noterte hashen er aldri bevis: referansen
ligger i dokumentet og bytene i lageret, og ingenting binder dem hardt nok
sammen til at den ene kan gå god for den andre. Derfor brukes en notert hash bare
til å *utelukke* kandidater, mens et treff alltid avgjøres på de faktisk lagrede
bytene – sammenlignet byte for byte før en fil gjenbrukes eller to filer slås
sammen. Begge dørene inn i assetlageret
(`state/assetUpload.ts`, `agent/assetStore.ts`) spør
`persistence/assetDedupe.ts` før de skriver og gjenbruker filen de finner;
`upload_asset` svarer da med `deduplicated: true`. «Optimaliser bilder» slår
sammen eksisterende kopier (`mergeDuplicateAssets`) *før* planleggingen, så en
sammenslått fil ses med alle sine steder. Bare innenfor én presentasjon: filer
eies av presentasjonen og slettes med den.

**Livssyklus og atomisitet.** Pikselarbeidet skjer i nettleseren, i en Web
Worker (`src/state/imageWorker.ts`, `imagePipeline.ts`) med `createImageBitmap`
og `OffscreenCanvas`; nettleseren har dekodere for alle formatene Slaids lagrer,
og ingen byte forlater maskinen. Analysen (`analyzeImages`) produserer de
faktiske resultatbytene i minnet og skriver ingenting; dialogen viser derfor
eksakte størrelser, ikke estimater. Anvendelsen (`applyImageOptimization`)
skriver i den rekkefølgen som er trygg å stoppe i: nye filer under nye id-er
først, så dokumentet (`replaceAssetUses`, som også registrerer den nye
referansen og fjerner den gamle når ingenting viser den lenger), så lagring, og
først *etter* lagringen slettes filene ingenting peker på. Ett bilde som feiler
feiler alene.

En lagring som feiler er en utsettelse, ikke en slutt: autosave fortsetter å
prøve, og slettingen følger den skrivingen som til slutt går gjennom
(`AutosaveController.afterSave`, brukt via `onceSaved`). Uten det ville et
øyeblikks nettverkstrøbbel etterlatt de erstattede filene for godt – dokumentet
blir lagret et sekund senere uten å nevne dem, og verken en ny
optimaliseringsrunde eller `deleteOrphanAssets` (som bare rydder filer hvis
presentasjon er borte) finner dem igjen. Slettingen leser alltid den *lagrede*
presentasjonen først (`reclaimReplacedAssets`) og lar en fil den fortsatt viser
være i fred, så den er trygg å kjøre når som helst – også når editoren ble
forlatt med skrivingen hengende, og lageret altså fortsatt har det gamle
dokumentet.

Resultatet valideres ved den samme døren som all annen lagring
(`acceptAsset` med `raster: 'bitstream'`), så størrelsen kommer fra bitstrømmen.
Operasjonen ligger utenfor angrehistorikken (`replaceDocument` i storen), fordi
et angre-steg som peker på slettede filer ville vært en slide med et hull;
dialogen sier det før noe skjer, sammen med advarselen om at bortbeskårne
piksler er borte for godt.

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
  dokumentet peker på den;
- interaktive slider: døren for filen, kommandoene, rammedokumentet som data,
  forsiden uten aktivering, flaten og spilleren med – se «Tester» i § 8.7.

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
  kommer og går sammen med delingen;
- interaktiv slide: hele løpet fra fil til kjørende app og tilbake, og
  isolasjonen målt utenfra med en fiendtlig app (§ 8.7).

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

Slaids er en **énbruker-app**. Supabase-prosjektet deles med mdeditz, som ikke
bruker Supabase Auth i det hele tatt, så det finnes ingen konto- eller
produktkobling til noen annen app. Bare den faste Supabase Auth-brukeren definert
av `SLAIDS_OWNER_ID` kan bruke Slaids i produksjon; e-postadressen er bare
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
| `slaids_presentations`  | hele `Presentation` som `document jsonb`, pluss `title`, `folder_id`, `slide_count`, `byte_size`, `version` og `deleted_at` (søppelkassen, § 21) |
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

Prosjektet deles med mdeditz, og det avgjør hvordan migrasjoner deployes.
Supabases egen historikk, `supabase_migrations.schema_migrations`, er
**prosjektglobal**: den inneholder mdeditz' migrasjon også, og den bor i et annet
repo. `supabase db push` leser den som om den var historikken til repoet den
kjøres fra, og stopper derfor herfra med «Remote migration versions not found in
local migrations directory» – med to forslag som begge er feil for dette
oppsettet: `migration repair` skriver om en annen apps historikk, og `db pull`
drar en annen apps skjema inn i Slaids. Ingen flagg avgrenser `db push` til én
app.

Slaids fører derfor sin egen historikk, i sin egen tabell,
`public.slaids_migrations`, og `scripts/deploy-migrations.sh` er hele
mekanismen: hver ukjørte migrasjon, i filnavnrekkefølge, hver i én transaksjon
sammen med sin egen historikkrad. Den prosjektglobale tabellen leses aldri og
skrives aldri, og en migrasjon som nevner den avvises før noe kjøres.

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
authored slides (forsiden først) → avledede referansesider → avledet QR-side
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
8. En deaktivert eller slettet presentasjon kan ikke leses via et gammelt token,
   og heller ikke en som ligger i søppelkassen – den virker igjen først når den
   gjenopprettes.
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

- innholdsspesifikk minimumsstørrelse på soner (§7);
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
set_presentation_title
move_presentation
duplicate_presentation
delete_presentation

list_folders
create_folder
delete_folder

set_theme

add_section
set_section
set_section_colors

inspect_slide
add_slide
move_slide
duplicate_slide
delete_slide
set_slide_title
set_slide_has_title

split_zone
adjust_split
delete_zone

set_zone_text
set_zone_card
adjust_subfields
set_zone_asset
set_image_focus
set_image_caption
set_vertical_alignment

list_sandbox_items
place_sandbox_item
duplicate_sandbox_item
delete_sandbox_item

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
- citations koblet til reference-ID;
- bilder som står mellom avsnittene, med `assetId` til en fil dekket allerede har.

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

### Tema

Temaet er globalt: font for titler, font for brødtekst, luft og skriftstørrelse
gjelder hele presentasjonen, og en enkelt slide kan ikke avvike. Farger er ikke
en del av det – de er en seksjons, og settes med `set_section_colors`.
En agent som ikke kan styre det, kan bare lage innhold i standardtemaet – og da
er «lag en gjennomført presentasjon» ikke en oppgave den kan gjøre ferdig.

Kontrakten er derfor:

- **Lesing hører hjemme i `get_presentation`.** Temaet er lite, globalt og noe
  enhver plan for en slide avhenger av, så en agent som har lest presentasjonen
  har lest temaet. Ingen egen `get_theme`; API-flaten skal være liten og
  ortogonal.
- **Skriving er én operasjon**, `set_theme`, over den eksisterende
  `setTheme`-kommandoen. Ingen validering, ingen klamping og ingen temalogikk i
  agentlaget – det som avgjør er kommandoen editoren også bruker.
- **Fonter navngis med id fra fontkatalogen**, og det publiserte JSON
  Schema-et er et enum generert fra `src/domain/fonts.ts`. Det gjør de gyldige
  valgene oppdagbare i `tools/list`, og det finnes ingen andre liste som kan
  havne bak katalogen. Enumet er katalogens **garanterte** halvdel – se
  «Webfonter, hodeløs fit-måling og hva et preview kan love» under.
- **Skalaene publiseres med domenets eget intervall.** Editorens fire trinn er
  navn en agent kan bruke for å si «normal», ikke grensene den må holde seg til;
  de siteres i beskrivelsen fra `SPACING_PRESETS` og `FONT_SCALE_PRESETS`. En
  agent som ber om 1.12 har bedt om noe lovlig, og fit-guarden avgjør resten.
- **Fargene ligger ikke i temaet**, de settes per seksjon med
  `set_section_colors`. Editorens
  palett er en måte å klikke en farge på, ikke en begrensning domenet har.
- **Endringen er atomisk.** En temaendring måler hele dekket på nytt mot det
  prospektive temaet, og en endring som ville skjult innhold avvises med
  `CONTENT_DOES_NOT_FIT` – hele endringen, også feltene som i seg selv var
  harmløse. Ingenting lagres. `expectedRevision` virker som ved enhver annen
  mutasjon.
- **Luft og skriftstørrelse er to spørsmål, ikke ett.** De flytter geometrien
  selv – gapet mellom soner, høyden på tittelsonen og kromet et kort bruker – og
  fit-guarden måler om teksten er synlig: et større gap kan presse en sju-delt
  slide under minstemålet for kortene som står der uten at ett tegn forsvinner.
  `setTheme` spør derfor først om geometrien (`findGeometryRegression`, som
  bruker den samme `validateSlideGeometry` som `validate_presentation`) og
  svarer `ZONE_TOO_SMALL` med slide og sone. Et tema guarden slipper gjennom kan
  dermed ikke være et valideringen avviser. Begge guardene er regresjonssjekker:
  et dekk som allerede er for trangt – en import, eller et dokument fra før en
  token endret seg – må fortsatt kunne repareres.
- **Rektangelet en avvisning bærer er det prospektive.** `guardFit` legger ved
  rektangelet fra dokumentet som ble avvist, ikke fra det som fortsatt står:
  målingen feilet mot gapet og tittelhøyden det *nye* temaet gir, og rommet en
  sone hadde før ville sendt agenten på å korte ned med feil mengde.

#### Webfonter, hodeløs fit-måling og hva et preview kan love

En font avgjør hvor mye tekst som får plass, så «hvilken font ble dette godkjent
mot?» må ha ett svar – og bildet agenten deretter ser på må være i den samme
fonten. Tre mekanismer, og de er bare enige fordi inndataene er begrenset:

- **I nettleseren** måler fit-gaten den ekte DOM-en, altså den fonten som er
  lastet i det øyeblikket. Derfor venter `ThemeModal` på `ensureWebFonts` før
  den kaller `setTheme`: måles endringen midt i nedlastingen, godkjennes den mot
  reservefonten og tegnes i noe annet et øyeblikk senere.
- **Hodeløst – som er hvert eneste agentkall** – måles ingenting. Estimatoren
  leser `advanceRatioFor(stack)`, et tall katalogen oppgir for *den* fonten, og
  det er det samme tallet enten fontens bytes noen gang kommer eller ikke. Et
  fit-svar beskriver derfor alltid fonten som ble navngitt.
- **Et rendret preview** tegnes av en hodeløs Chromium, som har de fontene
  Slaids ga den og ingen andre.

Det siste punktet er grunnen til at katalogen skiller eksplisitt mellom to
slags fonter, og at agenten bare får den ene:

- en **webfont** navngir en Google Fonts-familie, så Slaids henter ansiktene
  selv – nettleseren gjennom `ui/fonts.ts`, rendreren gjennom
  `render/fonts.ts`. Den kan gis til hvem som helst som skal tegne dekket, og
  en henting som feiler *rapporteres* i stedet for å byttes ut i stillhet;
- en **lokal font** er en maskinen enten har eller ikke har: Calibri, Segoe UI,
  Times New Roman. Den hører hjemme i editoren, der forfatteren ser resultatet
  på sin egen maskin og Slaids måler nettopp den DOM-en. Den kan ikke sendes
  noe sted, og en serverless Linux-container har ingen av dem.

En lokal font var derfor det ene tilfellet der de tre kunne bli uenige uten at
noen merket det: det finnes ingenting å hente, så hentingen lykkes trivielt,
rasterizeren har ingen familie å vente på – og «ingenting å vente på» svarte
`fontsReady: true` mens containeren tegnet noe annet. Fit-svaret beskrev
Calibri, bildet viste en reservefont, og API-et sa at alt var i orden.

Kontrakten er derfor:

- `set_theme` publiserer `GUARANTEED_FONT_IDS`, ikke hele katalogen. En agent
  kan ikke velge en font previewet ville byttet ut. Listen genereres fra
  katalogen (`isGuaranteedFont`), aldri skrevet ut på nytt.
- Et dekk kan fortsatt *inneholde* en lokal font, fordi et menneske kan velge
  den i editoren. `get_presentation` leser den som før, og markerer den med
  `guaranteed: false` – så agenten vet både at `set_theme` ikke tar den tilbake
  og at et preview ikke er tegnet i den.
- `fontsReady: true` betyr at bildet er i dekkets egen skrift. Den er `false`
  av begge grunner den kan være det: en webfont som ikke kom fram, og en font
  som aldri kunne komme fram. `warnings` sier hvilken.
- Editoren er uendret og tilbyr fortsatt hele katalogen.

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
set_image_focus(zoneId, x, y)
set_image_caption(zoneId, position, spans, color)
```

Assetopplasting og plassering er separate operasjoner. Et opplastet asset skal derfor kunne gjenbrukes og inspiseres før det plasseres.

En fil med nøyaktig samme bytes som en presentasjonen alt har, lagres ikke igjen:
`upload_asset` og `create_svg_asset` svarer med den eksisterende filens `assetId`
og `deduplicated: true` (se §26, «Bildeoptimalisering»). Identiteten er bytene,
aldri navnet.

`set_zone_asset` plasserer bildet som §13.4 beskriver det: det fyller sonen helt
og beskjæres. Utsnittet er derfor en redigering i seg selv, og den ene en agent
ikke kan gjøre ved å velge en annen fil — derav `set_image_focus`. En sone som
allerede *har* et bildepanel uten fil i seg er en sone som venter på en, ikke
opptatt innhold: å fylle den beholder kortets tittel, utsnittet og bildeteksten,
og `replace` har ingenting å beskytte. Et panel som allerede viser en fil er
vanlig innhold og går gjennom den vanlige regelen.

`inspect_slide` og `list_sandbox_items` leser bildet tilbake gjennom det samme
`image`-feltet: filen, utsnittet som to tall, og bildeteksten som spans — nøyaktig
det `set_image_focus` og `set_image_caption` tar imot igjen.

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

`create_svg_asset` skal derfor validere og sanitere SVG før lagring – og det
gjelder hver eneste inngang, ikke bare den. Editorens opplastingsdialog,
`upload_asset` og `.slaids`-import går gjennom den samme døren
(`src/domain/assetIngress.ts` → `src/domain/svg.ts`), så hvilken vei en SVG kom
inn påvirker verken hva Slaids godtar eller hvilke bytes som lagres. Se «Én dør
inn til assetlageret» i §44.

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
slaids_add_section
slaids_set_section
slaids_set_section_colors
slaids_inspect_slide
slaids_add_slide
slaids_split_zone
slaids_adjust_split
slaids_set_zone_text
slaids_set_zone_asset
slaids_set_image_focus
slaids_set_image_caption
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

#### Klienter som ikke tar imot et token

Noen klienter tilbyr ingen måte å oppgi en fast API-nøkkel på. En egendefinert
MCP-app i ChatGPT har to valg – ingen legitimasjon, eller OAuth – og ingenting
imellom. Agent-API-et skal derfor ta imot **to legitimasjonsfamilier**:

- et agenttoken, som over;
- et OAuth 2.1 access token utstedt av Slaids' egen autorisasjonsserver.

Autorisasjonsserveren skal være **Supabase Auth**, det samme prosjektet
innloggingen allerede bruker. Slaids skal ikke bygge en egen: en andre
brukerkatalog og en andre samtykkeflyt for de samme personene er nøyaktig det
énbruker-modellen finnes for å unngå. Slaids er en OAuth *ressursserver* og
ikke noe mer.

Kravene til den halvdelen:

- **Metadata.** MCP-endepunktet skal publisere protected resource metadata
  (RFC 9728) med den kanoniske adressen sin som `resource` og
  autorisasjonsserveren i `authorization_servers`. Dokumentet er offentlig – det
  er dét en klient leser fordi den ikke har en legitimasjon ennå.
- **Utfordring.** En 401 skal bære `WWW-Authenticate: Bearer …` med
  `resource_metadata` som peker på dokumentet, slik RFC 9728 §5.1 definerer, og
  bare når dokumentet finnes.
- **Verifisering.** Signaturen skal verifiseres mot autorisasjonsserverens
  nøkkelsett, med en lukket liste over asymmetriske algoritmer. Ingen påstand i
  et token skal leses før signaturen er verifisert. Utsteder, mottaker og utløp
  skal sjekkes, og et token uten `client_id` – altså et vanlig
  innloggingstoken fra nettleseren – skal avvises: det er ikke en delegasjon.
- **Hvem som slipper inn.** Slaids er fortsatt énbruker. Prosjektet deles med
  andre apper, og API-et holder en nøkkel som går forbi row level security, så
  hvilke Supabase-brukere som får koble seg på skal være en eksplisitt liste i
  servermiljøet. Uten den listen tilbyr installasjonen ingen OAuth i det hele
  tatt.
- **Scopes.** Samme fire scopes. Navngir tokenet dem, er tokenet det som
  gjelder; navngir det ingen – som er tilfellet så lenge autorisasjonsserveren
  ikke støtter egendefinerte scopes – gjelder installasjonens standard, og den
  skal ikke inneholde `sharing:write`.
- **Én autorisasjon.** Begge familiene skal ende som det samme prinsipalet, og
  alt etter autentisering – scopekontroll, repository, audit – skal være den
  samme koden. To autorisasjonssystemer bak ett API er det denne regelen
  finnes for å hindre.
- **Samtykke.** Supabase sender brukeren til en samtykkeside appen selv eier.
  Den siden skal navngi hvem som spør, ligge bak den vanlige innloggingen, og
  ikke gi noe som helst ved å bli åpnet.

Verktøykatalogen skal si hvilke verktøy som krever legitimasjon og hvilke
scopes de krever, utledet av operasjonens eget `scopes`-felt – aldri av en
håndskrevet liste.

### Audit

Agentmutasjoner skal kunne skilles fra vanlige UI-mutasjoner i relevante serverlogger/auditdata.

Minst følgende bør kunne spores:

- hvilken legitimasjonsfamilie kallet kom fra;
- token/agent-identitet uten å lagre selve tokenet, eller – for OAuth – hvilken
  klient eieren godkjente. Et OAuth-kall skal aldri få en oppdiktet tokenrad;
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

For fase 6, sandkassen, i tillegg – som ett sammenhengende livsløp, ikke bare
isolerte kall:

- bygg innhold på en slide, utfør en strukturendring som sender det til
  sandkassen, les sandkassen igjen og finn elementet med `list_sandbox_items`,
  i samme tekstformat `inspect_slide` bruker;
- plasser elementet i en ny sone med `place_sandbox_item`, og verifiser at det
  er borte fra sandkassen og riktig til stede på sliden, begge veier lest
  tilbake;
- dupliser og slett et sandkasseelement;
- en utdatert `expectedRevision` gir `CONFLICT` på `place_sandbox_item`, uten å
  skrive noe;
- en ukjent `itemId` gir `SANDBOX_ITEM_NOT_FOUND` på alle tre mutasjonene, uten
  å skrive noe;
- et element som ikke får plass i målsonen avvises med `CONTENT_DOES_NOT_FIT`,
  atomisk – sandkassen og målsonen er uendret etterpå;
- en tilbakeplassering som endrer citation-nummereringen på en helt annen slide
  må gjennom den samme globale fit-guarden (`guardFit`) som enhver annen
  citation-bærende endring, og avvises der innholdet selv ikke endret et
  eneste tegn;
- REST og MCP er enige om sandkassen, id for id, og den offisielle
  MCP-klienten godtar `list_sandbox_items`- og `place_sandbox_item`-verktøyene.

For bilder inne i teksten, i tillegg – tekstformatets egen retning inn og ut, og
livsløpet rundt filen:

- agentformat → `RichDoc` skriver editorens egen node, med filens proporsjoner
  fra `AssetRef` og ingen bytes noe sted;
- `RichDoc` → agentformat leser den samme blokken tilbake, og en roundtrip
  bevarer `assetId`, bredden, alt-teksten og justeringen;
- tekst før og etter bildet, og et bilde sammen med citations og formattert
  tekst, overlever begge veier;
- en node uten fil bak seg er fortsatt `unsupported`, og en tabell, en kodeblokk
  og en nøstet liste er det fremdeles;
- `set_zone_text` gjennom den ekte operasjonen skriver bildet, og
  `inspect_slide` viser det;
- en figur fyller feltet uten å flyte over, uansett hvor høy filen er, i enhver
  subfeltlayout – og det er teksten over en fylt figur som avvises;
- estimatet og en ekte Chromium er enige om alle tre: portrettfiguren som fyller
  feltet, linjen over den som ikke får plass, og banneret som er lavere enn
  feltet;
- en ukjent `assetId`, og en `assetId` som tilhører en annen presentasjon, gir
  `ASSET_NOT_FOUND` uten at noe skrives – og REST og MCP svarer det samme;
- et bilde som ikke får plass gir `CONTENT_DOES_NOT_FIT` atomisk, og et smalere
  bilde lykkes på neste forsøk;
- `delete_asset` ser inline-referansen som bruk, og slipper filen når teksten
  skrives om uten den;
- en duplisering remapper bildet, og kopien viser sin egen fil også etter at
  originalen er slettet;
- `set_zone_text` krever fortsatt bare `presentations:write`.

For fase 6, oppryddingen, i tillegg – og her er avvisningene viktigere enn
suksessene, fordi de er de eneste som kan ødelegge et dekk:

- et ubrukt asset slettes: `AssetRef`-en forlater dokumentet *og* bytene
  forlater lagringen, og revisjonen i kvitteringen er den lagrede;
- et asset som er innholdet i en sone avvises med `ASSET_IN_USE`;
- et asset som bare ligger inline i rik tekst avvises på samme måte – det er
  tilfellet en sjekk på soneinnhold alene ville sluppet gjennom;
- et asset som bare vises fra innhold i sandkassen avvises også;
- etter hver avvisning er både dokumentet og assetlageret nøyaktig som før,
  sammenlignet mot lagret tilstand og ikke mot et kall på en stubb;
- avvisningen navngir aldri en slide, en sone eller et sandkasseelement, bare
  hvor mange steder av hvert slag filen vises;
- en fil som ikke lot seg slette fra lagringen etter at dokumentet var skrevet
  rapporteres som `fileRemoved: false` – aldri som en feil, og aldri ved å
  legge referansen tilbake;
- `delete_unused_references` rydder én ubrukt referanse, flere ubrukte
  referanser, og lar de siterte stå – også når de tre tilfellene er i det samme
  dekket, og også når det som siterer er en slidetittel eller innhold i
  sandkassen;
- et andre kall er en no-op som fjerner ingenting og ikke flytter revisjonen;
- en utdatert `expectedRevision` gir `CONFLICT` på begge, uten å rydde noe;
- et token med bare `assets:write` kan slette en fil uten å kunne lese dekket,
  og et token med bare `presentations:write` kan rydde referanser uten at
  kvitteringen bærer en eneste tittel, forfatter eller lenke;
- REST og MCP svarer med den samme kvitteringen, den samme feilkoden, de samme
  tallene og den samme MCP-konvolutten.

For bibliotekets livsløp i tillegg:

- mappene listes, også når det ikke finnes noen;
- en mappe opprettes, navnet trimmes, og et tomt navn avvises uten at noe
  skrives – to mapper med samme navn er to mapper, som i biblioteket;
- mappen som nettopp ble laget listes, tar imot et nytt dekk (`create_presentation`)
  og et som fantes fra før (`move_presentation`);
- en tom mappe slettes, og en mappe med flere presentasjoner slettes uten at én
  eneste av dem forsvinner: alle finnes etterpå med `folderId: null`, både i
  dokumentet og i kolonnen oversikten filtrerer på, og en annen mappe og det som
  ligger i den er urørt;
- en mappe som ikke finnes avvises med `FOLDER_NOT_FOUND` – både på flytting og
  på sletting, og på det andre slettekallet – før noe skrives, og avvisningen
  bærer aldri et mappenavn;
- de to mappeoperasjonene virker med `presentations:write` alene, uten lesescope,
  og verken kvitteringen eller avvisningen bærer et mappenavn eller en dekktittel;
- lengdegrensen er den samme fra begge dører: det lengste lovlige navnet godtas
  og ett tegn mer avvises, i `createFolder` og i det publiserte skjemaet;
- slettingen er ett kall og ikke en sekvens setninger (ingen listing, ingen
  rad-for-rad-oppdatering, ingen egen `DELETE`), den tar imot de nye versjonene
  så en åpen editor ikke taper et kappløp den ikke var i, og en manglende
  migrasjon sier at migrasjonen mangler i stedet for at mappen ikke kan slettes;
- SQL-en selv låser mapperaden først, tømmer begge stedene i den samme setningen,
  fjerner mappen etterpå, filtrerer hver setning på eier og er ikke
  `security definer`;
- en lagringsfeil i `saveFolder` eller `deleteFolder` er `STORAGE_FAILED`, og
  lar biblioteket stå som det sto;
- en flytting til mappen dekket allerede ligger i er en no-op som ikke flytter
  revisjonen;
- en duplisering tar med innhold, referanser, citations og filer, og kopien får
  nye id-er hele veien – slides, soner, innhold, subfelt, sandkasse og filer;
- originalen står bit for bit uendret etter at kopien er redigert, og kopiens
  filer overlever at originalen slettes;
- en duplisering som ikke gikk igjennom etterlater ingen halv kopi – når en
  filskriving feiler, når en kildefil forsvinner fra lagringen etter at
  revisjonen er sjekket, og når selve kopiraden ble skrevet mens svaret forsvant;
- tilbakerullingen fjerner kopien også når filoppryddingen i lagringen er ødelagt;
- en vanlig presentasjon slettes – til søppelkassen; en med filer beholder
  radene og bytene til søppelkassen tømmes, og da går de med; en publisert
  slettes uten `sharing:write`; en presentasjon i søppelkassen er
  `PRESENTATION_NOT_FOUND` for hver operasjon, denne inkludert;
- en sletting av noe som ikke finnes er `PRESENTATION_NOT_FOUND`, ikke et stille
  `ok`;
- en utdatert `expectedRevision` gir `CONFLICT` på flytting, duplisering og
  sletting, uten å endre noe – og slettingen vaktes mot lesingen operasjonen selv
  tok, også når kalleren ikke oppga en;
- en sletting krever begge skriveautoritetene, en duplisering krever lesescopet,
  og et token uten lesescope kan flytte og slette uten at kvitteringen bærer en
  tittel eller et mappenavn;
- REST og MCP svarer med den samme kvitteringen, den samme feilkoden og den
  samme MCP-konvolutten.

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

Fase 1, 2, 3, 4 og 5 er på plass, og flaten er siden utvidet i to runder (se
«Fase 6» og «Fase 7» nedenfor):

- `src/agent/` – Agent Core. `registry.ts` er katalogen og den ene veien inn
  (`runOperation` kaster aldri); `types.ts` er konteksten, konvolutten og
  feilkodene; `presentation.ts` er load → revisjonssjekk → domenekommandoer →
  save, med fit-sjekkerne som aldri utelates; `text.ts` er det agentvennlige
  tekstformatet; `assetStore.ts` er den ene veien et asset kommer inn;
  `operations/` er selve operasjonene.
- Lesing: `list_presentations`, `list_folders`, `get_presentation` (som også
  bærer temaet og `sandboxCount`), `inspect_slide`, `list_assets`,
  `list_sandbox_items`, `validate_slide`, `validate_presentation`.
- Lesing (forts.): `get_sharing`, `render_slide_preview`.
- Skriving: `create_presentation`, `set_presentation_title`,
  `create_folder`, `delete_folder`,
  `move_presentation`, `duplicate_presentation`, `delete_presentation`,
  `set_theme`, `add_section`, `set_section`, `set_section_colors`, `add_slide`,
  `duplicate_slide`, `move_slide`,
  `delete_slide`, `set_slide_title`, `set_slide_has_title`, `split_zone`,
  `adjust_split`, `delete_zone`,
  `clear_zone`, `move_zone_content`, `copy_zone_content`, `set_zone_text`,
  `set_zone_card`, `adjust_subfields`,
  `set_image_focus`, `set_image_caption`, `set_vertical_alignment`,
  `place_sandbox_item`, `duplicate_sandbox_item`, `delete_sandbox_item`,
  `add_reference`, `update_reference`, `delete_reference`, `upload_asset`,
  `create_svg_asset`, `set_zone_asset`, `add_interactive_slide`,
  `set_interactive_slide`.
- En interaktiv slide (§ 8.7) listes og inspiseres med navn, filnavn og
  `htmlByteSize`, aldri med kilden; de to operasjonene tar kilden inn gjennom
  den samme døren som opplastingsdialogen, og `render_slide_preview` tegner
  forsiden.
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
- `src/domain/assetIngress.ts` – den ene døren som setter de tre sammen, og som
  hver inngang kaller. Se under.

#### Én dør inn til assetlageret

En fil blir et asset gjennom flere innganger – editorens opplastingsdialog,
`upload_asset`, `create_svg_asset`, en `.slaids`-backup – og alle ender med de
samme bytene i det samme lageret, tegnet av den samme rendereren. Hvilken vei en
fil kom, skal derfor ikke avgjøre hva Slaids godtar eller hvilke bytes som
lagres. `acceptAsset` i `src/domain/assetIngress.ts` avgjør det, én gang, for
alle sammen.

Invarianten, sagt rett ut: **en SVG som kommer utenfra Slaids kan aldri nå
assetlageret uten først å ha blitt tolket og sanitisert av `src/domain/svg.ts`.**
Ingenting kan lagres som `image/svg+xml` som ikke kom ut av `sanitizeSvg`.

Døren svarer på to spørsmål:

1. **Hva er dette, egentlig?** Formatet leses av bytene (`imageBytes.ts`), aldri
   av et filnavn, en `File.type` eller kallerens ord. En `.png` som inneholder
   `<svg>`-markup *er* en SVG, og en `.svg` som inneholder PNG-bytes *er* en
   PNG – og den andre veien betyr like mye som den første: det er MIME-typen en
   lagret fil serveres med som gjør den til aktivt innhold, så den typen er
   alltid snifferens svar.
2. **Hva får lagres?** To validatorer, én per innholdstype: raster går gjennom
   `imageFile.ts`, SVG gjennom `domain/svg.ts`. Det som kommer tilbake i `bytes`
   er det som skal lagres – for en SVG er det reserialiseringen og aldri
   inndataen. Derfor er dette en funksjon som returnerer bytes og ikke et
   predikat som returnerer en dom: en kaller kan ikke glemme å bruke den rene
   versjonen når den rene versjonen er den eneste den får.

Størrelsesgrensen (`MAX_ASSET_BYTES`) hører hjemme her av samme grunn, og måles
to ganger for en SVG: på det som kom inn, og på det som faktisk lagres.
Reserialisering kan vokse en fil – hver `&` kommer tilbake som `&amp;`.

**En SVG leses i tegnkodingen den selv oppgir.** SVG er XML, og XML sier hvordan
det er skrevet: en byte order mark, eller `encoding="…"` i deklarasjonen.
`declaredTextEncoding` i `imageBytes.ts` er den ene lesingen av det, delt av
snifferen – som ellers ikke ville kjent igjen en UTF-16-fil, der hver andre byte
er null – og av døren. Å lese alt som UTF-8 er riktig for nesten hver fil og
stille galt for resten: hvert aksenttegn i en Windows-1252-eksport fra
Illustrator kommer tilbake som U+FFFD, og det som lagres er en figur med ødelagt
tekst i seg. Det er verre enn en avvisning, fordi ingen får vite det. En
tegnkoding `TextDecoder` ikke tar imot avvises ved navn i stedet for å gjettes
på. Det som lagres er alltid UTF-8, og ingen trenger å huske det:
reserialiseringen bygges av det parsede treet og dropper XML-deklarasjonen
sammen med alle andre prosesseringsinstruksjoner, og et dokument uten
deklarasjon er UTF-8 per definisjon.

Det eneste som varierer mellom dørene, er hvordan *raster* måles, og det er
nettleserens dekoder og ikke en andre policy:

- `raster: 'bitstream'` – `imageFile.ts` går gjennom hele filen og størrelsen tas
  ut av den. Hodeløse dører: `upload_asset`, `create_svg_asset`.
- `raster: 'caller'` – bytene beholdes som de er, og størrelsen kommer fra en
  kilde døren allerede har. To dører kvalifiserer, av samme grunn: noen har
  allerede dekodet dette bildet. Editoren har nettleseren, som er den ene
  kjøretiden som kan lese størrelsen på en AVIF – derfor tar editoren imot AVIF
  og agentveien ikke – og en `.slaids`-backup bærer størrelsen som ble lest den
  gangen filen først ble lagret, ved en av disse dørene.

Ingen av modusene slipper en byte usanitert SVG forbi, og begge bruker den samme
listen over formater.

**En avvist fil etterlater ingenting.** Valideringen skjer før den første
skrivingen, ikke som en angring etterpå: ingen blob i IndexedDB eller Supabase
Storage, ingen `AssetRef` i dokumentet, ingen halvplassert figur i en sone.
Editorens dør er `src/state/assetUpload.ts` – lagt der og ikke i komponenten
fordi en sikkerhetsgrense begravd i en event handler bare kan testes ved å kjøre
en komponent.

**`.slaids`-import er ekstern input.** En backup er nøyaktig like troverdig som
en `.svg` noen sender deg, og åpnes av den samme parseren. Rasterfiler beholdes
byte for byte med størrelsen arkivet husket (`raster: 'caller'`): å utlede den på
nytt ville gjort et bilde som har ligget i et dekk i et år uimporterbart av en
grunn eieren ikke kan gjøre noe med. SVG får ingen slik tvil til gode. En figur
som avvises rapporteres ved navn og hoppes over – dekket importeres fortsatt,
akkurat som når fildata mangler.

«Hoppes over» gjelder dokumentet også. En fil som ikke blir lagret – avvist,
uten bytes i arkivet, eller uten oppføring i registeret – fjernes med
`dropAssetIds` (`src/domain/docs.ts`, speilbildet av `remapAssetIds`) fra
assetlisten *og* fra hvert sted som viste den: sonen, bildet inne i teksten,
sandkassen. Ellers ville importen svart `ok` med et dekk som peker på bytes
ingen kommer til å skrive – nøyaktig det `unknownAssetIds` kaller ødelagt – og
med en id-remapping på toppen ville pekeren til og med vært *ny*. En bildesone
blir stående som en sone som venter på en fil (`assetId: null`) og beholder
utsnitt, bildetekst og tittel; et bilde inne i teksten er en blokk som ikke kan
tegnes uten fil, og tas ut, med et tomt avsnitt igjen hvis feltet ikke hadde
annet. En SVG uten `viewBox` eller `width`/`height`
avvises også her, og det er med vilje: Slaids plasserer bilder etter
størrelsesforholdet, og forholdet arkivet husket for en slik fil var nettleserens
egen 300 × 150-gjetning – altså nøyaktig gjetningen §44 nekter å plassere etter.

**Interne kopier er unntaket, og de er ikke et hull.** Innliming på tvers av
presentasjoner (`state/pasteAssets.ts`) og duplisering (`persistence/library.ts`)
flytter bytes som allerede kom gjennom døren, fra ett Slaids-lager til et annet.
Å validere dem på nytt ville dømt en lagret fil etter dagens regler i stedet for
reglene den ble lagret under. Regelen døren håndhever gjelder hva som får
*komme inn* i lageret, og den håndheves én gang, ved inngangen. Clipboard-
payloaden navngir bare asset-id-er og bærer aldri bytes, så fremmed tekst kan
ikke nå hit i det hele tatt.

To tester håndhever dette mekanisk, fordi feilen ellers er stille:
`src/domain/assetIngress.test.ts` leser kildetreet og krever at hver fil som
kaller `putAsset` enten går gjennom `assetIngress.ts` eller står på den
navngitte listen over interne kopier, og at `sanitizeSvg` har nøyaktig én
kaller. En andre kaller ville stått fritt til å lese resultatet annerledes, og de
to dørene ville glidd fra hverandre uten at noe feilet.

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
  postet som markup, og skal møte de samme reglene. Det er `assetIngress.ts` som
  gjør det sant for editoren og `.slaids`-import også – se «Én dør inn til
  assetlageret».

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

Et bilde som står inne i teksten er en blokk til: `image`, med `assetId` til en
fil presentasjonen allerede har. Se «Bilder inne i teksten» under.

To ting formatet ikke kan uttrykke, og hva som skjer med dem:

- **Struktur editoren kan lage og formatet ikke kan** – tabell, kodeblokk,
  nøstet liste. Lesing gir en `unsupported`-blokk som navngir
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
et avsnitt, en overskrift eller et bilde, og `align`/`titleAlign` på operasjonene
som setter en tittel. Utelates den, beholdes justeringen tittelen allerede hadde –
en agent som er bedt om å endre ordene har ikke bedt om å midtstille dem tilbake
til venstre.

#### Bilder inne i teksten

Et bilde kan stå på to steder, og de er to forskjellige ting. Det ene er hele
sonens innhold: `set_zone_asset`, der bildet fyller sonen ut til kantene og
beskjæres, og `set_image_focus`/`set_image_caption` bestemmer utsnittet og
teksten over det. Det andre er en figur som står mellom avsnittene i et
tekstfelt, og *den* er en blokk i tekstformatet:

```json
{ "type": "image", "assetId": "as_…", "alt": "Figur 1", "widthPercent": 60, "align": "center" }
```

Fire ting gjør dette til én modell og ikke to:

- **Det er editorens egen node.** Blokken oversettes til `slaidsImage` med de
  samme attributtene editorens innsettingsknapp skriver, og
  `src/domain/richdoc.ts` er det ene stedet de attributtene leses – av den
  statiske rendereren, av den hodeløse fit-estimatoren og av tekstformatet.
  Det er dét som gjør at `delete_asset` teller bildet som bruk, at en
  duplisering peker kopien på kopiens egen fil, og at import og paste
  remapper den, uten at noen av dem trengte å lære en agentspesifikk
  referanse å kjenne.
- **Aldri bytes i tekstformatet.** Blokken navngir en fil som allerede ligger i
  presentasjonen; `upload_asset` og `create_svg_asset` er fortsatt de to eneste
  dørene bytes kommer inn gjennom. Derfor krever det ingen `assets:write` å vise
  en fil som allerede finnes: ingenting skrives til, leses fra eller fjernes fra
  fillageret, og en referanse til en fil er en helt vanlig redigering av
  dokumentet. Å legge filscopet på `set_zone_text` ville gitt hver eneste
  tekstendring rett til å fylle lageret.
- **Filen må være dekkets egen.** `assetId` slås opp i presentasjonens egen
  filliste (`unknownAssetIds`, samme utledning som `set_zone_asset` og
  `setImageAsset` bruker) *før* noen kommando kjører, så en id fra en annen
  presentasjon er `ASSET_NOT_FOUND` og ingenting lagres. Assets tilhører én
  presentasjon, så det finnes ingen egen regel for «en fil fra et annet dekk» –
  det er den samme sjekken.
- **Proporsjonene er filens, ikke kallerens.** Skjemaet har ingen `aspect`:
  høyden følger av `AssetRef`-ens `width`/`height`, som ble lest ut av
  bitstrømmen da filen ble lagret. Et forholdstall en kaller oppga ville vært en
  påstand, og en påstand er nøyaktig det som ville fått fit-målingen og den
  tegnede sliden til å være uenige. `widthPercent` er andelen av kolonnen –
  `INLINE_IMAGE_MIN_WIDTH_PERCENT`–100, standard 50 – så et bilde kan aldri bli
  bredere enn feltet rundt det.
- **Og en figur er alltid innelukket av feltet sitt.** `.rd-image-wrapper` er
  `max-height: 100%` i et felt med en bestemt høyde, så nettleseren tegner den
  aldri høyere enn feltet: «a figure can never be the cause of an overflow», som
  `slide.css` sier det. Estimatoren måler derfor `min(bredde / aspect,
  felthøyde)`. Bare det første leddet ville avvist et portrettfotografi ved
  *enhver* bredde – taket er det samme ved enhver bredde – for innhold den ekte
  rendereren tegner helt fint. Taket er hele feltets høyde og ikke plassen som
  er igjen under blokkene over, fordi det er dét en prosentandel regnes mot: en
  linje over en fylt figur flyter over med nøyaktig sin egen høyde. Inne i et
  listepunkt eller et sitat finnes taket ikke, fordi prosenten der regnes mot en
  `auto`-høyde, og figuren er da så høy som proporsjonene gjør den.
  Det som avvises er altså teksten rundt figuren, ikke figuren:
  `CONTENT_DOES_NOT_FIT` med sonens rect og overflow, akkurat som for mye tekst,
  og løkken agenten kjører er den samme – bare med bredden som ett av det som
  kan kortes ned.
- **To målinger av det samme spørsmålet må sjekkes mot hverandre, ikke
  resonneres om.** Den hodeløse estimatoren gater hvert agentkall og
  DOM-målingen gater editoren; der de er uenige blir en slide enten avvist selv
  om den tegnes perfekt, eller godtatt selv om den klippes – og ingen av delene
  sier fra. Figuren var nettopp et slikt sted. `src/render/fitParity.test.ts`
  sammenligner derfor estimatet med `scrollHeight - clientHeight` i en ekte
  Chromium, på den samme markupen `DeckPageView` tegner.

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
ubevoktet les-så-skriv.

Editorens autosave sender ingen `SaveGuard`, men skriver likevel ikke ubetinget:
den er låst mot det *dette lageret sist så* – `knownVersions` i Supabase,
`knownRevisions` i Dexie – og hver av dens egne skrivinger flytter betingelsen
framover. Én fane lagrer derfor så ofte den vil, mens en fane som sitter på en
eldre kopi blir avvist og må lese på nytt. Det er ikke bare tekst som står på
spill: en nyere lagret versjon kan ha *slettet* filer den eldre kopien fortsatt
peker på (bildeoptimalisering erstatter filer og fjerner det ingenting viser),
og en stale skriving ville dermed etterlatt et lagret dokument som navngir filer
som er borte. Betingelsen er lagerets egen nettopp derfor: den kan ikke være
avhengig av at hver kaller husker å be om den.

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

`applySteps` gjør *lagringen* atomisk, ikke *målingen*: hvert steg er fortsatt
en egen kommando med sin egen fit-guard, så en mellomtilstand blir målt på egne
premisser. Det er som regel riktig, og nøyaktig én gang er det galt – når to
spørsmål gjelder det samme rektangelet. Retning, forholdstall og antall subfelt
er et slikt tilfelle: to subfelt over hverandre kan være for lave for en figur
to subfelt ved siden av hverandre bærer fint, så «sett antallet» etterfulgt av
«sett retningen» kommer aldri fram – det første steget avvises på veien, og
måltilstanden er ikke bare tungvint, den er uoppnåelig. Svaret er ikke å slå av
guarden for mellomtilstanden, men å la kommandoen dekke hele spørsmålet:
`setBodyLayout` tar alle tre og måler én gang, slik `updateSplit` alltid har
gjort for en splitting. `setSubfieldCount`, `setBodyAxis` og `setBodyWeights` er
den samme kommandoen med ett av feltene fylt ut, og editoren – som endrer én
ting av gangen – bruker dem uendret.

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

MCP ligger på `POST /api/agent/v1/mcp` – i den samme Vercel-funksjonen, med det
samme tokenet og den samme auditen. Ikke som en besparelse, men fordi alt rundt
det faktisk *er* det samme; det som skiller ligger i `src/server/mcp/`.

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

**MCP discovery er offentlig; Slaids-operasjoner er autentiserte og
scope-gatede.** Dette er den ene adressen i API-et der de to halvdelene møtes, og
derfor den ene adressen som autentiserer for seg selv. Hver REST-rute svarer
fortsatt `401` før den ruter noe som helst, og `tools/call` krever nøyaktig det
tokenet og de scopene et REST-kall krever – det som er åpent, er at en klient kan
håndhilse og lese verktøykatalogen *før* en eier har gitt den et token.

Det er ikke en høflighet, det er rekkefølgen en klient bygges i. En egendefinert
MCP-app i ChatGPT skanner serveren for verktøy når appen opprettes, og lagrer den
katalogen med appen – før, og uavhengig av, at en sluttbruker kobler på kontoen
sin. En server som svarte `401` på `initialize` fikk dermed publisert en app med
tom verktøyliste: integrasjonen koblet seg opp og tilbød ingenting. Den samme
rekkefølgen finnes i enhver «skann serveren, koble på kontoen etterpå»-klient og i
inspektørverktøyene folk feilsøker med.

MCP-spesifikasjonen står ikke i veien for dette. Autorisasjon er **valgfritt** der
(«Authorization is OPTIONAL for MCP implementations») og ligger på
*transportnivå*, så en server kan beskytte noen forespørsler og ikke andre. Det
spesifikasjonen låser, er *svaret* når en forespørsel trenger et token og ikke har
et: `401` for «authorization required or token invalid», `403` for manglende
scopes. Slaids svarer nøyaktig det – `401` med `WWW-Authenticate` på transporten,
ikke en JSON-RPC-feil inne i en `200`, for det er 401-et en klient med et utløpt
token trenger å se for å gå og hente et nytt. Slaids implementerer ikke OAuth, og
`WWW-Authenticate` bærer derfor ingen `resource_metadata`: et agenttoken er en
delegasjon eieren lager i biblioteket og limer inn i klienten, ikke noe en klient
kan gå og skaffe seg.

To ting gjør at dette ikke er et hull, og begge er egenskaper ved koden:

1. **Bare meldinger som ikke kan nå et dekk er offentlige.** `METHOD_ACCESS` i
   `src/server/mcp/server.ts` er en total avbildning over metodene serveren
   implementerer, og dispatch-switchen er uttømmende over nøklene dens – så en
   metode kan ikke implementeres uten å bli klassifisert, og ikke klassifiseres
   uten å bli implementert. En håndholdt liste over «offentlige metoder» ved
   siden av en switch er nøyaktig den andre kontrakten dette laget er bygget for
   å unngå, og den ville gått galt den stille veien: en metode lagt til i
   switchen og glemt her, født offentlig.

   `tools/call` er den eneste metoden som når `invoke.ts`, og altså den eneste
   som kan lese eller endre noe. `initialize`, `ping` og `tools/list` svarer ut
   av registeret alene: katalogen kompileres av operasjonsdefinisjonene i
   bundelen – navn, beskrivelse, JSON Schema, påkrevde scopes – så den er de
   samme bytene for hver kaller og for ingen. En notifikasjon, et løst svar og en
   ødelagt konvolutt er offentlige *ved konstruksjon* og ikke ved oppramsing:
   `dispatchMcpMessage` kvitterer for hver av dem uten å dispatche noe i det hele
   tatt. En metode serveren ikke har svarer fortsatt `-32601` til hvem som helst,
   fordi listen i avvisningen er de fire navnene spesifikasjonen alt publiserer –
   og fordi klienter spør etter `resources/list` uansett hva serveren annonserte,
   der et `401` ville lest som «hele denne serveren er stengt».

2. **Et token som *er* sendt, verifiseres alltid** – uansett metode. At discovery
   er åpent handler om en klient som ennå ikke har fått et token, aldri om en
   klient hvis token er trukket tilbake eller utløpt; ellers ville en
   tilbaketrekking i stillhet blitt en nedgradering til anonym tilgang. Et dårlig
   token er derfor `401` på `initialize` også, og det revideres nøyaktig som REST
   reviderer det. En anonym melding skriver ingen auditrad i det hele tatt, av
   samme grunn som REST ikke skriver en for et token ingen har sett før: auditen
   er eierens, nøklet på tokenet som handlet, og her finnes ingen av delene.

At katalogen *kan* være offentlig er en påstand om innhold, ikke om tilgang, så
den holdes på plass som en påstand om innhold: `tools.test.ts` sjekker at verken
et navn, en beskrivelse, et skjema, en default eller et eksempel inneholder en
adresse, en e-post, en uuid, et tokenprefiks, et miljøvariabelnavn, et tabellnavn
eller en eier-id – og at `describeOperations()` og `mcpTools()` ikke tar
argumenter, så de ikke *kan* svare forskjellig for to kallere.
`discovery.test.ts` holder tilgangshalvdelen, og gjør det ved å ta repositoryet
bort: en installasjon der `contextFor` kaster svarer fortsatt på alle tre
offentlige metodene, og telleren viser at ingen av dem så mye som spurte etter
et. Broen mellom de to er at en anonym kaller og et token får nøyaktig de samme
bytene tilbake fra `tools/list`.

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
en seksjon (forsiden er den første), eller id-en til en avledet referanseside – oppslaget
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

Assetlageret har nå én dør, `src/domain/assetIngress.ts` – se «Én dør inn til
assetlageret» over. Editorens opplastingsdialog, `upload_asset`,
`create_svg_asset` og `.slaids`-import går alle gjennom den.

#### Fase 6: temaet, og hva som fortsatt mangler mot editoren

Temaet er nå agentstyrt: `get_presentation` bærer det, `set_theme` setter det, og
begge går gjennom de samme kommandoene og den samme fit-guarden som modalen. Se
«Tema» over for kontrakten. Sammen med det kom to hull som var i veien for at en
agent kunne *vedlikeholde* et dekk den hadde laget: `set_slide_has_title` (en
tittelsone kunne bare bestemmes idet sliden ble laget) og
`set_presentation_title` (navnet i biblioteket kunne bare settes ved
opprettelse). Begge retninger av `setSlideHasTitle` er fit-gatet: å fjerne
tittelsonen gir *denne* sliden mer plass, men en tittel kan sitere, og en
citation som forsvinner tar en referanses første forekomst med seg – da
renummereres citations på slides ingen har rørt. Se kommandolisten i
`fitGuard.ts`.

Sandkassen var det eneste stedet i flaten der en operasjons egen standardverdi
(`disposition: 'sandbox'`) la innhold et sted API-et ikke nådde: en agent kunne
sende innhold dit, men verken se det, hente det tilbake, kopiere det eller
kaste det. Fire operasjoner lukker det hullet, og ingen av dem legger
sandkasse-, fit- eller layoutlogikk i agentlaget – alt av det bor fortsatt i
domenekommandoene. `list_sandbox_items` leser hvert element med en stabil
`itemId` og innholdet i den samme vokabularen `inspect_slide` bruker for en
sone (`inspectContent`, delt av begge – én funksjon, ikke to som kan gli fra
hverandre); telling alene bor i `get_presentation` som `sandboxCount`, av samme
grunn `assetCount` gjør det. `place_sandbox_item`, `duplicate_sandbox_item` og
`delete_sandbox_item` er tynne innpakninger over `placeSandboxItem`,
`duplicateSandboxItem` og `deleteSandboxItem`: fit-gating (både den absolutte
plasseringssjekken og den globale citation-guarden), håndtering av en opptatt
målsone, atomisitet og `expectedRevision` er alt sammen kommandoenes egne,
uendret. De strukturelle operasjonene som allerede sendte innhold til
sandkassen (`split_zone`, `adjust_split`, `delete_zone`, `clear_zone`,
`set_zone_asset`) svarer nå også med `sandboxItemIds` – og `place_sandbox_item`
med `displacedSandboxItemId` – så en agent som nettopp forårsaket en
sandkasseplassering kan fortsette direkte i stedet for å lese sandkassen på
nytt bare for å finne id-en sitt eget kall utløste. Id-ene regnes ut ved å
sammenligne dokumentets `sandbox`-liste før og etter kallet
(`sandboxIdsAdded` i `src/agent/presentation.ts`), aldri ved at en
domenekommando begynner å returnere noe den ikke returnerte før.

Subfeltlayouten var det siste stedet der editoren kunne uttrykke en komposisjon
agenten ikke kunne: `set_zone_card` tok `subfieldCount`, men retningen var
alltid `y` og vektene alltid like, så to tekstkolonner *inne i* det samme kortet
måtte erstattes med to soner og et gap – som er en annen komposisjon, med to
bakgrunner i stedet for én. `adjust_subfields` lukker det, og gjør det med én
operasjon i stedet for to fordi retning, forholdstall og antall er ett spørsmål
mot det samme rektangelet: se «Atomisitet uten transaksjon» over for hvorfor
`setBodyLayout` måtte bli én kommando i domenet, og hvorfor det er den samme
kommandoen editorens tre knapper kaller. Agentlaget er en ren adapter: ingen
layout-, normaliserings- eller fit-logikk, bare `expectedRevision` inn og
`revision` ut. Paret er det samme ett nivå opp – `split_zone` lager
oppdelingen, `adjust_split` former den; `set_zone_card` lager kortet,
`adjust_subfields` former innmaten – og `inspect_slide` rapporterer begge nivåer
med hvert sitt navn (`axis`/`weights` for en splitting, `subfieldAxis`/
`subfieldWeights` for et kort), slik at ingen leser det ene som det andre.

Flytting av innhold var det siste hullet der agenten kunne nå målet, men ikke
uten å ødelegge noe på veien: `moveZoneContent` har alltid ligget i domenet, men
uten en operasjon over den måtte en agent tømme sonen og bygge innholdet opp
igjen et annet sted. Resultatet ser likt ut og er noe annet – content-id-en,
subfelt-id-ene, citationene og filreferansen er alle nye, så hver id agenten
holdt, inkludert de den nettopp hadde bestemt seg for å skrive inn i, peker på
noe som ikke finnes lenger. `move_zone_content` flytter i stedet selve
`ZoneContent`-objektet, og det er hele poenget: id-ene følger med, og en agent
kan skrive videre gjennom dem uten en ny `inspect_slide`. Svaret bærer derfor
målsonens identitet og subfelt-id-ene – og ingenting mer. Det siste er en
scope-grense og ikke bare en konvensjon: `presentations:read` og
`presentations:write` er uavhengige avkryssinger på et token, og domenet regner
en flytting til den sonen innholdet allerede står i som en lovlig no-op, så et
svar som *beskrev* innholdet ville gjort denne operasjonen til et
`inspect_slide` uten lesescopet. Å beskrive hva en sone inneholder hører hjemme
i lesingene; en mutasjon kvitterer med id-er, slik `set_zone_card` og
`adjust_subfields` allerede gjør.

Kilde og mål er to soner, og det avgjør kontrakten: `fromSlideId`/`fromNodeId`
og `toSlideId`/`toNodeId`, aldri et enslig `slideId` som leseren må gjette
tilhørigheten til. `toSlideId` er valgfri fordi «samme slide» er det vanlige,
men den er alltid utfylt i svaret. Av samme grunn sender agentlaget ingen
`slideId`/`nodeId` inn i `mutatePresentation`: de feltene er fallbacken for en
kommando som ikke sa hvilken sone den avviste, og med to soner i spill ville en
fallback merket en kildefeil med målsonen. `moveZoneContent` navngir i stedet
siden selv på hver eneste avvisning, og skiller nå «finnes ikke»
(`NODE_NOT_FOUND`) fra «finnes, men er delt» (`NODE_NOT_LEAF`) på begge sider –
en kaller som fikk den første som den andre ville lett etter en oppdeling som
ikke er der. Alt annet er kommandoens eget, uendret: målet må være en tom
bladsone, plasseringen måles absolutt mot målsonens rektangel, og en flytting
mellom slides som endrer hvilken referanse som forekommer først går gjennom den
globale fit-guarden – den kan gjøre en citation-pille bredere på en slide ingen
rørte.

Kopiering er den samme adresseringen med det motsatte løftet, og derfor en egen
operasjon. `copy_zone_content` tar de samme fire id-ene, kvitterer med den samme
kontrakten og møter de samme reglene: målet må være en tom bladsone, kopien
måles absolutt mot målsonens rektangel, og en kopi som gir en referanse en
tidligere første forekomst må gjennom den globale fit-guarden. Det siste gjelder
selv om kilden blir stående – en kopi *legger til* en citation-forekomst i
stedet for å flytte en, og en tidligere forekomst renummererer alt etter seg.

Forskjellen er id-ene, og den er hele grunnen til at dette ikke er et flagg på
`move_zone_content`: en flytting lover at content-id-en og subfelt-id-ene
overlever, en kopi må lage nye – to bladsoner med samme content-id er et ødelagt
dokument, og et subfelt skrevet fra to adresser er ett felt. `cloneContentWithNewIds`
spør derfor `bodyOf`/`withBody` om hvor kroppen ligger i stedet for å liste
innholdstypene som har en: en ren tekstsone er en `container` hvis payload *er*
en `CardBody`, så en liste over «de to korttypene» lot nettopp den dele
subfelt-id-er med kilden sin – i en kopi *og* i en duplisert slide. En operasjon som
noen ganger gjør det ene og noen ganger det andre er to operasjoner med ett
navn, slik `duplicate_slide` og `move_slide` er to, og `duplicate_sandbox_item`
og `place_sandbox_item` er det. Kilden blir stående bit for bit som den var,
assetreferansen fornyes ikke (en fil dupliseres ikke av å vises to steder), og
kopiens subfelt-id-er er de eneste id-ene agenten umulig kunne kjent på
forhånd – derfor står de i svaret, og en `inspect_slide` etterpå er valgfri.
Kvitteringen er fortsatt id-er og ingenting mer, og det betyr mer her enn i en
flytting: en kopi er den ene mutasjonen som kunne hatt en unnskyldning for å
beskrive innholdet sitt, og et skrivetoken skal fortsatt ikke kunne lese med
den.

Domenet fikk den samme behandlingen. `moveZoneContent` og `copyZoneContent` er
to eksporterte navn over én implementasjon (`transferZoneContent`) i stedet for
én kommando med et `copy`-flagg, og den ene semantiske forskjellen mellom dem
bor der: en flytting til sonen innholdet allerede står i er en lovlig no-op
(dokumentet er allerede i den tilstanden), mens en kopi dit er
`TARGET_OCCUPIED` – å svare `ok` på en kopi som aldri ble laget ville sendt
kalleren på leting etter et innholdsobjekt som ikke finnes. Agentlaget har ingen
gren mellom de to: én innpakningsfunksjon bygger begge operasjonene og får
domenekommandoen inn som argument, så det finnes ikke noe sted der en kopi kunne
få en flyttings semantikk.

Opprydding var det siste hullet der agenten kunne *lage* noe den ikke kunne
fjerne igjen. En agent som lastet opp en figur, plasserte den og senere byttet
den ut, etterlot en foreldreløs fil for alltid: `list_assets` viste den, og
ingen operasjon kunne ta den bort. Det samme gjaldt en referanse som ble lagt
inn og aldri sitert. `delete_asset` og `delete_unused_references` lukker begge,
og begge er tynne innpakninger over kommandoer domenet allerede hadde
(`removeAsset` og `deleteUnusedReferences`) – ingen ny opprydningslogikk i
agentlaget.

Det interessante er avvisningene, ikke slettingene. `delete_asset` skal aldri
kunne etterlate dokumentet med en referanse til en fil som ikke finnes, så
domenet nekter så lenge dekket viser filen – og «viser» betyr alle fire
måtene: som innholdet i en sone, inline i rik tekst, og hver av de to fra
innhold som ligger parkert i sandkassen. En sjekk på soneinnhold alene ville
sluppet gjennom nettopp den varianten editoren lager oftest. Sandkassen teller
med av samme grunn som den teller med i `deleteUnusedReferences`: parkert
innhold er uferdig arbeid, ikke slettet arbeid, og en fil slettet under det
ville brutt elementet i det øyeblikket det ble satt tilbake på en slide.

Feilen er `ASSET_IN_USE` (422 – forespørselen var forstått, og reglene sa nei),
og den bærer hvor mange steder filen vises, delt på slide/sandkasse og
soneinnhold/inline. Den navngir *ikke* sliden eller sonen, og det er en
scope-grense: `delete_asset` krever `assets:write` – speilbildet av
`upload_asset`, siden det er den samme autoriteten over den samme listen – og
det holder nettopp fordi operasjonen er innelukket i fillisten og aldri kan
fjerne noe fra en slide. Et token som bare får lagre filer skal ikke kunne
kartlegge et dekk det ikke har lesetilgang til ved å prøve å slette hver fil.
Tallene gjør avvisningen handlingsbar; adressene finner en agent med
`list_assets` og `inspect_slide`, som krever `presentations:read`.

Atomisiteten er to spørsmål, fordi det er to lagre. En avvisning rører ingen av
dem: `mutatePresentation` returnerer før dokumentet skrives, og filen berøres
først etterpå – så «verken presentasjonen eller assetlageret er endret» er sant
ved konstruksjon og ikke ved opprydding. En godkjent sletting skriver dokumentet
først og bytene etterpå, og det er den samme asymmetrien `storeAsset` snur den
andre veien: bytes ingen peker på koster lagring til presentasjonen slettes,
mens et dokument som peker på bytes som er borte koster sliden. Går den siste
skrivingen galt, står slettingen likevel – `fileRemoved: false` sier at det ble
liggende igjen en foreldreløs fil, aldri at referansen kom tilbake.

Flagget må komme fra lagringen selv, og det er skarpere enn det ser ut. I
Supabase er en filsletting to fjerninger – raden, så objektet – og en feilet
objektfjerning feller med vilje ikke kallet: raden er borte, som er det kalleren
ba om, og stien huskes for opprydningssveipet. «Husket» er et svakere løfte enn
det høres ut som på serveren: `agentContextFor` bygger et nytt repository per
forespørsel, så settet overlever ikke kallet, og sveipet rydder bare mapper til
presentasjoner som er slettet. Derfor returnerer `SlaidsRepository.deleteAsset`
en `boolean` i stedet for `void`, og `deleteAssetFile` leser den i stedet for å
utlede `true` av at kallet ikke kastet – ellers ville `fileRemoved: true` vært
en påstand om lagringen ingen har sjekket.

Delingen tåler dette uten et eneste ekstra kall, og det er verdt å si hvorfor:
`buildSharedSnapshot` tar bare med filer slidene faktisk viser, og en delt
presentasjon publiseres på nytt av den samme skrivingen som lagrer den. Et
asset som er slettbart er derfor per definisjon et asset det publiserte
snapshotet ikke lister, og en sletting kan ikke gjøre en delt lenke ødelagt.

`delete_unused_references` krever `presentations:write`, som `delete_reference`:
en referanse bor i dokumentet, ikke i fillageret. Kvitteringen er id-ene som
faktisk ble fjernet og ingenting mer – samme grense som for `move_zone_content`,
og den biter her: et svar som listet titler og forfattere ville vært en lesing
av dekket utført av en skriving. Et dekk uten noe å rydde svarer med en tom
liste og den samme revisjonen som før, så operasjonen kan kalles på rutine uten
å gjøre noen andres `expectedRevision` utdatert.

#### Fase 7: bibliotekets livsløp

Alt annet i agentflaten arbeider *inne i* ett dekk. Seks operasjoner arbeider på
dekket utenfra – `list_folders`, `create_folder`, `delete_folder`,
`move_presentation`, `duplicate_presentation` og `delete_presentation` – og de
lukker det siste hullet der en agent kunne lage noe den ikke kunne rydde opp i
eller organisere.

Ingen av dem er en ny implementasjon av biblioteket. Mappemodellen er
repositoryets egen (`listFolders`), flyttingen er domenekommandoen `setFolder`
som editoren nå også bruker, dupliseringen er den funksjonen bibliotekrutenettet
kaller, og begge slettingene er ett repository-kall hver. Det som *var* i veien
var at dupliseringen lå i `src/state/` og importerte nettleserens repository
direkte: den ble flyttet ned til `src/persistence/library.ts` og tar repositoryet
som argument, slik at editoren og agenten kaller den samme funksjonen med hvert
sitt. Den rene halvdelen – hva en kopi *er* – ligger i
`domain/presentation.ts` (`duplicatePresentationDocument`).

Det samme skjedde med *opprettelsen* av en mappe. Å lagre en mappe var alltid ett
repository-kall, men **hva en ny mappe er** – et trimmet navn som ikke kan være
tomt, en id fra domenets egen generator, tidspunktet den ble laget – sto inne i
`LibraryView`, der bare editoren kunne nå det. Det ligger nå i `createFolder` i
`src/persistence/library.ts`, ved siden av dupliseringen og av samme grunn: en
agent som skrev regelen om ville vært et andre svar på det samme spørsmålet, og
måten det går galt på er ikke at den ene knekker, men at den ene stille begynner
å godta `"   "` som mappenavn. `src/persistence/library.test.ts` håndhever det
mekanisk: `newFolderId` har nøyaktig én kaller i hele `src/`.

**Scope-grensen er tegnet per operasjon, og de seks er ikke like.**

- `list_folders` er `presentations:read`. `list_presentations` sier allerede
  hvilken mappe hvert dekk ligger i, så navnene er den manglende halvdelen av en
  lesing et lesetoken allerede har.
- `create_folder` er `presentations:write`, som er det minst privilegerte
  **eksisterende** scopet som faktisk dekker mutasjonen. En mappe er ikke en fil,
  så `assets:write` ville vært feil autoritet og delt ut filstoret på kjøpet;
  ingenting publiseres, så `sharing:write` er feil to ganger; og
  `presentations:read` er ikke en skriving i det hele tatt. En ny mappe er heller
  ikke en ny *slags* ting: det er beholderen `move_presentation` allerede
  arkiverer dekk i med nøyaktig dette scopet, så et token som får omorganisere
  biblioteket får nå også lage et sted å legge noe. Et eget mappescope ville vært
  en femte autoritet for én rad med et navn på, og hvert eneste token som finnes
  måtte utstedes på nytt for å bruke den. Kvitteringen er mappen selv, og den
  koster ingen leseautoritet: id-en er en Slaids nettopp laget, navnet er
  kallerens eget (trimmet), og tidspunktet er kallets. Ingenting i den lå i
  biblioteket før kallet, så det er ingenting i den å ha lest.
- `delete_folder` er `presentations:write`, og der er scopet ikke en høflighet,
  men en beskrivelse: å slette en mappe *skriver om hver presentasjon i den* og
  fjerner `folderId`-en som pekte på den. Det er en presentasjonsskriving, på så
  mange dokumenter som mappen holder. Det er også *bare* det – ingen bytes lagres
  eller hentes tilbake, så `assets:write` ville vært autoritet handlingen ikke
  bruker, og ingenting publiseres eller avpubliseres. Kvitteringen er id-en
  kalleren sendte og `deleted: true`: ikke mappens navn, og ikke hva som lå i
  den, fordi operasjonen ikke kan lese.
- `move_presentation` er `presentations:write` alene. Den skriver ett felt og
  svarer med de to id-ene kalleren selv sendte. En mappes *navn* er en lesing, og
  operasjonen returnerer aldri et – heller ikke i avvisningen for en mappe som
  ikke finnes, som bare bærer id-en kalleren oppga. En liste over de ekte mappene
  ville vært `list_folders` besvart uten scopet sitt.
- `duplicate_presentation` krever alle tre: `presentations:read`, fordi en kopi
  er en lesing av hele dokumentet og svarer med kopien slik `get_presentation`
  ville lest den – et token som får skrive, men ikke lese, skal ikke kunne lære
  et dekks tittel, slidetall eller struktur ved å kopiere det;
  `presentations:write`, fordi den lagrer et nytt dokument; og `assets:write`,
  fordi den lagrer en ny *fil* for hver fil kilden har. Det siste er speilbildet
  av regelen under og ikke et tillegg: er autoriteten som tar en fil ut av
  lageret `assets:write`, er det den samme som legger en inn, og en kopi legger
  inn like mange som kilden har. Uten det kunne et token nektet `upload_asset`
  likevel fylle lageret, én duplisering av et bildetungt dekk om gangen. Kravet
  er ubetinget, også for et dekk uten filer: scopes håndheves av transporten før
  operasjonen kjører, og Agent Core får aldri vite hvilke kalleren har, så et
  krav som var avhengig av kildens innhold ville vært et krav ingen katalog kunne
  publisere og ingen kaller kunne forutse.
- `delete_presentation` krever `presentations:write` **og** `assets:write`, fordi
  det er nøyaktig de to tingene den setter på klokken: dokumentet, og hver eneste
  fil lagret under det. Slettingen er bibliotekets egen – til søppelkassen (§ 21),
  der dekket kan gjenopprettes i `TRASH_RETENTION_DAYS` dager før det slettes for
  godt med filene – og scopene er dem den endelige slettingen bruker, deklarert
  på forhånd heller enn i det øyeblikket søppelkassen tømmes av et sveip ingen
  token holder. `delete_asset` trekker allerede den linjen – autoriteten som
  legger en fil inn er autoriteten som tar den ut – og å kaste et dekk er det som
  tar ut alle sammen, tretti dager senere.

`sharing:write` er bevisst ikke med i noen av dem. Det scopet finnes for at
vanlig redigering ikke skal kunne publisere et dekk til internett, og ingen av
disse publiserer noe: en sletting tar en publisert kopi *ned*, som er den trygge
retningen, og en kopi er aldri delt – delingsstatus bor på raden og arves aldri.
Å kreve det ville betydd at et token som får slette hvert dekk ikke får slette
det ene som tilfeldigvis er delt, og det er ingen beskyttelse, bare et dekk ingen
kan rydde bort.

**Slettesemantikken.** Operasjonen er ett kall til
`SlaidsRepository.trashPresentation`, vaktet mot lesingen den selv tok, og
ingenting går tapt i det kallet. Det som til slutt skal bort – når søppelkassen
tømmes – er dokumentet, slidene, filradene, bytene i objektlageret og en
eventuell publisert kopi. Alt det gjør `SlaidsRepository.deletePresentation`
allerede, og det er hele grunnen til at tømmingen er ett kall per dekk og ikke
en sekvens: Dexie tar dokumentet og
filradene i én `rw`-transaksjon, og Supabase sletter raden – filradene henger på
den gjennom en fremmednøkkel, og `is_shared`, `share_token` og `shared_document`
er kolonner *på* den, så den delte lenken dør i den samme setningen. En andre
slettesekvens skrevet i agentlaget ville vært en andre sjanse til å etterlate en
halv presentasjon. Rekkefølgen er den samme som overalt ellers: raden først,
bytene etterpå, fordi data ingen peker på koster lagring mens en peker uten mål
koster sliden.

To ting operasjonen legger til på egen hånd, og begge er om det som *ikke* skjer:

- **En rad som ikke finnes er `PRESENTATION_NOT_FOUND`.** Uten lesingen først
  kunne en sletting av noe som aldri fantes svart `ok`, og en agent må kunne
  skille «den er borte nå» fra «den var aldri der». En rad som ligger i
  søppelkassen er *også* `PRESENTATION_NOT_FOUND` – `loadPresentation` avviser
  den – så et dekk kan ikke kastes to ganger, og klokken startes aldri på nytt
  fra agentflaten.
- **Slettingen er vaktet.** `SlaidsRepository.deletePresentation` tar den samme
  `SaveGuard` som `savePresentation`, og agentoperasjonen sender alltid med
  revisjonen den nettopp leste – ikke bare når kalleren oppga en. Det er de to
  samme vinduene som for enhver annen skriving, av en sterkere grunn. Dexie
  sammenligner inne i transaksjonen som sletter; Supabase legger versjonen
  *lesingen kom fra* i `WHERE`-klausulen, slik den vaktede lagringen gjør. En rad
  som allerede er borte er ikke en konflikt for en uvaktet sletting – kalleren
  ville at den ikke skulle være der.

Kvitteringen er `{ presentationId, deleted: true }` og ikke noe mer. Særlig ingen
`revision`: hver annen mutasjon svarer med lesingen den produserte slik at neste
kall kan skrives mot den, og her finnes det verken et neste kall eller et
dokument å ha en lesing av. Og ingen tittel, sidetall eller delingsstatus – dette
er en operasjon uten `presentations:read`, og en kvittering er et dårlig sted å
dele ut det tokenet ikke får spørre om.

**Dupliseringssemantikken.** Kopien er selvstendig i to forskjellige
betydninger, og de har hver sin begrunnelse:

- **Filene kopieres, de deles ikke.** En asset-rad er nøklet på id-en alene,
  uansett hvilken presentasjon den hører til, og filer slettes sammen med dekket
  som eier dem. En kopi som pekte på originalens filer ville vært én sletting
  unna et dekk fullt av manglende bilder. Derfor får hver fil en ny id, bytene
  skrives på nytt, og dokumentet remappes med `remapAssetIds` – den samme
  funksjonen import og lim inn bruker, som også når sandkassen og innfelte bilder
  i rik tekst.
- **Hver id inne i dokumentet er ny.** Slides, soner, innhold, subfelt og
  sandkasse-elementer. Det er strengere enn lagringen krever – de id-ene slås
  bare opp innenfor ett dokument – og strengheten er poenget: «ingen identitet er
  delt med originalen» er en egenskap som kan sjekkes, mens «delt, men bare der
  det tilfeldigvis ikke betyr noe» må argumenteres på nytt hver gang en av sidene
  får en ny funksjon.

Referanse- og idé-id-ene er det bevisste unntaket. En citation navngir referansen
sin med id inne i rik tekst, så å fornye en betyr å skrive om hver citation som
peker på den: kopien blir identisk uansett, og det eneste man vinner er et
navnebytte som kan gå galt.

Rekkefølgen er dokumentet først, filene etterpå – motsatt av `storeAsset`, og av
samme grunn: en fil uten en presentasjon å høre til kan aldri ryddes bort av
sveipet, som arbeider ved å sammenligne filer mot presentasjonene som fortsatt
finnes. Kommer ikke alle filene fram, tas kopien ut igjen – med **ett** kall,
`deletePresentation`, som tar dokumentet og filradene sammen. En egen
filopprydding foran den var overflødig og svakere: feilet den, kjørte aldri
dokumentslettingen, og tilbakerullingen endte i nøyaktig den tilstanden den
finnes for å hindre. Det er den samme regelen `delete_presentation` bygger på –
en andre slettesekvens ved siden av lagringens egen er en andre sjanse til å
etterlate en halv presentasjon – og den gjaldt like fullt her. En kopi
som mangler bilder er verre enn ingen kopi: kalleren får vite at dupliseringen
feilet, mens et halvkopiert dekk dukker opp i biblioteket ved neste oppfriskning.

«Kom ikke fram» dekker tre ting, og bare den første er åpenbar.

En skriving som feiler underveis er den enkle. Den **første** skrivingen –
dokumentet – er ikke like enkel, fordi en feilet respons ikke er bevis for at
serveren ikke skrev: Supabase kan committe raden og miste svaret på veien
tilbake, og da finnes kopien, med et dokument som allerede peker på asset-id-er
ingenting har lagret ennå, siden filløkken aldri kjørte. Det er nøyaktig den
samme tvetydigheten `resolveAmbiguousRegistration` resonnerer om den andre
veien. Derfor fjernes kopi-id-en i stedet for å antas fraværende, og det er
trygt uten å lese noe tilbake først: id-en ble laget noen linjer før, den er
ikke gitt til noen, og en uvaktet sletting av en rad som ikke er der er en
no-op – så slettingen kan bare fjerne en kopi som ikke skulle finnes. Unntaket
er en `RepositoryConflictError`, som er lagringen som sier at id-en allerede er
tatt, av en rad dupliseringen ikke laget: den raden er noens ekte presentasjon.
Unntaket gjelder bare den første skrivingen – en konflikt fra `putAsset` er en
*asset*-id som er tatt, og presentasjonen den skulle hørt til er fortsatt vår og
skal fortsatt bort.

En **kildefil lagringen ikke har** er den tredje: løkken ber om bytene til hver fil dokumentet lister, og et svar som ikke
finnes måtte enten hoppes over eller feile. Å hoppe over den er stille
ødeleggelse – kopiens dokument lister allerede filen under sin nye id og peker
slides på den, så svaret ville vært `ok` med et dekk som viser et bilde som
aldri kan lastes. Det er heller ikke et hypotetisk kappløp: kilden kan ha vært
helt konsistent da revisjonen ble sjekket, og en samtidig `delete_asset` eller
`delete_presentation` kan ha tatt filen mellom lesingen og kopieringen. Derfor
er det en avvisning som utløser den samme tilbakerullingen, og feilen navngir
filen fra dokumentet – den ene siden som fortsatt har et navn på den. Prisen er
at et dekk som allerede *er* inkonsistent ikke kan dupliseres før pekeren uten
mål er fjernet, og det er riktig vei: `delete_asset` kan fjerne den, så dekket
står ikke fast.

`duplicate_presentation` tar imot et navn på kopien, slik at en variant er ett
kall og ikke en duplisering fulgt av en omdøping, og svarer med den samme
`PresentationView` som `create_presentation`: en agent som nettopp har laget et
dekk har slide-id-ene og revisjonen sin uten en ny lesing, uansett hvilken av de
to veiene den laget det.

`expectedRevision` gjelder kilden, og vakter ikke en skriving – den nye raden er
en insert som ingen kan tape et kappløp mot. Den betyr «kopier nøyaktig den
lesingen jeg så», som er den samme formen publisering har, av den samme grunnen:
et snapshot er et bilde av én bestemt versjon. Derfor tar
`persistence/library.ts` imot dokumentet i stedet for en id – en id ville
betydd at revisjonen ble sjekket på én lesing og kopien laget av en annen.

**Mappe-/flyttesemantikken.** `folderId` er påkrevd og nullbar. Å utelate det
måtte betydd «la den ligge der den ligger», som ikke er en flytting; `null` er
måten å si «ut av alle mapper». Mappen valideres mot bibliotekets egen liste før
noe leses eller skrives, fordi et dekk i en mappe som ikke finnes vises *ingen
steder* – verken på rotnivå eller i noen mappe – og det er en feil som ellers
ville vært helt stille. Slaids lager ikke mappen; `FOLDER_NOT_FOUND` (404) sier
at den ikke finnes. Sjekken ligger i `agent/presentation.ts` og ikke i
operasjonen, fordi `create_presentation` også kan navngi en mappe: «en `folderId`
som når et dokument er en mappe biblioteket har» er verdt å være en egenskap ved
flaten framfor noe hver dør husker for seg.

**Å lage og slette en mappe.** `create_folder` tar `name` og ingenting mer:
id-en mintes av Slaids, ikke av kalleren, fordi `saveFolder` er en `put` og en id
kalleren navnga ville vært en id den kunne overskrive en eksisterende mappe med.
Navnet trimmes, og et tomt eller for langt navn avvises – både av det publiserte
skjemaet, så en kaller kan se det på forhånd, og av `createFolder`, som er der
reglene bestemmes. Lengdegrensen er `FOLDER_NAME_MAX_LENGTH`, og
`folderNameSchema` **importerer** den i stedet for å gjenta tallet: en grense
bare agentdøren håndhevet ville betydd at editoren lagrer navn agenten avviser,
som er nøyaktig den driften det delte laget finnes for å hindre. Retningen er
verdt å merke seg – et skjema strengere enn biblioteket ville avvist navn
editoren lagrer uten videre; et bibliotek strengere enn skjemaet ville lovet en
kaller noe det så nekter.
Svaret er mappen (`{ id, name, createdAt }`), som ikke koster leseautoritet:
ingenting i den fantes før kallet. Ingen `revision`, fordi en mappe ikke er et
dokument og ikke har en lesing å være utdatert mot – den samme grunnen
`create_presentation` ikke har en.

`delete_folder` tar `folderId` og lover nøyaktig det biblioteket allerede lover
brukeren: **«Mappen slettes. Presentasjonene i den blir liggende, men uten
mappe.»** Det er ikke en sekvens agentlaget setter sammen, men kontrakten på
`SlaidsRepository.deleteFolder` – som nå står skrevet der, i grensesnittet, i
stedet for som en kommentar i hver av de to implementasjonene. Begge holder den,
og de holder den forskjellig fordi lagrene er forskjellige:

- **Dexie** gjør begge halvdelene i én `rw`-transaksjon over `folders` og
  `presentations`. Feiler noe, skjer ingenting.
- **Supabase** har ingen transaksjon å gi klienten, og det er nettopp derfor
  slettingen ikke *er* en klientoperasjon der. Den er én databasefunksjon,
  `public.slaids_delete_folder`, og den eneste RPC-en Slaids har.

  Den første versjonen var en klientsekvens: list medlemmene, flytt hver av dem
  ut med en vaktet skriving, slett mapperaden til slutt. Rekkefølgen er riktig og
  likevel ikke nok, fordi den bare dekker rader som *allerede var* i mappen. Et
  konkret kappløp:

  1. klienten lister mappens medlemmer og tømmer dem;
  2. en annen skriver arkiverer en presentasjon **inn i** mappen – raden finnes
     fortsatt, så fremmednøkkelen godtar det;
  3. klienten sletter mapperaden;
  4. `on delete set null (folder_id)` tømmer den radens *kolonne*, mens
     `document.folderId` blir stående og navngir en mappe som er borte.

  Steg 4 er skaden, og den er verre enn den ser ut: biblioteket filtrerer på
  kolonnen og viser dekket på rotnivå, men neste lagring skriver `folder_id`
  tilbake fra dokumentet og blir avvist av fremmednøkkelen. Dekket blir umulig å
  lagre, og kallet som forårsaket det svarte `ok`. Ingen ekstra lesing lukker
  det: det finnes alltid et gap mellom siste tomhetssjekk og `DELETE`.

  Funksjonen tar derfor `for update` på mapperaden **før** den rører noe. En
  fremmednøkkelsjekk tar `FOR KEY SHARE` på foreldreraden den refererer, og
  `FOR UPDATE` er i konflikt med den, så en samtidig flytting inn i mappen må
  vente – og når den slipper til, er mappen borte og fremmednøkkelen avviser
  den. Enten kommer flyttingen med i slettetransaksjonen, eller så avvises den.
  Det finnes ikke et tredje utfall, og det var akkurat det klientversjonen ikke
  kunne si. Den er dermed også alt-eller-ingenting, som klientversjonen ikke var:
  den tømte mappen én vaktet skriving om gangen, og en rad som tapte kappløpet
  etterlot noen presentasjoner på rotnivå med mappen fortsatt stående.

  Funksjonen returnerer id-ene og de nye versjonene til radene den flyttet.
  Repositoryet er det en åpen editor spør om versjonen neste lagring vaktes mot,
  og uten dem ville den autolagringen blitt avvist som et tapt kappløp – for en
  endring ingen gjorde for hånd.

  Fordi korrektheten nå ligger i SQL, sjekkes SQL-en:
  `src/persistence/migrations.test.ts` håndhever `for update` først, at begge
  stedene tømmes i den samme setningen, rekkefølgen, eierfilteret på hver
  setning, og at funksjonen ikke er `security definer`. En migrasjon redigert til
  tre løse setninger ville ellers bestått hver eneste andre test i repoet og
  stille gjeninnført kappløpet.

En mappe som ikke finnes er `FOLDER_NOT_FOUND` (404), ikke et stille `ok` – begge
lagrene sletter på id og bryr seg ikke om at id-en ikke er der, så et `ok` ville
fortalt en agent at den fjernet noe som aldri fantes. Sjekken er den samme
`missingFolder` som `move_presentation` og `create_presentation` bruker, så de
tre dørene som navngir en mappe ikke kan bli uenige om hvorvidt den er der.
Slettingen tar ingen `expectedRevision`: en mappe har ingen revisjon, og én
revisjon kunne uansett ikke vaktet de N dokumentene den rører.

En flytting til mappen dekket allerede ligger i er en lovlig no-op som ikke
flytter revisjonen. Det gjøres ved at operasjonen gir dokumentet uendret
tilbake, og `mutatePresentation` lagrer da ingenting – en generell regel, ikke en
gren for denne operasjonen: en kommando som returnerer objektet den fikk, har
bestemt at det ikke er noe å endre. `deleteUnusedReferences` gjorde allerede det
på et dekk uten noe å rydde, og lovet i teksten at revisjonen sto stille; i
Supabase gjorde den det ikke, fordi en `UPDATE` med identisk innhold likevel
flytter radens `version` og dermed gjør en annens `expectedRevision` utdatert.
Nå står den virkelig stille.

Inline bilder i rik tekst var det tredje hullet her, og er lukket: tekstformatet
har en `image`-blokk, og den skriver editorens egen node (se «Bilder inne i
teksten» over). En systematisk sammenligning mot editorens handlinger etterlater
disse hullene. Ingen av dem er en mangel ved denne fasen; de står her fordi de er
de neste tingene som faktisk stopper en agent, og fordi flaten skal vokse med
vilje og ikke mekanisk:

- **Å gi en mappe nytt navn** er det som står igjen av mappeflaten.
  `create_folder` og `delete_folder` lukket hullet som faktisk stoppet noen – en
  agent kan nå lage stedet den arkiverer i, og rydde det bort igjen – mens et
  nytt navn er den ene tingen en agent kan komme utenom: den lager en mappe med
  det navnet den vil ha og flytter dekkene dit. Det er en operasjon til over den
  samme `saveFolder`, og den legges til når noen faktisk trenger den heller enn
  mekanisk.
- **Layoutmaler og idéer** er bevisst utenfor: den første er en snarvei for et
  menneske som bygger med musen, den andre en notatflate som aldri forlater
  arbeidskopien.

---

## 44.5\. Kompakt arbeidsflate

Slaids er desktop-først og ikke desktop-eksklusivt. Den samme presentasjonen
skal kunne åpnes, rettes, bygges videre på og vises fram fra en telefon eller
et smalt vindu, uten at det finnes en «mobilversjon» av noe som helst under
overflaten.

### 44.5.1 Hva som er felles, og derfor aldri kopieres

Det er én presentasjonsmodell. Compact og desktop deler **domenemodell,
layouttre, geometri (`domain/geometry.ts`), rendering, fit-regler, typede
domenekommandoer, autosave, undo/redo, assets og persistens**. En presentasjon
redigert på telefon skal se identisk ut på desktop.

Følgelig:

- det finnes ingen «mobile slides», mobile temaer eller mobilspesifikke
  layoutverdier i dokumentet;
- viewportens størrelse, orientering og eventuell zoom lagres aldri som
  presentasjonsdata;
- et skjult eller nedskalert UI brukes aldri som målegrunnlag for fit.

### 44.5.2 To uavhengige egenskaper, aldri user-agent

Hvilket UI som brukes avgjøres av to uavhengige fakta om flaten, aldri av en
user-agent-streng:

- **compact** – vinduet er for smalt eller for lavt til permanent filmstripe,
  stage og inspector samtidig;
- **coarse** – pekeren er en finger, så treffflater må være fingerstore og
  ingen viktig funksjon kan kreve hover eller presis dragging.

De er ortogonale med vilje: et smalt desktopvindu er compact med mus, og et
stort nettbrett er romslig med finger. Begge avgjøres ett sted
(`ui/workspace/`), som også publiserer dem på `<html>` slik at CSS og React
leser nøyaktig samme beslutning. Et breakpoint skrevet to steder er et
breakpoint som før eller siden er uenig med seg selv.

Orientering er et layoutsignal, ikke apptilstand. Rotasjon, og et skjermtastatur
som åpnes eller lukkes, skal aldri nullstille valgt slide, valgt sone, åpent
panel, ulagret kladd eller undo/redo-historikk.

Et skjermtastatur kan i tillegg aldri endre *hvilket* skall som gjelder:
`compact` leses fra layout-viewporten, som tastaturet ikke gjør mindre. Derfor
remounter ingenting når det åpnes, og markøren blir stående.

Rotasjon som **krysser** compact-terskelen er det ene tilfellet der selve
oppsettet bygges om — et nettbrett er romslig på langs og kompakt på tvers, og
de to skallene er to forskjellige arrangementer, ikke to tilstander av ett.
Listen over gjelder like fullt: ingenting av dokumentet, utvalget, historikken
eller brukerens valg av arbeidsflate ligger i skallet, nettopp fordi skallet kan
byttes. Det som ikke overlever en slik kryssing er markørposisjonen i et felt
som skrives i; rotasjon *innenfor* samme arbeidsflate — altså enhver telefon —
remounter ingenting og beholder også den.

### 44.5.3 Ett skall om gangen

`EditorView` eier lasting, autosave, kommandoer, dialoger og de tre store
flatene. Plasseringen – og bare plasseringen – ligger i to skall
(`ui/editor/shell/`). **Nøyaktig ett av dem er mountet.** To komplette
editortrær der det ene skjules med CSS er forbudt: en skjult Tiptap-instans
måler innholdet sitt til null, og det er det ene svaret fit-regelen aldri må få.

På compact vises én stor flate om gangen – slides, tekst, sone eller verktøy.
Å lukke panelet er «fokuser sliden»; det finnes ingen egen kontroll for det.

### 44.5.4 Valg først, og ingen sentral funksjon krever dragging

Et trykk på en sone **velger** den. Det starter ikke flytting, resizing eller
tekstredigering – på en nedskalert slide er det ikke mulig å sikte på et ord.

Alle dragbaserte operasjoner har en diskret tvilling som ender i **samme
domenekommando**:

| Gest | Diskret vei |
| --- | --- |
| dra sliden i filmstripen | «Flytt opp»/«Flytt ned» → `moveSlide` |
| dra en sonegrense | større/mindre og eksplisitte forholdstall → `setSplitWeights` |
| dra innhold til en annen sone | «Flytt innholdet …» → velg målsone → `moveZoneContent` |
| dra fra sandkassen | «Plasser» → velg målsone → `placeSandboxItem` |

Hvilke soner som kan ta imot innholdet avgjøres **ved å tørrkjøre den
kommandoen som ville gjort jobben** og lese `Result`-en. Alt i domenet er rene
funksjoner fra presentasjon til `Result`, så det endrer ingenting, og svaret kan
ikke være uenig med commiten fordi det *er* commiten med resultatet kastet.

Det er ikke pedanteri. En flytting og en kopi er forskjellige overganger: en
sjekk som legger innholdet i målsonen mens kilden beholder sitt, måler et
dokument flyttingen aldri produserer — og innhold som bærer en citation er
nettopp der de to kommer fra hverandre, fordi first-occurrence-rekkefølgen, og
dermed etikettbredden, avhenger av at kilden faktisk tømmes. Trykk og drag
stiller det samme spørsmålet gjennom den samme funksjonen.

Dragging beholdes som rask snarvei der den fungerer.

**To tilstander, og editoren er alltid i nøyaktig én av dem:**

1. **hele siden** – ingenting er fokusert, og et kort trykk velger en sone;
2. **fokusert felt** – ett felt fyller stagen, og bærer feltet tekst, *er* det
   samtidig skriveflaten.

Veien inn er **ett langtrykk** rett på feltet: det identifiserer feltet under
fingeren, velger sonen, fyller stagen med den og setter caret-en i den, i én
operasjon. Bærer feltet ingen tekst – et bilde uten bildetekst – fokuseres det
likevel, og det finnes da ikke noe å skrive i. Veien ut er **én ×** øverst til
høyre, som avslutter redigering, fokus og en eventuell pinch samtidig. Det
finnes ingen mellomtrinn, ingen «fokuser sonen»-kontroll og ingen «rediger
tekst»-kontroll; å nå fokus fra tekstlista er den samme operasjonen, ikke en
annen vei.

Et **felt** er ikke alltid en sone. Slidetittelen og en seksjons to linjer
tegnes utenfor layouttreet, men er tekst på siden på samme måte, og adresseres
med de samme syntetiske node-id-ene geometrimotoren allerede gir dem
(`TITLE_NODE_ID`, `SECTION_TITLE_NODE_ID`, `SECTION_SUBTITLE_NODE_ID`). Det er
det som holder compact til **én** tekstmodell: hvert felt på hver sidetype
redigeres der det er tegnet, og ingenting redigeres noe annet sted.

Fokuset er transient editor-state: det eies høyt nok til å overleve rotasjon og
skallbytte, og leses alltid derivert mot det som faktisk er på skjermen, aldri
synkronisert med en effekt. En angring som fjerner sonen, en tittel som slås av
eller et sidebytte faller dermed av seg selv tilbake til hele siden.

**Langtrykket er en ekte gest, ikke en timer.** Det ligger i den samme
pointer-gjenkjenneren som sveip og pinch (`stageGestures.ts`) og er gjensidig
utelukkende med dem ved konstruksjon: bevegelse forbi toleransen avslutter det,
en annen finger avslutter det og sveipen, og et langtrykk som utløses avslutter
sveipen. `pointerup`, `pointercancel` og `blur` forkaster et ventende
langtrykk. En knapp, en lenke, et felt som skrives i og en kjørende miniapp
eier fortsatt sine egne gester, og en layoutgest som faktisk har tatt hånda –
et sonedrag som har begynt å bevege seg – er ikke en hvilende finger. Et
langtrykk skal aldri etterlate nettleserens tekstmarkering eller callout på
skrivebeskyttet slideinnhold; se § 44.5.9.

**Én view-transform-modell.** Hel slide, fokusert sone og pinch er ikke tre
transformer, men det samme spørsmålet med tre svar: *hvilket rektangel av sliden
fyller stagen?* Rektangelet er alltid i det logiske 1600 × 900-rommet og skaleres
uniformt inn i stagen, så et pekerpunkt konverteres tilbake til samme
slidekoordinat uansett hvilket av de tre som gjelder. Det finnes ingen parallell
geometri, og fokusert sone og pinch komponerer: pinchen forstørrer det
rektangelet fokuseringen valgte.

For pinch gjelder:

- en pinch som starter i slideområdet endrer bare denne view-transformen;
  toppmeny, paneler og resten av UI-et beholder størrelse og posisjon;
- forstørrelsen er forankret om pinchens sentrum, så innholdet under fingrene
  blir liggende;
- visningen klampes inni basisrektangelet, og en pinch tilbake lander nøyaktig
  på det igjen;
- panorering skjer med to fingre under pinchen og med én finger når visningen
  er forstørret;
- dette gjelder **alle sidetyper som vises i slideområdet** — en vanlig slide,
  en seksjon, en miniapps forside og en generert side. De deler én stage-ramme,
  så det er den samme transformen i alle fire tilfellene og ikke fire av dem;
  utenfor slideområdet beholder nettleseren sin egen pinch;
- ingen del av den lagres, ingen kommando ser den, og den **kastes** når
  trinnet eller sliden den hørte til ikke lenger gjelder. Det samme gjelder
  trinnet på stigen: en tilstand som bare var skjult ville blitt gyldig igjen
  neste gang det samme utvalget eller den samme sliden kom tilbake, og satt
  editoren i en visning ingen ba om.

**Sveip bytter slide.** På slideområdet på en kompakt arbeidsflate:

- sveip mot venstre er neste slide, mot høyre er forrige — altså samme retning
  som presentasjonsmodus og som enhver karusell: å dra siden mot venstre henter
  den neste inn fra høyre;
- én tydelig gest flytter nøyaktig én slide, avgjort når fingeren slippes;
- små bevegelser er vanlige trykk, og vertikale bevegelser er ikke sveip;
- gesten gjelder bare slideområdet: en knapp, en lenke, et felt som skrives i og
  en kjørende miniapp eier sine egne gester, og et sonedrag som allerede er i
  gang tar pekeren;
- sveip er av mens visningen er forstørret (da panorerer fingeren) og mens et
  felt er fokusert, der siden er en skriveflate og et drag er en markering;
- sveip bruker **den samme dekknavigasjonen** som piltastene og hjulet — samme
  funksjon, som også lukker en avledet side på veien. Det finnes ingen egen
  mobil navigasjonsmodell.

Alle gester er pointer events. Det finnes ikke ett kodeløp for touch og ett for
mus, og derfor heller ingen user-agent-deteksjon: et smalt desktopvindu oppfører
seg som en telefon fordi det er den samme koden.

To gjenkjennere er festet til det samme slideområdet — én for sveipen, én for
visningen og langtrykket — og den indre kan slå av den ytre midt i et trykk ved
å fokusere et felt. En gjenkjenner som blir slått av mens en gest pågår skal
derfor **forkaste** gesten der den er, ikke fullføre den når fingeren slippes.
Ellers ville et drag sideveis etter et langtrykk, altså måten man utvider en
markering på, bladd bort fra feltet som nettopp ble åpnet.

Slideoversikten er navigasjon, ikke et sidepanel: på compact dekker den hele
høyden under toppmenyen, og miniatyrene er så store som flaten tillater.
Hvor mange som får plass ved siden av hverandre er regnestykke på boksen, ikke
et breakpoint. Den bruker de samme entry-ene og de samme kommandoene som
desktopstripen, inkludert de diskrete flyttekontrollene.

### 44.5.5 Tekstredigering: flaten er ikke målet

På compact skrives tekst **i det fokuserte feltet, på sliden selv**. Det finnes
ikke en annen skriveflate ved siden av, og ingen egen mobil tekstmodell: samme
`RichTextEditor`, samme ProseMirror-dokument, samme formatteringskommandoer,
samme undo/redo, samme citation-regler og samme fit-måling som på desktop. Det
eneste som skiller flatene er hvor stort feltet er tegnet, og hvordan man kommer
inn i det.

Tekstlista (`CompactContentList`) er **navigasjon**, ikke en andre skriveflate.
En smal skjerm gjør det upraktisk å sikte på et felt inne i en nedskalert slide,
så lista navngir hvert felt på siden; å velge et av dem fokuserer feltet på
stagen, slik langtrykket gjør. `textTarget.ts` er derfor bare adressering og
oppramsing; det leser og skriver ingen dokumenter.

**Caret-en plasseres, den overlates ikke til trykket som avslutter gesten.**
Begge veier inn setter den, med ulik presisjon: tekstlista navngir ett felt
blant flere i samme sone og sier nøyaktig hvilket; et langtrykk kan bare navngi
sonen og tar dens første felt. Fokuset bærer adressen (`ActiveField`, den samme
butikkens `activeField` bruker), og nøyaktig den ene editoren tar caret-en — en
sone med korttittel og to bunnfelt svarer ellers identisk på tre
listeoppføringer.

At langtrykket også må gjøre det er målt, ikke antatt: feltet tegnes flere
ganger større i det øyeblikket det fokuseres, så trykket som avslutter gesten
lander der fingertuppen tilfeldigvis er *etterpå* — noen ganger i teksten, noen
ganger i lufta ved siden av. En vei inn som virker fra ett sted i en sone og
ikke fra et annet er ingen vei inn.

Følgelig: **mens ett felt er skriveflaten, tar ikke et trykk ved siden av det
caret-en bort.** Nettleseren flytter fokus på `mousedown`, og på touch er det
trykket det *samme* som åpnet feltet. Et trykk *i* teksten flytter caret-en som
vanlig.

**En sone uten tekst har ingen verktøylinje.** Et bilde uten bildetekst fyller
stagen som enhver annen sone og har ingenting å skrive i; en verktøylinje der
ville pekt på det som sist ble redigert. Og en editor som ikke lenger er
redigerbar er ikke lenger noe verktøys mål: på compact blir editorene stående
mountet og bare skrivebeskyttet, så regelen står ett sted — der `editable`
faktisk endres — og gjelder verktøylinja, referansedialogen og bildedialogen
likt.

**Fit-regelen er uendret.** Om teksten passer avgjøres av den virkelige sonen i
det logiske 1600 × 900-rommet, med dekkets typografi og citation-nummerering,
gjennom den samme offscreen-måleren kommandoene bruker. At det fokuserte feltet
er tegnet større endrer ingenting: visningen er en transform, og målingen skjer
i layout, ikke på skjermen. En endring som ikke får plass rulles tilbake med
samme melding som på stagen, og kladden som ble godtatt blir stående.

**Konsekvens som må kjennes:** en sone som er bred i det logiske rommet tegnes
ikke stor på en smal skjerm, fordi fokuseringen er en uniform skalering av den
samme geometrien og ikke en ny ombrekking. På en stående telefon er en
slidebred sone derfor bare marginalt større enn hele sliden. Pinchen er svaret
der det trengs, og den komponerer med fokuseringen (§ 44.5.4).

### 44.5.6 Skjermtastatur og synlig viewport

Skjermtastatur er en egen layouttilstand, lest fra `window.visualViewport` med
robust fallback. Kompakte flater måler seg mot den *synlige* høyden, slik at
primærhandlingen – «Ferdig», bunnlinjen, dialogens knapper – aldri havner bak
tastaturet. Safe-area-insets respekteres. En endret viewport er aldri en ny
presentasjonstilstand.

### 44.5.7 Presentasjonsmodus og miniapper

Presentasjonsmodus kan styres og avsluttes uten fysisk tastatur: forrige, neste
og avslutt er trykkbare kontroller som kan skjule seg og hentes tilbake med et
trykk. Med mus er et klikk på sliden fortsatt «neste»; med finger viser det
kontrollene i stedet. Lenker, valgbar tekst og en kjørende miniapp tolkes aldri
som navigasjon.

Miniappkontrakten er uendret på 1600 × 900. Det som gjelder her er bare at en
interaktiv slide kan aktiveres og avsluttes med trykk, at avsluttkontrollen er
en fingerstor treffflate rundt en liten synlig «×» tegnet i skjermpiksler
uansett skala (§ 8.7), og at en kjørende app eier pointer, touch, wheel og
tastatur inne på sin egen flate – låsen i `state/interactiveRuntime.ts` er
fortsatt det ene stedet det avgjøres.

### 44.5.8 Tilgjengelighet

Desktopens tastaturbetjening skal ikke svekkes. Ikonknapper har tilgjengelig
navn, aktive tilstander er semantiske og ikke bare visuelle, drawers og dialoger
bruker de eksisterende Radix-primitivene for fokusfelle og fokusretur, og
reduced motion respekteres.

### 44.5.9 Tekstmarkering er en redigeringsaffordans

Et trykk, et langt trykk eller et drag på en sone skal **aldri** starte
nettleserens tekstmarkering. En markering som oppstår av en slik gest gjør de
gestene upålitelige etterpå, fordi neste trykk går med til å oppheve den.

Regelen er derfor snudd og uttrykt positivt, ett sted: **den eneste teksten i
appen som kan markeres, er tekst som kan redigeres.** Et ekte felt – en
Tiptap-flate, en `input`, et `contenteditable` – har full markering, caret,
callout og copy/paste, fordi det er der brukeren faktisk har bedt om et caret.
Presentasjonsmodus er det ene bevisste unntaket: publikum kopierer sitater ut av
en slide, og spilleren skiller allerede mellom et trykk som etterlot en
markering og et som ikke gjorde det.

Dette er en UI-invariant, ikke en `preventDefault()` per komponent. En gest som
må undertrykkes fem steder er en gest som kommer tilbake gjennom det sjette.

### 44.5.10 Testing

Compact-flyten testes som flyt, ikke som media queries. Playwright kjører den
samme suiten over stående telefon, liggende telefon og et smalt desktopvindu med
mus – det siste er beviset på at compact avgjøres av vinduet og ikke av en
user-agent. Desktopsuiten er regresjonsnettet for den romslige flaten og kjører
uendret.

Gester testes som gester, med nettleserens egen input: mus der kjøringen har
mus, Chromiums touch-pipeline der den har finger. En test som sendte
syntetiske events ville bevise at handleren virker, ikke at nettleseren lar den
få hendelsene – og det siste er halve poenget med `touch-action` inne i
slideområdet.

`docs/MOBILE_WORKSPACE.md` er implementasjonsdokumentet for dette delsystemet:
UX-begrunnelser, konkrete flyter og de fysiske røyktestene som ikke kan
automatiseres. Denne planen er fortsatt den normative.

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
- MCP authorization spec (valgfri, transportnivå, 401/403-tabellen):
  https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- MCP TypeScript SDK: https://ts.sdk.modelcontextprotocol.io/
- Egendefinerte MCP-apper i ChatGPT (skanning av verktøy når appen opprettes):
  https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
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
