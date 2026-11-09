#!/usr/bin/env sh
set -eu
umask 077

: "${DATABASE_URL:?Set DATABASE_URL for the Staging database}"
: "${FSB_MIGRATION_BACKUP_FILE:?Set FSB_MIGRATION_BACKUP_FILE to a verified pre-migration backup}"
[ -s "$FSB_MIGRATION_BACKUP_FILE" ] || { echo "ERROR: backup file is missing or empty." >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "ERROR: psql is required." >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "ERROR: sha256sum is required." >&2; exit 1; }

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "SELECT 1 FROM tenants LIMIT 1" >/dev/null || {
  echo "ERROR: tenant baseline is missing; apply and verify all prerequisite migrations first." >&2
  exit 1
}
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c '
  CREATE TABLE IF NOT EXISTS fsb_report_migration_ledger (
    filename text PRIMARY KEY,
    sha256 char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
' >/dev/null

apply_one() {
  file="$1"
  name="$(basename "$file")"
  checksum="$(sha256sum "$file" | awk '{print $1}')"
  recorded="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "SELECT sha256 FROM fsb_report_migration_ledger WHERE filename='$name'")"
  if [ -n "$recorded" ]; then
    [ "$recorded" = "$checksum" ] || { echo "ERROR: checksum mismatch for already-applied $name." >&2; exit 1; }
    echo "Already applied and checksum verified: $name"
    return
  fi

  if [ "$name" = "20261109_024_tenant_saved_reports.sql" ]; then
    exists="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "SELECT to_regclass('tenant_saved_reports') IS NOT NULL")"
    [ "$exists" = "f" ] || { echo "ERROR: tenant_saved_reports exists without this script's ledger entry; reconcile manually, do not rerun." >&2; exit 1; }
  fi
  if [ "$name" = "20261109_025_report_jobs_cache_schedules.sql" ]; then
    exists="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "SELECT to_regclass('tenant_report_jobs') IS NOT NULL OR to_regclass('tenant_report_cache') IS NOT NULL OR to_regclass('tenant_report_schedules') IS NOT NULL")"
    [ "$exists" = "f" ] || { echo "ERROR: report job/cache/schedule objects exist without this script's ledger entry; reconcile manually, do not rerun." >&2; exit 1; }
  fi

  tmp="$(mktemp)"
  {
    printf "SELECT pg_advisory_xact_lock(hashtext('fsb-report-migrations'));
"
    sed -E '/^[[:space:]]*BEGIN;[[:space:]]*$/Id; /^[[:space:]]*COMMIT;[[:space:]]*$/Id' "$file"
    printf "\nINSERT INTO fsb_report_migration_ledger(filename,sha256) VALUES ('%s','%s');\n" "$name" "$checksum"
  } > "$tmp"
  if ! psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$tmp"; then
    rm -f "$tmp"
    echo "ERROR: migration failed; transaction rolled back: $name" >&2
    exit 1
  fi
  rm -f "$tmp"
  echo "Applied and checksummed: $name"
}

base="apps/api/database/migrations"
apply_one "$base/20261109_024_tenant_saved_reports.sql"
apply_one "$base/20261109_025_report_jobs_cache_schedules.sql"
echo "Report migrations completed. Verify schema, constraints, indexes and application compatibility in Staging."
