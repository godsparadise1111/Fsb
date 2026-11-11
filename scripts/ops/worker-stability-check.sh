#!/usr/bin/env bash
set -euo pipefail

[[ "${FSB_STAGING_TESTS:-}" == "true" ]] || { echo "Set FSB_STAGING_TESTS=true" >&2; exit 2; }
[[ "${FSB_WORKER_STABILITY_CHECK:-}" == "YES" ]] || { echo "Set FSB_WORKER_STABILITY_CHECK=YES after a staging load run" >&2; exit 2; }
command -v docker >/dev/null || { echo "docker is required" >&2; exit 2; }
compose_file="${COMPOSE_FILE:-compose.production.yaml}"
env_file="${ENV_FILE:-.env}"
[[ -f "$compose_file" && -f "$env_file" ]] || { echo "Compose and env files must exist in the current deployment directory" >&2; exit 2; }
max_restarts="${FSB_MAX_WORKER_RESTARTS:-0}"
[[ "$max_restarts" =~ ^[0-9]+$ ]] || { echo "FSB_MAX_WORKER_RESTARTS must be an integer" >&2; exit 2; }

services=(report-worker notification-worker workflow-automation-worker workflow-recovery-worker)
failed=0
for service in "${services[@]}"; do
  id="$(docker compose --env-file "$env_file" -f "$compose_file" ps -q "$service")"
  if [[ -z "$id" ]]; then echo "FAIL: $service has no container"; failed=1; continue; fi
  state="$(docker inspect --format '{{.State.Status}}' "$id")"
  restarts="$(docker inspect --format '{{.RestartCount}}' "$id")"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$id")"
  printf '%-32s state=%-10s health=%-16s restarts=%s\n' "$service" "$state" "$health" "$restarts"
  [[ "$state" == "running" ]] || failed=1
  [[ "$restarts" -le "$max_restarts" ]] || failed=1
  [[ "$health" == "healthy" || "$health" == "no-healthcheck" ]] || failed=1
done
if [[ "$failed" -ne 0 ]]; then echo "Worker stability check failed; inspect service logs before proceeding" >&2; exit 1; fi
echo "Worker containers are running and restart counts are within the configured threshold."
