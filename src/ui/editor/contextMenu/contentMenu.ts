/**
 * The menu for what is under the pointer in content mode.
 *
 * Zone mode is about the boxes; content mode is about what is in them, so the
 * menu here is about the thing that was right-clicked — the words in a field, a
 * table, a picture, its caption, the card around them — and then, below it,
 * about the content that thing belongs to. Built from parts, so «Tittelfarge»
 * or «Endre innholdstype» reads and behaves the same whichever part of a card
 * the menu was opened on.
 *
 * As in zone mode, nothing here decides what is allowed: text entries ask the
 * editor whether its command can run, and document entries dry-run the domain
 * command they would commit, so a disabled entry is disabled for the reason the
 * command itself gives.
 */

import {
  resetContentColors,
  setBodyAxis,
  setCardColor,
  setImageCaption,
  setImageFocus,
  setSubfieldCount,
  setVerticalAlign,
} from '../../../domain/commands'
import { DEFAULT_VERTICAL_ALIGN } from '../../../domain/constants'
import {
  bodyOf,
  CAPTION_POSITION_LABELS,
  CENTRED_FOCUS,
  captionPositionsFor,
  contentLabel,
  hasCardTitle,
  imagePanelOf,
  MAX_SUBFIELDS,
  withDefaultColors,
} from '../../../domain/content'
import { findLeaf } from '../../../domain/layout'
import { describeError, type Result } from '../../../domain/result'
import { docToPlainText, isDocEmpty } from '../../../domain/richdoc'
import type { ImagePanel, Presentation, ZoneContent } from '../../../domain/types'
import { SEPARATOR, type MenuAction, type MenuEntry } from '../../components/contextMenu'
import { VERTICAL_ALIGNMENTS } from '../textActions'
import type { ContentTarget } from './contentTarget'
import {
  FIELD_TITLES,
  colorSubmenu,
  inlineImageEntries,
  tableEntries,
  textEntries,
  type TextMenuHandlers,
} from './textMenu'
import {
  contentKindSubmenu,
  fillEntries,
  type ZoneMenu,
  type ZoneMenuHandlers,
  type ZoneMenuInput,
} from './zoneMenu'

export interface ContentMenuInput extends ZoneMenuInput {
  /** Commit one change to the document as one step of undo. */
  commit: (label: string, change: (presentation: Presentation) => Result<Presentation>) => void
}

export interface ContentMenuHandlers
  extends TextMenuHandlers,
    Pick<ZoneMenuHandlers, 'addContent' | 'setContentKind' | 'paste' | 'placeSandboxItem' | 'openSandbox'> {
  /** The upload dialog, to put a file in this zone's picture. */
  pickImage: (nodeId: string) => void
  /** Shrink the file behind this zone's picture. */
  optimizePanel: (nodeId: string) => void
}

/** The refusal a dry run gives, or `null` when the change would go through. */
function refusalOf(result: Result<unknown>): string | null {
  return result.ok ? null : describeError(result.error)
}

/** A document change as an entry: dry-run for its availability, committed when chosen. */
function change(
  input: ContentMenuInput,
  label: string,
  command: (presentation: Presentation) => Result<Presentation>,
  entry: Omit<MenuAction, 'kind' | 'onSelect'>,
): MenuAction {
  // Something the menu already knows is pointless is not asked of the command.
  const refusal = entry.disabled ? null : refusalOf(command(input.presentation))
  return {
    kind: 'action',
    ...entry,
    disabled: entry.disabled === true || refusal !== null,
    reason: refusal ?? entry.reason ?? null,
    onSelect: () => input.commit(label, command),
  }
}

function verticalEntries(input: ContentMenuInput, subfieldId: string): MenuEntry[] {
  const leaf = findLeaf(input.slide.root, input.nodeId)
  const current = (leaf?.content && bodyOf(leaf.content)?.subfields.find((field) => field.id === subfieldId))
    ?.verticalAlign ?? DEFAULT_VERTICAL_ALIGN
  return VERTICAL_ALIGNMENTS.map(([align, label, icon]) =>
    change(
      input,
      'vertical-align',
      (presentation) =>
        setVerticalAlign(presentation, {
          slideId: input.slide.id,
          nodeId: input.nodeId,
          subfieldId,
          align,
          ...input.checks,
        }),
      { id: `valign-${align}`, label, icon, checked: current === align },
    ),
  )
}

/* ------------------------------------------------------------------ *
 * Pictures and captions
 * ------------------------------------------------------------------ */

/* A caption with no colour of its own reads its picture's title panel when
   there is one, and the section otherwise — as the inspector says. */
function captionInherits(content: ZoneContent): string {
  return content.kind === 'titled-image-card' ? 'fra tittelpanelet' : 'fra inndelingen'
}

function captionPositionEntries(input: ContentMenuInput, content: ZoneContent, panel: ImagePanel): MenuEntry[] {
  return captionPositionsFor(content.kind).map((position) =>
    change(
      input,
      'caption-position',
      (presentation) =>
        setImageCaption(presentation, { slideId: input.slide.id, nodeId: input.nodeId, position, ...input.checks }),
      { id: `caption-${position}`, label: CAPTION_POSITION_LABELS[position], checked: panel.caption?.position === position },
    ),
  )
}

function removeCaptionEntry(input: ContentMenuInput, panel: ImagePanel): MenuAction {
  const written = panel.caption !== null && !isDocEmpty(panel.caption.doc)
  return {
    kind: 'action',
    id: 'caption-remove',
    label: written ? 'Fjern bildeteksten …' : 'Fjern bildeteksten',
    icon: 'trash',
    danger: true,
    confirm: written
      ? {
          title: 'Fjerne bildeteksten?',
          message: `«${docToPlainText(panel.caption?.doc).slice(0, 80)}» fjernes. Du kan angre etterpå.`,
          confirmLabel: 'Fjern bildeteksten',
        }
      : undefined,
    onSelect: () =>
      input.commit('caption-remove', (presentation) =>
        setImageCaption(presentation, { slideId: input.slide.id, nodeId: input.nodeId, remove: true }),
      ),
  }
}

function captionSection(input: ContentMenuInput, content: ZoneContent, panel: ImagePanel): MenuEntry[] {
  if (!panel.caption) return []
  const caption = panel.caption
  return [
    { kind: 'submenu', id: 'caption-position', label: 'Plassering', icon: 'move', entries: captionPositionEntries(input, content, panel) },
    colorSubmenu('caption-color', 'Bakgrunnsfarge', caption.color, captionInherits(content), (color) =>
      input.commit('caption-color', (presentation) =>
        setImageCaption(presentation, { slideId: input.slide.id, nodeId: input.nodeId, color }),
      ),
    ),
    removeCaptionEntry(input, panel),
  ]
}

function imageSection(
  input: ContentMenuInput,
  handlers: ContentMenuHandlers,
  content: ZoneContent,
  panel: ImagePanel,
): MenuEntry[] {
  const { nodeId } = input
  if (!panel.assetId) {
    return [{ kind: 'action', id: 'pick-image', label: 'Sett inn bilde …', icon: 'image-add', tone: 'media', onSelect: () => handlers.pickImage(nodeId) }]
  }
  const centred = panel.focus.x === CENTRED_FOCUS.x && panel.focus.y === CENTRED_FOCUS.y
  return [
    { kind: 'action', id: 'replace-image', label: 'Erstatt bildet …', icon: 'image-add', tone: 'media', onSelect: () => handlers.pickImage(nodeId) },
    change(
      input,
      'image-focus',
      (presentation) => setImageFocus(presentation, { slideId: input.slide.id, nodeId, focus: { ...CENTRED_FOCUS } }),
      {
        id: 'reset-crop',
        label: 'Tilbakestill utsnitt',
        icon: 'reset',
        disabled: centred,
        reason: centred ? 'Utsnittet er allerede midt i bildet.' : null,
      },
    ),
    {
      kind: 'submenu',
      id: 'caption',
      label: 'Bildetekst',
      icon: 'text',
      entries: [
        ...captionPositionEntries(input, content, panel),
        ...(panel.caption ? [SEPARATOR, removeCaptionEntry(input, panel)] : []),
      ],
    },
    { kind: 'action', id: 'optimize-image', label: 'Optimaliser bildet …', icon: 'optimize', onSelect: () => handlers.optimizePanel(nodeId) },
  ]
}

/* ------------------------------------------------------------------ *
 * The content around it
 * ------------------------------------------------------------------ */

function cardSection(input: ContentMenuInput, handlers: ContentMenuHandlers, content: ZoneContent): MenuEntry[] {
  const target = { slideId: input.slide.id, nodeId: input.nodeId }
  const entries: MenuEntry[] = []

  if (content.kind === 'untitled-card' || hasCardTitle(content)) {
    const untitled = content.kind === 'untitled-card'
    entries.push(
      colorSubmenu(
        'card-color',
        untitled ? 'Kortfarge' : 'Tittelfarge',
        untitled ? content.backgroundColor : content.headerColor,
        untitled ? null : 'fra inndelingen',
        (color) => input.commit('card-color', (presentation) => setCardColor(presentation, { ...target, color })),
      ),
    )
  }

  const body = bodyOf(content)
  if (body) {
    entries.push({
      kind: 'submenu',
      id: 'subfields',
      label: 'Delfelt',
      icon: 'zones',
      entries: [
        ...Array.from({ length: MAX_SUBFIELDS }, (_, index) => index + 1).map((count) =>
          change(
            input,
            'subfield-count',
            (presentation) => setSubfieldCount(presentation, { ...target, count, ...input.checks }),
            {
              id: `subfields-${count}`,
              label: count === 1 ? '1 felt' : `${count} felt`,
              checked: body.subfields.length === count,
              disabled: body.subfields.length === count,
            },
          ),
        ),
        SEPARATOR,
        ...(['x', 'y'] as const).map((axis) =>
          change(
            input,
            'subfield-axis',
            (presentation) => setBodyAxis(presentation, { ...target, axis, ...input.checks }),
            {
              id: `subfields-${axis}`,
              label: axis === 'x' ? 'Side ved side' : 'Over/under',
              icon: axis === 'x' ? 'split-x' : 'split-y',
              checked: body.axis === axis,
              disabled: body.axis === axis || body.subfields.length === 1,
              reason: body.subfields.length === 1 ? 'Ett felt står ikke i noen retning.' : null,
            },
          ),
        ),
      ],
    })
  }

  entries.push(contentKindSubmenu(input, handlers))

  const picked = withDefaultColors(content) !== content
  entries.push(
    change(input, 'reset-colors', (presentation) => resetContentColors(presentation, { ...target, ...input.checks }), {
      id: 'reset-colors',
      label: 'Tilbakestill farger',
      icon: 'reset',
      disabled: !picked,
      reason: picked ? null : 'Ingen farger er valgt her.',
    }),
  )
  return entries
}

/* ------------------------------------------------------------------ *
 * The menu
 * ------------------------------------------------------------------ */

export function contentModeMenu(
  input: ContentMenuInput,
  handlers: ContentMenuHandlers,
  target: ContentTarget,
): ZoneMenu | null {
  if ('at' in target) {
    const { editor, field } = target.at
    if (target.kind === 'table') return { title: 'Tabell', entries: tableEntries(editor) }
    if (target.kind === 'inline-image') return { title: 'Bilde i teksten', entries: inlineImageEntries(editor, handlers) }
    const text = textEntries(
      target.at,
      handlers,
      field.kind === 'body' && field.subfieldId ? verticalEntries(input, field.subfieldId) : [],
    )
    if (field.kind === 'slide-title') return { title: FIELD_TITLES[field.kind], entries: text }
    const content = findLeaf(input.slide.root, input.nodeId)?.content
    const panel = content ? imagePanelOf(content) : null
    return {
      title: FIELD_TITLES[field.kind],
      entries: [
        ...text,
        SEPARATOR,
        ...(content && panel && field.kind === 'caption' ? captionSection(input, content, panel) : []),
        ...(content && field.kind !== 'caption' ? cardSection(input, handlers, content) : []),
      ],
    }
  }

  const leaf = findLeaf(input.slide.root, input.nodeId)
  if (!leaf) return null
  const content = leaf.content
  if (!content) return { title: 'Tom sone', entries: fillEntries(input, handlers) }
  if (content.kind === 'negative-space') {
    return { title: contentLabel(content), entries: [contentKindSubmenu(input, handlers, 'Erstatt med')] }
  }

  const panel = imagePanelOf(content)
  if (panel && target.kind === 'caption') {
    return { title: 'Bildetekst', entries: captionSection(input, content, panel) }
  }
  if (panel && target.kind === 'image') {
    return {
      title: panel.assetId ? 'Bilde' : 'Tomt bilde',
      entries: [...imageSection(input, handlers, content, panel), SEPARATOR, ...cardSection(input, handlers, content)],
    }
  }
  return { title: contentLabel(content), entries: cardSection(input, handlers, content) }
}
