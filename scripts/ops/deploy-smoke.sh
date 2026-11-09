#!/usr/bin/env sh
set -eu

[ -f .env ] || { echo "ERROR: .env is missing." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker CLI is required." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is required to inspect Compose output." >&2; exit 1; }

compose() {
  docker compose --env-file .env -f compose.production.yaml "$@"
}

config="$(compose config --format json)"
API_PORT="$(printf '%s' "$config" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s);const p=(c.services.api.ports||[]).find(x=>x.target===3001);if(!p)process.exit(2);process.stdout.write(String(p.published));});")"
WEB_PORT="$(printf '%s' "$config" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const c=JSON.parse(s);const p=(c.services.web.ports||[]).find(x=>x.target===3000);if(!p)process.exit(2);process.stdout.write(String(p.published));});")"

for service in db api web report-worker notification-worker workflow-automation-worker workflow-recovery-worker; do
  if ! compose ps --status running --services | grep -Fx "$service" >/dev/null; then
    echo "ERROR: required service is not running: $service" >&2
    compose ps
    exit 1
  fi
done

curl --fail --silent --show-error "http://127.0.0.1:$API_PORT/api/health/ready" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:$WEB_PORT/" >/dev/null

migration_count="$(compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT count(*) FROM fsb_schema_migration_ledger WHERE filename IN (\$\$20261109_024_tenant_saved_reports.sql\$\$,\$\$20261109_025_report_jobs_cache_schedules.sql\$\$,\$\$20261109_026_workflow_task_reassignment_permission.sql\$\$)"' | tr -d '\r')"
[ "$migration_count" = "3" ] || {
  echo "ERROR: expected report/workflow migrations 024, 025 and 026 in the checksum ledger; found $migration_count." >&2
  exit 1
}

echo "Deployment smoke checks passed: API readiness, Web HTTP, all dedicated workers and report/workflow migration ledger."
echo "This smoke check does not replace tenant-isolation, SMTP, PDF/XLSX, workflow-path or restore acceptance tests."
