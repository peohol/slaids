/**
 * Storage abstraction.
 *
 * The UI depends on this interface only. There are two implementations —
 * `DexieSlaidsRepository` (IndexedDB, local/test mode) and
 * `SupabaseSlaidsRepository` (production) — and `activeRepository.ts` is the
 * one place that decides which of them is live.
 */

import type { UserSettings } from '../domain/userSettings'
import type { AutocorrectRule } from '../domain/autocorrect'
import type { SharedPresentationSnapshot } from '../domain/sharing'
import type {
  AssetRef,
  Folder,
  LayoutTemplate,
  Presentation,
  PresentationSummary,
} from '../domain/types'

export interface StoredAsset {
  ref: AssetRef
  blob: Blob
}

/**
 * A precondition on a write: only store this if the stored copy is still the
 * one the caller read.
 *
 * The revision is `domain/revision.ts`'s digest of the document that was
 * loaded. It exists because the two implementations guard the same window with
 * different currencies — Supabase has a `version` column and IndexedDB has
 * nothing — and a caller that wants "do not overwrite somebody else" should not
 * have to know which store it is talking to.
 */
export interface SaveGuard {
  expectedRevision: string
}

export interface SlaidsRepository {
  /**
   * The library: every presentation that is not in the trash, most recently
   * edited first. What the trash holds is `listTrashedPresentations`, and the
   * two never overlap — a caller that wants "everything" asks both, and a
   * caller that forgets the trash exists gets the library, which is the safe
   * mistake.
   */
  listPresentations(): Promise<PresentationSummary[]>
  /**
   * The trash: every presentation that was moved there and not yet purged, most
   * recently trashed first, each with its `deletedAt` set.
   */
  listTrashedPresentations(): Promise<PresentationSummary[]>
  loadPresentation(id: string): Promise<Presentation>
  /**
   * Store the document. With a `guard`, refuse — `RepositoryConflictError` —
   * if the stored copy has moved on since the revision the guard names.
   *
   * Without one the write is still conditional, on a weaker and automatic
   * precondition: that nothing has been stored since *this* repository last
   * read or wrote this presentation. That is what the editor's autosave wants —
   * it re-saves the document it owns continuously, and each of its own writes
   * moves the precondition along, so a tab saves as often as it likes. What it
   * cannot do is overwrite somebody else: a second tab holding a copy from
   * before, or an editor whose deck was changed under it, is told to read again
   * rather than allowed to write its stale copy back.
   *
   * That refusal is not only about losing the other writer's text. A document
   * stored earlier may have *deleted* files the older copy still points at —
   * image optimisation replaces files and removes what nothing shows any more —
   * and writing the older copy back would leave the store holding a document
   * that names files that are gone. Which is why the precondition is the
   * store's own, not something a caller has to remember to ask for.
   *
   * One thing neither form of the write ever does is bring a deleted row back.
   * "Nothing known about this id" means "new", and a new presentation is
   * inserted; but a row this repository has seen and cannot find any more was
   * deleted for good by somebody else, and a save of it is refused —
   * `RepositoryConflictError` — rather than re-inserted. Both stores keep that
   * memory (Supabase as the versions it has seen, Dexie as the ids), because
   * the alternative is a stale editor in another tab resurrecting a deck the
   * trash was just emptied of, without the files that went with it.
   */
  savePresentation(presentation: Presentation, guard?: SaveGuard): Promise<void>
  /**
   * Take the presentation down, and everything that only existed because of it:
   * its asset rows, the bytes behind them, and — where the store has one — the
   * published copy and the share token, which live on the same row.
   *
   * One call rather than a sequence a caller assembles, because the parts have
   * to go in an order that never leaves a document pointing at files that are
   * gone, and a second caller writing that sequence out again is a second
   * chance to get it wrong. There is no undo: what this removes is removed —
   * which is why the library never calls it directly. A deletion from the
   * library is `trashPresentation`, and the trash is emptied by
   * `purgePresentation`, which is this with one precondition.
   *
   * With a `guard`, refuse — `RepositoryConflictError` — if the stored copy is no
   * longer the revision the guard names. The same precondition
   * `savePresentation` takes, and it matters more here: an overwrite can be
   * argued about afterwards, and a deletion cannot.
   *
   * "No longer that revision" includes a row that is not there at all, which is
   * the one place the two guards differ. A guarded *save* of an absent row is an
   * insert, and an insert is not a lost update; a guarded *delete* names a
   * document — remove the one I read — and a row somebody else already removed
   * is not it. Without a guard the delete is unconditional and idempotent: an id
   * that is not there is not an error, which is what the duplication rollback
   * relies on.
   */
  deletePresentation(id: string, guard?: SaveGuard): Promise<void>
  /**
   * Delete a trashed presentation for good — if, and only if, it is still the
   * trash entry the caller saw: in the trash, trashed at exactly `deletedAt`.
   *
   * `deletePresentation` is unconditional, and unconditional is wrong for the
   * trash. Between listing the trash and emptying it, another tab or device can
   * restore the deck, and a delete that does not look would then destroy a
   * live presentation, files and all. So the check and the delete are one
   * atomic step in the store — one statement in Supabase, one transaction in
   * Dexie — and `deletedAt` is the identity of the trash entry: a deck restored
   * and trashed again is a new entry with a new time and a fresh thirty days,
   * which the caller has not seen and must not purge on an old reading.
   *
   * Answers whether the deletion happened. `false` means the entry is not
   * there any more — restored, trashed again, or already purged — and nothing
   * was touched: a caller emptying the trash skips it, and a caller acting on
   * one card tells the user. Not a `RepositoryConflictError`, because for the
   * sweep this is the expected outcome of a race it is built to lose safely,
   * not a failure of the call.
   */
  purgePresentation(id: string, deletedAt: string): Promise<boolean>
  /**
   * Move the presentation to the trash.
   *
   * Nothing is destroyed: the document, its files and its share columns all
   * stay exactly where they are, and only `deletedAt` is written — which is
   * why a deck open in another tab keeps autosaving without either resurrecting
   * itself or losing anything. What changes is which listing it appears in,
   * and that it is now on the clock: `persistence/library.ts` purges the trash
   * after `TRASH_RETENTION_DAYS` with `purgePresentation`, which is the one
   * and only way out of the trash that is not `restorePresentation`.
   *
   * `deletedAt` is set to now, also for a row that is already in the trash —
   * trashing twice restarts the clock rather than being refused, because the
   * two stores cannot both express "set only if unset" in one statement and
   * one rule is worth more than the distinction.
   *
   * With a `guard`, the same precondition `deletePresentation` takes, for the
   * same reason: a caller that names a reading is asking to trash *that*
   * document, and a row that has moved on or is gone is not it —
   * `RepositoryConflictError`. Without a guard, a row that is not there is a
   * `RepositoryNotFoundError`: unlike a permanent delete, which the duplication
   * rollback needs to be idempotent, nothing relies on trashing an absent row
   * quietly succeeding, and the library would rather say so.
   */
  trashPresentation(id: string, guard?: SaveGuard): Promise<void>
  /**
   * Take the presentation back out of the trash, into the library where it
   * was — same folder, same document, same files, same share state. A row that
   * is not there is a `RepositoryNotFoundError`: the trash was purged in the
   * meantime, and the caller must be told rather than shown an empty library.
   * A row that was never in the trash is left as it is.
   */
  restorePresentation(id: string): Promise<void>

  listFolders(): Promise<Folder[]>
  /**
   * Store the folder, by id. A `put`: an id that is already there is renamed,
   * not rejected. Minting the id is the caller's business — see
   * `persistence/library.ts`, which is where a *new* folder comes from.
   */
  saveFolder(folder: Folder): Promise<void>
  /**
   * Give an existing folder a new name, and only that: unlike `saveFolder` this
   * never creates a row, so a rename that lost a race with a deletion cannot
   * bring the folder back. Answers with the folder as stored, or `null` when
   * there is no such folder. The share state is not touched.
   */
  renameFolder(id: string, name: string): Promise<Folder | null>
  /**
   * Take the folder away and leave everything that was in it.
   *
   * **The presentations survive, at the root.** That is the promise, not an
   * implementation detail of either store: a folder is a label on the library,
   * and deleting a label must never delete what it was on. So this call also
   * clears the `folderId` of every presentation that named it — in *both* places
   * the id is written down, the column the library filters on and the field
   * inside the document — because a document left naming a folder that is gone
   * would be a deck shown nowhere: not at the root, not in any folder.
   *
   * Stated here rather than in the two implementations because callers now
   * depend on it. `agent/operations/library.ts` answers an agent with nothing
   * but `deleted: true`, and what makes that a complete answer is that there is
   * no second thing the caller has to do afterwards.
   *
   * Idempotent, and deliberately unguarded: an id that is not there is not an
   * error. Both stores delete by id and do not mind an id that is absent, so a
   * caller that wants "no such folder" to *mean* something has to look first —
   * which is exactly what the agent surface does, with the same `missingFolder`
   * check `move_presentation` and `create_presentation` already share.
   */
  deleteFolder(id: string): Promise<void>

  listTemplates(): Promise<LayoutTemplate[]>
  saveTemplate(template: LayoutTemplate): Promise<void>
  deleteTemplate(id: string): Promise<void>

  getUserSettings(ownerId: string | null): Promise<UserSettings>
  updateUserSettings(ownerId: string | null, patch: Partial<UserSettings>): Promise<void>

  /**
   * This user's autoerstatt rules (`domain/autocorrect.ts`), repaired. A user
   * who has never saved a list gets `DEFAULT_AUTOCORRECT_RULES`; one who saved
   * an empty list gets an empty list, because that was a choice.
   */
  loadAutocorrectRules(): Promise<AutocorrectRule[]>
  /** Replace this user's whole list. Stored repaired, never as given. */
  saveAutocorrectRules(rules: readonly AutocorrectRule[]): Promise<void>

  putAsset(presentationId: string, ref: AssetRef, blob: Blob): Promise<void>
  getAsset(id: string): Promise<StoredAsset | null>
  listAssets(presentationId: string): Promise<AssetRef[]>
  /**
   * Which of these asset ids this account already has a file under, whichever
   * presentation it belongs to. Asset rows are keyed by id alone, so an importer
   * asks before writing rather than discovering the clash afterwards.
   *
   * It answers for this account and no further — a remote store shows a user
   * only their own rows, and the server-side repository writes that same limit
   * out because its key would otherwise see past it. An id that looks free can
   * therefore still be taken by an account nobody here can see; that is not this
   * method's job to catch, and it is not left to chance either. The write
   * refuses such an id with a `RepositoryConflictError` rather than taking the
   * row over, which is the same answer `savePresentation` already gives and the
   * one `persistence/backup.ts` already knows how to act on.
   */
  existingAssetIds(ids: readonly string[]): Promise<string[]>
  /**
   * Remove one file, and say whether the bytes really went with it.
   *
   * Three answers, not two, because deleting a file is two removals in the
   * stores that have two: the row that makes the file reachable, and the bytes
   * themselves. The row always goes first — what is left behind then is a file
   * nothing references, never a reference to a file that is gone.
   *
   *  - **throws** — nothing happened. The row is still there and the file is
   *    still reachable.
   *  - **`true`** — the row is gone and so are the bytes.
   *  - **`false`** — the row is gone; the bytes were not reclaimed and are now
   *    an orphan in the object store. The deletion still stands, and the caller
   *    must not retry it or undo it: reclaiming is the store's own job (see
   *    `deleteOrphanAssets`), and the object goes with its presentation either
   *    way.
   *
   * Returned rather than swallowed because a caller can be *reporting* the
   * outcome — `delete_asset` answers an agent with `fileRemoved` — and a
   * quietly optimistic `true` would be a claim about storage nobody checked.
   */
  deleteAsset(id: string): Promise<boolean>
  deleteAssetsForPresentation(presentationId: string): Promise<void>
  /** Remove asset rows whose owning presentation no longer exists. */
  deleteOrphanAssets(): Promise<number>
}

/**
 * What the editor needs to know about sharing, and nothing more.
 *
 * `token` is `null` whenever `shared` is false — a revoked token is not a link,
 * and handing one out would let the UI show an address that cannot work.
 */
export interface ShareState {
  shared: boolean
  token: string | null
}

/**
 * Publishing a presentation to a secret link.
 *
 * Deliberately a separate interface from `SlaidsRepository`: sharing needs a
 * public backend, so it exists in Supabase mode and nowhere else. Local mode
 * has no answer to "what does an anonymous visitor see", and a pretend local
 * implementation would be worse than none — it would produce links that look
 * shareable and are not. `activeRepository.ts` decides whether there is one.
 */
export interface SharingRepository {
  /** The current state as stored, never as remembered. */
  readShareState(presentationId: string): Promise<ShareState>
  /**
   * Publish this snapshot under a **new** token, atomically. Any token handed
   * out before is dead from this moment, including one from an earlier share of
   * the same presentation.
   */
  enableSharing(
    presentationId: string,
    snapshot: SharedPresentationSnapshot,
  ): Promise<ShareState>
  /**
   * Stop sharing: the published copy is dropped and the token is rotated in the
   * same statement, so the link that was in circulation can never be revived.
   */
  disableSharing(presentationId: string): Promise<ShareState>
}

/**
 * Publishing a whole folder to a secret link.
 *
 * While a folder is shared, every presentation filed in it is published — the
 * same sanitised snapshot a presentation shared on its own carries — and the
 * folder's link lists them and opens them in presentation mode. Filing a deck
 * in a shared folder publishes it; moving it out, trashing it or deleting the
 * folder takes it off the link again. Nobody holding the link can change
 * anything: the public side only ever reads.
 *
 * Separate from `SharingRepository` for the same reason that one is separate
 * from `SlaidsRepository`: it exists in Supabase mode only, and a caller that
 * shares single decks — the agent surface — has no business being handed it.
 */
export interface FolderSharingRepository {
  /** The share state of every shared folder, by folder id. A folder not listed is not shared. */
  listFolderShareStates(): Promise<Record<string, ShareState>>
  /**
   * Share the folder under a **new** token, and publish every deck in it before
   * the token is handed out. If any deck cannot be published, the folder is
   * switched off again and this rejects.
   */
  enableFolderSharing(folderId: string): Promise<ShareState>
  /**
   * Stop sharing: the token is rotated and every deck that was published only
   * through the folder loses its published copy, in the same statement.
   */
  disableFolderSharing(folderId: string): Promise<ShareState>
}

export class RepositoryError extends Error {
  readonly detail?: unknown

  constructor(message: string, detail?: unknown) {
    super(message)
    this.name = 'RepositoryError'
    this.detail = detail
  }
}

/**
 * The row is not there.
 *
 * Told apart from every other repository failure on purpose: "this
 * presentation does not exist" and "the store did not answer" call for opposite
 * reactions, and a caller that cannot tell them apart will treat an outage as a
 * deletion. Only a genuinely absent row throws this — never a network error, a
 * refused query or a document that failed validation.
 */
export class RepositoryNotFoundError extends RepositoryError {
  constructor(message: string, detail?: unknown) {
    super(message, detail)
    this.name = 'RepositoryNotFoundError'
  }
}

/**
 * A write lost a race: the stored copy has moved on since the one being saved
 * was read, so writing it would silently discard whatever the other tab or
 * device did. The caller is told rather than overwritten.
 */
export class RepositoryConflictError extends RepositoryError {
  constructor(message: string, detail?: unknown) {
    super(message, detail)
    this.name = 'RepositoryConflictError'
  }
}
