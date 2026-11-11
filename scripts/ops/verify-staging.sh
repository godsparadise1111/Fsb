#!/usr/bin/env bash
set -euo pipefail

[[ "${FSB_STAGING_TESTS:-}" == "true" ]] || { echo "Set FSB_STAGING_TESTS=true to run read-only acceptance checks" >&2; exit 2; }
: "${DATABASE_URL:?Set DATABASE_URL to the isolated staging database}"
command -v psql >/dev/null || { echo "psql is required" >&2; exit 2; }
command -v sha256sum >/dev/null || { echo "sha256sum is required" >&2; exit 2; }
host="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[^:]+://([^/@]+@)?([^:/?]+).*#\2#')"
case "$host" in localhost|127.0.0.1|staging|staging.*|*.staging.*|test.*|*.test|*.test.*) ;; *) echo "Refusing database host outside staging allowlist: $host" >&2; exit 2 ;; esac
root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
migration_dir="$root/apps/api/database/migrations"
ledger="fsb_schema_migration_ledger"

ledger_exists="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT to_regclass('$ledger') IS NOT NULL")"
[[ "$ledger_exists" == "t" ]] || { echo "FAIL: $ledger is missing; run the guarded migration procedure first" >&2; exit 1; }

echo "Verifying every migration file against the immutable filename/checksum ledger"
migration_count=0
for file in "$migration_dir"/*.sql; do
  [[ -f "$file" ]] || continue
  name="${file##*/}"
  checksum="$(sha256sum "$file" | awk '{print $1}')"
  recorded="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT sha256 FROM $ledger WHERE filename='$name'")"
  [[ -n "$recorded" ]] || { echo "FAIL: migration is not recorded: $name" >&2; exit 1; }
  [[ "$recorded" == "$checksum" ]] || { echo "FAIL: migration checksum mismatch: $name" >&2; exit 1; }
  migration_count=$((migration_count + 1))
done
[[ "$migration_count" -gt 0 ]] || { echo "FAIL: no migration files found" >&2; exit 1; }
recorded_count="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM $ledger")"
[[ "$recorded_count" -eq "$migration_count" ]] || {
  echo "FAIL: migration ledger has $recorded_count rows but repository has $migration_count migration files; investigate drift" >&2
  exit 1
}
echo "Migration ledger verified: $migration_count files, all SHA-256 checksums match"

for file in \
  "$root/apps/api/database/verification/tenant_identity_invariants.sql" \
  "$root/apps/api/database/verification/workflow_transactional_invariants.sql" \
  "$root/apps/api/database/verification/workflow_lifecycle_invariants.sql" \
  "$root/apps/api/database/verification/workflow_recovery_incidents.sql" \
  "$root/apps/api/database/verification/enterprise_acceptance.sql"; do
  echo "Running read-only verification: ${file##*/}"
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$file"
done
echo "Read-only enterprise database checks completed. Review every result set; expected invariant queries return zero rows."
