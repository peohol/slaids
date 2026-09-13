/**
 * Everything the desktop toolbar has that a compact top bar has no room for.
 *
 * A list of ordinary buttons rather than a row of icons: at this width a label
 * is cheaper than a tooltip nobody can hover, and the list scrolls where a row
 * would have to hide things.
 */

import { useSharingStore, useShareUrl } from '../../../state/sharing'
import { Icon, type IconName } from '../../components/Icon'
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
        {/* The same options the desktop toolbar draws, from the same domain
            rule: a compact workspace is a different surface, never a different
            answer to «can this content live in this zone». */}
        <div className="inspector__actions">
          {toolbar.contentKinds.map((option) => (
            <button
              key={option.kind}
              type="button"
              className="btn btn--sm touch-target"
              disabled={!toolbar.selectionIsLeaf || option.disabled}
              title={option.reason ?? undefined}
              data-testid={`content-kind-${option.kind}`}
              onClick={() => toolbar.onSetContentKind(option.kind)}
            >
              <Icon name={option.icon} size={15} /> {option.label}
            </button>
          ))}
        </div>
        {toolbar.contentKinds.some((option) => option.disabled) && (
          /* A tooltip is a pointer affordance, and this surface has none — so
             the reason is written out instead of hovered for. */
          <p className="hint" data-testid="content-kind-hint">
            {toolbar.contentKinds.find((option) => option.disabled)?.reason}
          </p>
        )}
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
