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
      renderAsset={(payload) => <AssetImage assetId={payload.assetId} fit={payload.fit} />}
    />
  )
}
