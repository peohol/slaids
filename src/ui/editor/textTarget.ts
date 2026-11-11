/**
 * Every piece of text on a slide, named so it can be found from anywhere.
 *
 * Text is always edited where it is drawn — on a compact workspace by focusing
 * the field so it fills the stage, on a desktop simply by clicking into it. But
 * a phone also needs a way to *find* a field: a list of what is written on this
 * page, because a slide scaled to a quarter of its size puts twelve-point type
 * at three and hunting for a caret in that is not something a finger can do.
 *
 * That is all this module is: a name for every field on a page, in the order
 * the page reads, and the node id each one is focused by. Nothing here reads or
 * writes a document — the fields on the stage do that through the commands that
 * own them, and a second path to the same text would be a second set of rules
 * about it.
 */

import { bodyOf, hasCardTitle, imagePanelOf } from '../../domain/content'
import {
  SECTION_SUBTITLE_NODE_ID,
  SECTION_TITLE_NODE_ID,
  TITLE_NODE_ID,
} from '../../domain/geometry'
import { collectLeaves, breadcrumbLabels } from '../../domain/layout'
import { docToPlainText } from '../../domain/richdoc'
import type { ActiveField } from '../../state/store'
import type { Slide } from '../../domain/types'

/** One editable piece of text, addressed by where it lives in the document. */
export type TextTarget =
  | { kind: 'slide-title'; slideId: string }
  | { kind: 'card-title'; slideId: string; nodeId: string }
  | { kind: 'body'; slideId: string; nodeId: string; subfieldId: string }
  | { kind: 'caption'; slideId: string; nodeId: string }
  | { kind: 'section-title'; slideId: string }
  | { kind: 'section-subtitle'; slideId: string }

/** A target as a string, for React keys and for comparing two of them. */
export function textTargetKey(target: TextTarget): string {
  switch (target.kind) {
    case 'body':
      return `body:${target.slideId}:${target.nodeId}:${target.subfieldId}`
    case 'card-title':
    case 'caption':
      return `${target.kind}:${target.slideId}:${target.nodeId}`
    default:
      return `${target.kind}:${target.slideId}`
  }
}

/** One entry in the slide's list of text: the field, and what to call it. */
export interface TextTargetEntry {
  target: TextTarget
  /** Where it is, in the author's words — «Rot › Venstre › Tittel». */
  label: string
  /** The first line of what is in it, for the list. Empty when nothing is. */
  preview: string
}

/**
 * Every text field on a slide, in the order the slide reads.
 *
 * The layout tree is walked rather than a list being kept: a zone split in two
 * yesterday has two fields today without anything here being changed.
 */
export function textTargetsForSlide(slide: Slide): TextTargetEntry[] {
  if (slide.kind === 'interactive') return []
  if (slide.kind === 'section') {
    return [
      {
        target: { kind: 'section-title', slideId: slide.id },
        label: 'Overskrift',
        preview: docToPlainText(slide.title),
      },
      {
        target: { kind: 'section-subtitle', slideId: slide.id },
        label: 'Underoverskrift',
        preview: docToPlainText(slide.subtitle),
      },
    ]
  }

  const entries: TextTargetEntry[] = []
  if (slide.title) {
    entries.push({
      target: { kind: 'slide-title', slideId: slide.id },
      label: 'Slidetittel',
      preview: docToPlainText(slide.title),
    })
  }
  for (const leaf of collectLeaves(slide.root)) {
    if (!leaf.content) continue
    // The whole path, the same one the inspector prints: «1» on its own says
    // nothing about which «1», and a list of fields is exactly where that has
    // to be unambiguous.
    const where = breadcrumbLabels(slide.root, leaf.id).join(' › ')
    const content = leaf.content
    if (hasCardTitle(content)) {
      entries.push({
        target: { kind: 'card-title', slideId: slide.id, nodeId: leaf.id },
        label: `${where} · tittel`,
        preview: docToPlainText(content.title),
      })
    }
    const body = bodyOf(content)
    if (body) {
      body.subfields.forEach((subfield, index) => {
        entries.push({
          target: { kind: 'body', slideId: slide.id, nodeId: leaf.id, subfieldId: subfield.id },
          label: body.subfields.length > 1 ? `${where} · felt ${index + 1}` : where,
          preview: docToPlainText(subfield.doc),
        })
      })
    }
    const caption = imagePanelOf(content)?.caption
    if (caption) {
      entries.push({
        target: { kind: 'caption', slideId: slide.id, nodeId: leaf.id },
        label: `${where} · bildetekst`,
        preview: docToPlainText(caption.doc),
      })
    }
  }
  return entries
}

/**
 * The first thing to write in inside this part of the page, or `null` when
 * there is nothing.
 *
 * Two questions with one answer, and they have to agree: whether a focused
 * field is a writing surface at all — a picture with no caption is not — and,
 * when it is, which of its editors takes the caret. Read off the same walk the
 * list is, so «the bar is offered» and «there is somewhere to type» can never
 * come apart.
 */
export function firstFieldIn(slide: Slide, fieldId: string): ActiveField | null {
  for (const entry of textTargetsForSlide(slide)) {
    const field = activeFieldFor(entry.target)
    if (field.nodeId === fieldId) return field
  }
  return null
}

/**
 * This field as the editor addresses it everywhere else.
 *
 * One shape for two jobs, deliberately. Its `nodeId` is what the stage focuses
 * itself on — so choosing a field in the list and long-pressing the same field
 * on the page arrive at the very same view — and the whole of it is what the
 * store's `activeField` carries, which is how the *one* editor inside that view
 * gets the caret. Without the second half a zone with a card title and two body
 * fields would answer three list entries with one indistinguishable state.
 *
 * The three fields that are not zones have the ids the geometry engine already
 * gives them.
 */
export function activeFieldFor(target: TextTarget): ActiveField {
  switch (target.kind) {
    case 'slide-title':
      return { nodeId: TITLE_NODE_ID, subfieldId: null, kind: target.kind }
    case 'section-title':
      return { nodeId: SECTION_TITLE_NODE_ID, subfieldId: null, kind: target.kind }
    case 'section-subtitle':
      return { nodeId: SECTION_SUBTITLE_NODE_ID, subfieldId: null, kind: target.kind }
    case 'body':
      return { nodeId: target.nodeId, subfieldId: target.subfieldId, kind: target.kind }
    default:
      return { nodeId: target.nodeId, subfieldId: null, kind: target.kind }
  }
}

/** Whether two field addresses point at the same editor. */
export function sameField(a: ActiveField | null, b: ActiveField | null): boolean {
  if (!a || !b) return false
  return a.nodeId === b.nodeId && a.subfieldId === b.subfieldId && a.kind === b.kind
}

/** Feltene som ligger i en sone: korttittel, brødtekst og bildetekst. */
export function isZoneTextField(field: ActiveField): boolean {
  return field.kind === 'body' || field.kind === 'card-title' || field.kind === 'caption'
}

/**
 * Et felt som skal ta markøren, og eventuelt hvor i teksten.
 *
 * `at` er en posisjon i feltets dokument. Den brukes når teksten har flyttet
 * til et nytt felt med samme innhold – som når sonen det skrives i deles – slik
 * at markøren havner der den var. Uten `at` havner den sist i teksten.
 */
export interface CaretRequest extends ActiveField {
  at?: number
}

/** Hvor `field` skal sette markøren: en posisjon, `true` for sist i teksten, eller `false`. */
export function caretFor(caret: CaretRequest | null, field: ActiveField): number | boolean {
  return sameField(caret, field) ? (caret?.at ?? true) : false
}
