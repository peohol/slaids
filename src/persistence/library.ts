/**
 * Library-level operations that span the repository and the domain.
 *
 * Headless, and parameterised by the repository rather than reaching for the
 * active one, for the same reason the domain and the geometry engine are: these
 * are the library's rules, and the library has two callers now. The editor
 * passes the browser's repository (`state/libraryActions.ts`), and an agent
 * passes the one its token was pinned to (`agent/operations/library.ts`). One
 * implementation, so "duplicating a deck from an agent is the same act as
 * duplicating it in the library" is a property of the code rather than of two
 * functions written to match.
 *
 * What is *not* here is anything the repository already does. Deleting a
 * presentation is one call, because both stores already take the document, its
 * asset rows, its stored bytes and its share columns down together — see
 * `SlaidsRepository.deletePresentation`. A second, hand-rolled deletion sequence
 * next to it would be a second chance to leave half a presentation behind.
 */

import { duplicatePresentationDocument } from '../domain/presentation'
import type { Presentation } from '../domain/types'
import type { SlaidsRepository } from './repository'

/**
 * Deep-copy a presentation, including its files.
 *
 * Files are copied rather than shared: an asset belongs to a presentation and is
 * deleted with it, so a copy pointing at the original's files would break the
 * day the original is deleted. `duplicatePresentationDocument` decides what the
 * copy *is*; this decides the order the two stores are written in, and what
 * happens when the second write fails.
 *
 * The document goes first so every file has an owner from the moment it exists:
 * an asset row whose presentation is not there can never be cleaned up by the
 * sweep, which works by comparing files against the presentations that remain.
 */
export async function duplicatePresentation(
  repository: SlaidsRepository,
  /**
   * The document to copy, already read.
   *
   * An id would be the shorter signature and the wrong one: a caller that has
   * checked something about the source — an agent comparing it against the
   * revision it was told to copy — would be checking one reading and copying
   * whatever a second read returned. The copy is of the document handed in.
   */
  source: Presentation,
  options: { title?: string } = {},
): Promise<Presentation> {
  const { presentation: copy, assetIds } = duplicatePresentationDocument(source, options)

  await repository.savePresentation(copy)

  try {
    for (const asset of source.assets) {
      const stored = await repository.getAsset(asset.id)
      if (!stored) continue
      const targetId = assetIds.get(asset.id)
      if (!targetId) continue
      await repository.putAsset(copy.id, { ...stored.ref, id: targetId }, stored.blob)
    }
  } catch (error) {
    // A copy whose files did not all make it is worse than no copy: the caller
    // is told the duplication failed while a half-copied presentation shows up
    // on the next refresh. Take it back out, files first.
    try {
      await repository.deleteAssetsForPresentation(copy.id)
      await repository.deletePresentation(copy.id)
    } catch {
      // Nothing more to try; the original error is the one worth reporting.
    }
    throw error
  }

  return copy
}
