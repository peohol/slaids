-- Slaids: the trash, and how much room a presentation takes.
--
-- Two columns on `slaids_presentations`, both additive and both idempotent, so
-- this file can be run again in the SQL editor or against a database whose
-- ledger is incomplete. Nothing outside the `slaids_` prefix is touched.
--
--   * `deleted_at` — when the presentation was moved to the trash, or null
--     while it is in the library. Deleting from the library no longer deletes
--     the row: it sets this, and the row keeps its document, its asset rows,
--     its files and its share columns. `persistence/library.ts` purges the
--     trash after thirty days with the same permanent delete as before, and a
--     restore clears the column again. The column sits beside `document`
--     rather than inside it on purpose: the editor saves the document it holds,
--     and a save never writes `deleted_at` — so a deck trashed in one tab stays
--     in the trash when another tab autosaves it, and comes back out only when
--     somebody restores it.
--   * `byte_size` — the document's JSON plus the bytes of every file it lists,
--     so the library can show what each presentation costs without downloading
--     it. Written by the client on every save, exactly as `slide_count` is, from
--     the one rule in `domain/presentation.ts` (`presentationByteSize`). The
--     backfill below computes the same thing once, in SQL, for the rows that
--     were saved before the column existed.
--
-- The version trigger (`slaids_presentations_touch`) is unchanged and needs no
-- change: it bumps `version` only when `document`, `title`, `folder_id` or
-- `slide_count` moves, so trashing and restoring — writes to `deleted_at`
-- alone — leave an open editor's version valid, and `byte_size` only ever
-- changes together with `document`.

alter table public.slaids_presentations
  add column if not exists deleted_at timestamptz;

alter table public.slaids_presentations
  add column if not exists byte_size bigint not null default 0;

-- Named, and dropped before it is created, so the file can be run again.
alter table public.slaids_presentations
  drop constraint if exists slaids_presentations_byte_size_check;
alter table public.slaids_presentations
  add constraint slaids_presentations_byte_size_check
  check (byte_size >= 0);

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

-- The rows that exist today were saved before the client wrote `byte_size`, so
-- they are at the default. Only those are touched (a real document is never
-- zero bytes), and only that column: the SET list deliberately does not name
-- `document`, so the touch trigger sees no edit and leaves `version` and
-- `updated_at` exactly as they are — an open editor's next autosave still lands,
-- and the library still shows when the deck was last changed by a person.
--
-- `octet_length(document::text)` is the size of the JSON as Postgres prints it,
-- a little wider than the client's own serialisation; close enough for a figure
-- that is replaced by the client's own on the next save.
update public.slaids_presentations p
   set byte_size = pg_catalog.octet_length(p.document::text)
                 + coalesce(
                     (select sum(coalesce((a ->> 'byteSize')::numeric, 0))
                        from jsonb_array_elements(coalesce(p.document -> 'assets', '[]'::jsonb)) a),
                     0
                   )::bigint
 where p.byte_size = 0;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The library's own read, now with the trash filtered out: the owner's live
-- presentations, newest edit first. Partial, so the index is exactly the rows
-- that query returns and the trash costs it nothing.
create index if not exists slaids_presentations_owner_live_updated_idx
  on public.slaids_presentations (owner_id, updated_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Row level security is unchanged, deliberately
-- ---------------------------------------------------------------------------

-- A trashed row is still the owner's row: the same policies read and write it,
-- and `anon` still has nothing here. What a trashed row may *not* do is answer
-- a share link — that is the Edge Function's rule (`slaids-share` refuses a row
-- whose `deleted_at` is set), because "deleted" has to mean deleted to the
-- public even while the owner can still get it back.
revoke all on table public.slaids_presentations from anon;
