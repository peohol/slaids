/**
 * A presentation's life beyond its name: where it lives, copying it, ending it.
 *
 * Everything else in the agent surface works *inside* one deck. These six work
 * on the library around it, which is why they are together and why their rules
 * come from somewhere else: the folder model is the library's own
 * (`SlaidsRepository.listFolders`), making a folder is `persistence/library.ts`
 * — the same function the sidebar's dialog calls — a copy is that file too, and
 * both deletions are one repository call each, already taking down everything
 * that only existed because of the thing being deleted. Nothing here
 * re-implements any of that; if a rule lived here, it would be a rule the editor
 * does not have.
 *
 * The scope boundary is drawn separately for each of them, and the differences
 * are the interesting part:
 *
 *  - **`list_folders`** is `presentations:read`. Folders are how the library
 *    organises presentations, and `list_presentations` already reports which
 *    folder each deck is in — the names are the missing half of a reading a
 *    read token already has, not a new kind of secret.
 *  - **`create_folder`** is `presentations:write`, which is the least privileged
 *    *existing* scope that actually covers what it does. A folder is not a file,
 *    so `assets:write` is the wrong authority and would hand out the file store
 *    along with it; nothing is published, so `sharing:write` is wrong twice
 *    over; and `presentations:read` is not a write at all. A new folder is not a
 *    new *kind* of thing either — it is the container `move_presentation`
 *    already files decks into with exactly this scope, so a token that may
 *    reorganise the library may now also make somewhere to put things. A folder
 *    scope of its own would have been a fifth authority for one row with a name
 *    on it, and every token in existence would have to be reissued to use it.
 *    The receipt is the folder itself, which costs no read authority: the id is
 *    one Slaids just minted, the name is the caller's own (trimmed), and the
 *    timestamp is the moment of the call. Nothing in it was in the library
 *    before the call, so there is nothing in it to have been read.
 *  - **`delete_folder`** is `presentations:write`, and here the scope is not a
 *    courtesy but a description: deleting a folder *rewrites every presentation
 *    in it*, clearing the `folderId` that pointed at it. That is a presentation
 *    write, on as many documents as the folder holds. It is also *only* that —
 *    no bytes are stored or reclaimed, so `assets:write` would be authority the
 *    act does not consume, and nothing is published or unpublished. The receipt
 *    is the id the caller sent and `deleted: true`: not the folder's name, and
 *    not what was in it, because this operation cannot read.
 *  - **`move_presentation`** is `presentations:write` and nothing more. It writes
 *    one field of the document, and it answers with the two ids the caller
 *    already sent. A folder's *name* is a reading, and this operation never
 *    returns one — not even in the refusal for a folder that does not exist
 *    (`missingFolder`, in `agent/presentation.ts`, which `create_presentation`
 *    and `delete_folder` go through too: the three doors that name a folder
 *    cannot disagree about whether it is there).
 *  - **`duplicate_presentation`** needs all three write-adjacent authorities:
 *    `presentations:read`, because a copy is a whole-document read and it answers
 *    with the copy the way `get_presentation` would — a token that may write but
 *    not read must not be able to learn a deck's title, its slide count or its
 *    structure by copying it; `presentations:write`, because it stores a new
 *    document; and `assets:write`, because it stores a new *file* for every file
 *    the source has. That last one is the mirror of the rule below rather than an
 *    extra: if the authority that takes a file out of the store is `assets:write`,
 *    then so is the authority that puts one in, and a copy puts in as many as the
 *    source holds. Without it a token denied `upload_asset` could still fill the
 *    store, one duplication of a picture-heavy deck at a time.
 *  - **`delete_presentation`** needs `presentations:write` **and** `assets:write`,
 *    because those are exactly the two things it puts on the clock: the
 *    document, and every file stored under it. It is the library's own
 *    deletion — into the trash, where the deck can be restored for
 *    `TRASH_RETENTION_DAYS` and is then deleted for good, files and all — and
 *    the scopes are the ones that final deletion consumes, declared up front
 *    rather than at the moment the trash is emptied by a sweep no token is
 *    holding. `delete_asset` already draws that line — the authority that puts
 *    a file in is the authority that takes it out — and trashing a deck is
 *    what takes all of them out, thirty days later.
 *
 * `sharing:write` is deliberately *not* among them. That scope exists so that
 * ordinary editing cannot publish a deck to the internet, and none of these
 * publishes anything: a deletion takes a published copy down, which is the safe
 * direction, and a copy is never shared — sharing lives on the row and is never
 * inherited. Requiring it would mean a token that may delete every deck cannot
 * delete the one that happens to be shared, which is not a protection, only a
 * deck nobody can clean up.
 */

import { z } from 'zod'
import { setFolder } from '../../domain/commands'
import { presentationRevision } from '../../domain/revision'
import { ok } from '../../domain/result'
import type { Folder } from '../../domain/types'
import {
  TRASH_RETENTION_DAYS,
  createFolder,
  duplicatePresentation,
} from '../../persistence/library'
import {
  defineOperation,
  expectedRevisionSchema,
  folderIdSchema,
  folderNameSchema,
  presentationIdSchema,
} from '../operation'
import {
  loadPresentation,
  missingFolder,
  mutatePresentation,
  revisionConflict,
  storageFailure,
} from '../presentation'
import { agentOk, fromDomainError, type AgentResult } from '../types'
import { presentationView, type PresentationView } from './deck'

/* ------------------------------------------------------------------ *
 * list_folders
 * ------------------------------------------------------------------ */

export const listFolders = defineOperation({
  name: 'list_folders',
  summary:
    'Mappene i biblioteket, med id og navn. Id-en er den move_presentation og create_presentation tar imot.',
  mutates: false,
  scopes: ['presentations:read'],
  input: z.strictObject({}),
  async run(context): Promise<AgentResult<{ folders: Folder[] }>> {
    // The repository's own rows, unchanged. A folder is an id, a name and a
    // creation time in the library, and inventing a second shape for the API —
    // a count of what is in it, a nesting that does not exist — would be a
    // second folder model to keep in step with the one the library draws.
    return agentOk({ folders: await context.repository.listFolders() })
  },
})

/* ------------------------------------------------------------------ *
 * create_folder
 * ------------------------------------------------------------------ */

export const createFolderOperation = defineOperation({
  name: 'create_folder',
  summary:
    'Lag en ny mappe i biblioteket. Svarer med mappen, og id-en er den move_presentation og create_presentation tar imot.',
  mutates: true,
  // The least privileged existing scope that covers the act; see the note at
  // the top of the file for why none of the other three fits.
  scopes: ['presentations:write'],
  input: z.strictObject({ name: folderNameSchema }),
  async run(context, input): Promise<AgentResult<{ folder: Folder }>> {
    try {
      // The library's own function, not a folder built here. Trimming, the id
      // and the timestamp are its answers, so the folder an agent makes is the
      // folder the sidebar makes — and a rule added there is a rule an agent
      // meets without anybody having to remember to add it twice.
      const created = await createFolder(context.repository, input.name)
      // Reachable even though the schema already trims and requires a
      // character: the rule belongs to the library, and the schema is how the
      // *contract* states it in advance. Trusting one to have covered the other
      // is what lets the two drift.
      if (!created.ok) return fromDomainError(created.error)

      // No `revision`: a folder is not a presentation and has none. Every other
      // mutation reports one so the next call can be written against it, and the
      // next call here is `move_presentation`, which reports the deck's.
      return agentOk({ folder: created.value })
    } catch (error) {
      // The caller's own name comes back with the failure, never a folder id —
      // nothing was minted that anybody could use.
      return storageFailure(error, 'Kunne ikke lagre mappen.', { name: input.name })
    }
  },
})

/* ------------------------------------------------------------------ *
 * delete_folder
 * ------------------------------------------------------------------ */

export interface DeletedFolder {
  folderId: string
  /** Always `true` when the call succeeded, and there is nothing else to say. */
  deleted: true
}

export const deleteFolderOperation = defineOperation({
  name: 'delete_folder',
  summary:
    'Slett en mappe. Presentasjonene i den blir liggende, men uten mappe – nøyaktig som når mappen slettes i biblioteket.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    folderId: folderIdSchema.describe(
      'Mappen som skal slettes, fra list_folders. Presentasjonene i den slettes ikke; de havner på rotnivå.',
    ),
  }),
  async run(context, input): Promise<AgentResult<DeletedFolder>> {
    // The same check the two doors *into* a folder take, for the same reason and
    // out of the same function: both stores delete by id and do not mind an id
    // that is not there, so a silent `ok` would tell an agent it had removed
    // something that never existed. `delete_presentation` draws the line in the
    // same place, and for the same reason.
    //
    // What the refusal carries is the id the caller sent and nothing else. A
    // list of the real folders would be `list_folders` answered without
    // `presentations:read`.
    const missing = await missingFolder(context, input.folderId)
    if (missing) return missing

    try {
      // One call, and deliberately not a sequence assembled here. What happens
      // to the presentations inside is the store's own promise — see
      // `SlaidsRepository.deleteFolder` — and both stores keep it: the decks
      // survive at the root, with the folder cleared from the column the library
      // filters on *and* from the document. A second emptying loop in this layer
      // would be a second chance to leave a deck pointing at a folder that is
      // gone, which is a deck shown nowhere at all.
      await context.repository.deleteFolder(input.folderId)
    } catch (error) {
      return storageFailure(error, 'Kunne ikke slette mappen.', { folderId: input.folderId })
    }

    // The id the caller already had, and the fact that it is gone. Not the name
    // and not what was in it: this operation holds no read scope, and a receipt
    // is a poor place to hand out what the token may not ask for.
    return agentOk({ folderId: input.folderId, deleted: true })
  },
})

/* ------------------------------------------------------------------ *
 * move_presentation
 * ------------------------------------------------------------------ */

export interface MovedPresentation {
  presentationId: string
  folderId: string | null
}

export const movePresentation = defineOperation({
  name: 'move_presentation',
  summary:
    'Flytt en presentasjon inn i en mappe, eller ut til rotnivå. Mappen må finnes fra før – Slaids lager den ikke.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    folderId: folderIdSchema
      .nullable()
      .describe(
        'Mappen presentasjonen skal ligge i, fra list_folders. `null` flytter den ut av mapper, til rotnivå. Feltet er påkrevd: en flytting må si hvor.',
      ),
  }),
  async run(context, input): Promise<AgentResult<MovedPresentation & { revision: string }>> {
    const missing = await missingFolder(context, input.folderId)
    if (missing) return missing

    return mutatePresentation(context, input, (presentation) => {
      // A move to the folder the deck is already in is a legal no-op, and it is
      // answered by handing the document straight back: `mutatePresentation`
      // then stores nothing, so calling this on routine cannot move the
      // revision and cannot make somebody else's `expectedRevision` stale. The
      // same reasoning as `delete_unused_references` on a deck with nothing to
      // prune.
      const moved =
        presentation.folderId === input.folderId
          ? ok(presentation)
          : setFolder(presentation, input.folderId)
      if (!moved.ok) return moved
      return ok({
        presentation: moved.value,
        value: { presentationId: presentation.id, folderId: input.folderId },
      })
    })
  },
})

/* ------------------------------------------------------------------ *
 * duplicate_presentation
 * ------------------------------------------------------------------ */

export const duplicatePresentationOperation = defineOperation({
  name: 'duplicate_presentation',
  summary:
    'Kopier en hel presentasjon, filene inkludert, til en ny og selvstendig presentasjon. Svarer med kopien slik get_presentation ville lest den.',
  mutates: true,
  // All three, and each of them is something this operation actually does: it
  // reads the whole source document, writes a new one, and writes a new file for
  // every file the source has. See the note at the top of the file.
  //
  // Declared unconditionally, including for a deck with no files at all. Scopes
  // are enforced by the transport before the operation runs, and Agent Core
  // never learns which ones the caller holds — a requirement that depended on
  // the source's contents would be one no catalogue could publish and no caller
  // could predict.
  scopes: ['presentations:read', 'presentations:write', 'assets:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema.describe('Id-en til presentasjonen som skal kopieres.'),
    expectedRevision: expectedRevisionSchema.describe(
      'Revisjonen fra get_presentation eller inspect_slide. Er kilden endret siden da, avvises kallet med CONFLICT – kopien er et bilde av én bestemt lesing.',
    ),
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('Navnet på kopien. Utelatt gir kildens navn med «(kopi)» bak.'),
  }),
  async run(context, input): Promise<AgentResult<PresentationView>> {
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded

    // Checked before a single byte is copied, and the document that passes the
    // check is the document that gets copied — `duplicatePresentation` takes it
    // rather than re-reading it, so there is no window where the copy is of a
    // reading nobody verified.
    const conflict = revisionConflict(loaded.value, input.expectedRevision)
    if (conflict) return conflict

    try {
      const copy = await duplicatePresentation(context.repository, loaded.value, {
        ...(input.title ? { title: input.title } : {}),
      })
      // The same view `create_presentation` answers with: an agent that has just
      // made a deck gets its slide ids and its revision without a second call,
      // whichever of the two ways it made it.
      return agentOk(presentationView(copy))
    } catch (error) {
      return storageFailure(error, 'Kunne ikke kopiere presentasjonen.', {
        presentationId: input.presentationId,
      })
    }
  },
})

/* ------------------------------------------------------------------ *
 * delete_presentation
 * ------------------------------------------------------------------ */

export interface DeletedPresentation {
  presentationId: string
  /**
   * Always `true` when the call succeeded, and there is nothing else in this
   * answer.
   *
   * Notably no `revision`: every other mutation reports the reading it produced
   * so the next call can be written against it, and here there is no next call
   * — the deck is out of the library, and nothing an agent does addresses the
   * trash. Notably no title, slide count or sharing state either — this
   * operation does not require `presentations:read`, and a receipt is a poor
   * place to hand out what the token may not ask for.
   */
  deleted: true
}

export const deletePresentationOperation = defineOperation({
  name: 'delete_presentation',
  summary: `Slett en presentasjon: den flyttes til søppelkassen, forsvinner fra list_presentations og kan gjenopprettes i biblioteket i ${TRASH_RETENTION_DAYS} dager. Deretter slettes den for godt, med slidene, filene og en eventuell delingslenke. Delingslenken er død så lenge presentasjonen ligger i søppelkassen, og for hver operasjon her – denne inkludert – er en presentasjon i søppelkassen PRESENTATION_NOT_FOUND.`,
  mutates: true,
  // The two authorities the act consumes, both of them. See the note at the top.
  scopes: ['presentations:write', 'assets:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema.describe(
      'Revisjonen fra get_presentation eller inspect_slide. Er presentasjonen endret siden da, avvises slettingen med CONFLICT i stedet for å fjerne noe du ikke har sett.',
    ),
  }),
  async run(context, input): Promise<AgentResult<DeletedPresentation>> {
    // Loaded first for two reasons, and neither is the document itself: an
    // absent row has to be `PRESENTATION_NOT_FOUND` rather than a silent
    // success, and the reading is what the guarded write below is written
    // against.
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded

    const revision = presentationRevision(loaded.value)
    const conflict = revisionConflict(loaded.value, input.expectedRevision, revision)
    if (conflict) return conflict

    try {
      // The library's own deletion, and one call: into the trash, guarded by
      // the reading this operation just took — the same two windows every agent
      // write is covered by. Nothing is destroyed here; what happens after
      // `TRASH_RETENTION_DAYS` is the store's business, and both stores already
      // take the document, its asset rows, the bytes behind them and the share
      // columns down together when the trash is emptied. A permanent delete
      // from here would be a second meaning of "delete" — one the owner could
      // not undo — beside the one the library has.
      await context.repository.trashPresentation(input.presentationId, {
        expectedRevision: revision,
      })
    } catch (error) {
      return storageFailure(error, 'Kunne ikke slette presentasjonen.', {
        presentationId: input.presentationId,
      })
    }

    return agentOk({ presentationId: input.presentationId, deleted: true })
  },
})

export const libraryOperations = [
  listFolders,
  createFolderOperation,
  deleteFolderOperation,
  movePresentation,
  duplicatePresentationOperation,
  deletePresentationOperation,
]
