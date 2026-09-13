/**
 * The compact workspace's one navigation control.
 *
 * Four places to be, and never two of them at once: the slides of the deck, the
 * text on this page, the zone that is selected, and the tools. Pressing the tab
 * that is already open closes it, which is how the stage gets the whole screen
 * back without a separate "hide panel" control to find.
 */

import { useEditorStore } from '../../../state/store'
import { Icon, type IconName } from '../../components/Icon'
import type { CompactPanel } from '../shell/editorShell'

const TABS: { id: CompactPanel; label: string; icon: IconName }[] = [
  { id: 'slides', label: 'Slides', icon: 'template' },
  { id: 'content', label: 'Tekst', icon: 'text' },
  { id: 'zone', label: 'Soner', icon: 'zones' },
  { id: 'tools', label: 'Verktøy', icon: 'menu' },
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
  const setMode = useEditorStore((state) => state.setMode)

  return (
    <nav className="compact-bar compact-bar--tabs" data-testid="compact-tab-bar">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={panel === tab.id ? 'compact-tab compact-tab--active' : 'compact-tab'}
          aria-pressed={panel === tab.id}
          data-testid={`compact-tab-${tab.id}`}
          onClick={() => {
            const next = panel === tab.id ? null : tab.id
            /*
             * The zone tab *is* the zone mode, and every other tab is content
             * mode. Stated here once rather than left to drift: outlines and
             * ratio handles on the slide while the text panel is open would
             * be chrome for a mode the workspace is not in, and a zone panel
             * over a slide with no outlines would be the same mistake the
             * other way round.
             */
            setMode(next === 'zone' ? 'zone' : 'content')
            onSelect(next)
          }}
        >
          <Icon name={tab.icon} size={19} />
          <span>{tab.label}</span>
          {tab.id === 'tools' && sandboxCount > 0 && (
            <span className="compact-tab__badge">{sandboxCount}</span>
          )}
        </button>
      ))}
    </nav>
  )
}
