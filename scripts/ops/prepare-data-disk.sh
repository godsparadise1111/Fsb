#!/usr/bin/env bash
# Prepare isolated data directories for one F-S environment on the data disk.
# Usage: sudo bash scripts/ops/prepare-data-disk.sh production|staging
# Idempotent. Never deletes or moves data. Never touches other databases (e.g. my-postgres).
set -euo pipefail

env_name="${1:-}"
[[ "$env_name" == "production" || "$env_name" == "staging" ]] || { echo "Usage: $0 production|staging" >&2; exit 2; }
root="${FSB_DATA_ROOT:-/srv/fsb-data}"

if ! mountpoint -q "$root"; then
  if [[ "${FSB_ALLOW_UNMOUNTED:-}" != "YES" ]]; then
    echo "FAIL: $root is not a mount point. Mount the data disk first, or set FSB_ALLOW_UNMOUNTED=YES for a deliberate test run." >&2
    exit 1
  fi
  echo "WARN: $root is not a mount point; continuing because FSB_ALLOW_UNMOUNTED=YES"
fi

base="$root/$env_name"
mkdir -p "$base/postgres" "$base/private-files" "$base/backups"
# postgres:16-alpine runs as uid/gid 70; the API image runs as the node user (uid/gid 1000).
chown 70:70 "$base/postgres"
chown 1000:1000 "$base/private-files"
chown root:root "$base/backups"
chmod 700 "$base/postgres" "$base/private-files" "$base/backups"

echo "Prepared $base"
echo "  postgres      -> $(stat -c '%U:%G %a' "$base/postgres")"
echo "  private-files -> $(stat -c '%U:%G %a' "$base/private-files")"
echo "  backups       -> $(stat -c '%U:%G %a' "$base/backups")"
df -h "$base" | tail -1
echo "Next: set FSB_DATA_DIR=$base in the matching env file and add -f compose.datadisk.yaml."
