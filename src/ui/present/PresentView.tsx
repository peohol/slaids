/**
 * Presentation mode, from inside the editor.
 *
 * A thin wrapper around `PresentationPlayer`: the same renderer, the same
 * geometry and the same page list the public view uses, plus the one thing only
 * this side has — a way out.
 */

import { PresentationPlayer } from './PresentationPlayer'
import { useUserSettings } from '../../state/userSettings'
import type { Presentation } from '../../domain/types'

export function PresentView({
  presentation,
  startIndex,
  shareUrl,
  onExit,
}: {
  presentation: Presentation
  startIndex: number
  /** The live share link, so the author sees the QR page the audience will. */
  shareUrl?: string | null
  /** Called with the id of the last slide shown, to select it back in the editor. */
  onExit: (lastSlideId: string) => void
}) {
  const includeReferencesInProgress = useUserSettings((state) => state.includeReferencesInProgress)
  const citationStyle = useUserSettings((state) => state.citationStyle)
  return (
    <PresentationPlayer
      deck={presentation}
      citationStyle={citationStyle}
      includeReferencesInProgress={includeReferencesInProgress}
      shareUrl={shareUrl ?? null}
      startIndex={startIndex}
      onExit={onExit}
    />
  )
}
