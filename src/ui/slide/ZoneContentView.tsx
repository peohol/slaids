/** Static (non-editable) rendering of zone content. */

import { ZoneContentFrame } from './ZoneContentFrame'
import { ImagePanelView } from './ImagePanelView'
import { RichDocView } from './RichDocView'
import { REFERENCE_SLIDE_ID_PREFIX } from '../../domain/references'
import type { NoteContent, ZoneContent } from '../../domain/types'

export function ZoneContentView({
  content,
  renderNote,
}: {
  content: ZoneContent
  /**
   * What a note draws, for the one caller that is still the editor.
   *
   * Nothing, unless somebody asks for something — see `ZoneContentFrameProps`.
   * The editor's zone mode renders content statically (there is no typing in
   * it) but is still the editor, so it passes the affordance through; the
   * audience-facing callers — presentation, the player, a published deck,
   * thumbnails, a rendered preview and offscreen measurement — pass nothing,
   * and a note zone is bare ground for them.
   */
  renderNote?: (note: NoteContent) => React.ReactNode
}) {
  return (
    <ZoneContentFrame
      content={content}
      renderTitle={(card) => <RichDocView doc={card.title} className="rich-doc--title" />}
      renderField={(field) => (
        <RichDocView
          doc={field.doc}
          className={field.id.includes(REFERENCE_SLIDE_ID_PREFIX) ? 'rich-doc--reference' : undefined}
        />
      )}
      renderNote={renderNote}
      renderImage={(panel, variant) => <ImagePanelView panel={panel} variant={variant} />}
    />
  )
}
