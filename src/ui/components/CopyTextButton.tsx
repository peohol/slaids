/**
 * A button that shows a short piece of text and puts it on the clipboard.
 *
 * The text is the label, so what the button says is exactly what is copied;
 * a tick replaces the copy icon for a moment when it worked, and a refusal is
 * said out loud rather than passing for success.
 */

import { useEffect, useRef, useState } from 'react'
import { notify } from '../../state/toast'
import { COPIED_FEEDBACK_MS, copyToClipboard } from './clipboard'
import { Icon } from './Icon'
import { Tooltip } from './Tooltip'

export function CopyTextButton({
  text,
  tooltip,
  testId,
}: {
  text: string
  tooltip: string
  testId?: string
}) {
  // Which text the tick is for: a different text is a different claim, and a
  // tick left over from the last one would say this one was copied too.
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const copied = copiedText === text
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return (
    <Tooltip label={tooltip}>
      <button
        type="button"
        className="btn btn--sm"
        data-testid={testId}
        data-copied={copied ? 'true' : undefined}
        onClick={() => {
          void copyToClipboard(text).then((ok) => {
            if (!ok) {
              notify.error(`Kunne ikke kopiere automatisk. Skriv inn «${text}» for hånd.`)
              return
            }
            setCopiedText(text)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => setCopiedText(null), COPIED_FEEDBACK_MS)
          })
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} /> {text}
      </button>
    </Tooltip>
  )
}
