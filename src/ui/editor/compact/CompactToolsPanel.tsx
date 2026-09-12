/**
 * Everything the desktop toolbar has that a compact top bar has no room for.
 *
 * A list of ordinary buttons rather than a row of icons: at this width a label
 * is cheaper than a tooltip nobody can hover, and the list scrolls where a row
 * would have to hide things.
 */

import { CONTENT_KIND_LABELS } from '../../../domain/content'
import { useSharingStore, useShareUrl } from '../../../state/sharing'
import type { ZoneContentKind } from '../../../domain/types'
import { Icon, type IconName } from '../../components/Icon'
import { CONTENT_KINDS, CONTENT_KIND_ICONS } from '../contentKinds'
import { ShareToggle } from '../ShareToggle'
import type { TopToolbarProps } from '../TopToolbar'

interface ToolRow {
  id: string
  label: string
  icon: IconName
  disabled?: boolean
  onSelect: () => void
}

export function CompactToolsPanel({
  toolbar,
  onOpenIdeas,
  onOpenSandbox,
  onShowShortcuts,
}: {
  toolbar: TopToolbarProps
  onOpenIdeas: () => void
  onOpenSandbox: () => void
  onShowShortcuts: () => void
}) {
  const shareStatus = useSharingStore((state) => state.status)
  const shared = useSharingStore((state) => state.shared)
  const shareBusy = useSharingStore((state) => state.busy)
  const shareError = useSharingStore((state) => state.error)
  const shareLink = useShareUrl()

  const rows: ToolRow[] = [
    {
      id: 'title',
      label: toolbar.hasTitleZone ? 'Fjern overskriftssonen' : 'Legg til overskriftssone',
      icon: 'heading',
      disabled: !toolbar.canToggleTitle,
      onSelect: toolbar.onToggleTitle,
    },
    {
      id: 'image',
      label: 'Sett inn bilde',
      icon: 'image',
      disabled: !toolbar.canEditZones,
      onSelect: toolbar.onOpenImage,
    },
    { id: 'templates', label: 'Maler', icon: 'template', disabled: !toolbar.canEditZones, onSelect: toolbar.onOpenTemplates },
    { id: 'references', label: 'Referanser', icon: 'reference', onSelect: toolbar.onOpenReferences },
    { id: 'theme', label: 'Tema', icon: 'palette', onSelect: toolbar.onOpenTheme },
    { id: 'optimize', label: 'Optimaliser bilder', icon: 'optimize', onSelect: toolbar.onOptimizeImages },
    { id: 'ideas', label: 'Idéer', icon: 'ideas', onSelect: onOpenIdeas },
    {
      id: 'sandbox',
      label: toolbar.sandboxCount > 0 ? `Sandkassen (${toolbar.sandboxCount})` : 'Sandkassen',
      icon: 'sandbox',
      onSelect: onOpenSandbox,
    },
    { id: 'rename', label: 'Gi presentasjonen nytt navn', icon: 'edit', onSelect: toolbar.onRename },
    { id: 'shortcuts', label: 'Hurtigtaster', icon: 'code', onSelect: onShowShortcuts },
  ]

  return (
    <div className="compact-tools" data-testid="compact-tools">
      <section className="compact-tools__section">
        <h3 className="inspector__heading">Innholdstype for valgt sone</h3>
        <div className="inspector__actions">
          {CONTENT_KINDS.map((kind: ZoneContentKind) => (
            <button
              key={kind}
              type="button"
              className="btn btn--sm touch-target"
              disabled={!toolbar.selectionIsLeaf}
              data-testid={`content-kind-${kind}`}
              onClick={() => toolbar.onSetContentKind(kind)}
            >
              <Icon name={CONTENT_KIND_ICONS[kind]} size={15} /> {CONTENT_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      </section>

      <section className="compact-tools__section">
        <h3 className="inspector__heading">Deling</h3>
        <ShareToggle
          status={shareStatus}
          shared={shared}
          busy={shareBusy}
          error={shareError}
          link={shareLink}
          onToggle={toolbar.onToggleShare}
        />
      </section>

      <section className="compact-tools__section">
        <h3 className="inspector__heading">Verktøy</h3>
        <ul className="compact-tools__list">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="compact-tools__item"
                data-testid={`compact-tool-${row.id}`}
                disabled={row.disabled}
                onClick={row.onSelect}
              >
                <Icon name={row.icon} size={17} />
                {row.label}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
