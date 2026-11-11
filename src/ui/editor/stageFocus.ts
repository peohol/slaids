/**
 * Whether the compact stage is showing the whole page, or one field of it.
 *
 * Two states, and the editor is always on exactly one of them:
 *
 *   1. the page      – the whole slide, and a press selects a zone
 *   2. a focused field – that field fills the stage, and if it holds text it
 *                        *is* the writing surface
 *
 * There is no step in between and no step after. A long press on the slide
 * goes straight from the first to the second, and the one × in the corner goes
 * straight back — a focused field that can be typed into is typed into, with
 * nothing to press first and nothing to press on the way out.
 *
 * A field here is not always a layout zone. The slide's title and a section's
 * two lines are drawn outside the layout tree but are text on the page all the
 * same, so they are addressed by the same synthetic node ids the geometry
 * engine already gives them and focused by the same model. That is what keeps
 * the compact workspace to *one* text model: every field on every page is
 * edited where it is drawn, and nothing is edited anywhere else.
 *
 * None of it is a fact about the presentation. A focus is a view transform and
 * a mode of the editor, and both die with the tab.
 */

import {
  SECTION_SUBTITLE_NODE_ID,
  SECTION_TITLE_NODE_ID,
  TITLE_NODE_ID,
  computeSectionGeometry,
  computeSlideGeometry,
} from '../../domain/geometry'
import { sectionGeometryForTheme } from '../../domain/metrics'
import { geometryForDeck, type LogoDeck } from '../../domain/logo'
import type { EditorMode } from '../../state/store'
import type { CaretRequest } from './textTarget'
import type { Rect, Slide } from '../../domain/types'

export interface StageFocus {
  /** The slide it was taken on: paging away is leaving the focused field. */
  slideId: string
  /** The field filling the stage: a layout zone, a slide title, a section line. */
  fieldId: string
  /**
   * The one editor inside it that takes the caret, or `null` when there is
   * nothing to type in.
   *
   * Both ways in set it, for the same reason and with different precision. The
   * text list names one field out of several in the same zone, so it says
   * exactly which. A long press can only name the zone, so it takes that zone's
   * first field — but it does have to name one: the press that ends the gesture
   * lands wherever the fingertip happens to be *after* the field has been
   * re-laid out several times larger, which is sometimes the text and sometimes
   * the air beside it. A way in that works from one spot of a zone and not from
   * another is not a way in. A tap inside the text moves the caret from there,
   * exactly as it does anywhere else.
   */
  caret: CaretRequest | null
}

/** What the editor is looking at right now, as the focus was asked about it. */
export interface FocusContext {
  slideId: string | null
  /** Where the focused field is drawn now, or `null` when the page has it no more. */
  rect: Rect | null
  /**
   * The editing mode. A focused field is a writing surface, which is content
   * mode; zone mode reached any other way — Ctrl+E while typing, the zone
   * panel — leaves the field rather than showing outlines around a zoomed one.
   */
  mode: EditorMode
}

/**
 * The focus that is still true of what is on screen, or `null`.
 *
 * Derived rather than reset: an undo that deletes the zone, a page turn and a
 * rotation that swaps the shell all pass through here, and every one of them
 * lands on the state that is actually true instead of on whatever was true when
 * the focus was taken.
 */
export function liveFocus(focus: StageFocus | null, context: FocusContext): StageFocus | null {
  if (!focus) return null
  if (focus.slideId !== context.slideId) return null
  if (!context.rect) return null
  if (context.mode !== 'content') return null
  return focus
}

/** The fields that are text on the page without being a zone of the layout. */
const FIELDS_OUTSIDE_THE_LAYOUT: ReadonlySet<string> = new Set([
  TITLE_NODE_ID,
  SECTION_TITLE_NODE_ID,
  SECTION_SUBTITLE_NODE_ID,
])

/**
 * Whether this field is a zone of the layout tree, and therefore something the
 * store's selection, the inspector and the zone commands can address.
 */
export function isZoneField(fieldId: string): boolean {
  return !FIELDS_OUTSIDE_THE_LAYOUT.has(fieldId)
}

/**
 * Where a focusable field sits on the page, or `null` when this page has no
 * such field.
 *
 * The one place that knows which parts of a page can fill the stage, and it
 * knows it by *asking the geometry engine* rather than by keeping a list: a
 * zone split this morning is focusable this afternoon, a title that was removed
 * stops being focusable in the same render, and nothing here can disagree with
 * where the page is actually drawn.
 */
export function focusFieldRect(slide: Slide | null, deck: LogoDeck, fieldId: string): Rect | null {
  if (!slide) return null
  if (slide.kind === 'section') {
    if (fieldId !== SECTION_TITLE_NODE_ID && fieldId !== SECTION_SUBTITLE_NODE_ID) return null
    const geometry = computeSectionGeometry(sectionGeometryForTheme(deck.theme))
    return fieldId === SECTION_TITLE_NODE_ID ? geometry.titleRect : geometry.subtitleRect
  }
  if (slide.kind !== 'content') return null
  // `computeSlideGeometry` puts the title in the same map as the zones, and
  // leaves it out when the slide has none — so one lookup answers for both.
  return computeSlideGeometry(slide, geometryForDeck(deck)).rects.get(fieldId) ?? null
}

/**
 * Which text on a stage may be typed into where it is drawn.
 *
 * `all` on a roomy workspace. `none` on a compact one showing the whole page,
 * where a line of body type is a few pixels tall and aiming at a word is not
 * something a finger can do. `{ only }` is the focused state: one field is
 * drawn large enough to write in, and it is the only writing surface on the
 * page.
 */
export type StageTextEditing = 'all' | 'none' | { only: string }

/** Whether this particular field is a writing surface right now. */
export function canTypeIn(editing: StageTextEditing, fieldId: string): boolean {
  if (editing === 'all') return true
  if (editing === 'none') return false
  return editing.only === fieldId
}
