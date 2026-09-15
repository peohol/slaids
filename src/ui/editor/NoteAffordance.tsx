/**
 * What a note zone shows **in the editor**, and nowhere else.
 *
 * A note is editorial text the audience never sees (see `NoteContent`), so the
 * zone itself draws nothing. This is the handle that opens it — a button with
 * the note's own label on it — and it is editor chrome in the strict sense:
 *
 *  - it is passed to `ZoneContentFrame` as `renderNote`, which only the
 *    editable renderer does, so a presented, published, exported or offscreen
 *    note zone is bare ground with nothing to hide;
 *  - it is never measured. `estimateFit` reports no parts for a note and
 *    `minimumSizeForKind` gives it no floor, so this button cannot push a zone
 *    over its limits or set one. In a sliver of a zone the label folds away and
 *    the icon stands alone rather than the layout becoming invalid.
 *
 * It deliberately does not try to show the note's text. A prompt is a
 * paragraph, a zone can be a hundred pixels tall, and a preview that is
 * sometimes legible and sometimes three clipped words is worse than a label
 * that always says the same thing.
 */

import { noteLabel } from '../../domain/content'
import type { NoteContent } from '../../domain/types'
import { Icon } from '../components/Icon'

export function NoteAffordance({
  content,
  onOpen,
}: {
  content: NoteContent
  /**
   * What opening the note does, where opening it is what a press means.
   *
   * Absent in zone mode, and then the handle is drawn but inert. Zone mode is
   * the mode about the zones themselves — a press there selects the zone, the
   * way it does over a card's text, which is not typed into there either — so a
   * button that swallowed the press would make a note the one kind of zone that
   * cannot be selected by pressing it.
   */
  onOpen?: () => void
}) {
  const label = noteLabel(content)
  const inside = (
    <>
      <Icon name="note" size={16} />
      <span className="zone-note__label">{label}</span>
    </>
  )
  return (
    <div className="zone-note">
      {onOpen ? (
        <button
          type="button"
          className="zone-note__button"
          data-testid="open-note"
          data-note-purpose={content.purpose}
          aria-label={label}
          title={label}
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
        >
          {inside}
        </button>
      ) : (
        <span
          className="zone-note__button zone-note__button--inert"
          data-testid="note-marker"
          data-note-purpose={content.purpose}
        >
          {inside}
        </span>
      )}
    </div>
  )
}
