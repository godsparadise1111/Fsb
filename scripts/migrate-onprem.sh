#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose --env-file .env -f docker-compose.onprem.yml)
set -a; source .env; set +a
"${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'CREATE TABLE IF NOT EXISTS fsb_schema_migrations (filename varchar(255) PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());'
shopt -s nullglob
files=(apps/api/database/migrations/*.sql)
if (("${#files[@]}" == 0)); then echo "No migration files found"; exit 1; fi
tmp_migration=""
trap '[[ -z "${tmp_migration:-}" ]] || rm -f "$tmp_migration"' EXIT
for file in "${files[@]}"; do
  name="$(basename "$file")"
  checksum="$(sha256sum "$file" | awk '{print $1}')"
  existing=$("${COMPOSE[@]}" exec -T postgres psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT checksum FROM fsb_schema_migrations WHERE filename='$name';" | tr -d '\r')
  if [[ -n "$existing" ]]; then
    if [[ "$existing" != "$checksum" ]]; then echo "Checksum mismatch for applied migration: $name" >&2; exit 1; fi
    echo "SKIP $name"; continue
  fi
  echo "APPLY $name"
  # Each migration file owns an explicit BEGIN/COMMIT. Strip only those
  # standalone transaction markers, then commit the migration and its ledger
  # row together so a crash cannot leave applied DDL without a recorded checksum.
  tmp_migration="$(mktemp)"
  {
    printf 'BEGIN;\n'
    sed -E '/^[[:space:]]*BEGIN;[[:space:]]*$/d; /^[[:space:]]*COMMIT;[[:space:]]*$/d' "$file"
    printf "\nINSERT INTO fsb_schema_migrations(filename,checksum) VALUES ('%s','%s');\nCOMMIT;\n" "$name" "$checksum"
  } > "$tmp_migration"
  "${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$tmp_migration"
  rm -f "$tmp_migration"
  tmp_migration=""
done
echo "Migration pass completed. Review the migration ledger."
