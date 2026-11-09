#!/usr/bin/env bash
set -euo pipefail

: "${FSB_STAGING_TESTS:?Set FSB_STAGING_TESTS=true only in an isolated disposable staging environment}"
[[ "$FSB_STAGING_TESTS" == "true" ]] || { echo "Refusing to run outside explicit staging opt-in" >&2; exit 2; }
: "${BASE_URL:?Set BASE_URL to the staging API origin}"
: "${TOKEN_TENANT_A:?Set a JWT for a user who belongs only to Tenant A}"
: "${TENANT_A_ID:?Set Tenant A UUID}"
: "${TENANT_B_ID:?Set Tenant B UUID}"
: "${TASK_B_ID:?Set a task UUID that belongs only to Tenant B}"
command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
case "$BASE_URL" in
  *localhost*|*127.0.0.1*|*staging*|*test*) ;;
  *) echo "Refusing non-staging host. BASE_URL must contain localhost, 127.0.0.1, staging or test." >&2; exit 2 ;;
esac

API="${BASE_URL%/}/api"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail(){ echo "FAIL: $*" >&2; exit 1; }

echo "[1/3] Verify authenticated tenant context cannot be changed with X-Tenant-Id"
status=$(curl -sS -o "$tmp/commercial.json" -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN_TENANT_A" \
  -H "X-Tenant-Id: $TENANT_B_ID" "$API/tenant/commercial")
if [[ "$status" == "200" ]]; then
  returned="$(jq -r '.tenant.id // empty' "$tmp/commercial.json")"
  [[ "$returned" == "$TENANT_A_ID" ]] || fail "Tenant A token returned data for a different tenant ($returned)"
elif [[ "$status" != "403" && "$status" != "404" ]]; then
  fail "Unexpected response for tenant context spoof attempt: HTTP $status"
fi

echo "[2/3] Verify cross-tenant workflow task history is inaccessible"
status=$(curl -sS -o "$tmp/task.json" -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN_TENANT_A" \
  "$API/workflow/tasks/$TASK_B_ID/history")
[[ "$status" == "403" || "$status" == "404" ]] || fail "Tenant A accessed Tenant B task history or received unexpected HTTP $status"

echo "[3/3] Verify tenant commercial view is bound to Tenant A without spoof header"
status=$(curl -sS -o "$tmp/commercial-a.json" -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN_TENANT_A" "$API/tenant/commercial")
[[ "$status" == "200" ]] || fail "Tenant A commercial overview returned HTTP $status"
returned="$(jq -r '.tenant.id // empty' "$tmp/commercial-a.json")"
[[ "$returned" == "$TENANT_A_ID" ]] || fail "Tenant A token resolved to unexpected tenant $returned"

echo "Basic tenant isolation smoke checks passed. This is not the full cross-resource security suite."
