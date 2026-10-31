/**
 * The «Flere handlinger» menus of the library: one for a presentation card,
 * one for a folder.
 *
 * A card's one direct action is to open the presentation, and a folder's is to
 * show what is in it; everything else either is in these lists, under the same
 * names and icons wherever the same thing is done in the app, or is a visible
 * control of its own (the folder a deck is in, whether a folder is shared).
 * What removes something comes last and asks first — the question is the
 * library's own dialog, which says what goes and what can be had back.
 */

import type { MenuEntry } from '../components/contextMenu'

export interface PresentationMenuHandlers {
  rename: () => void
  duplicate: () => void
  copyId: () => void
  exportBackup: () => void
  /** Ask to move it to the trash; the question is the caller's. */
  trash: () => void
}

export function presentationEntries(handlers: PresentationMenuHandlers): MenuEntry[] {
  return [
    {
      kind: 'action',
      id: 'presentation-rename',
      label: 'Gi nytt navn …',
      icon: 'edit',
      testId: 'rename-presentation',
      onSelect: handlers.rename,
    },
    {
      kind: 'action',
      id: 'presentation-duplicate',
      label: 'Dupliser',
      icon: 'duplicate',
      testId: 'duplicate-presentation',
      onSelect: handlers.duplicate,
    },
    {
      kind: 'action',
      id: 'presentation-copy-id',
      label: 'Kopier presentasjons-ID',
      icon: 'copy',
      testId: 'copy-presentation-id',
      onSelect: handlers.copyId,
    },
    {
      kind: 'action',
      id: 'presentation-export',
      label: 'Last ned sikkerhetskopi',
      icon: 'download',
      testId: 'export-presentation',
      onSelect: handlers.exportBackup,
    },
    {
      kind: 'action',
      id: 'presentation-trash',
      label: 'Flytt til søppelkassen …',
      icon: 'trash',
      danger: true,
      testId: 'delete-presentation',
      onSelect: handlers.trash,
    },
  ]
}

export interface FolderMenuHandlers {
  rename: () => void
  /** Ask to delete the folder; the question is the caller's. */
  remove: () => void
}

export function folderEntries(handlers: FolderMenuHandlers): MenuEntry[] {
  return [
    {
      kind: 'action',
      id: 'folder-rename',
      label: 'Gi nytt navn …',
      icon: 'edit',
      testId: 'rename-folder',
      onSelect: handlers.rename,
    },
    {
      kind: 'action',
      id: 'folder-delete',
      label: 'Slett mappen …',
      icon: 'trash',
      danger: true,
      testId: 'delete-folder',
      onSelect: handlers.remove,
    },
  ]
}
