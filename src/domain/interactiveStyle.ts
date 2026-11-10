/**
 * What a miniapp inherits from the presentation it lives in.
 *
 * A miniapp runs in a frame the browser keeps entirely apart from Slaids — no
 * shared origin, no shared DOM, no shared stylesheet. Left alone it would
 * therefore be drawn in the browser's defaults: Times New Roman on white, in
 * the middle of a deck set in Quicksand on midnight blue. So Slaids hands it
 * the deck's design *as data*, in the one form that crosses that boundary:
 * CSS text, written into the document Slaids builds around the file.
 *
 * Two halves, and the split is the whole idea.
 *
 *  - **The tokens.** Custom properties naming the effective colours, fonts,
 *    type scale and spacing for the slide the app sits on. They are computed
 *    per run from the deck's theme and the governing section's colours, and
 *    they are never written into the author's file — which is why recolouring
 *    a section or changing the deck's font shows up in the app the next time
 *    it is started, with nothing stored rewritten and nothing for undo to walk
 *    back through.
 *  - **The base stylesheet.** Slaids' own CSS for ordinary semantic HTML,
 *    written only against those tokens. An app that is a heading, a paragraph
 *    and a button looks like part of the deck without a line of CSS of its
 *    own; an app with opinions overrides it, because it is element selectors
 *    only and the author's own `<style>` is parsed after it.
 *
 * Both are **versioned** — see `INTERACTIVE_STYLE_CONTRACTS`. An app has real
 * CSS depending on what these variables are called and on what an unstyled
 * `<button>` looks like, so changing either under an app that already exists
 * would be changing the app. A change that an existing app could notice is a
 * new version instead: the sheet below stays exactly as it is for every slide
 * that names `1`, and a slide moves only when somebody moves it.
 *
 * `docs/INTERACTIVE_MINIAPPS.md` is this file in prose, for the people and the
 * agents that write the apps, and `get_interactive_contract` is it as data for
 * an agent that would rather ask than read.
 */

import {
  BODY_LINE_HEIGHT,
  CARD_RADIUS,
  TITLE_LINE_HEIGHT,
  type InteractiveStyleContract,
} from './constants'
import { bestTextColor, dividerColorFor, withAlpha } from './color'
import { cardShadow, themeMetrics } from './metrics'
import type { SectionColors } from './pages'
import type { PresentationTheme } from './types'

/** The deck's design at the point of one slide. */
export interface InteractiveStyleInput {
  theme: PresentationTheme
  /** The governing section's colours — the ones this slide is drawn in. */
  colors: SectionColors
}

/**
 * The published variables, v1.
 *
 * The names are the contract; the values are the deck's own numbers, taken
 * from `themeMetrics` and `constants.ts` so a miniapp and the slide beside it
 * are set in the same type at the same size. Lengths are in the design space's
 * pixels — the frame is the slide's 1600 × 900 box, scaled as one — so `21px`
 * here is the same height as `21px` in a zone.
 */
export function interactiveThemeTokens(input: InteractiveStyleInput): Record<string, string> {
  const { theme, colors } = input
  const metrics = themeMetrics(theme)
  const text = bestTextColor(colors.background)

  return {
    /* Colours: the section's, so an app follows the part of the deck it is in. */
    '--slaids-background': colors.background,
    '--slaids-text': text,
    '--slaids-muted': withAlpha(text, 0.72),
    '--slaids-accent': colors.accent,
    '--slaids-accent-text': bestTextColor(colors.accent),
    /* A raised panel, as a wash of the text colour: legible on a light deck and
       on a dark one without either being named. */
    '--slaids-surface': withAlpha(text, 0.08),
    '--slaids-border': dividerColorFor(colors.background),

    /* Type. Two roles, exactly as the deck has: headings and everything else. */
    '--slaids-heading-font': theme.headingFontFamily,
    '--slaids-body-font': theme.bodyFontFamily,
    '--slaids-font-size': `${metrics.bodyFontSize}px`,
    '--slaids-font-size-small': `${metrics.captionFontSize}px`,
    '--slaids-font-size-heading': `${metrics.headingFontSize}px`,
    '--slaids-font-size-title': `${metrics.titleFontSize}px`,
    '--slaids-line-height': String(BODY_LINE_HEIGHT),
    '--slaids-heading-line-height': String(TITLE_LINE_HEIGHT),

    /* Space and shape. */
    '--slaids-gap': `${metrics.gap}px`,
    '--slaids-padding': `${metrics.cardPadding}px`,
    '--slaids-block-spacing': `${metrics.blockSpacing}px`,
    '--slaids-radius': `${CARD_RADIUS}px`,
    '--slaids-shadow': cardShadow(theme),
  }
}

/** The tokens as the `:root` rule the sandbox document carries. */
export function interactiveThemeCss(input: InteractiveStyleInput): string {
  const declarations = Object.entries(interactiveThemeTokens(input))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')
  return `:root {\n${declarations}\n}`
}

/**
 * Slaids' own CSS for a miniapp that has not written any, v1.
 *
 * Element selectors and nothing else, on purpose: every rule here is beaten by
 * a single class in the author's stylesheet, and the author's stylesheet is
 * parsed after this one. Nothing positions anything — an app's layout is the
 * app's — and nothing is stated that the tokens above do not supply.
 */
const BASE_STYLESHEET_V1 = `
*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0;
  height: 100%;
}

body {
  padding: var(--slaids-gap);
  background: var(--slaids-background);
  color: var(--slaids-text);
  font-family: var(--slaids-body-font);
  font-size: var(--slaids-font-size);
  line-height: var(--slaids-line-height);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4, h5, h6 {
  margin: 0 0 var(--slaids-block-spacing);
  font-family: var(--slaids-heading-font);
  line-height: var(--slaids-heading-line-height);
  font-weight: 600;
}
h1 { font-size: var(--slaids-font-size-title); }
h2 { font-size: var(--slaids-font-size-heading); }
h3, h4, h5, h6 { font-size: var(--slaids-font-size); }

p, ul, ol, dl, table, figure, blockquote, pre {
  margin: 0 0 var(--slaids-block-spacing);
}
ul, ol { padding-left: var(--slaids-padding); }
li { margin-bottom: calc(var(--slaids-block-spacing) / 2); }
small, figcaption { font-size: var(--slaids-font-size-small); color: var(--slaids-muted); }
a { color: var(--slaids-accent); }
code, pre, kbd, samp { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
hr { border: 0; border-top: 1px solid var(--slaids-border); margin: var(--slaids-gap) 0; }

button, [type="button"], [type="submit"], [type="reset"] {
  font: inherit;
  font-family: var(--slaids-heading-font);
  padding: calc(var(--slaids-padding) / 2) var(--slaids-padding);
  border: 0;
  border-radius: var(--slaids-radius);
  background: var(--slaids-accent);
  color: var(--slaids-accent-text);
  box-shadow: var(--slaids-shadow);
  cursor: pointer;
}
button:disabled, [type="button"]:disabled, [type="submit"]:disabled { opacity: 0.5; cursor: default; }

input, textarea, select {
  font: inherit;
  padding: calc(var(--slaids-padding) / 2);
  border: 1px solid var(--slaids-border);
  border-radius: var(--slaids-radius);
  background: var(--slaids-surface);
  color: var(--slaids-text);
}
input::placeholder, textarea::placeholder { color: var(--slaids-muted); }
textarea { resize: vertical; }
[type="checkbox"], [type="radio"], [type="range"], [type="color"] {
  accent-color: var(--slaids-accent);
  padding: 0;
  border: 0;
  background: none;
}
progress, meter { accent-color: var(--slaids-accent); width: 100%; height: 12px; }

:focus-visible { outline: 3px solid var(--slaids-accent); outline-offset: 2px; }

fieldset {
  border: 1px solid var(--slaids-border);
  border-radius: var(--slaids-radius);
  padding: var(--slaids-padding);
  margin: 0 0 var(--slaids-block-spacing);
}
legend { font-family: var(--slaids-heading-font); padding: 0 calc(var(--slaids-gap) / 3); }
label { display: inline-block; margin-bottom: calc(var(--slaids-block-spacing) / 2); }

table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: calc(var(--slaids-padding) / 2); border-bottom: 1px solid var(--slaids-border); }
th { font-family: var(--slaids-heading-font); font-weight: 600; }

/* A panel, for the app that wants the deck's card without describing one. */
article, section > section, .slaids-card {
  background: var(--slaids-surface);
  border-radius: var(--slaids-radius);
  padding: var(--slaids-padding);
}

img, svg, video, canvas { max-width: 100%; }
`.trim()

/** Every version's sheet, by the number a slide stores. */
const BASE_STYLESHEETS: Record<InteractiveStyleContract, string> = {
  1: BASE_STYLESHEET_V1,
}

/**
 * The base stylesheet a slide's contract asks for.
 *
 * A version this build has never heard of falls back to the current sheet: a
 * document from a newer Slaids is refused by the schema long before it reaches
 * here, so the only way to arrive with an unknown number is a bug, and drawing
 * *something* in the deck's colours beats drawing Times New Roman.
 */
export function interactiveBaseStylesheet(contract: InteractiveStyleContract): string {
  return BASE_STYLESHEETS[contract] ?? BASE_STYLESHEET_V1
}

/**
 * What the frame refuses, in the words an author needs.
 *
 * The enforcement is the browser's, configured in
 * `ui/interactive/sandboxDocument.ts`; this is the same rules stated once for
 * whoever is writing the file — the upload dialog says the short version, the
 * agent contract returns this list, and `docs/INTERACTIVE_MINIAPPS.md` says it
 * at length. An app written against these does not have to discover them by
 * watching things silently fail.
 */
export const INTERACTIVE_RESTRICTIONS: readonly string[] = [
  'Ingen nettverk: fetch, XMLHttpRequest, WebSocket, sendBeacon og eksterne bilder, stilark, fonter og skript blir avvist.',
  'Ingen eksterne ressurser i det hele tatt — alt appen bruker må ligge i filen, eventuelt som data:- eller blob:-URL-er.',
  'Ingen lagring: localStorage, sessionStorage, informasjonskapsler og IndexedDB er utilgjengelige. Appen starter tom hver gang.',
  'Ingen eval eller new Function; skript og stiler må stå inline i filen.',
  'Ingen navigasjon, popup-vinduer, nedlastinger, skjemainnsending eller modale dialoger (alert, confirm, prompt).',
  'Ingen kamera, mikrofon, posisjon, skjermdeling, utklippstavle, fullskjerm eller pekerlås.',
  'Ingen kontakt med Slaids: appen kan ikke lese eller endre presentasjonen, og postMessage til Slaids gjør ingenting.',
]

/**
 * The space an author keeps clear for «Avslutt miniapp».
 *
 * Slaids draws its own exit control over the app's top right corner, and the
 * app cannot see it: it is outside the frame. So the clearance is the author's
 * to leave, and these are the numbers the examples leave — generous on purpose,
 * because the real control is smaller than this, and an app that keeps this
 * much clear cannot collide with it.
 *
 * One pair of numbers, used by the skeleton below and asserted against the
 * examples in `interactiveStyle.test.ts`, so the template a person starts from
 * and the contract an agent is handed cannot come to reserve different amounts.
 */
export const INTERACTIVE_EXIT_CLEARANCE = { top: 100, right: 400 } as const

/**
 * What a miniapp's structure has to be, whatever the app does.
 *
 * Colours and fonts are the easy half — the tokens above hand those over, and
 * an app that uses them looks like the deck immediately. The half that goes
 * wrong is layout: an unbounded height chain, three competing scroll boxes, a
 * spacing scale invented per element, `overflow-x: hidden` hiding a row that
 * does not fit. None of it shows in a first screenshot and all of it shows in
 * the room.
 *
 * So the structure is stated as rules rather than left to be inferred from an
 * example, and `get_interactive_contract` returns them: an agent writing a
 * miniapp over MCP has them without reading anything in this repository.
 */
export const INTERACTIVE_LAYOUT_RULES: readonly string[] = [
  'Én tydelig rot som eier hele appen, for eksempel #miniapp. All layout henger under den.',
  'html, body og roten har full høyde, og body har ingen nettleser-default marg. Høydekjeden ned til rulleflaten må være avgrenset hele veien.',
  'box-sizing: border-box på roten og alt under den, så padding og rammer ikke legger seg utenpå oppgitte bredder.',
  'Nøyaktig én navngitt vertikal rulleflate for appens innhold, ikke flere uavhengige rullebokser.',
  'Rulleflaten har min-height: 0 og overflow-y: auto. overflow-y: auto alene er ikke nok: uten min-height: 0 på hvert krympbart Grid/Flex-ledd vokser flaten i stedet for å rulle.',
  'overflow-x skal aldri brukes til å skjule en faktisk layoutfeil. Mål scrollWidth mot clientWidth; klipping er ikke et bevis på at innholdet har plass.',
  '--slaids-gap er ytterluft og avstand mellom hovedområder.',
  '--slaids-padding er innvendig panelpadding.',
  '--slaids-block-spacing er avstand mellom sammenhørende elementer inne i et panel.',
  'Hver avstand skal ha én eier, normalt foreldrens gap. Ikke stable tilfeldige marger oppå gap og padding; nullstill basisstilarkets marger innenfor roten.',
  'Hovedinnholdet skal være ryddig og panel-/beholderbasert, og visuelt sentrert eller balansert der det passer.',
  'Ingen tilfeldige asymmetriske paddings uten semantisk grunn, og ingen negative marger eller translate for å lappe over feil flyt.',
  `Hold de øverste ${INTERACTIVE_EXIT_CLEARANCE.top} logiske pikslene og ${INTERACTIVE_EXIT_CLEARANCE.right} piksler til høyre fri for innhold: Slaids tegner «Avslutt miniapp» der.`,
]

/**
 * The rules above as the smallest file that obeys them.
 *
 * Deliberately empty of content: it is a shell to fill, not an app to imitate.
 * `examples/interactive-miniapps/starter.html` is the worked template — the
 * same structure with a working counter in it — and the test beside this file
 * checks that it still is, so the shell an agent is handed and the template a
 * person starts from cannot drift apart.
 */
export const INTERACTIVE_STARTER_SKELETON = `<!DOCTYPE html>
<html lang="nb">
<head>
<meta charset="utf-8">
<title>Miniapp</title>
<style>
html, body { height: 100%; margin: 0; }
body { padding: 0; overflow: hidden; }
#miniapp, #miniapp * { box-sizing: border-box; }
#miniapp {
  height: 100%; min-height: 0; min-width: 0;
  display: grid; grid-template-rows: auto minmax(0, 1fr);
  gap: var(--slaids-gap); padding: var(--slaids-gap);
}
#miniapp :where(h1, h2, h3, p, ul, ol, li, figure, label, output) { margin: 0; }
#miniapp [hidden] { display: none !important; }
.app-title { padding-right: ${INTERACTIVE_EXIT_CLEARANCE.right}px; min-height: ${INTERACTIVE_EXIT_CLEARANCE.top}px; }
/* The one vertical scroll owner. */
.app-content {
  min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden;
  overscroll-behavior-y: contain; scrollbar-gutter: stable;
}
.panel {
  min-width: 0; padding: var(--slaids-padding);
  border-radius: var(--slaids-radius); background: var(--slaids-surface);
  display: grid; gap: var(--slaids-block-spacing); align-content: start;
}
</style>
</head>
<body>
<main id="miniapp">
  <header class="app-header"><h1 class="app-title">Tittel</h1></header>
  <div class="app-content" role="region" aria-label="Innhold" tabindex="0">
    <section class="panel"></section>
  </div>
</main>
</body>
</html>
`

/** Where the prose version lives, for an agent that would rather read it. */
export const INTERACTIVE_DOCS_PATH = 'docs/INTERACTIVE_MINIAPPS.md'
