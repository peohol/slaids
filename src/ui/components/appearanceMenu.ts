/**
 * «Utseende»: the choice between a dark interface, a light one and the
 * operating system's, said once for every surface that offers it — the
 * editor's «Verktøy» menu, the compact tools panel and the library.
 *
 * Named «Utseende» rather than «Tema» on purpose: a presentation's theme is
 * its colours and type, and this changes nothing about a slide.
 */

import { APPEARANCES, type Appearance } from '../../state/appearance'
import type { MenuAction, MenuSubmenu } from './contextMenu'
import type { IconName } from './Icon'

export const APPEARANCE_TITLE = 'Utseende'

const CHOICES: Record<Appearance, { label: string; icon: IconName }> = {
  dark: { label: 'Mørk', icon: 'moon' },
  light: { label: 'Lys', icon: 'sun' },
  system: { label: 'Følg systemet', icon: 'appearance' },
}

/** One entry per appearance, the one in force checked. */
export function appearanceEntries(
  current: Appearance,
  choose: (appearance: Appearance) => void,
): MenuAction[] {
  return APPEARANCES.map((appearance) => ({
    kind: 'action',
    id: `appearance-${appearance}`,
    label: CHOICES[appearance].label,
    icon: CHOICES[appearance].icon,
    checked: appearance === current,
    onSelect: () => choose(appearance),
  }))
}

/** The same entries as a submenu, for a menu that has other things in it. */
export function appearanceSubmenu(
  current: Appearance,
  choose: (appearance: Appearance) => void,
): MenuSubmenu {
  return {
    kind: 'submenu',
    id: 'appearance',
    label: APPEARANCE_TITLE,
    icon: 'appearance',
    entries: appearanceEntries(current, choose),
  }
}
