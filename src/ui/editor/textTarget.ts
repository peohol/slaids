/**
 * Every piece of text on a slide, named so it can be edited from anywhere.
 *
 * The stage edits text where it is drawn, which is right on a desktop and
 * unusable on a phone: a slide scaled to a quarter of its size puts twelve-point
 * type at three. A compact workspace therefore lists the slide's text and opens
 * one field at a time on a surface you can actually read — and to do that it
 * needs to be able to *address* a field, read it, and write it back.
 *
 * That is all this module is: a name for each field, and a dispatch to the
 * domain command that already owns it. No rule about what may be typed lives
 * here — `setSlideTitle`, `setCardTitle`, `setSubfieldDoc`, `setImageCaption`,
 * `setSectionTitle` and `setSectionSubtitle` keep theirs, and the fit
 * measurement below asks the same geometry and the same checkers the commands
 * ask.
 */

import {
  fitContextFor,
  setCardTitle,
  setImageCaption,
  setSectionSubtitle,
  setSectionTitle,
  setSlideTitle,
  setSubfieldDoc,
} from '../../domain/commands'
import { bodyOf, hasCardTitle, imagePanelOf } from '../../domain/content'
import {
  SECTION_SUBTITLE_NODE_ID,
  SECTION_TITLE_NODE_ID,
  TITLE_NODE_ID,
  computeSectionGeometry,
  computeSlideGeometry,
} from '../../domain/geometry'
import { collectLeaves, breadcrumbLabels } from '../../domain/layout'
import { geometryForTheme, sectionGeometryForTheme } from '../../domain/metrics'
import { docToPlainText } from '../../domain/richdoc'
import { findSlide } from '../../domain/presentation'
import { measureContentFit, measureTitleFit } from '../../state/measure'
import type { Presentation, RichDoc, Slide } from '../../domain/types'
import type { Result } from '../../domain/result'
import type { EditorVariant } from './RichTextEditor'

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

/**
 * Which editor a field is: the same four variants the stage uses, so the text
 * is typed under exactly the schema it is stored under.
 */
export function variantFor(target: TextTarget): EditorVariant {
  switch (target.kind) {
    case 'body':
      return 'body'
    case 'caption':
      return 'caption'
    default:
      return 'title'
  }
}

export function placeholderFor(target: TextTarget): string {
  switch (target.kind) {
    case 'slide-title':
      return 'Slidetittel'
    case 'card-title':
      return 'Korttittel'
    case 'caption':
      return 'Bildetekst'
    case 'section-title':
      return 'Overskrift'
    case 'section-subtitle':
      return 'Underoverskrift (valgfri)'
    case 'body':
      return 'Skriv innhold …'
  }
}

/** The message shown when a field is asked to hold more than its box can show. */
export function overflowMessageFor(target: TextTarget): string {
  switch (target.kind) {
    case 'slide-title':
      return 'Overskriften får ikke plass i tittelsonen.'
    case 'card-title':
      return 'Tittelen får ikke plass i kortet.'
    case 'caption':
      return 'Bildeteksten får ikke plass i bildet.'
    case 'section-title':
      return 'Overskriften får ikke plass på seksjonssliden.'
    case 'section-subtitle':
      return 'Underoverskriften får ikke plass på seksjonssliden.'
    case 'body':
      return 'Innholdet får ikke plass i sonen.'
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

/** What the field holds now, or `null` when the target no longer addresses one. */
export function readTextTarget(presentation: Presentation, target: TextTarget): RichDoc | null {
  const slide = findSlide(presentation, target.slideId)
  if (!slide) return null
  if (slide.kind === 'section') {
    if (target.kind === 'section-title') return slide.title
    if (target.kind === 'section-subtitle') return slide.subtitle
    return null
  }
  if (slide.kind !== 'content') return null
  if (target.kind === 'slide-title') return slide.title
  if (target.kind === 'section-title' || target.kind === 'section-subtitle') return null
  const leaf = collectLeaves(slide.root).find((entry) => entry.id === target.nodeId)
  const content = leaf?.content
  if (!content) return null
  switch (target.kind) {
    case 'card-title':
      return hasCardTitle(content) ? content.title : null
    case 'caption':
      return imagePanelOf(content)?.caption?.doc ?? null
    case 'body':
      return bodyOf(content)?.subfields.find((field) => field.id === target.subfieldId)?.doc ?? null
  }
}

/**
 * Write the field, through the command that owns it.
 *
 * Deliberately a dispatch and nothing more. Each of these commands carries its
 * own rules — a card title only exists on a kind that has one, a caption
 * removes itself when it is emptied, a section line is measured against the
 * pill it is drawn in — and a second implementation here would be a second set
 * of rules that agreed with the first until it did not.
 */
export function writeTextTarget(
  presentation: Presentation,
  target: TextTarget,
  doc: RichDoc,
): Result<Presentation> {
  switch (target.kind) {
    case 'slide-title':
      return setSlideTitle(presentation, target.slideId, doc)
    case 'section-title':
      return setSectionTitle(presentation, target.slideId, doc)
    case 'section-subtitle':
      return setSectionSubtitle(presentation, target.slideId, doc)
    case 'card-title':
      return setCardTitle(presentation, {
        slideId: target.slideId,
        nodeId: target.nodeId,
        doc,
      })
    case 'caption':
      return setImageCaption(presentation, {
        slideId: target.slideId,
        nodeId: target.nodeId,
        doc,
      })
    case 'body':
      return setSubfieldDoc(presentation, {
        slideId: target.slideId,
        nodeId: target.nodeId,
        subfieldId: target.subfieldId,
        doc,
      })
  }
}

/** The undo label a run of typing in this field coalesces under. */
export function typingLabelFor(target: TextTarget): string {
  switch (target.kind) {
    case 'body':
      return `typing:${target.nodeId}:${target.subfieldId}`
    case 'card-title':
      return `typing:${target.nodeId}:title`
    case 'caption':
      return `typing:${target.nodeId}:caption`
    case 'slide-title':
      return `typing:${target.slideId}:slide-title`
    default:
      return `typing:${target.slideId}:${target.kind}`
  }
}

/**
 * How far this field's text reaches past the box it is drawn in — measured
 * against the real slide, never against the surface it is being typed on.
 *
 * This is the whole reason a comfortable mobile writing surface is allowed to
 * exist. The text is typed at a readable size in a panel the size of a phone;
 * whether it *fits* is asked of the zone it will be drawn in, at 1600 × 900,
 * with the deck's own typography and citation numbering, through the same
 * offscreen renderer every domain command uses. The panel is where the text is
 * entered; the slide is where it has to fit.
 *
 * A body field is measured as the whole zone it belongs to, because that is
 * what has to fit: two subfields share one box, and a line added to the first
 * is what pushes the second out of it.
 */
export function textTargetOverflow(presentation: Presentation, target: TextTarget): number {
  const slide = findSlide(presentation, target.slideId)
  if (!slide) return 0
  const context = fitContextFor(presentation)

  if (slide.kind === 'section') {
    if (target.kind !== 'section-title' && target.kind !== 'section-subtitle') return 0
    const resolved = sectionGeometryForTheme(presentation.theme)
    const geometry = computeSectionGeometry(resolved)
    const isTitle = target.kind === 'section-title'
    return measureTitleFit(
      isTitle ? slide.title : slide.subtitle,
      isTitle ? geometry.titleRect : geometry.subtitleRect,
      context,
      isTitle ? resolved.titleFontSize : resolved.subtitleFontSize,
    ).overflow
  }

  if (slide.kind !== 'content') return 0
  const geometry = computeSlideGeometry(slide, geometryForTheme(presentation.theme))

  if (target.kind === 'slide-title') {
    if (!slide.title || !geometry.titleRect) return 0
    return measureTitleFit(slide.title, geometry.titleRect, context).overflow
  }
  if (target.kind === 'section-title' || target.kind === 'section-subtitle') return 0

  const leaf = collectLeaves(slide.root).find((entry) => entry.id === target.nodeId)
  const rect = geometry.rects.get(target.nodeId)
  if (!leaf?.content || !rect) return 0
  return measureContentFit(leaf.content, rect, context).overflow
}

/** The node id the store's `activeField` uses for this target. */
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
