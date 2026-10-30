/**
 * The presentation's tools and the helper tools, said once.
 *
 * The desktop toolbar offers them as two named menus and the compact tools
 * panel as a list; both read these entries, so a tool added, renamed or
 * re-iconed shows up in both, with the same name, icon and ink, and neither can
 * offer one the other has lost. Each entry's `testId` is the one the tool's
 * button had before it moved into a menu.
 */

import type { MenuAction } from '../components/contextMenu'

export interface PresentationToolHandlers {
  /** False on a derived page or the cover: there is no zone tree for a template. */
  canEditZones: boolean
  onRename: () => void
  onOpenTheme: () => void
  onOpenTemplates: () => void
  onOpenReferences: () => void
  onOpenImageBrief: () => void
  onOptimizeImages: () => void
}

/** What belongs to the presentation as a whole. */
export function presentationToolEntries(handlers: PresentationToolHandlers): MenuAction[] {
  return [
    { kind: 'action', id: 'rename', label: 'Gi presentasjonen nytt navn …', icon: 'edit', testId: 'menu-rename', onSelect: handlers.onRename },
    { kind: 'action', id: 'theme', label: 'Tema …', icon: 'palette', testId: 'open-theme', onSelect: handlers.onOpenTheme },
    {
      kind: 'action',
      id: 'templates',
      label: 'Maler …',
      icon: 'template',
      testId: 'open-templates',
      disabled: !handlers.canEditZones,
      reason: handlers.canEditZones ? null : 'Denne siden har ingen soner å bruke en mal på.',
      onSelect: handlers.onOpenTemplates,
    },
    {
      kind: 'action',
      id: 'references',
      label: 'Referanser …',
      icon: 'reference',
      testId: 'open-references',
      onSelect: handlers.onOpenReferences,
    },
    {
      kind: 'action',
      id: 'image-brief',
      label: 'Bildebrief …',
      icon: 'note',
      tone: 'media',
      testId: 'open-image-brief',
      onSelect: handlers.onOpenImageBrief,
    },
    {
      kind: 'action',
      id: 'optimize',
      label: 'Optimaliser bilder …',
      icon: 'optimize',
      tone: 'media',
      testId: 'optimize-images',
      onSelect: handlers.onOptimizeImages,
    },
  ]
}

export interface HelperToolHandlers {
  sandboxCount: number
  /** Whether each window is open, where the entry toggles it. Left out, it only opens. */
  ideasOpen?: boolean
  sandboxOpen?: boolean
  onIdeas: () => void
  onSandbox: () => void
  onShowShortcuts: () => void
}

/** Aids to working, rather than parts of the presentation. */
export function helperToolEntries(handlers: HelperToolHandlers): MenuAction[] {
  return [
    {
      kind: 'action',
      id: 'ideas',
      label: 'Idéer',
      icon: 'ideas',
      testId: 'open-ideas',
      ...(handlers.ideasOpen === undefined ? {} : { checked: handlers.ideasOpen }),
      onSelect: handlers.onIdeas,
    },
    {
      kind: 'action',
      id: 'sandbox',
      label: handlers.sandboxCount > 0 ? `Sandkassen (${handlers.sandboxCount})` : 'Sandkassen',
      icon: 'sandbox',
      testId: 'open-sandbox',
      ...(handlers.sandboxOpen === undefined ? {} : { checked: handlers.sandboxOpen }),
      onSelect: handlers.onSandbox,
    },
    {
      kind: 'action',
      id: 'shortcuts',
      label: 'Hurtigtaster',
      icon: 'code',
      testId: 'menu-shortcuts',
      onSelect: handlers.onShowShortcuts,
    },
  ]
}
