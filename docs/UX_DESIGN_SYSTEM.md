# Slaids' visuelle designsystem for app-chrome

**Innført:** U1, 30.10.2026 ([UX_IMPROVEMENT_PLAN.md](UX_IMPROVEMENT_PLAN.md))  
**Gjelder:** editorens og bibliotekets grensesnitt. **Gjelder ikke** sliden: slidens farger, fonter og geometri kommer fra presentasjonstemaet og geometrimotoren og berøres aldri av disse tokenene.  
**Kilde i koden:** tokenene står øverst i `src/styles/global.css`; ikoner og farge-familier i `src/ui/components/Icon.tsx`; innholdstypenes familie i `src/ui/editor/contentKinds.ts`; valget av utseende i `src/state/appearance.ts`.

## 0. Mørkt og lyst utseende

Grensesnittet finnes i et mørkt og et lyst utseende. Hvert fargetoken skrives én gang som `light-dark(<lys>, <mørk>)`, og rotens `color-scheme` velger halvdelen. Standard er **«Følg systemet»** (`color-scheme: light dark`), som virker før noe skript har kjørt og følger systemet direkte når det bytter. «Utseende» (i «Verktøy»-menyen, som egen gruppe i kompaktens verktøypanel og i bibliotekets topplinje) låser det til «Mørk» eller «Lys» ved å sette `data-appearance` på `<html>`. Valget er en lokal UI-preferanse (`localStorage`), aldri presentasjonsdata.

- Utseendet gjelder bare app-chromen. Sliden og presentasjonens farger er de samme i begge (`e2e/appearance.spec.ts` sammenligner scenen piksel for piksel), og presentasjonsvisningen er alltid mørk (`.present { color-scheme: dark }`).
- Heter «Utseende», ikke «Tema»: «Tema» er presentasjonens fonter og farger.
- `chromeTokens.test.ts` holder begge halvdelene til de samme kontrast- og fargesynskravene, og axe-revisjonen i `accessibility.spec.ts` kjøres i begge utseender. Tabellene under viser mørk verdi først, så lys.
- Et token som er likt i begge (primærknappen, faretekstflaten), skrives som én verdi.

## 1. Retning: tegnebordet

Slaids er et presisjonsverktøy: sider bygges av soner med eksakte forhold. Grensesnittet skal oppføre seg som et tegnebord, ikke som en plakat. Flatene er rolig grafitt, kantene er presise linjer, og farge er **blekk**: noen få fargede stifter, hver med én betydning.

- **Farge betyr funksjon, aldri pynt.** Tre blekkfarger skiller verktøyfamiliene; alt annet er nøytralt.
- **Blått betyr «valgt».** Sliden tegner allerede valgt sone blå, så verktøylinjen, inspektøren og menyene sier «denne» med samme farge.
- **Én dristig ting:** i sonemodus får verktøylinjens underkant sonefargen. Modusen kan leses fra hele skjermen, ikke bare fra bryteren. Innholdsmodus, normaltilstanden, har ingen strek.
- **Tilstand leses uten farge.** Valgt har både kant og flate, deaktivert er falmet, fokus er en ring. Testet i gråtoner.

## 2. Tokens

### Flater og tekst

| Token | Verdi | Bruk |
| --- | --- | --- |
| `--chrome-bg` | `#171a1f` / `#eceff3` | Bakgrunn |
| `--chrome-bg-raised` | `#1f242b` / `#ffffff` | Knapper, verktøylinjer, menyer |
| `--chrome-bg-inset` | `#12151a` / `#f4f6f9` | Inndataflater, inspektør, segmentert kontroll |
| `--chrome-bg-hover` | `#29303a` / `#e4e8ee` | Hover og tastaturmarkør i menyer |
| `--chrome-bg-pressed` | `#313945` / `#d7dde5` | Øyeblikket et trykk varer |
| `--chrome-text` | `#e7ecf3` / `#161b22` | Tekst, 13,2:1 på hevet flate (mørk) |
| `--chrome-text-dim` | `#96a1af` / `#525c6a` | Hint og sekundærtekst, minst 4,5:1 på alle flater |
| `--chrome-text-faint` | `#6b7684` / `#8a939f` | Bare deaktivert innhold |
| `--chrome-overlay-hover`, `--chrome-swatch-edge`, `--chrome-preview-mark(-strong)` | hvit / mørk med lav dekkevne | Gjennomsiktig hover, kant rundt fargeruter, merker i små layoutbilder |
| `--chrome-scrim`, `--chrome-shadow(-strong)`, `--chrome-tooltip-bg/-text` | | Under dialoger, skygger, verktøytips (mørkt også i lyst utseende) |

### Valg, fokus og primærhandling

| Token | Verdi | Bruk |
| --- | --- | --- |
| `--chrome-accent` | `#3386f7` / `#3b7ff0` | Valgt kant, fokusring (minst 3:1 mot flatene); også valgt sone på scenen (`--zone-outline-selected`) |
| `--chrome-accent-soft` | blå 18 % / 13 % | Valgt flate |
| `--chrome-accent-text` | `#cfe0ff` / `#1a4fa8` | Tekst på valgt flate |
| `--chrome-primary` | `#2f6fe0` | Primærknapp; hvit tekst 4,7:1 (før: 3,2:1) |

### Blekkfarger (funksjonsfamilier)

| Token | Verdi | Familie | Eksempler |
| --- | --- | --- | --- |
| `--ink-content` | `#4cc9d8` / `#086860` | Innhold og tekst | Innholdsmodus, kort med/uten tittel, overskrift |
| `--ink-zone` | `#bca0fc` / `#7f3ea3` | Soner og struktur | Sonemodus, beholder, negativt rom |
| `--ink-media` | `#e3bf4f` / `#875c00` | Bilder | Bilde, bildekort, «Sett inn bilde fra fil», bildebrief, optimaliser bilder |

Alle tre har minst 7:1 mot hevet flate i mørkt og minst 4,5:1 i lyst. De er valgt langs blå–gul-aksen i tillegg til kulør, så de holder seg adskilt ved rød–grønn fargeblindhet, og hver familie har i tillegg egne ikonformer.

Sonefiolett og valgt-blått står ofte side om side (sonemodus og en valgt sone). Fiolett og blått skiller seg mest i rødt, den kanalen protanopi mister, så de skilles i stedet på lyshet: fiolett er lysere enn blått i mørkt og mørkere i lyst. I lyst er innholdsfargen dratt mot grønnblått og fiolett mot purpur, fordi alle fire må være mørke nok for 3:1 på hvitt og da ellers ligger for tett ved tritanopi. Før dette (fiolett `#a78bfa`, blått `#4f8ef7`) var de nesten like ved protanopi (ΔE 3,1). Nå er avstanden minst 20 ved protanopi, deuteranopi og tritanopi, og `chromeTokens.test.ts` krever det for alle par av de tre blekkfargene og valgt-blått. Presentasjonsverktøy (tema, maler, referanser), historikk og navigasjon er **bevisst ufarget**.

Planen foreslo grønnblå for bilder. Det ble forkastet fordi grønnblå ligger for nær turkis (innhold) og grønn (lagret). Gult ble valgt i stedet, og advarselsfargen ble flyttet mot oransje.

### Status

| Token | Verdi | Bruk |
| --- | --- | --- |
| `--chrome-success` | `#4fc27e` / `#17763e` | «Lagret», fullført |
| `--chrome-warning` (`-soft`) | `#f08d49` / `#b85410` | Advarsler (rammer, aldri ikoner i verktøylinjer); `-soft` er flaten bak |
| `--chrome-danger` / `-strong` / `-text` | `#e5484d` / `#d13b40` / `#ff8a8d` (lys: `#d4343a` / `#d13b40` / `#b4232a`) | Fare: kant, knappeflate (hvit tekst 4,8:1) og tekst; `-soft` er menyens markør på en fareoppføring |

Status brukes som ord og rammer, aldri som ikonfarge i en verktøylinje, så en status ikke kan leses som en funksjon. «Lagrer …» er fremdrift, ikke advarsel, og vises nøytralt.

### Typografi og mellomrom

Inter (eller systemets sans) beholdes. Skala: `--text-xs` 11,5, `--text-sm` 12,5, `--text-md` 14, `--text-lg` 15, `--text-xl` 18, `--text-2xl` 22 px. Seksjonsnavn i inspektør, felt og menyer er setningsstil og halvfete, ikke sperret store bokstaver: de er navn, ikke etiketter. Mellomrom: `--space-1` til `--space-5` = 4, 8, 12, 16, 24 px.

## 3. Tilstander

Én tilstand har ett utseende, uansett knapp:

| Tilstand | Utseende | Kilde |
| --- | --- | --- |
| Hover | Lysere flate | `:hover` |
| Trykket | Enda lysere flate mens trykket varer | `:active` |
| **Valgt** | Blå kant + blå flate + lys tekst; i menyer og lister også en hake til høyre | `aria-pressed="true"` (knapper), `aria-checked` (menyer) |
| Deaktivert | Falmet; blekkfargen faller tilbake til tekstfarge. Grunnen står som tekst under raden (inspektør, kompakt) eller i verktøytipset; en knapp som bare har verktøytipset, er `aria-disabled` (`unavailable()`), så den kan fokuseres og grunnen nås med tastatur og skjermleser | `:disabled`, `[aria-disabled='true']` |
| Fokus | Blå ring med avstand, oppå alle andre tilstander | `:focus-visible` |
| Høy kontrast | Systemets farger; valgt og menyens tastaturmarkør får `Highlight`-ramme | `forced-colors` |

Valgt-utseendet tegnes fra `aria-pressed`, så skjermleseren og øyet får samme svar. `pressedButton()` i `src/ui/components/pressed.ts` setter attributtet og den eldre klassen `.btn--active` fra én verdi.

**Modus er ikke en bryter.** Et valg mellom to tilstander («Innhold | Soner») tegnes som én segmentert kontroll (`.segmented`), der det valgte segmentet får sin familiefarge som understrek. En av/på-bryter («Overskrift») er en vanlig knapp med valgt-utseendet. Før U1 så de to like ut.

**Hover er nøytral, valgt er blå.** I kontekstmenyer var markøren og valgt innholdstype tidligere den samme blå; nå er markøren grå og valgt har blå tekst og hake, og beholder sitt eget ikon.

## 4. Ikoner

- 24 × 24, strek 1,7, `currentColor`. Fargelegges bare ved `tone` (`'content' | 'zone' | 'media'`).
- Innholdstypene er ett system av to merker: **heltrukket bånd øverst = har tittel**, **linjer = tekst**, **ås under sol = bilde**. Kort uten tittel, kort med tittel, bilde og bildekort med tittel er de fire kombinasjonene og kan skilles i 15 px.
- «Sett inn bilde fra fil» har eget ikon (ramme med pluss), så det aldri forveksles med innholdstypen «Bilde» (planens § 4.2).
- Ikoner krymper aldri i en knapp med lang tekst (`.btn > .icon { flex: none }`).
- Dekorative SVG-er er `aria-hidden`; navnet står på knappen.

### Menyknapp (fra U2)

En knapp som åpner en meny viser ikon, navn og en liten pil ned, og sier `aria-haspopup="menu"` og `aria-expanded`. Menyen er appens ene kontekstmeny åpnet under knappen, så tastatur, fokusretur og plassering er de samme som overalt. Et nytt trykk på knappen lukker menyen. Viser knappen et valg (innholdstypen), står gjeldende valg som knappens tekst og som avhaket linje i menyen. Komponenten er felles (`src/ui/components/MenuButton.tsx`) og brukes også av inspektørens «Innholdstype». Når hovedlinjen blir smal, viker etikettene i fast rekkefølge (sekundære → menynavn → modusnavn) og ikonene blir stående; navnet ligger fortsatt i `aria-label` og verktøytipset.

### Inspektøren (fra U3)

- **Hode:** det valgte objektet med ikon og blekk, navn og én linje om plassering, med en strek i valgtblått langs venstre kant — samme blå som sliden tegner valgt sone med. Inndeling, miniapp, avledet side og «ingen sone valgt» bruker samme hode (`InspectorHeader`).
- **Grupper:** navngitte seksjoner skilt med en tynn linje, i fast rekkefølge: innhold, sone, så størrelse. Størrelse er to spørsmål med hvert sitt navn (fra Z3): «Fordeling inni denne sonen» (en delt sones egne subsoner) og «Størrelse blant søskensonene» (den valgte sonen i foreldrens deling). En nøstet delt sone har begge, hver med stien til delingen den endrer; den valgte sonens rad sier «(denne)».
- **Handlingsknapp** (`InspectorButton`): et langt navn brytes under seg selv; ikonet står fast. En utilgjengelig handling får stiplet kant og falmet navn, men grunnen står lesbart under navnet (dimmet tekst, 6,0:1) — ikke bare i et verktøytips. Fjerner handlingen noe, har teksten faretekstfarge og står sist.
- **Utvidbar gruppe** (`InspectorFold`): en `<details>` med pil som snus; åpnes med tastatur, mus og trykk, og husker tilstanden i økten. For sjeldne tall og lange forklaringer.

### Sonemarkering (fra Z3)

Én regel for hvordan soner tegnes i chrome: **heltrukket og sterkt er det som endres her; stiplet og svakt er struktur som vises som kontekst.**

- **Scenen:** valgt sone har heltrukket, valgtblå kant; andre soner er stiplet. Pekeren gir heltrukket, nøytral kant, uten fyll over innholdet.
- **Delingsdialogen:** målsonen er én nøytral ramme; de direkte subsonene som får nye mål, er heltrukne, tonet og nummerert; underinndelinger som beholdes, er stiplede skiller.
- **Malredigeringen:** alle soner er stiplede og svakt tonet; valgt sone har den ene heltrukne, valgtblå kanten. En delt sone får ingen egen ramme.
- Skillet bæres av heltrukket/stiplet, tykkelse, tall og tekst, ikke farge alene; i tvungne farger blir det Highlight mot GrayText.
- Forhåndsvisningene ligger i samme avgrensede boks (`BoundedPreview`): begrenset i bredde og høyde, én skala, ingen rulling.
- Stien skrives likt overalt: «Rot › 2 › 1» i stilinjen, inspektøren, statuslinjen, dialogen og malredigeringen. Undersonene i en deling heter «Sone 1: Tom sone» i inspektøren og malredigeringen.
- En dialog gir fokus tilbake til kontrollen som åpnet den, også når den ble åpnet fra en menyoppføring (da til knappen menyen ble åpnet fra).

### Tekstverktøylinjen (fra U4)

- **Én rad, fast høyde.** Stagen skaleres etter høyden den får, så linjen vokser aldri. Først feltets navn (dimmet, halvfet), så gruppene **Formatering · Avsnitt · Justering · Lenke · Sett inn**, skilt med en tynn linje. Inne i Justering skiller en kortere linje vannrett fra loddrett. Sist kommer det som bare gjelder der markøren står (aksentfarge, «Tabell», «Bilde»), så de faste gruppene står stille.
- **Samme oppføring som menyen.** Hver knapp tegnes fra kontekstmenyens `MenuAction` for samme handling (`textEntry`): valgt er `aria-pressed`, utilgjengelig er `disabled` med grunnen i verktøytipset. En kommando som ikke er en tilstand («Sett inn tabell», «Referanse …») har ikke `aria-pressed` i det hele tatt.
- **Markøren blir i teksten.** Knapper, menyknapper og fargevalg tar ikke fokus ved trykk (`focusKeeping.ts`); åpnet med tastatur går fokus inn i popoveren, og lukking gir det tilbake dit det var. Piltaster, Home og End går langs linjen; Tab når fortsatt hver kontroll.
- **Smalere vindu:** under 1366 px viker ordene («Referanse …», «Aksentfarge», «Tabell») for ikonene. På kompakt arbeidsflate skjules feltnavnet (feltet fyller stagen) og raden ruller sideveis som før.
- **Fargearv sier kilden.** «Standard (fra gjeldende inndeling)» eller «Standard (fra korttittelen)», aldri «fra forsiden» (`colorInheritance.ts`).

### Bibliotek og slideoversikt (fra U5)

- **Én direkte handling per oppføring.** Et presentasjonskort åpnes (hele flaten, og ordet «Åpne» står alltid synlig i valgtblå kontur, fylt ved hover/fokus); en mappe vises; en side i stripen velges. Alt annet ligger i en navngitt meny.
- **«Flere handlinger»** er en menyknapp (`MenuButton`) med ⋯-ikon. Der det er plass står navnet («Flere handlinger» på kortet); i stripen og mappelisten er den bare ikonet (`.menu-button--icon`), med navnet i `aria-label` («Flere handlinger for slide 3») og verktøytipset. Den er dempet til den trengs, og ser trykket ut så lenge menyen er åpen.
- **Høyreklikk og Shift+F10 er snarveier til den samme menyen**, aldri den eneste veien.
- **Valgt side** sies tre ganger: blå ramme, nummeret som fylt blå merkelapp og `aria-current`.
- **Ny side:** «Ny slide» er stripens brede knapp; de andre typene i menyen ved siden av. Over knappen står hvor siden havner, i stripens egen nummerering. Alle innganger til ny side bruker de samme oppføringene (`newPageEntries`).

### Kompakt arbeidsflate (fra U6)

- **Fanene** er navigasjon med samme tilstandsspråk som resten: valgt fane er blå flate og lys tekst fra `aria-pressed`. «Tekst» og «Soner» er også de to redigeringsmodusene og får modusens blekk som strek øverst, slik desktopens segmenterte «Innhold | Soner» understreker valgt segment. I sonemodus får topplinjens underkant sonefargen, som desktopens verktøylinje.
- **Ikoner som desktop:** «Slides» bruker slide-ikonet (ikke malikonet, som er «Maler …»), «Verktøy» bruker verktøymenyens ikon. Antall i sandkassen står på primærblått som på desktop.
- **Verktøyfanen** har desktoplinjens grupper i samme rekkefølge og med samme navn: *Valgt sone* (innholdstype som den samme menyknappen, «Sett inn bilde fra fil …»), *Slide* («Overskrift» som av/på med hake), *Presentasjon* (menyens oppføringer og «Del»), *Verktøy* (menyens oppføringer). Radene tegnes fra de samme `MenuAction`-oppføringene som menyene; en utilgjengelig rad skriver grunnen under seg.
- **«Vis»** har ordet ved siden av ikonet, som på desktop.
- **Feltnavn i tekstlista** er setningsstil og halvfete, som navn ellers.
- **En rad som ruller sideveis** (tekstlinja på telefon) toner ut kanten der det finnes mer (`useScrollEdges`).

## 5. Berøring

`:root[data-coarse='true']` gir **alle** knapper minst 44 × 44 px, med eller uten tekst, og felt (`.input`, `.select`) og mapper i biblioteket minst 44 px høyde. Det gjelder etter pekeren, ikke bredden, så et stort nettbrett i desktopvisning får også fingerstore kontroller; hovedlinjen får fortsatt plass ned til 1025 px (`e2e/toolbar.spec.ts`). Før U6 stoppet små knapper med tekst på 38 px, og hovedlinjens knapper som hadde gitt fra seg etiketten var 30 px brede på berøring. Inspektørens utvidbare grupper og stiknapper får 44 px høyde.

**Unntak, med vilje:** fargerutene i en palett deler radens bredde og er kvadratiske, inntil 28 px med mus og mellom 28 og 44 px på berøring; en rad som ikke rommer rutene på 28 px brytes i stedet for å krympe (før U7 ble de presset til 20,8 px med mus). Det er over WCAGs minstemål på 24 px, men en tett palett kan ikke ha 44 px ruter på en telefon uten å miste rekkefølgen. Presentasjonstittelen i hovedlinjen på et romslig berøringsnettbrett er lavere enn 44 px; «Gi presentasjonen nytt navn …» i «Presentasjon»-menyen er den fingerstore veien til det samme.

## 6. Bruk i dag og videre

Innført i: hovedlinjens modusvalg, overskriftsbryter, innholdstyper og bildeverktøy; hele inspektøren (U3); tekstverktøylinjen (U4); bibliotekets kort og mapper og filmstripen (U5); sonens ikonrad og dens innholdstypemeny; kontekstmenyene; velgeren i tom sone; kompaktens faner, topplinje og verktøypanel (U6). Globale knapper, felt, menyer og statuslinje bruker de nye tokenene overalt.

Regler for neste arbeidspakker:

1. Ny farge legges til som token her, aldri som hex i en komponent.
2. En handling får blekk bare hvis den tilhører en av de tre familiene. Er du i tvil: ufarget.
3. Valgt tilstand settes alltid med `aria-pressed`/`aria-checked`, aldri bare med en klasse.
4. Samme handling har samme ikon og blekk på alle flater; hent dem fra delt metadata (`contentKinds.ts`, `textActions.ts`).
