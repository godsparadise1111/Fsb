#!/usr/bin/env sh
set -eu
umask 077

[ -f .env ] || { echo "ERROR: .env is missing." >&2; exit 1; }
[ -n "${AGE_RECIPIENT:-}" ] || { echo "ERROR: set AGE_RECIPIENT to the backup recipient public key." >&2; exit 1; }
command -v age >/dev/null 2>&1 || { echo "ERROR: age is required on the host." >&2; exit 1; }

compose="docker compose --env-file .env -f compose.production.yaml"
mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

$compose exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$tmp/database.dump"
$compose exec -T api sh -c 'tar -C "$FSB_FILE_STORAGE_PATH" -czf - .' > "$tmp/private-files.tar.gz"
(
  cd "$tmp"
  sha256sum database.dump private-files.tar.gz > SHA256SUMS
  tar -czf "$OLDPWD/backups/fsb-$stamp.tar.gz" database.dump private-files.tar.gz SHA256SUMS
)
age -r "$AGE_RECIPIENT" -o "backups/fsb-$stamp.tar.gz.age" "backups/fsb-$stamp.tar.gz"
rm -f "backups/fsb-$stamp.tar.gz"
sha256sum "backups/fsb-$stamp.tar.gz.age" > "backups/fsb-$stamp.tar.gz.age.sha256"
echo "Encrypted backup created: backups/fsb-$stamp.tar.gz.age"
