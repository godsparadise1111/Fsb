#!/usr/bin/env sh
set -eu
umask 077

[ -f .env ] || { echo "ERROR: .env is missing." >&2; exit 1; }
[ -n "${AGE_RECIPIENT:-}" ] || { echo "ERROR: set AGE_RECIPIENT to the backup recipient public key." >&2; exit 1; }
[ "${FSB_BACKUP_QUIESCE_CONFIRMED:-}" = "YES" ] || { echo "ERROR: stop API and all workers, then set FSB_BACKUP_QUIESCE_CONFIRMED=YES before backup." >&2; exit 1; }
command -v age >/dev/null 2>&1 || { echo "ERROR: age is required on the host." >&2; exit 1; }

compose="docker compose --env-file .env -f compose.production.yaml"
root="$(pwd)"
mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

$compose exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$tmp/database.dump"
$compose run --rm -T --no-deps --entrypoint sh api -c 'tar -C "$FSB_FILE_STORAGE_PATH" -czf - .' > "$tmp/private-files.tar.gz"
archive="$tmp/fsb-$stamp.tar.gz"
encrypted="$tmp/fsb-$stamp.tar.gz.age"
(
  cd "$tmp"
  sha256sum database.dump private-files.tar.gz > SHA256SUMS
  tar -czf "$archive" database.dump private-files.tar.gz SHA256SUMS
)
# Keep the plaintext archive only inside the mode-0700 temporary directory.
age -r "$AGE_RECIPIENT" -o "$encrypted" "$archive"
rm -f "$archive"
mv "$encrypted" "backups/fsb-$stamp.tar.gz.age"
(cd backups && sha256sum "fsb-$stamp.tar.gz.age" > "fsb-$stamp.tar.gz.age.sha256")
echo "Encrypted backup created: backups/fsb-$stamp.tar.gz.age"
