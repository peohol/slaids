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
import { RepositoryConflictError, RepositoryError, type SlaidsRepository } from './repository'

/**
 * Deep-copy a presentation, including its files.
 *
 * Files are copied rather than shared: an asset belongs to a presentation and is
 * deleted with it, so a copy pointing at the original's files would break the
 * day the original is deleted. `duplicatePresentationDocument` decides what the
 * copy *is*; this decides the order the two stores are written in, and what
 * happens when the second write fails.
 *
 * The bytes are moved as they are, without going through
 * `domain/assetIngress.ts`: they are already in Slaids' store, so they came
 * through that door when they first arrived. Re-validating a copy would judge a
 * stored file by today's rules rather than the ones it was stored under, and a
 * deck that has been fine for a year would stop being duplicable for a reason
 * its owner cannot act on. The rule the door enforces is about what may *enter*
 * the store; it is enforced once, at entry.
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

  try {
    await repository.savePresentation(copy)
  } catch (error) {
    // A failed write is not proof that the server did not write. Supabase can
    // commit the row and lose the response on the way back, and then the copy
    // exists — with a document that already points at asset ids nothing has
    // stored yet, because the loop below never ran. That is the same broken
    // deck the rollback further down exists to prevent, arrived at through the
    // one path that used to skip it. `assetStore.ts` reasons about the same
    // ambiguity in the other direction; see `resolveAmbiguousRegistration`.
    //
    // So the copy id is taken back out rather than assumed absent. It is safe
    // without reading anything back first, and that is a property of *this* id
    // rather than of ids in general: it was minted a few lines ago, it has been
    // handed to nobody, and an unguarded delete of a row that is not there is a
    // no-op. Deleting it can therefore only remove a copy that should not exist.
    //
    // The exception is a conflict, which is the store saying the id is already
    // taken — by a row this duplication did not create. That row is somebody's
    // real presentation, and it is the one thing here that must not be touched.
    if (!(error instanceof RepositoryConflictError)) await discardCopy(repository, copy.id)
    throw error
  }

  try {
    // Over the map rather than over `source.assets`, so the pairing of "which
    // file becomes which" is structural: there is no lookup here that could
    // come back empty, and therefore no branch that has to decide what to do
    // when it does.
    for (const [sourceId, targetId] of assetIds) {
      const stored = await repository.getAsset(sourceId)
      if (!stored) {
        // The document says this file exists and the store does not have it.
        // Skipping it would produce exactly the thing the rollback below exists
        // to prevent, and quietly: the copy's document already lists the file
        // under its new id and points slides at it, so what would be returned
        // is a deck with a picture that can never load. Two ways to get here,
        // and neither is a copy worth keeping — a concurrent `delete_asset` or
        // `delete_presentation` on the source between the read and this loop,
        // or a source that was already inconsistent.
        // Named from the document, which is the only side that still has a
        // name for it: the store is the half that has nothing.
        const named = source.assets.find((asset) => asset.id === sourceId)?.name ?? sourceId
        throw new RepositoryError(
          `Kunne ikke kopiere presentasjonen: filen «${named}» står i dokumentet, men finnes ikke i lagringen. Fjern den fra presentasjonen og prøv igjen.`,
        )
      }
      await repository.putAsset(copy.id, { ...stored.ref, id: targetId }, stored.blob)
    }
  } catch (error) {
    // A copy whose files did not all make it is worse than no copy: the caller
    // is told the duplication failed while a half-copied presentation shows up
    // on the next refresh. Take it back out — document and files together.
    //
    // No conflict exemption here, unlike the save above: a conflict from
    // `putAsset` is an *asset* id that is taken, and the presentation it would
    // have belonged to is still ours and still has to go.
    await discardCopy(repository, copy.id)
    throw error
  }

  return copy
}

/**
 * Take a copy that should not exist back out.
 *
 * One call, because that call already does both halves: Dexie removes the
 * document and its asset rows in a single transaction, and Supabase removes the
 * row — the asset rows go with it through the foreign key — and then reclaims
 * the objects. Clearing the files separately first was redundant, and the
 * redundancy was the bug: a failure there meant `deletePresentation` never ran
 * at all, and the rollback ended in exactly the state it exists to prevent — a
 * copy still in the library after the duplication reported failure. The sweep
 * cannot repair that either, since files under a presentation that still exists
 * are not orphans.
 *
 * That is the same reasoning `delete_presentation` is built on, and it was
 * ignored right here: a second deletion sequence beside the store's own is a
 * second chance to leave half a presentation behind.
 *
 * Best effort, and never allowed to replace the failure that caused it: the
 * caller is already reporting why the duplication failed, and "the cleanup also
 * failed" is not a more useful thing to tell it.
 *
 * Only ever called with an id this duplication minted, which is what makes an
 * unconditional delete safe — see the note at the call site.
 */
async function discardCopy(repository: SlaidsRepository, copyId: string): Promise<void> {
  try {
    await repository.deletePresentation(copyId)
  } catch {
    // Nothing more to try; the original error is the one worth reporting.
  }
}
