#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "Missing .env" >&2; exit 1; }
set -a; source .env; set +a
: "${AGE_RECIPIENT:?Set AGE_RECIPIENT}"
: "${BACKUP_DIR:=./backups}"
command -v age >/dev/null || { echo "Install age before creating encrypted backups" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
docker compose --env-file .env -f docker-compose.onprem.yml exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$tmp/database.dump"
docker compose --env-file .env -f docker-compose.onprem.yml exec -T api tar -czf - -C /var/fsb/private-files . > "$tmp/private-files.tar.gz"
age -r "$AGE_RECIPIENT" -o "$BACKUP_DIR/fsb-$stamp-database.dump.age" "$tmp/database.dump"
age -r "$AGE_RECIPIENT" -o "$BACKUP_DIR/fsb-$stamp-private-files.tar.gz.age" "$tmp/private-files.tar.gz"
(cd "$BACKUP_DIR" && sha256sum "fsb-$stamp-database.dump.age" "fsb-$stamp-private-files.tar.gz.age" > "fsb-$stamp.sha256")
echo "Encrypted backup created: $BACKUP_DIR/fsb-$stamp-*"
