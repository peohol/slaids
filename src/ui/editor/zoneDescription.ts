/**
 * What a zone is and where it sits, in words.
 *
 * The zone menu's title, the inspector's heading and its line about the
 * zone's place in the tree all say the same few things about a node, so they
 * are said here once: a split read as «Delt sone» in a menu and as something
 * else in the panel beside it would be two names for one thing.
 */

import { contentLabel } from '../../domain/content'
import { findParent } from '../../domain/layout'
import type { Axis, LayoutNode, NodeId } from '../../domain/types'
import type { IconName, IconTone } from '../components/Icon'
import { CONTENT_KIND_ICONS, CONTENT_KIND_TONES } from './contentKinds'

/** The two directions a split or a card's fields run in, as every surface names them. */
export const AXIS_LABELS: Record<Axis, string> = { x: 'Side ved side', y: 'Over/under' }

/**
 * The two size questions a zone answers, as every surface names them.
 *
 * A split's ratios share out its own area among its direct children; a child's
 * ratio is its size among its siblings. The inspector heads a section with
 * each, and the zone menu names its entries after them, so «inni» and
 * «blant søskensonene» mean the same split wherever they are read.
 */
export type SizeScope = 'inside' | 'siblings'
export const SIZE_SCOPE_TITLES: Record<SizeScope, string> = {
  inside: 'Fordeling inni denne sonen',
  siblings: 'Størrelse blant søskensonene',
}

/** The zone's name: its content kind, «Tom sone», or «Delt sone». */
export function zoneTitle(node: LayoutNode): string {
  if (node.kind === 'split') return 'Delt sone'
  return node.content ? contentLabel(node.content) : 'Tom sone'
}

/** The icon and ink a zone is drawn with where it is named. */
export function zoneIcon(node: LayoutNode): { icon: IconName; tone?: IconTone } {
  if (node.kind === 'split') return { icon: node.axis === 'x' ? 'split-x' : 'split-y', tone: 'zone' }
  if (!node.content) return { icon: 'zones' }
  return { icon: CONTENT_KIND_ICONS[node.content.kind], tone: CONTENT_KIND_TONES[node.content.kind] }
}

/** What a split holds, e.g. «2 soner side ved side». `null` for a leaf. */
export function splitSummary(node: LayoutNode): string | null {
  if (node.kind !== 'split') return null
  return `${node.children.length} soner ${AXIS_LABELS[node.axis].toLowerCase()}`
}

/**
 * Where the zone sits among its siblings: the main zone for the root — named
 * with «Rot» too, the path's word for it — otherwise e.g. «Sone 2 av 3, side
 * ved side».
 */
export function zonePosition(root: LayoutNode, nodeId: NodeId): string {
  const parent = findParent(root, nodeId)
  if (!parent) return 'Hovedsonen (Rot), hele sliden'
  const index = parent.children.findIndex((child) => child.id === nodeId)
  return `Sone ${index + 1} av ${parent.children.length}, ${AXIS_LABELS[parent.axis].toLowerCase()}`
}
