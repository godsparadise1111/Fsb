#!/usr/bin/env bash
set -euo pipefail

[[ "${FSB_STAGING_TESTS:-}" == "true" ]] || { echo "Set FSB_STAGING_TESTS=true in an isolated disposable staging environment" >&2; exit 2; }
: "${BASE_URL:?Set BASE_URL to staging API origin}"
: "${TOKEN_TENANT_A:?Set Tenant A JWT}"
: "${TOKEN_TENANT_B:?Set Tenant B JWT}"
: "${TENANT_A_ID:?Set Tenant A UUID}"
: "${TENANT_B_ID:?Set Tenant B UUID}"
: "${ORG_B_ID:?Set an active organization UUID owned only by Tenant B}"
: "${PROCESS_B_ID:?Set a process definition UUID owned only by Tenant B}"
: "${FORM_B_ID:?Set a form definition UUID owned only by Tenant B}"
: "${TASK_B_ID:?Set an active workflow task UUID owned only by Tenant B}"
command -v curl >/dev/null
command -v jq >/dev/null
host="${BASE_URL#*://}"; host="${host%%/*}"; host="${host%%:*}"
case "$host" in localhost|127.0.0.1|staging|staging.*|*.staging.*|test.*|*.test|*.test.*) ;; *) echo "Refusing non-staging host" >&2; exit 2 ;; esac
API="${BASE_URL%/}/api"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
fail(){ echo "FAIL: $*" >&2; exit 1; }
request(){
  local token="$1" path="$2" output="$3"
  curl -sS -o "$output" -w '%{http_code}' -H "Authorization: Bearer $token" "$API$path"
}
expect_denied(){
  local path="$1" code
  code="$(request "$TOKEN_TENANT_A" "$path" "$tmp/denied.json")"
  [[ "$code" == "403" || "$code" == "404" ]] || fail "Tenant A accessed Tenant B resource $path (HTTP $code)"
}
expect_allowed(){
  local path="$1" code
  code="$(request "$TOKEN_TENANT_B" "$path" "$tmp/allowed.json")"
  [[ "$code" == "200" ]] || fail "Tenant B could not read its own resource $path (HTTP $code)"
}

echo "[1/6] Tenant context spoofing"
code="$(curl -sS -o "$tmp/spoof.json" -w '%{http_code}' -H "Authorization: Bearer $TOKEN_TENANT_A" -H "X-Tenant-Id: $TENANT_B_ID" "$API/tenant/commercial")"
if [[ "$code" == "200" ]]; then
  [[ "$(jq -r '.tenant.id // empty' "$tmp/spoof.json")" == "$TENANT_A_ID" ]] || fail "Tenant header changed authenticated tenant context"
elif [[ "$code" != "403" && "$code" != "404" ]]; then fail "Unexpected tenant spoof response HTTP $code"; fi

echo "[2/6] Organization boundary"
expect_denied "/organizations/$ORG_B_ID/units"
expect_allowed "/organizations/$ORG_B_ID/units"

echo "[3/6] Process definition and version boundary"
expect_denied "/process-definitions?organizationId=$ORG_B_ID"
expect_allowed "/process-definitions?organizationId=$ORG_B_ID"
expect_denied "/process-definitions/$PROCESS_B_ID/versions"
expect_allowed "/process-definitions/$PROCESS_B_ID/versions"

echo "[4/6] Form definition and version boundary"
expect_denied "/forms?organizationId=$ORG_B_ID"
expect_allowed "/forms?organizationId=$ORG_B_ID"
expect_denied "/forms/$FORM_B_ID/versions"
expect_allowed "/forms/$FORM_B_ID/versions"

echo "[5/6] Workflow task history boundary"
expect_denied "/tasks/$TASK_B_ID/history"
expect_allowed "/tasks/$TASK_B_ID/history"

echo "[6/6] Concurrent tenant-scoped read stability"
export API TOKEN_TENANT_A
seq 1 30 | xargs -P 8 -I{} sh -c '
  code=$(curl -sS -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN_TENANT_A" "$API/tenant/dashboard/me")
  [ "$code" = "200" ] || { echo "Concurrent dashboard request failed: HTTP $code" >&2; exit 1; }
'
echo "Enterprise staging acceptance smoke checks passed. This does not replace restore, SMTP, PDF, or full load drills."
