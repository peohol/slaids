/**
 * A section's properties panel.
 *
 * Two colours, and they are the two things a section decides for the part of
 * the deck it opens. The accent paints its pills, and with them every heading,
 * card header and caption from here to the next section that nobody picked a
 * colour for; the background is the page colour those slides are drawn on.
 * Neither is stored on the slides that follow — they read the section — which
 * is why changing one here restyles a whole part of the deck without a single
 * stored document changing, and why a heading that *was* given a colour keeps
 * the one it was given.
 *
 * The background used to be one setting in the theme for the entire deck. It
 * is here now for the same reason the accent is: a deck reads as a run of
 * parts, and a part is what an author recolours.
 */

import { setSectionAccentColor, setSectionBackgroundColor } from '../../domain/commands'
import { useEditorStore } from '../../state/store'
import type { SectionSlide } from '../../domain/types'
import { ColorSwatchGrid } from '../components/ColorPicker'

export function SectionInspector({ section }: { section: SectionSlide }) {
  const run = useEditorStore((state) => state.run)
  const isFront = useEditorStore((state) => state.presentation?.slides[0]?.id === section.id)

  return (
    <aside className="inspector" data-testid="inspector">
      <section className="inspector__section">
        <h2 className="inspector__heading">{isFront ? 'Forside' : 'Inndeling'}</h2>
        <p className="hint">
          {isFront
            ? 'Første slide er alltid en inndeling, så presentasjonen har alltid en forside. Overskrift og underoverskrift er midtstilt av seg selv, og underoverskriften er valgfri.'
            : 'En inndeling deler dekket i deler. Overskrift og underoverskrift er midtstilt av seg selv, og underoverskriften er valgfri.'}
        </p>
      </section>

      <section className="inspector__section">
        <h2 className="inspector__heading">Aksentfarge</h2>
        <ColorSwatchGrid
          value={section.accentColor}
          onSelect={(color) =>
            run('section-accent', (current) =>
              setSectionAccentColor(current, section.id, color),
            )
          }
        />
        <p className="hint">
          Fargen på pillene her, og standardfargen for overskrifter, kortheadere og
          bildetekster på slidene fram til neste inndeling. De du har gitt en egen farge,
          beholder den.
        </p>
      </section>

      <section className="inspector__section">
        <h2 className="inspector__heading">Bakgrunnsfarge</h2>
        <ColorSwatchGrid
          value={section.backgroundColor}
          onSelect={(color) =>
            run('section-background', (current) =>
              setSectionBackgroundColor(current, section.id, color),
            )
          }
        />
        <p className="hint">
          Bakgrunnen på denne siden og på slidene fram til neste inndeling.
        </p>
      </section>
    </aside>
  )
}
