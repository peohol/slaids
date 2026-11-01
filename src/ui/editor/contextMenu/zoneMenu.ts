/**
 * The menu for a zone, as zone mode offers it.
 *
 * Four kinds of zone, four menus — an empty one, one with content, a split and
 * deliberate air — composed from the same parts, so «Del sone» or «Slett sone»
 * reads and behaves the same wherever it appears.
 *
 * Whether an entry can be used is never decided here. It is asked of the very
 * domain command the entry would run, with the same fit checkers, against the
 * document as it stands: a duplicate that would squeeze a sibling's text out of
 * view is disabled *because the command refuses it*, and its reason is the
 * command's own words. A menu that judged for itself would be a second opinion
 * about the same question, and the two would drift.
 *
 * Nothing here runs anything. A builder returns entries whose `onSelect` calls
 * a handler, and the editor supplies the handlers — the same callbacks its
 * toolbar and dialogs already use.
 */

import {
  duplicateLayoutNode,
  placeSandboxItem,
  reorderLayoutNode,
  splitLeaf,
  updateSplit,
  type StructuralOptions,
} from '../../../domain/commands'
import { contentDocs, contentLabel } from '../../../domain/content'
import { computeSlideGeometry } from '../../../domain/geometry'
import { findLeaf, findNode, findParent } from '../../../domain/layout'
import { geometryForTheme } from '../../../domain/metrics'
import { describeError, type Result } from '../../../domain/result'
import { docToPlainText } from '../../../domain/richdoc'
import type {
  Axis,
  ContentSlide,
  LayoutNode,
  NodeId,
  Presentation,
  SandboxItem,
  SplitNode,
  ZoneContentKind,
} from '../../../domain/types'
import { SEPARATOR, type MenuAction, type MenuEntry } from '../../components/contextMenu'
import type { IconName } from '../../components/Icon'
import { contentKindEntries, contentKindOptions } from '../contentKinds'
import { AXIS_LABELS, SIZE_SCOPE_TITLES, splitSummary, zoneTitle } from '../zoneDescription'

export interface ZoneMenuHandlers {
  /** Fill an empty zone with fresh content of a kind. */
  addContent: (nodeId: NodeId, kind: ZoneContentKind) => void
  /** Convert the content a zone already holds. */
  setContentKind: (nodeId: NodeId, kind: ZoneContentKind) => void
  copy: (nodeId: NodeId) => void
  cut: (nodeId: NodeId) => void
  paste: (nodeId: NodeId) => void
  placeSandboxItem: (nodeId: NodeId, itemId: string) => void
  openSandbox: () => void
  /** Start choosing another zone for this one's content. */
  moveContent: (nodeId: NodeId) => void
  moveToSandbox: (nodeId: NodeId) => void
  /** Split a leaf into two equal halves along `axis`. */
  split: (nodeId: NodeId, axis: Axis) => void
  /** The split dialog, for anything the quick splits do not cover. */
  openSplitDialog: (nodeId: NodeId) => void
  setWeights: (splitId: NodeId, weights: number[]) => void
  duplicate: (nodeId: NodeId) => void
  /** Move a zone to `toIndex` among its siblings, keeping its ratio. */
  reorder: (nodeId: NodeId, toIndex: number) => void
  /** Ask, then empty the zone. */
  clear: (nodeId: NodeId) => void
  /** Ask, then remove the zone. */
  remove: (nodeId: NodeId) => void
}

export interface ZoneMenuInput {
  presentation: Presentation
  slide: ContentSlide
  nodeId: NodeId
  /**
   * The checkers every edit is measured with. The menu asks the same commands
   * the entries run, so it has to measure the same way they will.
   */
  checks: StructuralOptions
}

export interface ZoneMenu {
  title: string
  entries: MenuEntry[]
}

/**
 * The zone's own actions, as every surface names and draws them.
 *
 * The menu here, the inspector and the icon row over a selected zone all offer
 * these, and a person who learnt «Tøm sone …» in one of them should find the
 * same words and the same picture in the others. An ellipsis means the action
 * asks something before it acts — a target, a confirmation, a dialog.
 */
export const ZONE_ACTIONS = {
  split: { label: 'Del sone', icon: 'split-x' },
  editSplit: { label: 'Rediger deling …', icon: 'edit' },
  moveContent: { label: 'Flytt innholdet til en annen sone …', icon: 'target' },
  toSandbox: { label: 'Flytt til sandkassen', icon: 'sandbox' },
  clear: { label: 'Tøm sone …', icon: 'eraser' },
  remove: { label: 'Slett sone …', icon: 'trash' },
} as const satisfies Record<string, { label: string; icon: IconName }>

/** Why the root cannot be removed — said wherever «Slett sone» is offered. */
export const ROOT_REMOVE_REASON = 'Hovedsonen kan ikke slettes. Bruk «Tøm sone».'

/**
 * Whether «Tøm sone» has anything to do here: a split to collapse, or content
 * of any kind — deliberate air included. A zone too small for anything else
 * cannot be converted out of air, and the root cannot be deleted, so emptying
 * is the one way such a zone gets its picker back.
 */
export function canClearZone(node: LayoutNode): boolean {
  return node.kind === 'split' || node.content !== null
}

/** How many sandbox items are offered by name before the sandbox itself is. */
const SANDBOX_ITEMS_LISTED = 8
/** How much of an item's text says which item it is. */
const SANDBOX_LABEL_CHARS = 32

/**
 * The ratios a split of this many zones is most often wanted in.
 *
 * Equal first, then the halves and thirds a layout is usually reached for in.
 * A split of four or more is offered «equal» and the dialog: past that the
 * common shapes are too many to list, and a long list is what the dialog is for.
 */
export function ratioPresets(count: number): number[][] {
  const equal = Array.from({ length: count }, () => 1)
  if (count === 2) return [equal, [1, 2], [2, 1], [1, 3], [3, 1], [2, 3], [3, 2]]
  if (count === 3) return [equal, [1, 2, 1], [2, 1, 1], [1, 1, 2], [2, 1, 2]]
  return [equal]
}

function sameWeights(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((weight, index) => weight === b[index])
}

/** The refusal a dry run of the command gives, or `null` when it would go through. */
function refusalOf(result: Result<unknown>): string | null {
  return result.ok ? null : describeError(result.error)
}

/** What a zone is, as the menu's title says it. */
function describeNode(node: LayoutNode): string {
  const summary = splitSummary(node)
  return summary ? `${zoneTitle(node)} · ${summary}` : zoneTitle(node)
}

/** A sandbox item as a menu names it: its kind, and the first words it says. */
export function sandboxItemLabel(item: SandboxItem): string {
  const text = contentDocs(item.content)
    .map((doc) => docToPlainText(doc).trim())
    .find((value) => value.length > 0)
  if (!text) return contentLabel(item.content)
  const short = text.length > SANDBOX_LABEL_CHARS ? `${text.slice(0, SANDBOX_LABEL_CHARS - 1)}…` : text
  return `${contentLabel(item.content)}: ${short}`
}

/* ------------------------------------------------------------------ *
 * Parts
 * ------------------------------------------------------------------ */

/**
 * The content kinds, as a submenu.
 *
 * For an empty zone this is «Legg til innhold», for a full one «Endre
 * innholdstype» with the current kind checked. The domain decides what can be
 * used — `contentKindOptions` is the rule every picker reads.
 */
export function contentKindSubmenu(
  input: ZoneMenuInput,
  handlers: Pick<ZoneMenuHandlers, 'addContent' | 'setContentKind'>,
  label?: string,
): MenuEntry {
  const { presentation, slide, nodeId } = input
  const leaf = findLeaf(slide.root, nodeId)
  const content = leaf?.content ?? null
  const rect = computeSlideGeometry(slide, geometryForTheme(presentation.theme)).rects.get(nodeId)
  const options = contentKindOptions(rect ?? null, presentation.theme, content)
  return {
    kind: 'submenu',
    id: content ? 'content-kind' : 'add-content',
    label: label ?? (content ? 'Endre innholdstype' : 'Legg til innhold'),
    icon: content ? 'card' : 'plus',
    entries: contentKindEntries(options, content?.kind ?? null, (kind) =>
      content ? handlers.setContentKind(nodeId, kind) : handlers.addContent(nodeId, kind),
    ),
  }
}

function clipboardEntries(
  nodeId: NodeId,
  handlers: Pick<ZoneMenuHandlers, 'copy' | 'cut'>,
  withCut: boolean,
): MenuEntry[] {
  const copy: MenuAction = {
    kind: 'action',
    id: 'copy',
    label: 'Kopier',
    icon: 'copy',
    shortcut: 'Ctrl+C',
    onSelect: () => handlers.copy(nodeId),
  }
  if (!withCut) return [copy]
  return [
    copy,
    {
      kind: 'action',
      id: 'cut',
      label: 'Klipp ut',
      icon: 'cut',
      shortcut: 'Ctrl+X',
      onSelect: () => handlers.cut(nodeId),
    },
  ]
}

function sandboxSubmenu(
  input: ZoneMenuInput,
  handlers: Pick<ZoneMenuHandlers, 'placeSandboxItem' | 'openSandbox'>,
): MenuEntry {
  const { presentation, slide, nodeId, checks } = input
  const items = presentation.sandbox.slice(0, SANDBOX_ITEMS_LISTED)
  const listed: MenuEntry[] = items.map((item) => {
    const reason = refusalOf(
      placeSandboxItem(presentation, { itemId: item.id, slideId: slide.id, nodeId, ...checks }),
    )
    return {
      kind: 'action',
      id: `sandbox-${item.id}`,
      label: sandboxItemLabel(item),
      disabled: reason !== null,
      reason,
      onSelect: () => handlers.placeSandboxItem(nodeId, item.id),
    }
  })
  return {
    kind: 'submenu',
    id: 'from-sandbox',
    label: 'Hent fra sandkassen',
    icon: 'sandbox',
    disabled: presentation.sandbox.length === 0,
    reason: presentation.sandbox.length === 0 ? 'Sandkassen er tom.' : null,
    entries:
      presentation.sandbox.length === 0
        ? [{ kind: 'action', id: 'sandbox-empty', label: 'Sandkassen er tom', disabled: true, onSelect: () => undefined }]
        : [
            ...listed,
            SEPARATOR,
            {
              kind: 'action',
              id: 'open-sandbox',
              label:
                presentation.sandbox.length > items.length
                  ? `Åpne sandkassen (${presentation.sandbox.length})`
                  : 'Åpne sandkassen',
              icon: 'sandbox',
              onSelect: handlers.openSandbox,
            },
          ],
  }
}

/**
 * What an empty zone can be filled with: new content, the clipboard, or
 * something kept in the sandbox. The same in both modes — an empty zone is
 * about what goes in it either way.
 */
export function fillEntries(
  input: ZoneMenuInput,
  handlers: Pick<
    ZoneMenuHandlers,
    'addContent' | 'setContentKind' | 'paste' | 'placeSandboxItem' | 'openSandbox'
  >,
): MenuEntry[] {
  return [
    contentKindSubmenu(input, handlers),
    {
      kind: 'action',
      id: 'paste',
      label: 'Lim inn',
      icon: 'paste',
      shortcut: 'Ctrl+V',
      onSelect: () => handlers.paste(input.nodeId),
    },
    sandboxSubmenu(input, handlers),
  ]
}

/**
 * «Del sone»: side by side, one above the other, or the dialog for the rest.
 *
 * The two quick ones are halves; the dialog is where a count or a ratio is
 * chosen. A split of a zone with content keeps it in the first half, which is
 * what the dialog does by default too.
 */
function splitSubmenu(input: ZoneMenuInput, handlers: ZoneMenuHandlers): MenuEntry {
  const { presentation, slide, nodeId, checks } = input
  const quick = (axis: Axis, label: string): MenuAction => {
    const reason = refusalOf(
      splitLeaf(presentation, {
        slideId: slide.id,
        nodeId,
        axis,
        weights: [1, 1],
        contentTargetIndex: 0,
        ...checks,
      }),
    )
    return {
      kind: 'action',
      id: `split-${axis}`,
      label,
      icon: axis === 'x' ? 'split-x' : 'split-y',
      disabled: reason !== null,
      reason,
      onSelect: () => handlers.split(nodeId, axis),
    }
  }
  return {
    kind: 'submenu',
    id: 'split',
    ...ZONE_ACTIONS.split,
    entries: [
      quick('x', AXIS_LABELS.x),
      quick('y', AXIS_LABELS.y),
      SEPARATOR,
      {
        kind: 'action',
        id: 'split-advanced',
        label: 'Avansert deling …',
        icon: 'zones',
        onSelect: () => handlers.openSplitDialog(nodeId),
      },
    ],
  }
}

/** «Fordel likt» for one split: its children at the same ratio. */
function equalizeAction(
  input: ZoneMenuInput,
  handlers: ZoneMenuHandlers,
  split: SplitNode,
  id: string,
  label: string,
): MenuAction {
  const equal = split.children.map(() => 1)
  const already = sameWeights(split.weights, equal)
  const reason = already
    ? 'Sonene er allerede like store.'
    : refusalOf(
        updateSplit(input.presentation, {
          slideId: input.slide.id,
          nodeId: split.id,
          weights: equal,
          ...input.checks,
        }),
      )
  return {
    kind: 'action',
    id,
    label,
    icon: 'equalize',
    disabled: reason !== null,
    reason,
    onSelect: () => handlers.setWeights(split.id, equal),
  }
}

/** What the four places a zone can be moved to are called, along each axis. */
const REORDER_LABELS: Record<Axis, { previous: string; next: string; first: string; last: string }> = {
  x: { previous: 'Til venstre', next: 'Til høyre', first: 'Helt til venstre', last: 'Helt til høyre' },
  y: { previous: 'Opp', next: 'Ned', first: 'Øverst', last: 'Nederst' },
}

/**
 * The keys that move the selected zone one place, as the menu shows them.
 * The editor's key handler reads the same step from `reorderStepForKey`.
 */
const REORDER_SHORTCUTS = { previous: 'Shift+←', next: 'Shift+→' } as const

/**
 * Which way an arrow key moves the selected zone among its siblings, or `null`
 * for a key that does not move it.
 *
 * Left and up both mean "earlier", right and down "later", whichever way the
 * split runs — the same as the plain arrows walking the siblings, so a zone
 * never has a dead key.
 */
export function reorderStepForKey(key: string): -1 | 1 | null {
  if (key === 'ArrowLeft' || key === 'ArrowUp') return -1
  if (key === 'ArrowRight' || key === 'ArrowDown') return 1
  return null
}

/**
 * «Flytt sone»: the zone to another place among its siblings.
 *
 * One step either way, and — when there are more than two — straight to either
 * end. Each place is asked of `reorderLayoutNode` itself, so one the command
 * would refuse is greyed out with its words.
 */
function reorderSubmenu(input: ZoneMenuInput, handlers: ZoneMenuHandlers, parent: SplitNode): MenuEntry {
  const { presentation, slide, nodeId, checks } = input
  const index = parent.children.findIndex((child) => child.id === nodeId)
  const last = parent.children.length - 1
  const labels = REORDER_LABELS[parent.axis]
  const place = (
    id: string,
    label: string,
    toIndex: number,
    icon: MenuAction['icon'],
    shortcut?: string,
  ): MenuAction => {
    const reason =
      toIndex === index
        ? 'Sonen står allerede der.'
        : refusalOf(reorderLayoutNode(presentation, { slideId: slide.id, nodeId, toIndex, ...checks }))
    return {
      kind: 'action',
      id: `reorder-${id}`,
      label,
      icon,
      ...(shortcut ? { shortcut } : {}),
      disabled: reason !== null,
      reason,
      onSelect: () => handlers.reorder(nodeId, toIndex),
    }
  }
  const [back, forward] =
    parent.axis === 'x'
      ? (['chevron-left', 'chevron-right'] as const)
      : (['chevron-up', 'chevron-down'] as const)
  const steps = [
    place('previous', labels.previous, Math.max(0, index - 1), back, REORDER_SHORTCUTS.previous),
    place('next', labels.next, Math.min(last, index + 1), forward, REORDER_SHORTCUTS.next),
  ]
  const ends = last > 1 ? [place('first', labels.first, 0, back), place('last', labels.last, last, forward)] : []
  return {
    kind: 'submenu',
    id: 'reorder',
    label: 'Flytt sone',
    icon: 'move',
    entries: [...steps, ...(ends.length > 0 ? [SEPARATOR, ...ends] : [])],
  }
}

/**
 * The layout part every zone but the root has: a copy beside it, a new place
 * among its siblings, and its siblings made the same size.
 */
function siblingEntries(input: ZoneMenuInput, handlers: ZoneMenuHandlers): MenuEntry[] {
  const { presentation, slide, nodeId, checks } = input
  const parent = findParent(slide.root, nodeId)
  if (!parent) return []
  const duplicateRefusal = refusalOf(
    duplicateLayoutNode(presentation, { slideId: slide.id, nodeId, ...checks }),
  )
  return [
    {
      kind: 'action',
      id: 'duplicate',
      label: 'Dupliser sone',
      icon: 'duplicate',
      disabled: duplicateRefusal !== null,
      reason: duplicateRefusal,
      onSelect: () => handlers.duplicate(nodeId),
    },
    reorderSubmenu(input, handlers, parent),
    equalizeAction(input, handlers, parent, 'equalize-siblings', 'Fordel søskensonene likt'),
  ]
}

function ratioSubmenu(input: ZoneMenuInput, handlers: ZoneMenuHandlers, split: SplitNode): MenuEntry {
  const presets = ratioPresets(split.children.length).map((weights): MenuAction => {
    const current = sameWeights(split.weights, weights)
    const reason = current
      ? null
      : refusalOf(
          updateSplit(input.presentation, {
            slideId: input.slide.id,
            nodeId: split.id,
            weights,
            ...input.checks,
          }),
        )
    return {
      kind: 'action',
      id: `ratio-${weights.join('-')}`,
      label: weights.join(' : '),
      checked: current,
      disabled: reason !== null,
      reason,
      onSelect: () => handlers.setWeights(split.id, weights),
    }
  })
  return {
    kind: 'submenu',
    id: 'ratios',
    label: SIZE_SCOPE_TITLES.inside,
    icon: 'zones',
    entries: [
      ...presets,
      SEPARATOR,
      {
        kind: 'action',
        id: 'ratios-custom',
        label: 'Egendefinert …',
        icon: 'edit',
        onSelect: () => handlers.openSplitDialog(split.id),
      },
    ],
  }
}

function destructiveEntries(input: ZoneMenuInput, handlers: ZoneMenuHandlers, node: LayoutNode): MenuEntry[] {
  const isRoot = input.slide.root.id === input.nodeId
  const entries: MenuEntry[] = []
  if (canClearZone(node)) {
    entries.push({
      kind: 'action',
      id: 'clear',
      ...ZONE_ACTIONS.clear,
      danger: true,
      onSelect: () => handlers.clear(input.nodeId),
    })
  }
  entries.push({
    kind: 'action',
    id: 'delete',
    ...ZONE_ACTIONS.remove,
    danger: true,
    disabled: isRoot,
    reason: isRoot ? ROOT_REMOVE_REASON : null,
    onSelect: () => handlers.remove(input.nodeId),
  })
  return entries
}

/* ------------------------------------------------------------------ *
 * The four menus
 * ------------------------------------------------------------------ */

export function zoneModeMenu(input: ZoneMenuInput, handlers: ZoneMenuHandlers): ZoneMenu | null {
  const node = findNode(input.slide.root, input.nodeId)
  if (!node) return null
  const title = describeNode(node)
  const { nodeId } = input

  if (node.kind === 'split') {
    return {
      title,
      entries: [
        {
          kind: 'action',
          id: 'edit-split',
          ...ZONE_ACTIONS.editSplit,
          onSelect: () => handlers.openSplitDialog(nodeId),
        },
        ratioSubmenu(input, handlers, node),
        equalizeAction(input, handlers, node, 'equalize', 'Fordel subsonene likt'),
        SEPARATOR,
        ...siblingEntries(input, handlers),
        SEPARATOR,
        ...destructiveEntries(input, handlers, node),
      ],
    }
  }

  if (!node.content) {
    return {
      title,
      entries: [
        ...fillEntries(input, handlers),
        SEPARATOR,
        splitSubmenu(input, handlers),
        ...siblingEntries(input, handlers),
        SEPARATOR,
        ...destructiveEntries(input, handlers, node),
      ],
    }
  }

  if (node.content.kind === 'negative-space') {
    return {
      title,
      entries: [
        contentKindSubmenu(input, handlers),
        ...clipboardEntries(nodeId, handlers, false),
        SEPARATOR,
        splitSubmenu(input, handlers),
        ...siblingEntries(input, handlers),
        SEPARATOR,
        ...destructiveEntries(input, handlers, node),
      ],
    }
  }

  return {
    title,
    entries: [
      ...clipboardEntries(nodeId, handlers, true),
      SEPARATOR,
      {
        kind: 'action',
        id: 'move',
        ...ZONE_ACTIONS.moveContent,
        onSelect: () => handlers.moveContent(nodeId),
      },
      {
        kind: 'action',
        id: 'to-sandbox',
        ...ZONE_ACTIONS.toSandbox,
        onSelect: () => handlers.moveToSandbox(nodeId),
      },
      contentKindSubmenu(input, handlers),
      SEPARATOR,
      splitSubmenu(input, handlers),
      ...siblingEntries(input, handlers),
      SEPARATOR,
      ...destructiveEntries(input, handlers, node),
    ],
  }
}
