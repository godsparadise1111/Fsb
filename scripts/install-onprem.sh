#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then cp .env.onprem.example .env; echo "Created .env. Replace all REPLACE_* values, then rerun."; exit 1; fi
set -a; source .env; set +a
for name in POSTGRES_PASSWORD JWT_SECRET BOOTSTRAP_TOKEN FSB_OUTBOX_ENCRYPTION_KEY NEXT_PUBLIC_API_URL FSB_PUBLIC_APP_URL FSB_SMTP_HOST FSB_EMAIL_FROM AGE_RECIPIENT CORS_ORIGINS FSB_METRICS_TOKEN; do
  value="${!name:-}"
  if [[ -z "$value" || "$value" == *REPLACE_* ]]; then echo "Configure $name in .env" >&2; exit 1; fi
done
if (("${#JWT_SECRET}" < 32)); then echo "JWT_SECRET must contain at least 32 characters" >&2; exit 1; fi
if (("${#FSB_METRICS_TOKEN}" < 32)); then echo "FSB_METRICS_TOKEN must contain at least 32 characters" >&2; exit 1; fi
if [[ "$FSB_METRICS_TOKEN" == "$JWT_SECRET" || "$FSB_METRICS_TOKEN" == "$BOOTSTRAP_TOKEN" || "$FSB_METRICS_TOKEN" == "$FSB_OUTBOX_ENCRYPTION_KEY" ]]; then
  echo "FSB_METRICS_TOKEN must be independent from all application secrets" >&2; exit 1
fi
if [[ "${CORS_ORIGINS}" == *"*"* ]]; then echo "CORS_ORIGINS must not contain wildcard origins" >&2; exit 1; fi
if [[ "$CORS_ORIGINS" == *"example.com"* || "$NEXT_PUBLIC_API_URL" == *"example.com"* || "$FSB_PUBLIC_APP_URL" == *"example.com"* ]]; then
  echo "Replace all example.com URLs with real deployment domains before installation" >&2; exit 1
fi
IFS=',' read -r -a cors_origins <<< "$CORS_ORIGINS"
for origin in "${cors_origins[@]}"; do
  if [[ ! "$origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$ ]]; then
    echo "Each CORS_ORIGINS entry must be an HTTPS origin without a path: $origin" >&2; exit 1
  fi
done
[[ "$NEXT_PUBLIC_API_URL" == https://* && "$FSB_PUBLIC_APP_URL" == https://* ]] || {
  echo "Production API and app URLs must use HTTPS" >&2; exit 1;
}
if [[ ! "$FSB_OUTBOX_ENCRYPTION_KEY" =~ ^[a-fA-F0-9]{64}$ ]]; then echo "FSB_OUTBOX_ENCRYPTION_KEY must be 64 hexadecimal characters" >&2; exit 1; fi
command -v age >/dev/null || { echo "Install age before proceeding" >&2; exit 1; }
docker compose --env-file .env -f docker-compose.onprem.yml up -d postgres
for attempt in {1..60}; do
  if docker compose --env-file .env -f docker-compose.onprem.yml exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then break; fi
  if [[ "$attempt" == 60 ]]; then echo "PostgreSQL did not become ready" >&2; exit 1; fi
  sleep 2
done
bash ./scripts/migrate-onprem.sh
docker compose --env-file .env -f docker-compose.onprem.yml --profile workers up -d --build --remove-orphans
docker compose --env-file .env -f docker-compose.onprem.yml ps
