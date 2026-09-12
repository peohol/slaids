/**
 * What is written on this slide, as a list.
 *
 * A portrait phone is a reading shape, not a canvas shape, so the slide is a
 * preview at the top and this is the working surface below it: every field on
 * the page, named by where it sits, with the first line of what is in it. A tap
 * opens that field on the focused writing surface.
 *
 * The list is derived from the layout tree, so a zone split this morning has
 * its fields here this afternoon without this file knowing anything about it.
 */

import { useEditorStore } from '../../../state/store'
import type { Slide } from '../../../domain/types'
import { Icon } from '../../components/Icon'
import { textTargetKey, textTargetsForSlide, type TextTargetEntry } from '../textTarget'

export function CompactContentList({
  slide,
  onEdit,
}: {
  slide: Slide
  onEdit: (entry: TextTargetEntry) => void
}) {
  const selectNode = useEditorStore((state) => state.selectNode)
  const entries = textTargetsForSlide(slide)

  if (entries.length === 0) {
    return (
      <p className="hint" data-testid="compact-content-empty">
        {slide.kind === 'interactive'
          ? 'Interaktive slides har ingen tekstfelt. Navn og fil endres i panelet under.'
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
            onClick={() => {
              // The panel beside this list follows the caret, the same way the
              // stage's own fields make the inspector follow it.
              if ('nodeId' in entry.target) selectNode(entry.target.nodeId)
              onEdit(entry)
            }}
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
