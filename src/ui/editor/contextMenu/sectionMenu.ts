/**
 * The menu for a section page.
 *
 * A section is two lines of text and the two colours it decides for the part
 * of the deck it opens, so that is what its menu offers: the line under the
 * pointer, with whatever its editor can do, and the accent and the background
 * — the same two the inspector offers, committed by the same commands.
 */

import { setSectionAccentColor, setSectionBackgroundColor } from '../../../domain/commands'
import type { Result } from '../../../domain/result'
import type { Presentation, SectionSlide } from '../../../domain/types'
import { SEPARATOR } from '../../components/contextMenu'
import type { FieldTarget } from './contentTarget'
import { FIELD_TITLES } from '../textActions'
import { colorSubmenu, textEntries, type TextMenuHandlers } from './textMenu'
import type { ZoneMenu } from './zoneMenu'

export interface SectionMenuInput {
  section: SectionSlide
  /** Whether this section is the deck's front page, which is what it is called then. */
  isFront: boolean
  /** Commit one change to the document as one step of undo. */
  commit: (label: string, change: (presentation: Presentation) => Result<Presentation>) => void
}

/**
 * The menu for a section, about the line `at` when the pointer is on one.
 *
 * A section's colours inherit from nothing — they are what everything after
 * them inherits — so neither offers a «Standard».
 */
export function sectionMenu(input: SectionMenuInput, handlers: TextMenuHandlers, at: FieldTarget | null): ZoneMenu {
  const { section, commit } = input
  const color = (
    id: string,
    label: string,
    value: string,
    set: (presentation: Presentation, slideId: string, color: string) => Result<Presentation>,
  ) =>
    colorSubmenu(id, label, value, null, (picked) => {
      if (picked) commit(id, (presentation) => set(presentation, section.id, picked))
    })
  return {
    title: at ? FIELD_TITLES[at.field.kind] : input.isFront ? 'Forside' : 'Inndeling',
    entries: [
      ...(at ? [...textEntries(at, handlers), SEPARATOR] : []),
      color('section-accent', 'Aksentfarge', section.accentColor, setSectionAccentColor),
      color('section-background', 'Bakgrunnsfarge', section.backgroundColor, setSectionBackgroundColor),
    ],
  }
}
