/** Static (non-editable) rendering of zone content. */

import { ZoneContentFrame } from './ZoneContentFrame'
import { RichDocView } from './RichDocView'
import { AssetImage } from './AssetImage'
import type { ZoneContent } from '../../domain/types'

export function ZoneContentView({ content }: { content: ZoneContent }) {
  return (
    <ZoneContentFrame
      content={content}
      renderTitle={(card) => <RichDocView doc={card.title} className="rich-doc--title" />}
      renderField={(field) => <RichDocView doc={field.doc} />}
      renderContainer={(container) =>
        container.payload.type === 'richdoc' ? (
          <RichDocView doc={container.payload.doc} />
        ) : (
          <AssetImage assetId={container.payload.assetId} fit={container.payload.fit} />
        )
      }
    />
  )
}
