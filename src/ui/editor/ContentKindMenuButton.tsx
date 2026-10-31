/**
 * «Innholdstype» for the selected zone, as one menu button.
 *
 * The desktop toolbar and the compact tools panel both offer it, so it is said
 * once: the kind in force is the button's text and the checked entry of the
 * menu, and every kind the zone cannot take is in the menu with the domain's
 * reason written under it — readable without hovering, which is what a finger
 * needs as much as a mouse does. The menu is the app's one context menu.
 */

import type { ZoneContentKind } from '../../domain/types'
import { MenuButton } from '../components/MenuButton'
import { contentKindEntries, type ContentKindOption } from './contentKinds'

export function ContentKindMenuButton({
  contentKinds,
  selectedKind,
  selectionIsLeaf,
  onSetContentKind,
  className,
  labelClassName,
  testId,
}: {
  contentKinds: ContentKindOption[]
  selectedKind: ZoneContentKind | null
  /** Only one zone at a time has a content kind to choose. */
  selectionIsLeaf: boolean
  onSetContentKind: (kind: ZoneContentKind) => void
  className: string
  labelClassName: string
  testId: string
}) {
  const current = selectionIsLeaf
    ? (contentKinds.find((option) => option.kind === selectedKind) ?? null)
    : null
  const kindLabel = current?.label ?? (selectionIsLeaf ? 'Velg innholdstype' : 'Innholdstype')

  return (
    <MenuButton
      id={`content-kind-${testId}`}
      testId={testId}
      label={`Innholdstype: ${kindLabel}`}
      title="Innholdstype for valgt sone"
      tooltip={selectionIsLeaf ? 'Endre innholdstype' : 'Velg én sone for å velge innholdstype'}
      icon={current?.icon ?? 'card'}
      tone={current?.tone}
      disabled={!selectionIsLeaf}
      className={className}
      entries={() => contentKindEntries(contentKinds, selectedKind, onSetContentKind)}
    >
      <span className={labelClassName} data-kind={current?.kind ?? ''}>
        {kindLabel}
      </span>
    </MenuButton>
  )
}
