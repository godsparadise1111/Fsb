#!/usr/bin/env bash
set -euo pipefail

[[ "${FSB_STAGING_TESTS:-}" == "true" && "${TEST_FIXTURE_CONFIRMED:-}" == "true" ]] || {
  echo "Set FSB_STAGING_TESTS=true and TEST_FIXTURE_CONFIRMED=true for a disposable workflow fixture" >&2
  exit 2
}
: "${BASE_URL:?Set BASE_URL to isolated staging API origin}"
: "${ACCESS_TOKEN:?Set ACCESS_TOKEN for the assigned test user}"
: "${TEST_TASK_ID:?Set TEST_TASK_ID to a disposable active task assigned to ACCESS_TOKEN}"
: "${IDEMPOTENCY_KEY:?Set the same key used by workflow-idempotency.k6.js}"
command -v curl >/dev/null
command -v jq >/dev/null
[[ "$IDEMPOTENCY_KEY" =~ ^[A-Za-z0-9._:-]{16,128}$ ]] || { echo "Invalid IDEMPOTENCY_KEY" >&2; exit 2; }
host="${BASE_URL#*://}"; host="${host%%/*}"; host="${host%%:*}"
case "$host" in localhost|127.0.0.1|staging|staging.*|*.staging.*|test.*|*.test|*.test.*) ;; *) echo "Refusing non-staging host" >&2; exit 2 ;; esac
url="${BASE_URL%/}/api/tasks/$TEST_TASK_ID/actions"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
headers=(-H "Authorization: Bearer $ACCESS_TOKEN" -H 'Content-Type: application/json' -H "Idempotency-Key: $IDEMPOTENCY_KEY")
body='{"action":"APPROVED","comment":"Concurrent idempotency acceptance test"}'

first="$(curl -sS -o "$tmp/first.json" -w '%{http_code}' -X POST "$url" "${headers[@]}" --data "$body")"
[[ "$first" == "200" || "$first" == "201" ]] || { echo "Initial/replayed idempotent action failed: HTTP $first" >&2; cat "$tmp/first.json" >&2; exit 1; }
second="$(curl -sS -o "$tmp/second.json" -w '%{http_code}' -X POST "$url" "${headers[@]}" --data "$body")"
[[ "$second" == "200" || "$second" == "201" ]] || { echo "Identical replay failed: HTTP $second" >&2; cat "$tmp/second.json" >&2; exit 1; }
jq -S . "$tmp/first.json" > "$tmp/first.sorted.json"
jq -S . "$tmp/second.json" > "$tmp/second.sorted.json"
cmp -s "$tmp/first.sorted.json" "$tmp/second.sorted.json" || {
  echo "FAIL: replay response differs from the originally committed response" >&2
  diff -u "$tmp/first.sorted.json" "$tmp/second.sorted.json" >&2 || true
  exit 1
}

conflict="$(curl -sS -o "$tmp/conflict.json" -w '%{http_code}' -X POST "$url" "${headers[@]}" --data '{"action":"REJECTED","comment":"Conflicting payload must not execute"}')"
[[ "$conflict" == "409" ]] || { echo "Expected HTTP 409 for reused key with different payload; received HTTP $conflict" >&2; cat "$tmp/conflict.json" >&2; exit 1; }

echo "Workflow idempotency acceptance passed: concurrent duplicate, stable replay response and conflicting-payload rejection."
