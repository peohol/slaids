#!/usr/bin/env bash
#
# Apply Slaids' database migrations to a Supabase project.
#
# Why this exists instead of `supabase db push`
# ---------------------------------------------
# The Supabase project is shared infrastructure: Slaids, Huskis and mdeditz all
# live in it, from three independent repositories. But Supabase's own migration
# ledger, `supabase_migrations.schema_migrations`, is *project-global*. It holds
# every app's migrations, including ones this repo has never seen — e.g.
# `20260806132939_mdeditz_store`.
#
# `supabase db push` treats that ledger as the complete history of the repo it
# is run from, so from here it fails outright:
#
#     Remote migration versions not found in local migrations directory.
#     Try repairing the migration history table:
#       supabase migration repair --status reverted 20260806132939
#     And update local migrations to match remote database:
#       supabase db pull
#
# Both of its suggestions are wrong for this setup, and destructively so. The
# first rewrites *mdeditz's* history; the second drags another app's schema into
# this repo. There is no flag that scopes `db push` to one app — `--include-all`
# is about local migrations missing from the ledger, which is the other
# direction — and `config.toml` has no setting for it either.
#
# So Slaids keeps its own ledger, `public.slaids_migrations`, next to its own
# tables and under its own prefix. This script is the whole mechanism:
#
#   - it reads and writes `public.slaids_migrations`, and nothing else;
#   - it never reads, writes or repairs `supabase_migrations.schema_migrations`;
#   - it applies each migration exactly once, in filename order, each inside one
#     transaction together with its ledger row — so a failure leaves neither a
#     half-applied migration nor a lie about what is applied.
#
# The other apps are unaffected because nothing here is global: their ledger is
# untouched, and Slaids migrations only ever create `slaids_`-prefixed objects.
#
# Usage
# -----
#   export SLAIDS_DB_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'
#   ./scripts/deploy-migrations.sh --dry-run    # what would be applied
#   ./scripts/deploy-migrations.sh              # apply it
#
# The URL is the project's Postgres connection string, from the Supabase
# dashboard under Project Settings → Database. It is a secret: keep it out of
# the repo and out of Vercel.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
LEDGER='public.slaids_migrations'

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "Ukjent argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ -z "${SLAIDS_DB_URL:-}" ]]; then
  echo "SLAIDS_DB_URL er ikke satt. Sett den til prosjektets Postgres-connection string." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "Fant ikke psql. Installer PostgreSQL-klienten, eller kjør migrasjonen i" >&2
  echo "Supabase-dashbordets SQL Editor i stedet (se README, «Deploye Slaids-migrasjoner»)." >&2
  exit 2
fi

run_sql() {
  psql "$SLAIDS_DB_URL" --no-psqlrc --quiet -v ON_ERROR_STOP=1 "$@"
}

# The one thing Slaids' ledger must never become is a second copy of the shared
# one. A migration that mentions it at all is refused before anything runs.
if grep -rlF 'supabase_migrations' "$MIGRATIONS_DIR" 2>/dev/null | grep -q .; then
  echo "En migrasjon refererer til supabase_migrations — den delte historikken." >&2
  echo "Slaids skal aldri skrive der. Avbryter." >&2
  exit 1
fi

# Self-bootstrapping: no migration can create the table its own ledger row goes
# into. Locked down like every other Slaids table — this is deploy metadata, and
# no browser role has any business reading it.
run_sql <<SQL
set client_min_messages = warning;
create table if not exists $LEDGER (
  version    text primary key,
  name       text not null,
  applied_at timestamptz not null default now()
);
alter table $LEDGER enable row level security;
revoke all on table $LEDGER from anon;
revoke all on table $LEDGER from authenticated;
SQL

applied="$(run_sql --tuples-only --no-align -c "select version from $LEDGER")"

pending=()
for file in "$MIGRATIONS_DIR"/*.sql; do
  [[ -e "$file" ]] || continue
  base="$(basename "$file" .sql)"
  version="${base%%_*}"
  if grep -qxF "$version" <<<"$applied"; then continue; fi
  pending+=("$file")
done

if [[ ${#pending[@]} -eq 0 ]]; then
  echo "Ingen nye Slaids-migrasjoner. Databasen er à jour."
  exit 0
fi

echo "Migrasjoner som skal kjøres:"
for file in "${pending[@]}"; do echo "  - $(basename "$file")"; done

if [[ "$DRY_RUN" == true ]]; then
  echo "(--dry-run: ingenting ble kjørt)"
  exit 0
fi

for file in "${pending[@]}"; do
  base="$(basename "$file" .sql)"
  version="${base%%_*}"
  name="${base#*_}"
  echo "→ $base"

  # Migration and ledger row in one transaction: either both land or neither
  # does, so the ledger can never claim something that did not run.
  statement_file="$(mktemp)"
  trap 'rm -f "$statement_file"' EXIT
  {
    cat "$file"
    printf '\ninsert into %s (version, name) values (%s, %s);\n' \
      "$LEDGER" "$(printf "'%s'" "${version//\'/\'\'}")" "$(printf "'%s'" "${name//\'/\'\'}")"
  } >"$statement_file"

  run_sql --single-transaction -f "$statement_file"
  rm -f "$statement_file"
  trap - EXIT
done

echo "Ferdig. Slaids' egen migrasjonshistorikk er oppdatert; den delte er urørt."
