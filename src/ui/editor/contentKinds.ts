/**
 * How the content kinds are offered.
 *
 * One list, read by the empty-zone picker, the inspector, the toolbar menu and
 * the compact tools panel, so a kind added to the domain shows up in all of
 * them at once instead of in whichever of them somebody remembered. The labels
 * are the domain's own (`CONTENT_KIND_LABELS`); only the icon is a decision
 * this layer makes.
 *
 * Whether a kind can be *used* is the domain's answer too — `zoneKindRefusal`
 * in `domain/contentSize.ts`, the very rule the command refuses by and the one
 * the agent's `inspect_slide` lists the available kinds by. A picker that
 * decided for itself would be a second opinion about the same question, and the
 * two would drift the first time a token moved: a button that looks available
 * and then fails on click is worse than one that was never offered.
 */

import { CONTENT_KIND_LABELS, ZONE_CONTENT_KINDS } from '../../domain/content'
import { zoneKindRefusal } from '../../domain/contentSize'
import { themeMetrics } from '../../domain/metrics'
import type { PresentationTheme, Rect, ZoneContent, ZoneContentKind } from '../../domain/types'
import type { IconName, IconTone } from '../components/Icon'
import type { MenuAction } from '../components/contextMenu'

export const CONTENT_KIND_ICONS: Record<ZoneContentKind, IconName> = {
  'titled-card': 'card-titled',
  'untitled-card': 'card',
  container: 'container',
  image: 'image',
  'titled-image-card': 'card-image',
  'negative-space': 'negative-space',
}

/**
 * Which family of tools each kind belongs to, for its icon's ink.
 *
 * Text cards are content; a picture — with or without a title band — is a
 * picture; a container and deliberate air arrange other zones rather than
 * holding anything, so they belong with the zone tools.
 */
export const CONTENT_KIND_TONES: Record<ZoneContentKind, IconTone> = {
  'titled-card': 'content',
  'untitled-card': 'content',
  container: 'zone',
  image: 'media',
  'titled-image-card': 'media',
  'negative-space': 'zone',
}

/**
 * The kinds, in the order they are offered everywhere.
 *
 * The domain's order, not this layer's: `CONTENT_KIND_LABELS` says which kind
 * leads, and a picker that ordered them for itself would be a second opinion
 * about which content kind is the normal one.
 */
export const CONTENT_KINDS = ZONE_CONTENT_KINDS

export function contentKindLabel(kind: ZoneContentKind): string {
  return CONTENT_KIND_LABELS[kind]
}

/** One kind as a picker offers it: what it is called, and whether it can be used. */
export interface ContentKindOption {
  kind: ZoneContentKind
  label: string
  icon: IconName
  tone: IconTone
  disabled: boolean
  /** Why it is disabled, for a tooltip. `null` when it is available. */
  reason: string | null
}

/**
 * Every kind, with the ones that cannot be used here marked and explained.
 *
 * `rect` is the zone's actual rectangle in the logical design space, and
 * `content` is what it holds today (`null` for an empty zone). Both go straight
 * to `zoneKindRefusal`, which is the same answer the command refuses by and the
 * same one `inspect_slide` lists the available kinds by — one question, three
 * readers. `rect` is `null` where there is no zone to measure against, and then
 * nothing is offered as unavailable: a picker that greys everything out because
 * it does not know the size is telling the author something false.
 */
export function contentKindOptions(
  rect: Rect | null,
  theme?: PresentationTheme,
  content: ZoneContent | null = null,
): ContentKindOption[] {
  const tokens = themeMetrics(theme)
  return CONTENT_KINDS.map((kind) => {
    const refusal = zoneKindRefusal(kind, rect, content, tokens)
    return {
      kind,
      label: CONTENT_KIND_LABELS[kind],
      icon: CONTENT_KIND_ICONS[kind],
      tone: CONTENT_KIND_TONES[kind],
      disabled: refusal !== null,
      reason: refusal?.message ?? null,
    }
  })
}

/**
 * The kinds as menu entries: one per kind, the unavailable ones disabled with
 * the domain's reason under them, and — when the zone holds something — the
 * kind in force checked.
 *
 * Shared by the toolbar's «Innholdstype» menu and the zone's context menu, so
 * the two are the same list with the same marks, not two lists that agree today.
 */
export function contentKindEntries(
  options: readonly ContentKindOption[],
  current: ZoneContentKind | null,
  onSelect: (kind: ZoneContentKind) => void,
): MenuAction[] {
  return options.map((option) => ({
    kind: 'action',
    id: `kind-${option.kind}`,
    label: option.label,
    icon: option.icon,
    tone: option.tone,
    disabled: option.disabled,
    reason: option.reason,
    ...(current !== null ? { checked: current === option.kind } : {}),
    onSelect: () => onSelect(option.kind),
  }))
}
