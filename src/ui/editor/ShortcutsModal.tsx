/** Keyboard shortcut reference. */

import { Modal } from '../components/Modal'
import { EDITOR_SHORTCUTS, SPLIT_SHORTCUTS, type EditorShortcut } from './editorShortcuts'

function shortcut(action: EditorShortcut, label: string = EDITOR_SHORTCUTS[action][1]): [string, string] {
  return [`Ctrl + Alt + ${EDITOR_SHORTCUTS[action][0]}`, label]
}

/** Delingene virker også mens det skrives, på sonen markøren står i. */
const SPLITS_WHILE_TYPING = Object.entries(SPLIT_SHORTCUTS).map(([action, axis]) =>
  shortcut(
    action as EditorShortcut,
    `Del sonen du skriver i med en ${axis === 'x' ? 'vertikal' : 'horisontal'} strek`,
  ),
)

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Generelt',
    items: [
      ['Ctrl + E', 'Bytt mellom innholds- og soneredigering'],
      ['Ctrl + Z', 'Angre'],
      ['Ctrl + Shift + Z', 'Gjør om'],
      ['↑ / ↓', 'Forrige/neste side (ikke mens du skriver)'],
      ['Delete / Backspace', 'Slett sliden som er valgt i slideoversikten'],
      ['F5', 'Vis presentasjonen'],
      shortcut('sandbox'),
      shortcut('slide'),
    ],
  },
  {
    title: 'Soneredigering',
    items: [
      ['Esc', 'Tilbake til innholdsredigering'],
      ['↑', 'Velg supersonen'],
      ['↓', 'Velg første subsone'],
      ['← / →', 'Velg forrige/neste søsken (går rundt)'],
      ['Shift + ← / →', 'Flytt sonen ett hakk bakover/fremover blant søsknene'],
      ['Ctrl + C', 'Kopier innholdet i sonen'],
      ['Ctrl + X', 'Klipp ut innholdet i sonen'],
      ['Ctrl + V', 'Lim inn i en tom sone'],
      ['Shift + F10', 'Hurtigmeny for valgt sone (også høyreklikk)'],
      shortcut('splitVertical'),
      shortcut('splitHorizontal'),
      shortcut('clear'),
      shortcut('remove'),
      shortcut('toSandbox'),
    ],
  },
  {
    title: 'Tekst',
    items: [
      ['Ctrl + B / I / U', 'Fet / kursiv / understreket'],
      ['Ctrl + Shift + V', 'Lim inn som ren tekst'],
      ['Shift + F10', 'Hurtigmeny for markeringen'],
      shortcut('reference'),
      ...SPLITS_WHILE_TYPING,
    ],
  },
  {
    title: 'Presentasjonsmodus',
    items: [
      ['→ / mellomrom', 'Neste slide'],
      ['←', 'Forrige slide'],
      ['Home / End', 'Første / siste slide'],
      ['Esc', 'Avslutt'],
    ],
  },
]

export function ShortcutsModal({
  open,
  onOpenChange,
  onEditAutocorrect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The user's own typing substitutions are theirs to edit, not listed here. */
  onEditAutocorrect: () => void
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Hurtigtaster"
      testId="shortcuts-modal"
      width={560}
      footer={
        <button type="button" className="btn btn--primary" onClick={() => onOpenChange(false)}>
          Lukk
        </button>
      }
    >
      <p className="hint">På Mac kan du bruke ⌘ + Ctrl for hurtigtastene som bruker Ctrl + Alt.</p>
      {GROUPS.map((group) => (
        <section key={group.title}>
          <h3 className="reference-heading">{group.title}</h3>
          <dl className="shortcuts">
            {group.items.map(([keys, description]) => (
              <div className="shortcuts__row" key={keys}>
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{description}</dd>
              </div>
            ))}
          </dl>
          {group.title === 'Tekst' && (
            <p className="hint">
              Det som byttes ut mens du skriver – for eksempel at «mellomrom» - «mellomrom» blir til
              tankestrek – bestemmer du selv under{' '}
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                data-testid="shortcuts-autocorrect"
                onClick={onEditAutocorrect}
              >
                Autoerstatt
              </button>
            </p>
          )}
        </section>
      ))}
    </Modal>
  )
}
