#!/usr/bin/env sh
set -eu
umask 077

: "${BACKUP_FILE:?Set BACKUP_FILE to backups/fsb-<timestamp>.tar.gz.age}"
: "${AGE_IDENTITY:?Set AGE_IDENTITY to the age private identity file}"
: "${RESTORE_DATABASE:?Set RESTORE_DATABASE to a NEW isolated database name}"
[ "${ALLOW_STAGING_RESTORE:-}" = "YES" ] || { echo "ERROR: set ALLOW_STAGING_RESTORE=YES to confirm an isolated Staging restore." >&2; exit 1; }
[ -s "$BACKUP_FILE" ] || { echo "ERROR: encrypted backup is missing or empty." >&2; exit 1; }
[ -s "$BACKUP_FILE.sha256" ] || { echo "ERROR: backup checksum sidecar is missing." >&2; exit 1; }
[ -r "$AGE_IDENTITY" ] || { echo "ERROR: age identity file is not readable." >&2; exit 1; }
case "$RESTORE_DATABASE" in
  [A-Za-z_]* ) ;;
  * ) echo "ERROR: RESTORE_DATABASE must start with a letter or underscore." >&2; exit 1 ;;
esac
case "$RESTORE_DATABASE" in *[!A-Za-z0-9_]* ) echo "ERROR: RESTORE_DATABASE may contain only letters, digits and underscores." >&2; exit 1 ;; esac
[ "${#RESTORE_DATABASE}" -le 50 ] || { echo "ERROR: RESTORE_DATABASE is too long." >&2; exit 1; }
command -v age >/dev/null 2>&1 || { echo "ERROR: age is required." >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "ERROR: sha256sum is required." >&2; exit 1; }

sha256sum -c "$BACKUP_FILE.sha256"
tmp="$(mktemp -d)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
restore_subdir="restore-$stamp"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
age -d -i "$AGE_IDENTITY" "$BACKUP_FILE" > "$tmp/archive.tar.gz"
tar -xzf "$tmp/archive.tar.gz" -C "$tmp"
(
  cd "$tmp"
  sha256sum -c SHA256SUMS
)

compose="docker compose --env-file .env -f compose.production.yaml"
# Create a new database; CREATE DATABASE fails rather than overwriting an existing one.
$compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE $1"' sh "$RESTORE_DATABASE"
$compose exec -T db sh -c 'pg_restore --no-owner -U "$POSTGRES_USER" -d "$1"' sh "$RESTORE_DATABASE" < "$tmp/database.dump"
# Restore private files into a new subdirectory so the active file tree is never overwritten.
$compose exec -T api sh -c 'mkdir -p "$FSB_FILE_STORAGE_PATH/$1" && tar -xzf - -C "$FSB_FILE_STORAGE_PATH/$1"' sh "$restore_subdir" < "$tmp/private-files.tar.gz"

echo "Isolated restore completed: database=$RESTORE_DATABASE, private-files-subdirectory=$restore_subdir"
echo "The running API still uses its configured database and storage root; switch only after separate validation and explicit approval."
