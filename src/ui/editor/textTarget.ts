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
 * The node id this field is addressed by on the stage.
 *
 * One id for two jobs, deliberately: it is what the store's `activeField`
 * carries, and it is what the stage focuses itself on — so choosing a field in
 * the list and long-pressing the same field on the page arrive at the very same
 * place. The three that are not zones have the ids the geometry engine already
 * gives them.
 */
export function activeFieldNodeId(target: TextTarget): string {
  switch (target.kind) {
    case 'slide-title':
      return TITLE_NODE_ID
    case 'section-title':
      return SECTION_TITLE_NODE_ID
    case 'section-subtitle':
      return SECTION_SUBTITLE_NODE_ID
    default:
      return target.nodeId
  }
}
