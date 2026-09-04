/**
 * The library's actions, bound to the browser's repository.
 *
 * Everything that *decides* lives one layer down — `persistence/library.ts` for
 * a duplication, `domain/commands` for a rename or a move — so this file is the
 * binding and nothing else. An agent reaches the same functions with its own
 * repository; if a rule lived here, that would be a rule the agent does not have.
 */

import { setFolder, setPresentationTitle } from '../domain/commands'
import { duplicatePresentation as duplicateIn } from '../persistence/library'
import { repository } from '../persistence/activeRepository'
import type { Presentation } from '../domain/types'

/** Deep-copy a presentation, including its files. */
export async function duplicatePresentation(sourceId: string): Promise<Presentation> {
  return duplicateIn(repository, await repository.loadPresentation(sourceId))
}

export async function renamePresentation(id: string, title: string): Promise<void> {
  const presentation = await repository.loadPresentation(id)
  const renamed = setPresentationTitle(presentation, title)
  // An empty name is not a rename. The command already says so, and refusing it
  // here as "nothing to do" is what the dialog wants: the field keeps the old
  // name rather than the deck losing it.
  if (!renamed.ok) return
  await repository.savePresentation(renamed.value)
}

export async function movePresentationToFolder(id: string, folderId: string | null): Promise<void> {
  const presentation = await repository.loadPresentation(id)
  const moved = setFolder(presentation, folderId)
  if (!moved.ok) return
  await repository.savePresentation(moved.value)
}

/** Trigger a browser download for a generated file. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Give the browser a moment to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
