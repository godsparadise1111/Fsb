#!/usr/bin/env sh
set -eu

[ -f .env ] || { echo "ERROR: .env is missing; copy .env.example and configure production values." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker CLI is required." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: Docker Compose plugin is required." >&2; exit 1; }

# Compose parses .env and validates all required substitutions without printing secret values.
docker compose --env-file .env -f compose.production.yaml config --quiet

set -a
. ./.env
set +a

[ "${NODE_ENV:-production}" = "production" ] || { echo "ERROR: NODE_ENV must be production." >&2; exit 1; }
[ "${POSTGRES_PASSWORD:-}" != "change_me_locally" ] || { echo "ERROR: replace the example PostgreSQL password." >&2; exit 1; }
[ "${JWT_SECRET:-}" != "replace_with_a_long_random_secret_at_least_32_chars" ] || { echo "ERROR: replace the example JWT secret." >&2; exit 1; }
[ "${BOOTSTRAP_TOKEN:-}" != "replace_with_a_separate_one_time_secret" ] || { echo "ERROR: replace the example bootstrap token." >&2; exit 1; }
[ "${DB_SYNCHRONIZE:-false}" != "true" ] || { echo "ERROR: DB_SYNCHRONIZE=true is forbidden." >&2; exit 1; }
[ -n "${JWT_SECRET:-}" ] && [ "${#JWT_SECRET}" -ge 32 ] || { echo "ERROR: JWT_SECRET must contain at least 32 characters." >&2; exit 1; }
[ -n "${BOOTSTRAP_TOKEN:-}" ] && [ "${#BOOTSTRAP_TOKEN}" -ge 32 ] || { echo "ERROR: BOOTSTRAP_TOKEN must contain at least 32 characters." >&2; exit 1; }
[ -n "${CORS_ORIGINS:-}" ] || { echo "ERROR: CORS_ORIGINS is required." >&2; exit 1; }
case "$CORS_ORIGINS" in *\***) echo "ERROR: CORS_ORIGINS must not contain wildcard origins." >&2; exit 1 ;; esac
case "${FSB_PUBLIC_APP_URL:-}" in https://*) ;; *) echo "ERROR: FSB_PUBLIC_APP_URL must use HTTPS." >&2; exit 1 ;; esac

[ -n "${FSB_OUTBOX_ENCRYPTION_KEY:-}" ] || { echo "ERROR: FSB_OUTBOX_ENCRYPTION_KEY is required." >&2; exit 1; }
KEY="$FSB_OUTBOX_ENCRYPTION_KEY" node -e "const k=process.env.KEY;let b;if(/^[0-9a-fA-F]{64}$/.test(k))b=Buffer.from(k,'hex');else{try{b=Buffer.from(k,'base64')}catch{b=Buffer.alloc(0)}}if(b.length!==32)process.exit(1)" || {
  echo "ERROR: FSB_OUTBOX_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars or base64)." >&2
  exit 1
}

[ -n "${FSB_SMTP_HOST:-}" ] && [ -n "${FSB_EMAIL_FROM:-}" ] || { echo "ERROR: SMTP host and sender address are required." >&2; exit 1; }
if [ -n "${FSB_SMTP_USER:-}" ] || [ -n "${FSB_SMTP_PASS:-}" ]; then
  [ -n "${FSB_SMTP_USER:-}" ] && [ -n "${FSB_SMTP_PASS:-}" ] || { echo "ERROR: configure both SMTP username and password, or neither." >&2; exit 1; }
fi
[ -n "${NEXT_PUBLIC_API_URL:-}" ] || { echo "ERROR: NEXT_PUBLIC_API_URL is required." >&2; exit 1; }
case "$NEXT_PUBLIC_API_URL" in https://*) ;; *) echo "ERROR: NEXT_PUBLIC_API_URL must use HTTPS." >&2; exit 1 ;; esac

echo "Preflight passed. No database migration, SMTP connection, or PDF glyph rendering was tested."
