/**
 * How the five content kinds are offered.
 *
 * One list, read by the empty-zone picker, the inspector and the toolbar menu,
 * so a kind added to the domain shows up in all three at once instead of in
 * whichever of them somebody remembered. The labels are the domain's own
 * (`CONTENT_KIND_LABELS`); only the icon is a decision this layer makes.
 */

import { CONTENT_KIND_LABELS } from '../../domain/content'
import type { ZoneContentKind } from '../../domain/types'
import type { IconName } from '../components/Icon'

export const CONTENT_KIND_ICONS: Record<ZoneContentKind, IconName> = {
  container: 'container',
  'untitled-card': 'card',
  'titled-card': 'card-titled',
  image: 'image',
  'titled-image-card': 'card-image',
}

/** The kinds, in the order they are offered everywhere. */
export const CONTENT_KINDS = Object.keys(CONTENT_KIND_ICONS) as ZoneContentKind[]

export function contentKindLabel(kind: ZoneContentKind): string {
  return CONTENT_KIND_LABELS[kind]
}
