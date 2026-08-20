/** Keyboard shortcut reference. */

import { Modal } from '../components/Modal'

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Generelt',
    items: [
      ['Ctrl + E', 'Bytt mellom innholds- og soneredigering'],
      ['Ctrl + Z', 'Angre'],
      ['Ctrl + Shift + Z', 'Gjør om'],
      ['F5', 'Vis presentasjonen'],
    ],
  },
  {
    title: 'Soneredigering',
    items: [
      ['↑', 'Velg supersonen'],
      ['↓', 'Velg første subsone'],
      ['← / →', 'Velg forrige/neste søsken (går rundt)'],
      ['Ctrl + C', 'Kopier innholdet i sonen'],
      ['Ctrl + X', 'Klipp ut innholdet i sonen'],
      ['Ctrl + V', 'Lim inn i en tom sone'],
    ],
  },
  {
    title: 'Tekst',
    items: [
      ['Ctrl + B / I / U', 'Fet / kursiv / understreket'],
      ['Ctrl + Shift + V', 'Lim inn som ren tekst'],
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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
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
        </section>
      ))}
    </Modal>
  )
}
