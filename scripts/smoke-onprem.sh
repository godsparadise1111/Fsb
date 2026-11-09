#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "Missing .env" >&2; exit 1; }
set -a; source .env; set +a
: "${FSB_METRICS_TOKEN:?Set FSB_METRICS_TOKEN in .env}"
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:${API_PORT:-3001}/api}"
WEB_BASE_URL="${WEB_BASE_URL:-http://127.0.0.1:${WEB_PORT:-3000}}"
COMPOSE=(docker compose --env-file .env -f docker-compose.onprem.yml)

echo "[1/7] Compose services"
"${COMPOSE[@]}" ps
echo "[2/7] PostgreSQL readiness"
"${COMPOSE[@]}" exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
echo "[3/7] Production migration ledger and checksum verification"
"${COMPOSE[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c 'SELECT 1 FROM fsb_schema_migrations LIMIT 1;' >/dev/null
shopt -s nullglob
files=(apps/api/database/migrations/*.sql)
(("${#files[@]}" > 0)) || { echo "No SQL migration files found" >&2; exit 1; }
for file in "${files[@]}"; do
  name="$(basename "$file")"
  expected="$(sha256sum "$file" | awk '{print $1}')"
  actual=$("${COMPOSE[@]}" exec -T postgres psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT checksum FROM fsb_schema_migrations WHERE filename='$name';" | tr -d '\r')
  [[ "$actual" == "$expected" ]] || { echo "Migration missing or checksum mismatch: $name" >&2; exit 1; }
done
echo "All ${#files[@]} migration checksums match."
echo "[4/7] Production schema synchronization disabled"
sync_value=$("${COMPOSE[@]}" exec -T api printenv DB_SYNCHRONIZE | tr -d '\r')
[[ "$sync_value" == "false" ]] || { echo "DB_SYNCHRONIZE must be false in production" >&2; exit 1; }
echo "[5/7] API readiness"
curl --fail --silent --show-error "$API_BASE_URL/health/ready"
echo
echo "[6/7] Web response"
curl --fail --silent --show-error --output /dev/null --write-out 'HTTP %{http_code}\n' "$WEB_BASE_URL/"
echo "[7/7] Protected metrics endpoint"
unauth_metrics=$(curl -sS -o /dev/null -w '%{http_code}' "$API_BASE_URL/health/metrics")
[[ "$unauth_metrics" == "404" ]] || { echo "Metrics endpoint must reject unauthenticated access (got HTTP $unauth_metrics)" >&2; exit 1; }
auth_metrics=$(curl --fail --silent --show-error -H "Authorization: Bearer $FSB_METRICS_TOKEN" "$API_BASE_URL/health/metrics")
grep -q 'fsb_process_uptime_seconds' <<<"$auth_metrics" || { echo "Prometheus metrics output is missing expected process metric" >&2; exit 1; }
echo "Smoke checks passed. This does not replace authenticated tenant-isolation, load, security and backup-restore acceptance tests."
