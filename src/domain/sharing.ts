/**
 * The publishable snapshot of a presentation.
 *
 * Sharing is **publishing, not collaboration**. There are two documents, and
 * the difference between them is the whole security model:
 *
 *  - the private `Presentation` — the working copy, which only its owner ever
 *    reads, and which holds a great deal that is nobody else's business:
 *    the sandbox, the ideas list, which folder it is filed in, unused assets
 *    and references that were collected but never cited;
 *  - the `SharedPresentationSnapshot` — the only thing an anonymous viewer can
 *    ever be handed, built here, containing exactly what it takes to draw the
 *    deck and not one field more.
 *
 * The snapshot is built by *listing what goes in*, never by deleting fields
 * from the private document. A field added to `Presentation` later is therefore
 * private until somebody deliberately publishes it, which is the safe default
 * for the direction this data travels.
 *
 * Nothing here knows about Supabase: this is a pure function from the domain
 * object to the document that is published, so the repository and the tests
 * mean the same thing by "shared".
 */

import { z } from 'zod'
import { deckAssetIds } from './commands/assets'
import { withoutDepositNumbers } from './imageDeposit'
import { migratePresentation } from './migrations'
import { splitReferences, type CitationStyle } from './references'
import { err, ok, type Result } from './result'
import type {
  AssetRef,
  DeckSlides,
  DeckSource,
  Presentation,
  PresentationTheme,
  Reference,
} from './types'

/** Marks the payload as ours, so an unrelated JSON body fails loudly. */
export const SHARED_SNAPSHOT_FORMAT = 'slaids-shared'

/** The envelope's own version, bumped only if these fields change shape. */
export const SHARED_SNAPSHOT_VERSION = 1

/**
 * A published deck.
 *
 * `schemaVersion` is the *presentation* schema the slides are written in, so a
 * snapshot published before a migration is still readable afterwards; the
 * envelope version above is separate and governs the fields around them.
 */
export interface SharedPresentationSnapshot extends DeckSource {
  format: typeof SHARED_SNAPSHOT_FORMAT
  snapshotVersion: number
  schemaVersion: number
  title: string
  theme: PresentationTheme
  /* The front page is the deck's first section, so it is published with the
     rest of the slides rather than beside them. */
  slides: DeckSlides
  /** Only the references that are actually cited, in numbering order. */
  references: Reference[]
  citationStyle?: CitationStyle
  /** Only the assets the slides actually show. */
  assets: AssetRef[]
  publishedAt: string
}

/**
 * A snapshot carries no presentation id — a viewer has no use for one, and the
 * share token already says which deck this is. Validation reuses the
 * presentation schema, which insists on an id, so one is supplied here and
 * thrown away again.
 */
const PLACEHOLDER_ID = 'shared'

/**
 * Cut the publishable snapshot out of a presentation.
 *
 * Both the reference list and the asset list are narrowed by the same traversal
 * the rest of the app uses — `splitReferences` for what is cited, `deckAssetIds`
 * for what is shown (the slides and the theme's logo) — rather than by a second implementation that could drift
 * from it. The sandbox is not consulted by either, which is the point: content
 * parked there is unfinished work, not part of the deck. The image brief and
 * the image plan are not listed here at all, for the same reason and by the
 * same default: a field that is not named is a field that is not published.
 * That default is the whole guarantee now that no zone carries editorial text
 * of its own — the working material lives beside the slides rather than inside
 * them, so publishing the slides cannot publish it.
 *
 * The one thing on a slide that is *not* the audience's is the deposit number
 * an unfilled picture panel carries while the deck waits for its files. It is
 * internal bookkeeping about work in progress, so the slides are stripped of it
 * on the way out — by the same function that writes it, so «never published»
 * is a property of one traversal rather than a promise two files make.
 */
export function buildSharedSnapshot(
  presentation: Presentation,
  publishedAt: string = new Date().toISOString(),
): SharedPresentationSnapshot {
  const published = withoutDepositNumbers(presentation)
  const shownAssetIds = deckAssetIds(published)
  const snapshot: SharedPresentationSnapshot = {
    format: SHARED_SNAPSHOT_FORMAT,
    snapshotVersion: SHARED_SNAPSHOT_VERSION,
    schemaVersion: presentation.schemaVersion,
    title: published.title,
    theme: published.theme,
    slides: published.slides,
    references: splitReferences(published).used,
    includeReferencesInProgress: published.includeReferencesInProgress,
    assets: published.assets.filter((asset) => shownAssetIds.has(asset.id)),
    publishedAt,
  }
  // The same defensive round-trip the repository does before a write: what
  // leaves here is plain JSON, never a live object that shares structure with
  // the document the editor is still changing.
  return JSON.parse(JSON.stringify(snapshot)) as SharedPresentationSnapshot
}

/**
 * The envelope only. The deck inside it is validated by the presentation
 * schema below, so there is exactly one description of what a slide is.
 */
const envelopeSchema = z.object({
  format: z.literal(SHARED_SNAPSHOT_FORMAT),
  snapshotVersion: z.literal(SHARED_SNAPSHOT_VERSION),
  schemaVersion: z.number().int().nonnegative(),
  title: z.string(),
  publishedAt: z.string(),
  theme: z.unknown(),
  /* No longer published — the front page is the first slide now — but still
     read, because a link shared while the cover was its own field is still a
     link somebody holds. `.optional()` is what lets both through: a bare
     `z.unknown()` still *requires* the key, so every snapshot published after
     the change would stop resolving here. Whatever is found is handed to the
     migration chain below, which turns it into the deck's first section
     exactly as it does for a stored presentation. */
  cover: z.unknown().optional(),
  slides: z.unknown(),
  references: z.unknown(),
  citationStyle: z.enum(['numbered', 'author-year']).optional(),
  includeReferencesInProgress: z.unknown().optional(),
  assets: z.unknown(),
})

/**
 * Validate — and, when it was published before a schema change, migrate — a
 * snapshot read back from the network.
 *
 * The deck is run through `migratePresentation`, the very chain a stored
 * presentation goes through: a snapshot *is* a presentation with the private
 * parts removed, so its slides need the same migrations and deserve the same
 * validation. Doing it any other way would mean a second, weaker copy of the
 * rules, and the public viewer is the last place that should have one.
 */
export function parseSharedSnapshot(input: unknown): Result<SharedPresentationSnapshot> {
  const envelope = envelopeSchema.safeParse(input)
  if (!envelope.success) {
    return err('INVALID_CONTENT', 'Delingsdataene har et ukjent format.', {
      issues: envelope.error.issues,
    })
  }
  const parsed = envelope.data
  const migrated = migratePresentation({
    schemaVersion: parsed.schemaVersion,
    id: PLACEHOLDER_ID,
    title: parsed.title,
    folderId: null,
    theme: parsed.theme,
    cover: parsed.cover,
    slides: parsed.slides,
    references: parsed.references,
    includeReferencesInProgress: parsed.includeReferencesInProgress,
    sandbox: [],
    ideas: [],
    assets: parsed.assets,
    createdAt: parsed.publishedAt,
    updatedAt: parsed.publishedAt,
  })
  if (!migrated.ok) return migrated

  const deck = migrated.value
  return ok({
    format: SHARED_SNAPSHOT_FORMAT,
    snapshotVersion: SHARED_SNAPSHOT_VERSION,
    schemaVersion: deck.schemaVersion,
    title: deck.title,
    theme: deck.theme,
    slides: deck.slides,
    references: deck.references,
    ...(parsed.citationStyle ? { citationStyle: parsed.citationStyle } : {}),
    includeReferencesInProgress: deck.includeReferencesInProgress,
    assets: deck.assets,
    publishedAt: parsed.publishedAt,
  })
}

/** Marks a shared folder's listing as ours. Mirrored by the Edge Function. */
export const SHARED_FOLDER_FORMAT = 'slaids-shared-folder'

/** The listing's own version, bumped only if its fields change shape. */
export const SHARED_FOLDER_VERSION = 1

/**
 * What a shared folder's link shows before any deck is opened: the folder's
 * name, and the decks it publishes — each by the id to ask for it with, its
 * published title and how many slides it has. Nothing else about the folder or
 * the decks leaves the server; each deck is then fetched as its own snapshot.
 */
export interface SharedFolderListing {
  name: string
  presentations: SharedFolderEntry[]
}

export interface SharedFolderEntry {
  id: string
  title: string
  slideCount: number
}

const folderListingSchema = z.object({
  format: z.literal(SHARED_FOLDER_FORMAT),
  folderVersion: z.literal(SHARED_FOLDER_VERSION),
  name: z.string(),
  presentations: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string(),
      slideCount: z.number().int().nonnegative(),
    }),
  ),
})

/** Validate a shared folder's listing read back from the network. */
export function parseSharedFolder(input: unknown): Result<SharedFolderListing> {
  const parsed = folderListingSchema.safeParse(input)
  if (!parsed.success) {
    return err('INVALID_CONTENT', 'Mappedataene har et ukjent format.', {
      issues: parsed.error.issues,
    })
  }
  return ok({ name: parsed.data.name, presentations: parsed.data.presentations })
}
