import { describe, expect, it } from 'vitest'
import { createPresentation } from './domain/presentation'
import { collectLeaves, collectNodes, validateTree, walkNodes } from './domain/layout'
import { validateSlideGeometry } from './domain/geometry'
import { createTitledCard, createUntitledCard, createContainer } from './domain/content'
import { estimateFitChecker } from './domain/fit'
import { paragraphDoc } from './domain/richdoc'
import type { Presentation, LayoutNode, SplitNode } from './domain/types'
import {
  clearLayoutNode,
  deleteLayoutNode,
  moveZoneContent,
  moveZoneContentToSandbox,
  placeSandboxItem,
  setZoneContent,
  splitLeaf,
  updateSplit,
  setSubfieldCount,
  setContentKind,
} from './domain/commands'

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function checkInvariants(p: Presentation, label: string): string[] {
  const problems: string[] = []
  const contentIds = new Map<string, number>()
  for (const slide of p.slides) {
    for (const v of validateTree(slide.root)) problems.push(`${label}: tree ${v.message} @${v.nodeId}`)
    for (const v of validateSlideGeometry(slide)) problems.push(`${label}: geom ${v.kind} ${v.detail} @${v.nodeId}`)
    walkNodes(slide.root, (n) => {
      if (n.kind === 'split' && 'content' in n) problems.push(`${label}: split has content`)
      if (n.kind === 'leaf' && 'children' in n) problems.push(`${label}: leaf has children`)
      if (n.kind === 'leaf' && n.content) {
        contentIds.set(n.content.id, (contentIds.get(n.content.id) ?? 0) + 1)
      }
    })
  }
  for (const item of p.sandbox) contentIds.set(item.content.id, (contentIds.get(item.content.id) ?? 0) + 1)
  for (const [id, n] of contentIds) if (n > 1) problems.push(`${label}: duplicate content id ${id} x${n}`)
  return problems
}

describe('fuzz', () => {
  it('keeps invariants across random command sequences', () => {
    const allProblems: string[] = []
    const counts: Record<number, number> = {}
    for (let seed = 1; seed <= 400; seed += 1) {
      const rnd = mulberry(seed)
      let p = createPresentation({ title: 'F' })
      const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]
      for (let step = 0; step < 40; step += 1) {
        const slide = pick(p.slides)
        const nodes = collectNodes(slide.root)
        const leaves = collectLeaves(slide.root)
        const splits = nodes.filter((n): n is SplitNode => n.kind === 'split')
        const op = Math.floor(rnd() * 8)
        let next: Presentation | null = null
        const weights = (n: number): number[] => Array.from({ length: n }, () => 1 + Math.floor(rnd() * 3))
        try {
          if (op === 0 && leaves.length) {
            const n = 2 + Math.floor(rnd() * 4)
            const r = splitLeaf(p, { slideId: slide.id, nodeId: pick(leaves).id, axis: rnd() < 0.5 ? 'x' : 'y', weights: weights(n), contentTargetIndex: Math.floor(rnd() * n), fits: estimateFitChecker })
            if (r.ok) next = r.value.presentation
          } else if (op === 1 && splits.length) {
            const s = pick(splits)
            const n = 2 + Math.floor(rnd() * 4)
            const r = updateSplit(p, { slideId: slide.id, nodeId: s.id, axis: rnd() < 0.5 ? 'x' : 'y', childCount: n, weights: weights(n), fits: estimateFitChecker })
            if (r.ok) next = r.value.presentation
          } else if (op === 2 && splits.length) {
            const s = pick(splits)
            const n = s.children.length
            const r = updateSplit(p, { slideId: slide.id, nodeId: s.id, weights: weights(n), fits: estimateFitChecker })
            if (r.ok) next = r.value.presentation
          } else if (op === 3 && nodes.length > 1) {
            const target = pick(nodes.filter((n) => n.id !== slide.root.id))
            const r = deleteLayoutNode(p, { slideId: slide.id, nodeId: target.id })
            if (r.ok) next = r.value.presentation
          } else if (op === 4 && nodes.length) {
            const r = clearLayoutNode(p, { slideId: slide.id, nodeId: pick(nodes).id })
            if (r.ok) next = r.value.presentation
          } else if (op === 5 && leaves.length) {
            const empty = leaves.filter((l) => !l.content)
            if (empty.length) {
              const kind = Math.floor(rnd() * 3)
              const content = kind === 0 ? createUntitledCard() : kind === 1 ? createTitledCard('T') : createContainer({ type: 'richdoc', doc: paragraphDoc('hei '.repeat(1 + Math.floor(rnd() * 40))) })
              const r = setZoneContent(p, { slideId: slide.id, nodeId: pick(empty).id, content, fits: estimateFitChecker })
              if (r.ok) next = r.value.presentation
            }
          } else if (op === 6 && leaves.length > 1) {
            const full = leaves.filter((l) => l.content)
            const empty = leaves.filter((l) => !l.content)
            if (full.length && empty.length) {
              const r = moveZoneContent(p, { slideId: slide.id, fromNodeId: pick(full).id, toNodeId: pick(empty).id, fits: estimateFitChecker })
              if (r.ok) next = r.value.presentation
            }
          } else if (op === 7) {
            const full = leaves.filter((l) => l.content)
            if (full.length && rnd() < 0.5) {
              const r = moveZoneContentToSandbox(p, { slideId: slide.id, nodeId: pick(full).id })
              if (r.ok) next = r.value.presentation
            } else if (p.sandbox.length) {
              const empty = leaves.filter((l) => !l.content)
              if (empty.length) {
                const r = placeSandboxItem(p, { itemId: pick(p.sandbox).id, slideId: slide.id, nodeId: pick(empty).id, fits: estimateFitChecker })
                if (r.ok) next = r.value.presentation
              }
            }
          }
        } catch (e) {
          allProblems.push(`seed ${seed} step ${step} op ${op} THREW ${String(e)}`)
          break
        }
        if (next) {
          counts[op] = (counts[op] ?? 0) + 1
          p = next
          const probs = checkInvariants(p, `seed ${seed} step ${step} op ${op}`)
          if (probs.length) { allProblems.push(...probs); break }
        }
      }
      if (allProblems.length > 20) break
    }
    console.log('op counts', JSON.stringify(counts))
    expect(allProblems.slice(0, 20)).toEqual([])
  })
})
