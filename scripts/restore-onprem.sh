#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
stamp="${1:?Usage: ./scripts/restore-onprem.sh YYYYMMDDTHHMMSSZ}"
[[ -f .env ]] || { echo "Missing .env" >&2; exit 1; }
set -a; source .env; set +a
: "${AGE_IDENTITY:?Set AGE_IDENTITY to the protected age private-key file}"
: "${BACKUP_DIR:=./backups}"
command -v age >/dev/null || { echo "Install age" >&2; exit 1; }
base="$BACKUP_DIR/fsb-$stamp"
(cd "$BACKUP_DIR" && sha256sum -c "fsb-$stamp.sha256")
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
age -d -i "$AGE_IDENTITY" -o "$tmp/database.dump" "$base-database.dump.age"
age -d -i "$AGE_IDENTITY" -o "$tmp/private-files.tar.gz" "$base-private-files.tar.gz.age"
echo "WARNING: this replaces the current database and private-file volume."
read -r -p "Type RESTORE to continue: " confirmation
[[ "$confirmation" == "RESTORE" ]] || { echo "Restore cancelled"; exit 1; }
docker compose --env-file .env -f docker-compose.onprem.yml --profile workers stop api web worker || true
docker compose --env-file .env -f docker-compose.onprem.yml up -d postgres
docker compose --env-file .env -f docker-compose.onprem.yml exec -T postgres pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$tmp/database.dump"
docker compose --env-file .env -f docker-compose.onprem.yml run --rm -T --no-deps api sh -c 'find /var/fsb/private-files -mindepth 1 -delete && tar -xzf - -C /var/fsb/private-files' < "$tmp/private-files.tar.gz"
docker compose --env-file .env -f docker-compose.onprem.yml --profile workers up -d
docker compose --env-file .env -f docker-compose.onprem.yml ps
