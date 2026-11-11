#!/usr/bin/env bash
set -euo pipefail

[[ "${FSB_STAGING_TESTS:-}" == "true" ]] || { echo "Set FSB_STAGING_TESTS=true to run read-only acceptance checks" >&2; exit 2; }
: "${DATABASE_URL:?Set DATABASE_URL to the isolated staging database}"
command -v psql >/dev/null || { echo "psql is required" >&2; exit 2; }
host="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[^:]+://([^/@]+@)?([^:/?]+).*#\2#')"
case "$host" in localhost|127.0.0.1|staging|staging.*|*.staging.*|test.*|*.test|*.test.*) ;; *) echo "Refusing database host outside staging allowlist: $host" >&2; exit 2 ;; esac
root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
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
