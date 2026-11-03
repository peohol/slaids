/**
 * Which zones on the editor's stage are drawn smaller than normal, right now.
 *
 * Not a fact about the presentation, and never stored: each entry is what the
 * stage's own `ZoneFitBox` last measured for its zone, written when the
 * measurement changes and removed when the zone leaves the stage. It exists so
 * the inspector can say *why* a selected zone looks small without measuring
 * the zone a second time — the answer is always the one the slide is drawn
 * with. A zone at normal size has no entry at all.
 */

import { create } from 'zustand'
import type { NodeId } from '../domain/types'

interface ZoneScalesStore {
  scales: ReadonlyMap<NodeId, number>
  report: (nodeId: NodeId, scale: number) => void
}

export const useZoneScales = create<ZoneScalesStore>((set) => ({
  scales: new Map(),
  report: (nodeId, scale) =>
    set((state) => {
      const current = state.scales.get(nodeId)
      const next = scale < 1 ? scale : undefined
      if (current === next) return state
      const scales = new Map(state.scales)
      if (next === undefined) scales.delete(nodeId)
      else scales.set(nodeId, next)
      return { scales }
    }),
}))

/** How much smaller than normal the stage draws `nodeId`'s content; `1` when it is not. */
export function useZoneScale(nodeId: NodeId | null): number {
  return useZoneScales((state) => (nodeId ? (state.scales.get(nodeId) ?? 1) : 1))
}
