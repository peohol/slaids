/**
 * The compact workspace's one navigation control.
 *
 * Four places to be, and never two of them at once: the slides of the deck, the
 * text on this page, the zone that is selected, and the tools. Pressing the tab
 * that is already open closes it, which is how the stage gets the whole screen
 * back without a separate "hide panel" control to find.
 */

import { Icon, type IconName, type IconTone } from '../../components/Icon'
import type { CompactPanel } from '../shell/editorShell'

/* Text and zones carry the same inks as the desktop's two modes, because they
   *are* those two modes here (the shell sets the mode with the panel; see
   `modeForPanel`). The other two have the icons their desktop counterparts
   have: a page for the slides, and the «Verktøy» menu's own icon. */
const TABS: { id: CompactPanel; label: string; icon: IconName; tone?: IconTone }[] = [
  { id: 'slides', label: 'Slides', icon: 'slide' },
  { id: 'content', label: 'Tekst', icon: 'text', tone: 'content' },
  { id: 'zone', label: 'Soner', icon: 'zones', tone: 'zone' },
  { id: 'tools', label: 'Verktøy', icon: 'tools' },
]

export function CompactTabBar({
  panel,
  onSelect,
  sandboxCount,
}: {
  panel: CompactPanel | null
  onSelect: (panel: CompactPanel | null) => void
  sandboxCount: number
}) {
  return (
    <nav className="compact-bar compact-bar--tabs" data-testid="compact-tab-bar">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className="compact-tab"
          aria-pressed={panel === tab.id}
          data-tone={tab.tone}
          data-testid={`compact-tab-${tab.id}`}
          onClick={() => onSelect(panel === tab.id ? null : tab.id)}
        >
          <Icon name={tab.icon} size={19} tone={tab.tone} />
          <span>{tab.label}</span>
          {tab.id === 'tools' && sandboxCount > 0 && (
            <span className="compact-tab__badge">{sandboxCount}</span>
          )}
        </button>
      ))}
    </nav>
  )
}
