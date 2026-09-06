/** Static (non-editable) rendering of zone content. */

import { ZoneContentFrame } from './ZoneContentFrame'
import { ImagePanelView } from './ImagePanelView'
import { RichDocView } from './RichDocView'
import { REFERENCE_SLIDE_ID_PREFIX } from '../../domain/references'
import type { ZoneContent } from '../../domain/types'

export function ZoneContentView({ content }: { content: ZoneContent }) {
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
      renderImage={(panel, variant) => <ImagePanelView panel={panel} variant={variant} />}
    />
  )
}
