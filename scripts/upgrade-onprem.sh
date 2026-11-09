#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "Missing .env" >&2; exit 1; }
echo "Creating encrypted database and private-file backup..."
bash ./scripts/backup-onprem.sh
echo "Building application images..."
docker compose --env-file .env -f docker-compose.onprem.yml --profile workers build
docker compose --env-file .env -f docker-compose.onprem.yml up -d postgres
bash ./scripts/migrate-onprem.sh
docker compose --env-file .env -f docker-compose.onprem.yml --profile workers up -d --remove-orphans
docker compose --env-file .env -f docker-compose.onprem.yml ps
