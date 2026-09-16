/**
 * The first thing a deck full of empty picture zones says for itself.
 *
 * An agent-made presentation arrives finished except for its pictures: the
 * zones are laid out, the captions say «Sett inn bilde 3 her», and the one
 * thing missing is the files. Dropped into the editor with no explanation, that
 * reads as a deck with holes in it — so this says what the holes are and offers
 * the two ways out, in the order most people want them.
 *
 * Choosing the editor is deliberately *not* a decision about the deposit. It
 * closes a dialog and nothing else: the numbers stay on the zones, the toolbar
 * still opens the brief, and the files can be dropped in a week from now. The
 * only thing that ends the deposit is an edit that makes it impossible, and
 * that asks its own question when it happens.
 */

import { Modal } from '../components/Modal'

export function ImageDepositIntroModal({
  expectedCount,
  onGenerate,
  onEdit,
}: {
  /** How many pictures the deck is waiting for. */
  expectedCount: number
  onGenerate: () => void
  onEdit: () => void
}) {
  const pictures = expectedCount === 1 ? 'ett bilde' : `${expectedCount} bilder`
  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onEdit()
      }}
      title="Presentasjonen mangler bildene sine"
      testId="image-deposit-intro"
      width={560}
      footer={
        <>
          <button
            type="button"
            className="btn"
            data-testid="image-deposit-intro-edit"
            onClick={onEdit}
          >
            Gå til editoren
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="image-deposit-intro-generate"
            onClick={onGenerate}
          >
            Generer og legg inn bilder
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>
        Denne presentasjonen har plass til {pictures} som ikke er laget ennå. Hver plass vet allerede
        hvilket bilde som skal ligge der.
      </p>
      <p>
        Slaids kan gi deg en ferdig bestilling du limer inn der du lager bilder. Når bildene er
        laget, legger du dem inn samlet — og de havner på riktig plass av seg selv.
      </p>
      <p className="hint" style={{ marginBottom: 0 }}>
        Du kan også gå rett til editoren og jobbe med teksten først. Tilbudet står til du selv endrer
        på bildeplassene: knappen for bildebriefen finnes øverst i editoren hele tiden.
      </p>
    </Modal>
  )
}
