#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'MESSAGE'
ERROR: scripts/migrate-onprem.sh is deprecated and intentionally disabled.

The legacy script wrote to a separate fsb_schema_migrations ledger. Mixing it
with scripts/ops/migrate.sh can create two competing migration histories and
can attempt to replay DDL already applied by the other runner.

Use the single guarded runner instead:
  1. Create and verify an encrypted pre-migration backup.
  2. Set DATABASE_URL to the isolated Staging database.
  3. Set FSB_MIGRATION_BACKUP_FILE to the backup archive (with its .sha256 sidecar).
  4. Run scripts/ops/migrate.sh from the repository root.
  5. Run scripts/ops/verify-staging.sh and review every result set.

No database command was executed by this deprecated entrypoint.
MESSAGE
exit 2
