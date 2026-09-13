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
 * in `domain/contentSize.ts`, the very rule the commands refuse by. A picker
 * that decided for itself would be a second opinion about the same question,
 * and the two would drift the first time a token moved: a button that looks
 * available and then fails on click is worse than one that was never offered.
 */

import { CONTENT_KIND_LABELS } from '../../domain/content'
import { contentKindRefusal } from '../../domain/contentSize'
import { themeMetrics } from '../../domain/metrics'
import type { PresentationTheme, Rect, ZoneContentKind } from '../../domain/types'
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
 * Every kind, with the ones that cannot be drawn in `rect` marked and explained.
 *
 * `rect` is the zone's actual rectangle in the logical design space. It is
 * `null` where there is no zone to measure against — nothing is selected — and
 * then nothing is offered as unavailable: a picker that greys everything out
 * because it does not know the size is telling the author something false.
 */
export function contentKindOptions(
  rect: Rect | null,
  theme?: PresentationTheme,
): ContentKindOption[] {
  const tokens = themeMetrics(theme)
  return CONTENT_KINDS.map((kind) => {
    const refusal = rect ? contentKindRefusal(kind, rect, tokens) : null
    return {
      kind,
      label: CONTENT_KIND_LABELS[kind],
      icon: CONTENT_KIND_ICONS[kind],
      disabled: refusal !== null,
      reason: refusal?.message ?? null,
    }
  })
}
