#!/usr/bin/env sh
set -eu
umask 077
export LC_ALL=C

: "\${DATABASE_URL:?Set DATABASE_URL for the target Staging database}"
: "\${FSB_MIGRATION_BACKUP_FILE:?Set FSB_MIGRATION_BACKUP_FILE to a verified pre-migration backup}"
[ -s "$FSB_MIGRATION_BACKUP_FILE" ] || { echo "ERROR: pre-migration backup is missing or empty." >&2; exit 1; }
[ -s "$FSB_MIGRATION_BACKUP_FILE.sha256" ] || { echo "ERROR: pre-migration backup checksum sidecar is missing." >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "ERROR: psql is required." >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "ERROR: sha256sum is required." >&2; exit 1; }
backup_dir="$(dirname "$FSB_MIGRATION_BACKUP_FILE")"
backup_name="$(basename "$FSB_MIGRATION_BACKUP_FILE")"
(cd "$backup_dir" && sha256sum -c "$backup_name.sha256")

migration_dir="apps/api/database/migrations"
[ -d "$migration_dir" ] || { echo "ERROR: migration directory not found: $migration_dir" >&2; exit 1; }
set -- "$migration_dir"/*.sql
[ -f "$1" ] || { echo "ERROR: no SQL migrations found." >&2; exit 1; }

if [ -n "\${FSB_MIGRATION_BASELINE:-}" ]; then
  case "$FSB_MIGRATION_BASELINE" in */* ) echo "ERROR: baseline must be a migration filename, not a path." >&2; exit 1 ;; esac
  [ "\${FSB_CONFIRM_BASELINE:-}" = "YES" ] || {
    echo "ERROR: set FSB_CONFIRM_BASELINE=YES only after verifying every migration up to the selected baseline is already applied." >&2
    exit 1
  }
  [ -f "$migration_dir/$FSB_MIGRATION_BASELINE" ] || {
    echo "ERROR: baseline migration file does not exist." >&2
    exit 1
  }
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "SELECT current_database()" >/dev/null
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c '
  CREATE TABLE IF NOT EXISTS fsb_schema_migration_ledger (
    filename text PRIMARY KEY,
    sha256 char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now(),
    baseline_recorded boolean NOT NULL DEFAULT false
  );
' >/dev/null

run_ledger_transaction() {
  file="$1"
  mode="$2"
  name="$(basename "$file")"
  case "$name" in *[!A-Za-z0-9_.-]* ) echo "ERROR: unsafe migration filename: $name" >&2; exit 1 ;; esac
  checksum="$(sha256sum "$file" | awk '{print $1}')"

  recorded_checksum="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
    "SELECT sha256 FROM fsb_schema_migration_ledger WHERE filename='$name'")"
  if [ -n "$recorded_checksum" ]; then
    [ "$recorded_checksum" = "$checksum" ] || {
      echo "ERROR: checksum mismatch for already recorded migration: $name" >&2
      exit 1
    }
    echo "Already recorded and checksum verified: $name"
    return 0
  fi

  script="$(mktemp)"
  migration_sql=""
  if [ "$mode" = "apply" ]; then
    migration_sql="$(mktemp)"
    sed -E '/^[[:space:]]*BEGIN;[[:space:]]*$/Id; /^[[:space:]]*COMMIT;[[:space:]]*$/Id' "$file" > "$migration_sql"
  fi

  {
    printf 'BEGIN;\n'
    printf "SELECT pg_advisory_xact_lock(hashtext('fsb-schema-migrations'));\n"
    printf "DO \\\$\\\$ BEGIN IF EXISTS (SELECT 1 FROM fsb_schema_migration_ledger WHERE filename='%s') THEN RAISE EXCEPTION 'migration was concurrently recorded; rerun to verify checksum'; END IF; END \\\$\\\$;\n" "$name"
    if [ "$mode" = "apply" ]; then
      printf "\\\\i '%s'\n" "$migration_sql"
      printf "INSERT INTO fsb_schema_migration_ledger(filename,sha256,baseline_recorded) VALUES ('%s','%s',false);\n" "$name" "$checksum"
      printf "SELECT 'Applied and checksummed: %s';\n" "$name"
    else
      printf "INSERT INTO fsb_schema_migration_ledger(filename,sha256,baseline_recorded) VALUES ('%s','%s',true);\n" "$name" "$checksum"
      printf "SELECT 'Baseline recorded without execution: %s';\n" "$name"
    fi
    printf 'COMMIT;\n'
  } > "$script"

  if ! psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$script"; then
    rm -f "$script"
    [ -z "$migration_sql" ] || rm -f "$migration_sql"
    echo "ERROR: migration transaction failed: $name" >&2
    exit 1
  fi
  rm -f "$script"
  [ -z "$migration_sql" ] || rm -f "$migration_sql"
}

baseline_pending=false
if [ -n "\${FSB_MIGRATION_BASELINE:-}" ]; then baseline_pending=true; fi
baseline_found=false
for file in "$migration_dir"/*.sql; do
  name="$(basename "$file")"
  if [ "$baseline_pending" = true ]; then
    run_ledger_transaction "$file" baseline
    if [ "$name" = "$FSB_MIGRATION_BASELINE" ]; then
      baseline_pending=false
      baseline_found=true
    fi
    continue
  fi
  run_ledger_transaction "$file" apply
done

if [ -n "\${FSB_MIGRATION_BASELINE:-}" ] && [ "$baseline_found" != true ]; then
  echo "ERROR: selected migration baseline was not reached in lexical order." >&2
  exit 1
fi
echo "Migration run completed. Verify schema, constraints, indexes and application compatibility in Staging."
