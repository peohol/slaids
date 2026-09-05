/**
 * Special characters the keyboard doesn't have, everywhere text is edited.
 *
 * Ported from mdeditz's symbol menu: the same eight groups, the same "recently
 * used" memory shared across the whole app in `localStorage`, and the same
 * idea that the popover stays open after a press — a symbol rarely comes
 * alone, and the caret is still sitting where it was. The one thing that
 * changes is how a character reaches the document: mdeditz drives a
 * `contenteditable` Range by hand, while `insertSymbol` below is one Tiptap
 * command — the editor already knows how to replace a selection and have the
 * inserted text inherit the marks it lands in, exactly as if it had been
 * typed.
 *
 * The button reads whatever editor currently has focus rather than one tied
 * to a particular field kind, which is what makes it work in a slide title, a
 * card title, a caption and a section's two pills alike — every one of them
 * is still a Tiptap instance, even the ones with no formatting marks to
 * toggle.
 */

import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { Editor } from '@tiptap/react'
import { Tooltip } from '../components/Tooltip'

type SymbolEntry = readonly [char: string, name: string]

interface SymbolGroup {
  id: string
  label: string
  symbols: readonly SymbolEntry[]
}

/**
 * The characters themselves, grouped the way one hunts for them: arrows and
 * maths first, letters last. Order inside `SYMBOL_GROUPS` is also the order a
 * duplicate resolves to a name in — see `SYMBOL_NAMES`.
 */
export const SYMBOL_GROUPS: readonly SymbolGroup[] = [
  {
    id: 'arrows',
    label: 'Piler',
    symbols: [
      ['→', 'Pil høyre'],
      ['←', 'Pil venstre'],
      ['↑', 'Pil opp'],
      ['↓', 'Pil ned'],
      ['↔', 'Pil begge veier'],
      ['↕', 'Pil opp og ned'],
      ['↖', 'Pil opp mot venstre'],
      ['↗', 'Pil opp mot høyre'],
      ['↘', 'Pil ned mot høyre'],
      ['↙', 'Pil ned mot venstre'],
      ['⇐', 'Dobbel pil venstre'],
      ['⇒', 'Dobbel pil høyre'],
      ['⇑', 'Dobbel pil opp'],
      ['⇓', 'Dobbel pil ned'],
      ['⇔', 'Dobbel pil begge veier'],
      ['⟵', 'Lang pil venstre'],
      ['⟶', 'Lang pil høyre'],
      ['⟷', 'Lang pil begge veier'],
      ['↦', 'Avbildes til'],
      ['↩', 'Pil tilbake'],
      ['↪', 'Pil videre'],
      ['⤴', 'Pil opp og ut'],
      ['⤵', 'Pil ned og ut'],
      ['⇄', 'Fram og tilbake'],
      ['⇅', 'Opp og ned'],
      ['↻', 'Med klokka'],
      ['↺', 'Mot klokka'],
      ['➜', 'Tykk pil høyre'],
    ],
  },
  {
    id: 'math',
    label: 'Matematikk',
    symbols: [
      ['±', 'Pluss/minus'],
      ['∓', 'Minus/pluss'],
      ['×', 'Ganget med'],
      ['÷', 'Delt på'],
      ['−', 'Minustegn'],
      ['⋅', 'Multiplikasjonsprikk'],
      ['≠', 'Ulik'],
      ['≈', 'Omtrent lik'],
      ['≡', 'Identisk lik'],
      ['≅', 'Kongruent med'],
      ['≤', 'Mindre enn eller lik'],
      ['≥', 'Større enn eller lik'],
      ['≪', 'Mye mindre enn'],
      ['≫', 'Mye større enn'],
      ['∝', 'Proporsjonal med'],
      ['∞', 'Uendelig'],
      ['√', 'Kvadratrot'],
      ['∛', 'Kubikkrot'],
      ['∑', 'Sum'],
      ['∏', 'Produkt'],
      ['∫', 'Integral'],
      ['∂', 'Partiell derivert'],
      ['∆', 'Differanse'],
      ['∇', 'Nabla'],
      ['∈', 'Element i'],
      ['∉', 'Ikke element i'],
      ['⊂', 'Ekte delmengde av'],
      ['⊆', 'Delmengde av'],
      ['⊃', 'Ekte overmengde av'],
      ['∪', 'Union'],
      ['∩', 'Snitt'],
      ['∅', 'Tomme mengden'],
      ['∀', 'For alle'],
      ['∃', 'Det finnes'],
      ['¬', 'Ikke'],
      ['∧', 'Og'],
      ['∨', 'Eller'],
      ['⊕', 'Eksklusiv eller'],
      ['∴', 'Altså'],
      ['∵', 'Fordi'],
      ['ℝ', 'Reelle tall'],
      ['ℕ', 'Naturlige tall'],
      ['ℤ', 'Hele tall'],
      ['ℚ', 'Rasjonale tall'],
      ['½', 'En halv'],
      ['⅓', 'En tredel'],
      ['¼', 'En firedel'],
      ['¾', 'Tre firedeler'],
      ['¹', 'Opphøyd 1'],
      ['²', 'Opphøyd 2'],
      ['³', 'Opphøyd 3'],
      ['ⁿ', 'Opphøyd n'],
      ['₁', 'Senket 1'],
      ['₂', 'Senket 2'],
      ['₃', 'Senket 3'],
      ['ₙ', 'Senket n'],
    ],
  },
  {
    id: 'greek',
    label: 'Gresk',
    symbols: [
      ['α', 'Alfa'],
      ['β', 'Beta'],
      ['γ', 'Gamma'],
      ['δ', 'Delta'],
      ['ε', 'Epsilon'],
      ['ζ', 'Zeta'],
      ['η', 'Eta'],
      ['θ', 'Theta'],
      ['ι', 'Iota'],
      ['κ', 'Kappa'],
      ['λ', 'Lambda'],
      ['μ', 'My'],
      ['ν', 'Ny'],
      ['ξ', 'Ksi'],
      ['π', 'Pi'],
      ['ρ', 'Rho'],
      ['σ', 'Sigma'],
      ['ς', 'Sluttsigma'],
      ['τ', 'Tau'],
      ['υ', 'Ypsilon'],
      ['φ', 'Fi'],
      ['χ', 'Khi'],
      ['ψ', 'Psi'],
      ['ω', 'Omega'],
      ['Γ', 'Stor gamma'],
      ['Δ', 'Stor delta'],
      ['Θ', 'Stor theta'],
      ['Λ', 'Stor lambda'],
      ['Ξ', 'Stor ksi'],
      ['Π', 'Stor pi'],
      ['Σ', 'Stor sigma'],
      ['Υ', 'Stor ypsilon'],
      ['Φ', 'Stor fi'],
      ['Ψ', 'Stor psi'],
      ['Ω', 'Stor omega'],
    ],
  },
  {
    id: 'typography',
    label: 'Typografi',
    symbols: [
      ['–', 'Tankestrek'],
      ['—', 'Lang tankestrek'],
      ['…', 'Utelatelsestegn'],
      ['·', 'Midtprikk'],
      ['•', 'Punktmerke'],
      ['◦', 'Åpent punktmerke'],
      ['«', 'Anførselstegn venstre'],
      ['»', 'Anførselstegn høyre'],
      ['“', 'Hermetegn åpne'],
      ['”', 'Hermetegn lukke'],
      ['‘', 'Enkelt hermetegn åpne'],
      ['’', 'Enkelt hermetegn lukke'],
      ['‹', 'Enkel vinkel venstre'],
      ['›', 'Enkel vinkel høyre'],
      ['†', 'Kors'],
      ['‡', 'Dobbeltkors'],
      ['§', 'Paragraf'],
      ['¶', 'Avsnittstegn'],
      ['№', 'Nummertegn'],
      ['°', 'Grader'],
      ['′', 'Minutt eller derivert'],
      ['″', 'Sekund'],
      ['‰', 'Promille'],
      ['©', 'Opphavsrett'],
      ['®', 'Registrert varemerke'],
      ['™', 'Varemerke'],
      ['¡', 'Omvendt utropstegn'],
      ['¿', 'Omvendt spørsmålstegn'],
    ],
  },
  {
    id: 'marks',
    label: 'Merker',
    symbols: [
      ['✓', 'Hake'],
      ['✔', 'Fet hake'],
      ['✗', 'Kryss'],
      ['✘', 'Fet kryss'],
      ['☐', 'Tom boks'],
      ['☑', 'Avkrysset boks'],
      ['☒', 'Boks med kryss'],
      ['★', 'Stjerne fylt'],
      ['☆', 'Stjerne åpen'],
      ['⚠', 'Varseltrekant'],
      ['⚑', 'Flagg'],
      ['●', 'Sirkel fylt'],
      ['○', 'Sirkel åpen'],
      ['◉', 'Sirkel med prikk'],
      ['◆', 'Rombe fylt'],
      ['◇', 'Rombe åpen'],
      ['■', 'Kvadrat fylt'],
      ['□', 'Kvadrat åpent'],
      ['▪', 'Lite kvadrat fylt'],
      ['▫', 'Lite kvadrat åpent'],
      ['▲', 'Trekant opp'],
      ['▼', 'Trekant ned'],
      ['►', 'Trekant høyre'],
      ['◄', 'Trekant venstre'],
    ],
  },
  {
    id: 'units',
    label: 'Valuta og enheter',
    symbols: [
      ['€', 'Euro'],
      ['£', 'Pund'],
      ['$', 'Dollar'],
      ['¥', 'Yen'],
      ['¢', 'Cent'],
      ['¤', 'Valutategn'],
      ['₿', 'Bitcoin'],
      ['₽', 'Rubel'],
      ['₹', 'Rupi'],
      ['₩', 'Won'],
      ['°', 'Grader'],
      ['℃', 'Grader celsius'],
      ['℉', 'Grader fahrenheit'],
      ['‰', 'Promille'],
      ['µ', 'Mikro'],
      ['Ω', 'Ohm'],
      ['Å', 'Ångström'],
      ['ℓ', 'Liter'],
    ],
  },
  {
    // Tastene man skriver om når man dokumenterer en snarvei. Bare de som
    // finnes i skriftene folk faktisk har – en tom rute sier ingenting.
    id: 'keys',
    label: 'Tastatur',
    symbols: [
      ['⌘', 'Kommandotast'],
      ['⌥', 'Tilvalgstast'],
      ['⌃', 'Kontrolltast'],
      ['⇧', 'Skift'],
      ['⇪', 'Caps Lock'],
      ['⏎', 'Enter'],
      ['↵', 'Linjeskift'],
      ['⌫', 'Slett bakover'],
      ['⌦', 'Slett framover'],
      ['⇥', 'Tabulator'],
      ['⇤', 'Tabulator tilbake'],
      ['⎋', 'Escape'],
      ['␣', 'Mellomrom'],
      ['⇞', 'Side opp'],
      ['⇟', 'Side ned'],
    ],
  },
  {
    id: 'letters',
    label: 'Bokstaver',
    symbols: [
      ['á', 'a med akutt aksent'],
      ['à', 'a med grav aksent'],
      ['â', 'a med cirkumfleks'],
      ['ä', 'a med tøddel'],
      ['ã', 'a med tilde'],
      ['ā', 'a med strek'],
      ['ç', 'c med cedille'],
      ['č', 'c med hake'],
      ['é', 'e med akutt aksent'],
      ['è', 'e med grav aksent'],
      ['ê', 'e med cirkumfleks'],
      ['ë', 'e med tøddel'],
      ['ē', 'e med strek'],
      ['í', 'i med akutt aksent'],
      ['ì', 'i med grav aksent'],
      ['î', 'i med cirkumfleks'],
      ['ï', 'i med tøddel'],
      ['ñ', 'n med tilde'],
      ['ó', 'o med akutt aksent'],
      ['ò', 'o med grav aksent'],
      ['ô', 'o med cirkumfleks'],
      ['ö', 'o med tøddel'],
      ['õ', 'o med tilde'],
      ['ú', 'u med akutt aksent'],
      ['ù', 'u med grav aksent'],
      ['û', 'u med cirkumfleks'],
      ['ü', 'u med tøddel'],
      ['ý', 'y med akutt aksent'],
      ['ÿ', 'y med tøddel'],
      ['š', 's med hake'],
      ['ž', 'z med hake'],
      ['ł', 'l med strek'],
      ['ß', 'Skarpe s'],
      ['œ', 'oe-ligatur'],
      ['ð', 'Eth'],
      ['þ', 'Thorn'],
      ['É', 'E med akutt aksent'],
      ['Ä', 'A med tøddel'],
      ['Ö', 'O med tøddel'],
      ['Ü', 'U med tøddel'],
      ['Ñ', 'N med tilde'],
      ['Ç', 'C med cedille'],
    ],
  },
]

/**
 * The name for a character, whichever group it was read from. Where a
 * character appears in two groups — '°' is both typography and a unit — the
 * name it got first wins, so "Nylig" reads it the same way the menu does.
 */
export const SYMBOL_NAMES = new Map<string, string>()
for (const group of SYMBOL_GROUPS) {
  for (const [char, name] of group.symbols) {
    if (!SYMBOL_NAMES.has(char)) SYMBOL_NAMES.set(char, name)
  }
}

const GROUP_KEY = 'slaids.symbolGroup'
const RECENT_KEY = 'slaids.symbolsRecent'
/** Enough rows that what is in play right now is on screen, short enough to read at a glance. */
const RECENT_MAX = 16

/** The most recently used characters, minus any that no longer name a group. */
export function recentSymbols(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    if (!Array.isArray(stored)) return []
    return stored
      .filter((char): char is string => typeof char === 'string' && SYMBOL_NAMES.has(char))
      .slice(0, RECENT_MAX)
  } catch {
    return []
  }
}

/**
 * The menu's own memory: which group was open, and what was just used. Both
 * are conveniences — a full quota loses the choice silently rather than
 * blocking the menu.
 */
function saveChoice(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* full quota — the menu opens fine without it */
  }
}

export function rememberSymbol(char: string): void {
  const next = [char, ...recentSymbols().filter((other) => other !== char)].slice(0, RECENT_MAX)
  saveChoice(RECENT_KEY, JSON.stringify(next))
}

export function lastSymbolGroup(): string {
  try {
    return localStorage.getItem(GROUP_KEY) ?? SYMBOL_GROUPS[0].id
  } catch {
    return SYMBOL_GROUPS[0].id
  }
}

/**
 * Inserts a character where the caret is — plain text, in the format it lands
 * in, replacing a selection exactly as typing over one would. Tiptap already
 * does all of that for `insertContent`; there is no Range surgery to write.
 */
export function insertSymbol(editor: Editor, char: string): void {
  editor.chain().focus().insertContent(char).run()
}

/**
 * Ω in the toolbar, everywhere a Tiptap instance is the active editor —
 * including a slide title and a section's two pills, which carry no
 * formatting of their own but are still text somebody types into.
 *
 * The popover stays open after a press, since symbols rarely come one at a
 * time and the caret is still sitting where it was. Every button inside it —
 * the trigger, the group tabs, the cells — swallows its own `mousedown`, and
 * the content refuses the focus Radix would otherwise move into it on open:
 * together that is what keeps the caret in the field the whole time, the way
 * an empty caption (which deletes itself on blur) needs it to.
 */
export function SymbolPickerButton({ editor }: { editor: Editor }) {
  const [group, setGroup] = useState<string>(lastSymbolGroup)
  const [hovered, setHovered] = useState<string | null>(null)
  const [recent, setRecent] = useState<string[]>([])

  const groups = recent.length
    ? [
        {
          id: 'recent',
          label: 'Nylig',
          symbols: recent.map((char) => [char, SYMBOL_NAMES.get(char) ?? char] as SymbolEntry),
        },
        ...SYMBOL_GROUPS,
      ]
    : SYMBOL_GROUPS
  const active = groups.find((entry) => entry.id === group) ?? groups[0]

  const choose = (char: string): void => {
    rememberSymbol(char)
    insertSymbol(editor, char)
  }

  return (
    <Popover.Root
      onOpenChange={(open) => {
        // Read fresh each time it opens, not while it is open — the grid a
        // finger is aiming at should never move under it.
        if (open) {
          setRecent(recentSymbols())
          setHovered(null)
        }
      }}
    >
      <Tooltip label="Spesialtegn">
        <Popover.Trigger asChild>
          <button
            type="button"
            className="btn btn--sm btn--icon"
            onMouseDown={(event) => event.preventDefault()}
            data-testid="format-symbol"
            aria-label="Spesialtegn"
          >
            <span className="symbol-trigger">Ω</span>
          </button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          className="popover popover--symbols"
          sideOffset={6}
          onOpenAutoFocus={(event) => event.preventDefault()}
          data-testid="symbol-picker"
        >
          <div className="symbol-tabs" role="group" aria-label="Grupper">
            {groups.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === active.id ? 'btn btn--sm btn--active' : 'btn btn--sm'}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setGroup(entry.id)
                  saveChoice(GROUP_KEY, entry.id)
                  setHovered(null)
                }}
                aria-pressed={entry.id === active.id}
                data-testid={`symbol-group-${entry.id}`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="symbol-grid" role="group" aria-label={active.label}>
            {active.symbols.map(([char, name]) => (
              <button
                key={char}
                type="button"
                className="symbol-cell"
                title={name}
                aria-label={name}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(char)}
                onPointerEnter={() => setHovered(name)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(name)}
                onBlur={() => setHovered(null)}
                data-testid={`symbol-cell-${char}`}
              >
                {char}
              </button>
            ))}
          </div>
          <div className="symbol-name">{hovered ?? active.label}</div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
