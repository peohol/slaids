/**
 * What is written on this slide, as a list.
 *
 * Navigation, not a second place to write. A portrait phone is a reading shape,
 * so finding a field by hunting for it in a slide scaled to a quarter of its
 * size is not something a finger can do — this names every field on the page by
 * where it sits, with the first line of what is in it. A tap then does exactly
 * what a long press on the page itself does: it fills the stage with that
 * field, where the text is edited. There is one writing surface, and it is the
 * slide.
 *
 * The list is derived from the layout tree, so a zone split this morning has
 * its fields here this afternoon without this file knowing anything about it.
 */

import type { Slide } from '../../../domain/types'
import { Icon } from '../../components/Icon'
import { textTargetKey, textTargetsForSlide, type TextTargetEntry } from '../textTarget'

export function CompactContentList({
  slide,
  onEdit,
}: {
  /** `null` on a derived page: it is generated, and there is nothing to edit. */
  slide: Slide | null
  /** Fill the stage with this field and put the caret in it. */
  onEdit: (entry: TextTargetEntry) => void
}) {
  const entries = slide ? textTargetsForSlide(slide) : []

  if (entries.length === 0) {
    return (
      <p className="hint" data-testid="compact-content-empty">
        {!slide
          ? 'Denne siden lages automatisk fra presentasjonen og kan ikke redigeres. Velg en vanlig slide for å skrive.'
          : slide.kind === 'interactive'
            ? 'Miniapper har ingen tekstfelt. Navn og fil endres i panelet under.'
            : 'Ingen tekstfelt på denne sliden ennå. Legg inn innhold i en sone først.'}
      </p>
    )
  }

  return (
    <ul className="compact-content" data-testid="compact-content-list">
      {entries.map((entry) => (
        <li key={textTargetKey(entry.target)}>
          <button
            type="button"
            className="compact-content__item"
            data-testid="compact-content-item"
            data-target-kind={entry.target.kind}
            // Selecting the zone, focusing it and closing the panel are all
            // one step, and it is the same step the page's own long press
            // takes — see `focusField` in `EditorView`.
            onClick={() => onEdit(entry)}
          >
            <span className="compact-content__where">{entry.label}</span>
            <span className="compact-content__preview">
              {entry.preview.trim() || <em>Tomt</em>}
            </span>
            <Icon name="edit" size={15} />
          </button>
        </li>
      ))}
    </ul>
  )
}
