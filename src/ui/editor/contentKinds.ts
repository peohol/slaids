/**
 * How the content kinds are offered.
 *
 * One list, read by the empty-zone picker, the inspector, the toolbar menu and
 * the compact tools panel, so a kind added to the domain shows up in all of
 * them at once instead of in whichever of them somebody remembered. The labels
 * are the domain's own (`CONTENT_KIND_LABELS`); only the icon is a decision
 * this layer makes.
 *
 * Whether a kind can be *used* is the domain's answer too — `contentKindRefusal`
 * in `domain/contentSize.ts` and `negativeSpaceRefusal` in `domain/content.ts`,
 * the very rules the commands refuse by. A picker that decided for itself would
 * be a second opinion about the same question, and the two would drift the
 * first time a token moved: a button that looks available and then fails on
 * click is worse than one that was never offered.
 */

import { CONTENT_KIND_LABELS, negativeSpaceRefusal } from '../../domain/content'
import { contentKindRefusal } from '../../domain/contentSize'
import { themeMetrics } from '../../domain/metrics'
import type { PresentationTheme, Rect, ZoneContent, ZoneContentKind } from '../../domain/types'
import type { IconName } from '../components/Icon'

export const CONTENT_KIND_ICONS: Record<ZoneContentKind, IconName> = {
  container: 'container',
  'untitled-card': 'card',
  'titled-card': 'card-titled',
  image: 'image',
  'titled-image-card': 'card-image',
  /* Last in the row on purpose: the kinds that draw something are what an
     author reaches for first, and deliberate air is the considered choice at
     the end of the list — and the only one left in a zone too small for the
     rest. */
  'negative-space': 'negative-space',
}

/** The kinds, in the order they are offered everywhere. */
export const CONTENT_KINDS = Object.keys(CONTENT_KIND_ICONS) as ZoneContentKind[]

export function contentKindLabel(kind: ZoneContentKind): string {
  return CONTENT_KIND_LABELS[kind]
}

/** One kind as a picker offers it: what it is called, and whether it can be used. */
export interface ContentKindOption {
  kind: ZoneContentKind
  label: string
  icon: IconName
  disabled: boolean
  /** Why it is disabled, for a tooltip. `null` when it is available. */
  reason: string | null
}

/**
 * Every kind, with the ones that cannot be used here marked and explained.
 *
 * Two reasons a kind can be unavailable, and both are the domain's:
 *
 *  - **The zone is too small for it** (`contentKindRefusal`). `rect` is the
 *    zone's actual rectangle in the logical design space, and it is `null`
 *    where there is no zone to measure against — nothing is selected — in which
 *    case nothing is offered as unavailable: a picker that greys everything out
 *    because it does not know the size is telling the author something false.
 *  - **The zone holds something the kind cannot carry**
 *    (`negativeSpaceRefusal`). Only air can lose anything, and it loses
 *    everything, so a zone with text or a file in it has to be emptied first.
 *    `content` is what the zone holds today, and `null` for an empty zone.
 */
export function contentKindOptions(
  rect: Rect | null,
  theme?: PresentationTheme,
  content: ZoneContent | null = null,
): ContentKindOption[] {
  const tokens = themeMetrics(theme)
  const wouldLoseContent = negativeSpaceRefusal(content)
  return CONTENT_KINDS.map((kind) => {
    // The kind the zone already is can never be unavailable: it is the state
    // the document is in, and the command answers «done» to it. A zone that is
    // too small for what it holds — an import, a document from before a token
    // moved — would otherwise grey out its own kind and read as broken.
    if (kind === content?.kind) {
      return { kind, label: CONTENT_KIND_LABELS[kind], icon: CONTENT_KIND_ICONS[kind], disabled: false, reason: null }
    }
    const tooSmall = rect ? contentKindRefusal(kind, rect, tokens)?.message : undefined
    const reason =
      tooSmall ?? (kind === 'negative-space' ? (wouldLoseContent ?? undefined) : undefined)
    return {
      kind,
      label: CONTENT_KIND_LABELS[kind],
      icon: CONTENT_KIND_ICONS[kind],
      disabled: reason !== undefined,
      reason: reason ?? null,
    }
  })
}
