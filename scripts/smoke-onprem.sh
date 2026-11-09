#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "Missing .env" >&2; exit 1; }
set -a; source .env; set +a
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:${API_PORT:-3001}/api}"
WEB_BASE_URL="${WEB_BASE_URL:-http://127.0.0.1:${WEB_PORT:-3000}}"
COMPOSE=(docker compose --env-file .env -f docker-compose.onprem.yml)
echo "[1/5] Compose services"
"${COMPOSE[@]}" ps
echo "[2/5] PostgreSQL readiness"
"${COMPOSE[@]}" exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
echo "[3/5] Migration ledger and required baseline"
ledger=$("${COMPOSE[@]}" exec -T postgres psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM fsb_schema_migrations WHERE filename='20261107_000_core_schema_baseline.sql';" | tr -d '\r')
[[ "$ledger" == "1" ]] || { echo "Core baseline is not recorded in migration ledger" >&2; exit 1; }
echo "[4/5] API health"
curl --fail --silent --show-error "$API_BASE_URL/health/ready"
echo
echo "[5/5] Web response"
curl --fail --silent --show-error --output /dev/null --write-out 'HTTP %{http_code}\n' "$WEB_BASE_URL/"
echo "Smoke checks passed. This does not replace authenticated tenant-isolation and backup-restore acceptance tests."
