/**
 * The cover's properties panel.
 *
 * There is exactly one thing to set here beyond the two lines themselves, and
 * it is deliberately one thing rather than two: the pill colour is also the
 * deck's default heading colour. Every heading nobody picked a colour for
 * follows it, so this swatch grid restyles the whole deck's headings, and a
 * heading that was given a colour of its own keeps it.
 */

import { setCoverPillColor } from '../../domain/commands'
import { useEditorStore } from '../../state/store'
import type { DeckCover } from '../../domain/types'
import { ColorSwatchGrid } from '../components/ColorPicker'

export function CoverInspector({ cover }: { cover: DeckCover }) {
  const run = useEditorStore((state) => state.run)

  return (
    <aside className="inspector" data-testid="inspector">
      <section className="inspector__section">
        <h2 className="inspector__heading">Forside</h2>
        <p className="hint">
          Forsiden er alltid første side og kan ikke slettes eller flyttes. Tittel og undertittel
          er midtstilt av seg selv.
        </p>
      </section>

      <section className="inspector__section">
        <h2 className="inspector__heading">Pillefarge</h2>
        <ColorSwatchGrid
          value={cover.pillColor}
          onSelect={(color) =>
            run('cover-color', (current) => setCoverPillColor(current, color))
          }
        />
        <p className="hint">
          Denne fargen er også standardfargen for overskrifter i innholdet. Overskrifter der du
          ikke har valgt en egen farge, følger den – også de du lager senere.
        </p>
      </section>
    </aside>
  )
}
