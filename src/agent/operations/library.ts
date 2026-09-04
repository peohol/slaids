/**
 * A presentation's life beyond its name: where it lives, copying it, ending it.
 *
 * Everything else in the agent surface works *inside* one deck. These four work
 * on the library around it, which is why they are together and why their rules
 * come from somewhere else: the folder model is the library's own
 * (`SlaidsRepository.listFolders`), a copy is `persistence/library.ts` — the
 * same function the library grid calls — and a deletion is one repository call
 * that already takes the document, its files and its published copy down
 * together. Nothing here re-implements any of that; if a rule lived here, it
 * would be a rule the editor does not have.
 *
 * The scope boundary is drawn separately for each of them, and the differences
 * are the interesting part:
 *
 *  - **`list_folders`** is `presentations:read`. Folders are how the library
 *    organises presentations, and `list_presentations` already reports which
 *    folder each deck is in — the names are the missing half of a reading a
 *    read token already has, not a new kind of secret.
 *  - **`move_presentation`** is `presentations:write` and nothing more. It writes
 *    one field of the document, and it answers with the two ids the caller
 *    already sent. A folder's *name* is a reading, and this operation never
 *    returns one — not even in the refusal for a folder that does not exist
 *    (`missingFolder`, in `agent/presentation.ts`, which `create_presentation`
 *    goes through too: the two doors into a folder cannot disagree).
 *  - **`duplicate_presentation`** needs `presentations:read` as well as
 *    `presentations:write`, because a copy is a whole-document read followed by a
 *    write and it answers with the copy the way `get_presentation` would. A token
 *    that may write but not read must not be able to learn a deck's title, its
 *    slide count or its structure by copying it.
 *  - **`delete_presentation`** needs `presentations:write` **and** `assets:write`,
 *    because those are exactly the two things it destroys: the document, and
 *    every file stored under it. `delete_asset` already draws that line — the
 *    authority that puts a file in is the authority that takes it out — and
 *    deleting a deck takes out all of them at once. It is not extra authority; it
 *    is all the authority the act consumes, and a deletion is the one call with
 *    nothing to argue about afterwards.
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
import { duplicatePresentation } from '../../persistence/library'
import {
  defineOperation,
  expectedRevisionSchema,
  folderIdSchema,
  presentationIdSchema,
} from '../operation'
import {
  loadPresentation,
  missingFolder,
  mutatePresentation,
  revisionConflict,
  storageFailure,
} from '../presentation'
import { agentOk, type AgentResult } from '../types'
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
  // Read as well as write: this reads the whole source document and answers
  // with the copy in full. See the note at the top of the file.
  scopes: ['presentations:read', 'presentations:write'],
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
   * and no document left to have a reading. Notably no title, slide count or
   * sharing state either — this operation does not require `presentations:read`,
   * and a receipt is a poor place to hand out what the token may not ask for.
   */
  deleted: true
}

export const deletePresentationOperation = defineOperation({
  name: 'delete_presentation',
  summary:
    'Slett en presentasjon for godt, med slidene, filene og en eventuell delingslenke. Kan ikke angres.',
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
    // success — the stores delete by id and do not mind an id that is not there
    // — and the reading is what the guarded delete below is written against.
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded

    const revision = presentationRevision(loaded.value)
    const conflict = revisionConflict(loaded.value, input.expectedRevision, revision)
    if (conflict) return conflict

    try {
      // One call, guarded by the reading this operation just took — the same
      // two windows every agent write is covered by, and for a stronger reason:
      // an overwrite can be argued about afterwards and a deletion cannot. What
      // goes with the row is the store's business, and both of them already take
      // the document, its asset rows, the bytes behind them and the share
      // columns down together. Assembling that sequence here would be a second
      // deletion path, and the failure mode of a second path is half a
      // presentation left behind.
      await context.repository.deletePresentation(input.presentationId, {
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
  movePresentation,
  duplicatePresentationOperation,
  deletePresentationOperation,
]
