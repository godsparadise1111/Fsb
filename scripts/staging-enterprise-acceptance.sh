#!/usr/bin/env bash
set -euo pipefail

[[ "${FSB_STAGING_TESTS:-}" == "true" ]] || { echo "Set FSB_STAGING_TESTS=true in an isolated disposable staging environment" >&2; exit 2; }
: "${BASE_URL:?Set BASE_URL to staging API origin}"
: "${TOKEN_TENANT_A:?Set Tenant A administrator JWT}"
: "${TOKEN_TENANT_A_MEMBER:?Set a regular non-admin Tenant A member JWT}"
: "${TOKEN_TENANT_B:?Set Tenant B administrator JWT}"
: "${TOKEN_PLATFORM_ADMIN:?Set platform administrator JWT}"
: "${TENANT_A_ID:?Set Tenant A UUID}"
: "${TENANT_B_ID:?Set Tenant B UUID}"
: "${ORG_B_ID:?Set an active organization UUID owned only by Tenant B}"
: "${PROCESS_B_ID:?Set a process definition UUID owned only by Tenant B}"
: "${FORM_B_ID:?Set a form definition UUID owned only by Tenant B}"
: "${FORM_B_VERSION_ID:?Set a published form version UUID owned only by Tenant B}"
: "${SUBMISSION_B_ID:?Set a submission UUID owned only by Tenant B}"
: "${ATTACHMENT_B_ID:?Set a private attachment UUID owned only by Tenant B}"
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
  local token="$1" path="$2" code
  code="$(request "$token" "$path" "$tmp/denied.json")"
  [[ "$code" == "403" || "$code" == "404" ]] || fail "Expected cross-scope denial at $path; received HTTP $code"
}
expect_allowed(){
  local token="$1" path="$2" code
  code="$(request "$token" "$path" "$tmp/allowed.json")"
  [[ "$code" == "200" ]] || fail "Expected own-scope read at $path; received HTTP $code"
}
expect_no_leak(){
  local path="$1" code
  code="$(request "$TOKEN_TENANT_A" "$path" "$tmp/no-leak.json")"
  if [[ "$code" == "200" ]]; then
    [[ "$(jq 'length' "$tmp/no-leak.json")" == "0" ]] || fail "Tenant A list exposed Tenant B records at $path"
  elif [[ "$code" != "403" && "$code" != "404" ]]; then
    fail "Unexpected cross-tenant list response at $path (HTTP $code)"
  fi
}

echo "[1/8] Tenant context spoofing"
code="$(curl -sS -o "$tmp/spoof.json" -w '%{http_code}' -H "Authorization: Bearer $TOKEN_TENANT_A" -H "X-Tenant-Id: $TENANT_B_ID" "$API/tenant/commercial")"
if [[ "$code" == "200" ]]; then
  [[ "$(jq -r '.tenant.id // empty' "$tmp/spoof.json")" == "$TENANT_A_ID" ]] || fail "Tenant header changed authenticated tenant context"
elif [[ "$code" != "403" && "$code" != "404" ]]; then fail "Unexpected tenant spoof response HTTP $code"; fi

echo "[2/8] Platform and tenant administrator boundaries"
expect_allowed "$TOKEN_PLATFORM_ADMIN" "/platform/workflow-health"
expect_denied "$TOKEN_TENANT_A" "/platform/workflow-health"
expect_denied "$TOKEN_TENANT_B" "/platform/workflow-health"
expect_allowed "$TOKEN_TENANT_A" "/tenant/members"
expect_denied "$TOKEN_TENANT_A_MEMBER" "/tenant/members"
expect_allowed "$TOKEN_TENANT_A" "/tenant/audit-logs"
expect_denied "$TOKEN_TENANT_A_MEMBER" "/tenant/audit-logs"

echo "[3/8] Organization boundary"
expect_denied "$TOKEN_TENANT_A" "/organizations/$ORG_B_ID/units"
expect_allowed "$TOKEN_TENANT_B" "/organizations/$ORG_B_ID/units"

echo "[4/8] Process definition and version boundary"
expect_no_leak "/process-definitions?organizationId=$ORG_B_ID"
expect_allowed "$TOKEN_TENANT_B" "/process-definitions?organizationId=$ORG_B_ID"
expect_denied "$TOKEN_TENANT_A" "/process-definitions/$PROCESS_B_ID/versions"
expect_allowed "$TOKEN_TENANT_B" "/process-definitions/$PROCESS_B_ID/versions"

echo "[5/8] Form definition and version boundary"
expect_no_leak "/forms?organizationId=$ORG_B_ID"
expect_allowed "$TOKEN_TENANT_B" "/forms?organizationId=$ORG_B_ID"
expect_denied "$TOKEN_TENANT_A" "/forms/$FORM_B_ID/versions"
expect_allowed "$TOKEN_TENANT_B" "/forms/$FORM_B_ID/versions"

echo "[6/8] Submission, export and private attachment boundary"
expect_denied "$TOKEN_TENANT_A" "/forms/versions/$FORM_B_VERSION_ID/submissions"
expect_allowed "$TOKEN_TENANT_B" "/forms/versions/$FORM_B_VERSION_ID/submissions"
expect_denied "$TOKEN_TENANT_A" "/forms/versions/$FORM_B_VERSION_ID/submissions/$SUBMISSION_B_ID/attachments"
expect_allowed "$TOKEN_TENANT_B" "/forms/versions/$FORM_B_VERSION_ID/submissions/$SUBMISSION_B_ID/attachments"
expect_denied "$TOKEN_TENANT_A" "/forms/versions/$FORM_B_VERSION_ID/submissions/$SUBMISSION_B_ID/attachments/$ATTACHMENT_B_ID/download"
code="$(request "$TOKEN_TENANT_B" "/forms/versions/$FORM_B_VERSION_ID/submissions/$SUBMISSION_B_ID/attachments/$ATTACHMENT_B_ID/download" "$tmp/attachment.bin")"
[[ "$code" == "200" ]] || fail "Tenant B could not download its own attachment (HTTP $code)"

echo "[7/8] Workflow task history boundary"
expect_denied "$TOKEN_TENANT_A" "/tasks/$TASK_B_ID/history"
expect_allowed "$TOKEN_TENANT_B" "/tasks/$TASK_B_ID/history"

echo "[8/8] Concurrent tenant-scoped read stability"
export API TOKEN_TENANT_A
seq 1 30 | xargs -P 8 -I{} sh -c '
  code=$(curl -sS -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN_TENANT_A" "$API/tenant/dashboard/me")
  [ "$code" = "200" ] || { echo "Concurrent dashboard request failed: HTTP $code" >&2; exit 1; }
'
echo "Enterprise staging acceptance checks passed. Restore, SMTP, PDF and full load drills remain separate acceptance gates."
