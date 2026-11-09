#!/usr/bin/env sh
set -eu
umask 077
export LC_ALL=C

: "${DATABASE_URL:?Set DATABASE_URL for the target Staging database}"
: "${FSB_MIGRATION_BACKUP_FILE:?Set FSB_MIGRATION_BACKUP_FILE to a verified pre-migration backup}"
[ -s "$FSB_MIGRATION_BACKUP_FILE" ] || { echo "ERROR: pre-migration backup is missing or empty." >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "ERROR: psql is required." >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "ERROR: sha256sum is required." >&2; exit 1; }

migration_dir="apps/api/database/migrations"
[ -d "$migration_dir" ] || { echo "ERROR: migration directory not found: $migration_dir" >&2; exit 1; }
set -- "$migration_dir"/*.sql
[ -f "$1" ] || { echo "ERROR: no SQL migrations found." >&2; exit 1; }

if [ -n "${FSB_MIGRATION_BASELINE:-}" ]; then
  [ "${FSB_CONFIRM_BASELINE:-}" = "YES" ] || {
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

record_baseline() {
  file="$1"
  name="$(basename "$file")"
  checksum="$(sha256sum "$file" | awk '{print $1}')"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
    INSERT INTO fsb_schema_migration_ledger(filename,sha256,baseline_recorded)
    VALUES ('$name','$checksum',true)
    ON CONFLICT (filename) DO NOTHING
  " >/dev/null
  recorded="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "SELECT sha256 FROM fsb_schema_migration_ledger WHERE filename='$name'")"
  [ "$recorded" = "$checksum" ] || { echo "ERROR: baseline checksum conflict for $name." >&2; exit 1; }
  echo "Baseline recorded (not executed): $name"
}

apply_one() {
  file="$1"
  name="$(basename "$file")"
  checksum="$(sha256sum "$file" | awk '{print $1}')"
  recorded="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "SELECT sha256 FROM fsb_schema_migration_ledger WHERE filename='$name'")"
  if [ -n "$recorded" ]; then
    [ "$recorded" = "$checksum" ] || { echo "ERROR: checksum mismatch for already recorded migration $name." >&2; exit 1; }
    echo "Already applied and checksum verified: $name"
    return
  fi

  tmp="$(mktemp)"
  {
    printf "SELECT pg_advisory_xact_lock(hashtext('fsb-schema-migrations'));
"
    sed -E '/^[[:space:]]*BEGIN;[[:space:]]*$/Id; /^[[:space:]]*COMMIT;[[:space:]]*$/Id' "$file"
    printf "\nINSERT INTO fsb_schema_migration_ledger(filename,sha256,baseline_recorded) VALUES ('%s','%s',false);\n" "$name" "$checksum"
  } > "$tmp"
  if ! psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$tmp"; then
    rm -f "$tmp"
    echo "ERROR: migration failed and its transaction was rolled back: $name" >&2
    exit 1
  fi
  rm -f "$tmp"
  echo "Applied and checksummed: $name"
}

baseline_pending=false
if [ -n "${FSB_MIGRATION_BASELINE:-}" ]; then baseline_pending=true; fi
baseline_found=false
for file in "$migration_dir"/*.sql; do
  name="$(basename "$file")"
  if [ "$baseline_pending" = true ]; then
    record_baseline "$file"
    if [ "$name" = "$FSB_MIGRATION_BASELINE" ]; then
      baseline_pending=false
      baseline_found=true
    fi
    continue
  fi
  apply_one "$file"
done

if [ -n "${FSB_MIGRATION_BASELINE:-}" ] && [ "$baseline_found" != true ]; then
  echo "ERROR: selected migration baseline was not reached in lexical order." >&2
  exit 1
fi
echo "Migration run completed. Verify schema, constraints, indexes and application compatibility in Staging."
