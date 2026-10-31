/**
 * Everything the desktop toolbar has that a compact top bar has no room for.
 *
 * Grouped as the desktop toolbar is grouped, in the same order and under the
 * same names: the selected zone (its content kind and a picture file), the
 * slide (its title zone), the presentation (the «Presentasjon» menu, and
 * sharing) and the helpers (the «Verktøy» menu). Undo, redo and «Vis» are in
 * the top bar, as they are always in reach on the desktop.
 *
 * Rows rather than a row of icons: at this width a label is cheaper than a
 * tooltip nobody can hover, the list scrolls where a row would have to hide
 * things, and a reason an entry is unavailable is written under it.
 */

import { useSharingStore, useShareUrl } from '../../../state/sharing'
import type { MenuAction } from '../../components/contextMenu'
import { Icon } from '../../components/Icon'
import { ContentKindMenuButton } from '../ContentKindMenuButton'
import { ShareToggle } from '../ShareToggle'
import { helperToolEntries, presentationToolEntries } from '../toolbarMenus'
import type { TopToolbarProps } from '../TopToolbar'

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

  /* The desktop toolbar's two buttons beside the mode and the content kind,
     with the names they have there (their accessible names). */
  const pictureFile: MenuAction = {
    kind: 'action',
    id: 'image',
    label: 'Sett inn bilde fra fil …',
    icon: 'image-add',
    tone: 'media',
    disabled: !toolbar.canEditZones,
    reason: toolbar.canEditZones ? null : 'Denne siden har ingen soner å sette et bilde i.',
    onSelect: toolbar.onOpenImage,
  }
  const titleZone: MenuAction = {
    kind: 'action',
    id: 'title',
    label: 'Overskrift',
    icon: 'heading',
    tone: 'content',
    // A disabled toggle never reads as «on», as on the desktop.
    checked: toolbar.hasTitleZone && toolbar.canToggleTitle,
    disabled: !toolbar.canToggleTitle,
    reason: toolbar.canToggleTitle ? null : 'Denne siden har ingen overskriftssone å slå av eller på.',
    onSelect: toolbar.onToggleTitle,
  }

  return (
    <div className="compact-tools" data-testid="compact-tools">
      <section className="compact-tools__section" aria-labelledby="compact-tools-zone">
        <h3 className="inspector__heading" id="compact-tools-zone">
          Valgt sone
        </h3>
        <ContentKindMenuButton
          testId="compact-tool-content-kind"
          className="compact-tools__kind"
          labelClassName="compact-tools__kind-label"
          contentKinds={toolbar.contentKinds}
          selectedKind={toolbar.selectedKind}
          selectionIsLeaf={toolbar.selectionIsLeaf}
          onSetContentKind={toolbar.onSetContentKind}
        />
        <ActionRows entries={[pictureFile]} />
      </section>

      <section className="compact-tools__section" aria-labelledby="compact-tools-slide">
        <h3 className="inspector__heading" id="compact-tools-slide">
          Slide
        </h3>
        <ActionRows entries={[titleZone]} />
      </section>

      <section className="compact-tools__section" aria-labelledby="compact-tools-presentation">
        <h3 className="inspector__heading" id="compact-tools-presentation">
          Presentasjon
        </h3>
        <ActionRows entries={presentationToolEntries(toolbar)} />
        <ShareToggle
          status={shareStatus}
          shared={shared}
          busy={shareBusy}
          error={shareError}
          link={shareLink}
          onToggle={toolbar.onToggleShare}
        />
      </section>

      <section className="compact-tools__section" aria-labelledby="compact-tools-helpers">
        <h3 className="inspector__heading" id="compact-tools-helpers">
          Verktøy
        </h3>
        {/* Ideas and the sandbox only open here — the sheet they open in has
            its own close. */}
        <ActionRows
          entries={helperToolEntries({
            sandboxCount: toolbar.sandboxCount,
            onIdeas: onOpenIdeas,
            onSandbox: onOpenSandbox,
            onShowShortcuts,
          })}
        />
      </section>
    </div>
  )
}

/**
 * Menu entries as a list of rows: the same entries the desktop's menus draw,
 * with the same name, icon, ink, check and reason, laid out for a finger.
 */
function ActionRows({ entries }: { entries: MenuAction[] }) {
  return (
    <ul className="compact-tools__list">
      {entries.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            className="compact-tools__item"
            data-testid={`compact-tool-${entry.id}`}
            disabled={entry.disabled}
            {...(entry.checked === undefined ? {} : { 'aria-pressed': entry.checked })}
            onClick={entry.onSelect}
          >
            <Icon name={entry.icon ?? 'more'} size={17} tone={entry.tone} />
            {entry.label}
            {entry.checked && <Icon name="check" size={16} className="compact-tools__check" />}
          </button>
          {entry.disabled && entry.reason && (
            <p className="hint compact-tools__reason" data-testid={`compact-tool-reason-${entry.id}`}>
              {entry.reason}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
