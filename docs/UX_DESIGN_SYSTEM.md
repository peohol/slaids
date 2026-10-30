# Slaids' visuelle designsystem for app-chrome

**Innført:** U1, 30.10.2026 ([UX_IMPROVEMENT_PLAN.md](UX_IMPROVEMENT_PLAN.md))  
**Gjelder:** editorens og bibliotekets grensesnitt. **Gjelder ikke** sliden: slidens farger, fonter og geometri kommer fra presentasjonstemaet og geometrimotoren og berøres aldri av disse tokenene.  
**Kilde i koden:** tokenene står øverst i `src/styles/global.css`; ikoner og farge-familier i `src/ui/components/Icon.tsx`; innholdstypenes familie i `src/ui/editor/contentKinds.ts`.

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
| `--chrome-bg` | `#171a1f` | Bakgrunn |
| `--chrome-bg-raised` | `#1f242b` | Knapper, verktøylinjer, menyer |
| `--chrome-bg-inset` | `#12151a` | Inndataflater, inspektør, segmentert kontroll |
| `--chrome-bg-hover` | `#29303a` | Hover og tastaturmarkør i menyer |
| `--chrome-bg-pressed` | `#313945` | Øyeblikket et trykk varer |
| `--chrome-text` | `#e7ecf3` | Tekst, 13,2:1 på hevet flate |
| `--chrome-text-dim` | `#96a1af` | Hint og sekundærtekst, 6,0:1 |
| `--chrome-text-faint` | `#6b7684` | Bare deaktivert innhold, 3,4:1 |

### Valg, fokus og primærhandling

| Token | Verdi | Bruk |
| --- | --- | --- |
| `--chrome-accent` | `#4f8ef7` | Valgt kant, fokusring (4,9:1 mot hevet flate) |
| `--chrome-accent-soft` | blå 18 % | Valgt flate |
| `--chrome-accent-text` | `#cfe0ff` | Tekst på valgt flate |
| `--chrome-primary` | `#2f6fe0` | Primærknapp; hvit tekst 4,7:1 (før: 3,2:1) |

### Blekkfarger (funksjonsfamilier)

| Token | Verdi | Familie | Eksempler |
| --- | --- | --- | --- |
| `--ink-content` | `#4cc9d8` | Innhold og tekst | Innholdsmodus, kort med/uten tittel, overskrift |
| `--ink-zone` | `#a78bfa` | Soner og struktur | Sonemodus, beholder, negativt rom |
| `--ink-media` | `#e3bf4f` | Bilder | Bilde, bildekort, «Sett inn bilde fra fil», bildebrief, optimaliser bilder |

Alle tre har minst 5,7:1 mot hevet flate. De er valgt langs blå–gul-aksen i tillegg til kulør, så de holder seg adskilt ved rød–grønn fargeblindhet, og hver familie har i tillegg egne ikonformer. Presentasjonsverktøy (tema, maler, referanser), historikk og navigasjon er **bevisst ufarget**.

Planen foreslo grønnblå for bilder. Det ble forkastet fordi grønnblå ligger for nær turkis (innhold) og grønn (lagret). Gult ble valgt i stedet, og advarselsfargen ble flyttet mot oransje.

### Status

| Token | Verdi | Bruk |
| --- | --- | --- |
| `--chrome-success` | `#4fc27e` | «Lagret», fullført |
| `--chrome-warning` | `#f08d49` | Advarsler (rammer, aldri ikoner i verktøylinjer) |
| `--chrome-danger` / `-strong` / `-text` | `#e5484d` / `#d13b40` / `#ff8a8d` | Fare: kant, knappeflate (hvit tekst 4,8:1) og tekst |

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
| Deaktivert | Falmet; blekkfargen faller tilbake til tekstfarge | `:disabled` |
| Fokus | Blå ring med avstand, oppå alle andre tilstander | `:focus-visible` |
| Høy kontrast | Systemets farger; valgt får `Highlight`-ramme | `forced-colors` |

Valgt-utseendet tegnes fra `aria-pressed`, så skjermleseren og øyet får samme svar. `pressedButton()` i `src/ui/components/pressed.ts` setter attributtet og den eldre klassen `.btn--active` fra én verdi.

**Modus er ikke en bryter.** Et valg mellom to tilstander («Innhold | Soner») tegnes som én segmentert kontroll (`.segmented`), der det valgte segmentet får sin familiefarge som understrek. En av/på-bryter («Overskrift») er en vanlig knapp med valgt-utseendet. Før U1 så de to like ut.

**Hover er nøytral, valgt er blå.** I kontekstmenyer var markøren og valgt innholdstype tidligere den samme blå; nå er markøren grå og valgt har blå tekst og hake, og beholder sitt eget ikon.

## 4. Ikoner

- 24 × 24, strek 1,7, `currentColor`. Fargelegges bare ved `tone` (`'content' | 'zone' | 'media'`).
- Innholdstypene er ett system av to merker: **heltrukket bånd øverst = har tittel**, **linjer = tekst**, **ås under sol = bilde**. Kort uten tittel, kort med tittel, bilde og bildekort med tittel er de fire kombinasjonene og kan skilles i 15 px.
- «Sett inn bilde fra fil» har eget ikon (ramme med pluss), så det aldri forveksles med innholdstypen «Bilde» (planens § 4.2).
- Ikoner krymper aldri i en knapp med lang tekst (`.btn > .icon { flex: none }`).
- Dekorative SVG-er er `aria-hidden`; navnet står på knappen.

## 5. Berøring

`:root[data-coarse='true']` gir 44 × 44 px til ikonknapper og 38 px høyde til små knapper med tekst. En kaskadefeil ga tidligere små ikonknapper 44 × 38 px; det er rettet.

## 6. Bruk i dag og videre

Innført i: hovedlinjens modusvalg, overskriftsbryter, innholdstyper og bildeverktøy; inspektørens innholdstype, bildetekst og subfelt; sonens ikonrad og dens innholdstypemeny; kontekstmenyene; velgeren i tom sone; kompaktens faner og verktøypanel. Globale knapper, felt, menyer og statuslinje bruker de nye tokenene overalt.

Regler for neste arbeidspakker:

1. Ny farge legges til som token her, aldri som hex i en komponent.
2. En handling får blekk bare hvis den tilhører en av de tre familiene. Er du i tvil: ufarget.
3. Valgt tilstand settes alltid med `aria-pressed`/`aria-checked`, aldri bare med en klasse.
4. Samme handling har samme ikon og blekk på alle flater; hent dem fra delt metadata (`contentKinds.ts`, `textActions.ts`).
