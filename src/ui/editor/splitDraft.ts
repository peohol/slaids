/**
 * The split dialog's reading of its own fields and of what «Bruk» would do.
 *
 * Pure, so the rules the dialog states to the author are tested as rules: how a
 * typed ratio is read and what is wrong with it, how a count is read, which
 * share of the room each zone gets, which zones a lower count removes with how
 * much content inside them, and what a dry run of the command said. The dialog
 * only renders these.
 *
 * Nothing here decides a layout. The ratios are quantised by the domain, the
 * minimum size and the fit are the command's verdict (`splitCheck` only reads a
 * result the command itself returned), and the geometry is the engine's.
 */

import { MAX_SPLIT_CHILDREN, MIN_SPLIT_CHILDREN } from '../../domain/constants'
import type { StructuralOutcome } from '../../domain/commands'
import { collectLeaves, countContent, findNode } from '../../domain/layout'
import { describeError, type Result } from '../../domain/result'
import type { LayoutNode } from '../../domain/types'

/** A typed ratio as a number: decimal comma or point, `NaN` when it is not one. */
export function parseWeight(value: string): number {
  const trimmed = value.trim()
  if (trimmed === '') return Number.NaN
  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

/** What is wrong with one ratio field, in words; `null` when it can be used. */
export function weightFieldError(value: string): string | null {
  if (value.trim() === '') return 'Skriv inn et forholdstall.'
  const parsed = parseWeight(value)
  if (Number.isNaN(parsed)) return 'Skriv et tall, for eksempel 2 eller 1,5.'
  if (parsed <= 0) return 'Forholdstallet må være større enn 0.'
  return null
}

/** A typed child count, when it is one the layout allows; otherwise `null`. */
export function parseCount(value: string): number | null {
  const parsed = Number(value.trim())
  if (!Number.isInteger(parsed) || parsed < MIN_SPLIT_CHILDREN || parsed > MAX_SPLIT_CHILDREN) {
    return null
  }
  return parsed
}

export const COUNT_ERROR = `Velg et helt tall fra ${MIN_SPLIT_CHILDREN} til ${MAX_SPLIT_CHILDREN}.`

/**
 * Each zone's share of the room the split hands out, in whole percent that add
 * up to exactly 100 (largest remainder).
 *
 * The room is what is left once the gaps are taken off, so this is a share of
 * that and not of the target rectangle — the dialog says so beside it.
 */
export function shares(weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (!(total > 0)) return weights.map(() => 0)
  const exact = weights.map((weight) => (weight / total) * 100)
  const floors = exact.map(Math.floor)
  let missing = 100 - floors.reduce((sum, value) => sum + value, 0)
  const order = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const { index } of order) {
    if (missing <= 0) break
    floors[index] += 1
    missing -= 1
  }
  return floors
}

/** «3», «3 og 4», «3, 4 og 5». */
export function listed(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} og ${labels[labels.length - 1]}`
}

/** «1 innholdselement», «3 innholdselementer». */
export function contentCount(count: number): string {
  return count === 1 ? '1 innholdselement' : `${count} innholdselementer`
}

/** A direct child a lower count takes away, and what goes with it. */
export interface RemovedZone {
  /** Its number in the split today: «3». */
  label: string
  /** Content anywhere in its subtree, however deep. */
  content: number
  /** Leaf zones inside it; 0 when it is a leaf itself. */
  innerZones: number
}

/** The children `count` leaves out: the tail of the split, with their whole subtrees. */
export function removedZones(existing: readonly LayoutNode[], count: number): RemovedZone[] {
  return existing.slice(count).map((child, offset) => ({
    label: String(count + offset + 1),
    content: countContent(child),
    innerZones: child.kind === 'split' ? collectLeaves(child).length : 0,
  }))
}

/** «Sone 3 fjernes.», «Sone 3 og 4 fjernes.», «Sone 3–6 fjernes.» — always the tail, so a range. */
export function removalSummary(removed: readonly RemovedZone[]): string {
  if (removed.length === 0) return ''
  if (removed.length === 1) return `Sone ${removed[0].label} fjernes.`
  if (removed.length === 2) return `Sone ${removed[0].label} og ${removed[1].label} fjernes.`
  return `Sone ${removed[0].label}–${removed[removed.length - 1].label} fjernes.`
}

/** «Sone 3 inneholder 2 innholdselementer i 2 underordnede soner.» */
export function removedDetail(zone: RemovedZone): string {
  const where = zone.innerZones > 0 ? ` i ${zone.innerZones} underordnede soner` : ''
  return zone.content === 0
    ? `Sone ${zone.label} er tom${zone.innerZones > 0 ? ` (${zone.innerZones} underordnede soner)` : ''}.`
    : `Sone ${zone.label} inneholder ${contentCount(zone.content)}${where}.`
}

/**
 * What a dry run of the split command said about the proposal.
 *
 * `zones` are the direct children the refusal is about, so the preview can mark
 * them; empty when the refusal names none of them.
 */
export type SplitCheck =
  | { ok: true; movedToSandbox: number; discarded: number }
  | { ok: false; message: string; zones: number[] }

/**
 * Read the command's own result for the dialog.
 *
 * `children` are the proposal's direct children, in field order: a refusal that
 * names a node (the fit guard names the leaf whose content would be hidden) is
 * attributed to the direct child whose subtree holds it, and one that names
 * child indices (the minimum-size check) is taken as is.
 */
export function splitCheck(
  result: Result<StructuralOutcome>,
  children: readonly LayoutNode[],
): SplitCheck {
  if (result.ok) {
    return {
      ok: true,
      movedToSandbox: result.value.movedToSandbox.length,
      discarded: result.value.discarded.length,
    }
  }
  const details = result.error.details ?? {}
  const zones = new Set<number>()
  if (Array.isArray(details.tooSmall)) {
    for (const index of details.tooSmall) if (typeof index === 'number') zones.add(index)
  }
  if (typeof details.childIndex === 'number') zones.add(details.childIndex)
  if (typeof details.nodeId === 'string') {
    const nodeId = details.nodeId
    const index = children.findIndex((child) => findNode(child, nodeId) !== null)
    if (index >= 0) zones.add(index)
  }
  return {
    ok: false,
    message: describeError(result.error),
    zones: [...zones].sort((a, b) => a - b),
  }
}
