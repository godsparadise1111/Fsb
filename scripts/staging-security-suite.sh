#!/usr/bin/env bash
# F-S security acceptance suite (phase 4). Runs ONLY against an isolated staging/test environment.
#
# Required:  FSB_STAGING_TESTS=true  BASE_URL=https://staging.example.test
# Role tokens (access tokens of real staging users; each check is skipped when its inputs are missing):
#   TOKEN_TENANT_ADMIN  admin of tenant A         TOKEN_ORG_ADMIN   organization admin in tenant A
#   TOKEN_UNIT_MANAGER  unit manager in tenant A  TOKEN_USER        regular member of tenant A (no admin roles)
#   TOKEN_TENANT_B      any user of tenant B
# Resource ids:
#   TENANT_A_ID TENANT_B_ID ORG_A_ID USER_A_ID FORM_VERSION_A_ID SUBMISSION_A_ID ATTACHMENT_A_ID TASK_A_ID
#   (and the *_B_ID twins for tenant B: ORG_B_ID FORM_VERSION_B_ID SUBMISSION_B_ID ATTACHMENT_B_ID TASK_B_ID USER_B_ID)
# Optional behaviours (disruptive ones are opt-in):
#   FSB_TEST_LOGIN / FSB_TEST_PASSWORD  throwaway user for the session lifecycle test (needs FSB_TEST_SESSIONS=true)
#   FSB_TEST_LOGIN_THROTTLE=true        provokes the failed-login lockout for a random identity
#   FSB_TEST_RATE_LIMIT=true            floods /api/auth/* to prove 429 (blocks this IP for about a minute; runs last)
#   FSB_EXPECT_PRODUCTION_CORS=true     asserts that an unknown Origin is not reflected
#
# Expected statuses encode the policy of permissions.guard.ts: users/roles/permissions management is platform-only.
# If that policy changes on purpose, update the expectations here in the same commit.
set -uo pipefail

: "${FSB_STAGING_TESTS:?Set FSB_STAGING_TESTS=true only in an isolated disposable staging environment}"
[[ "$FSB_STAGING_TESTS" == "true" ]] || { echo "Refusing to run outside explicit staging opt-in" >&2; exit 2; }
: "${BASE_URL:?Set BASE_URL to the staging API origin}"
command -v curl >/dev/null || { echo "curl is required" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
host="${BASE_URL#*://}"; host="${host%%/*}"; host="${host%%:*}"
case "$host" in
  localhost|127.0.0.1|staging|staging.*|*.staging.*|test.*|*.test|*.test.*) ;;
  *) echo "Refusing non-staging host. Use localhost, a staging.* host or a .test domain." >&2; exit 2 ;;
esac

API="${BASE_URL%/}/api"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
pass=0; failed=0; skipped=0
ok()   { pass=$((pass+1));   printf '  PASS  %s\n' "$1"; }
bad()  { failed=$((failed+1)); printf '  FAIL  %s\n' "$1" >&2; }
skip() { skipped=$((skipped+1)); printf '  SKIP  %s (%s)\n' "$1" "$2"; }

# status METHOD PATH TOKEN [JSON_BODY] [extra curl args...]  -> prints the HTTP status, body in $tmp/body
status() {
  local method="$1" path="$2" token="$3" body="${4:-}"; shift 4 2>/dev/null || shift $#
  local args=(-sS -o "$tmp/body" -w '%{http_code}' -X "$method" --max-time 20)
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer $token")
  # Bodies go through a file: one command-line argument is capped at 128 KB on Linux, which the oversized-body check exceeds.
  if [[ -n "$body" ]]; then printf '%s' "$body" > "$tmp/request.json"; args+=(-H 'Content-Type: application/json' --data-binary "@$tmp/request.json"); fi
  curl "${args[@]}" "$@" "$API$path" 2>/dev/null || echo 000
}

# expect NAME "regex of acceptable statuses" METHOD PATH TOKEN [BODY] [extra curl args]
expect() {
  local name="$1" accepted="$2" method="$3" path="$4" token="$5" body="${6:-}"
  shift 6 2>/dev/null || shift $#
  local code; code="$(status "$method" "$path" "$token" "$body" "$@")"
  if [[ "$code" =~ ^($accepted)$ ]]; then ok "$name -> $code"; else bad "$name -> got $code, expected $accepted"; fi
}
need() { local v; for v in "$@"; do [[ -n "${!v:-}" ]] || { echo "$v"; return 1; }; done; return 0; }
# guarded NAME "VAR1 VAR2" accepted METHOD PATH TOKEN [BODY]: skip when any variable is empty
guarded() {
  local name="$1" vars="$2"; shift 2
  local missing; missing="$(need $vars)" || { skip "$name" "set $missing"; return; }
  expect "$name" "$@"
}
b64url() { printf '%s' "$1" | base64 | tr -d '=\n' | tr '/+' '_-'; }

echo "== 1. Unauthenticated and forged credentials"
expect "GET /auth/me without token" 401 GET /auth/me ""
expect "GET /users without token" 401 GET /users ""
expect "GET /forms without token" 401 GET /forms ""
expect "GET /tenant/commercial without token" 401 GET /tenant/commercial ""
expect "garbage bearer token" 401 GET /auth/me "not.a.jwt"
none_token="$(b64url '{"alg":"none","typ":"JWT"}').$(b64url '{"sub":"00000000-0000-0000-0000-000000000000","exp":9999999999}')."
expect "alg=none token is rejected" 401 GET /auth/me "$none_token"
if [[ -n "${TOKEN_USER:-}" ]]; then
  tampered="${TOKEN_USER%?}$([[ "${TOKEN_USER: -1}" == "A" ]] && echo B || echo A)"
  expect "token with altered signature" 401 GET /auth/me "$tampered"
else skip "token with altered signature" "set TOKEN_USER"; fi
expect "login rejects unknown fields (mass assignment)" 400 POST /auth/login "" '{"username":"nobody@test.invalid","password":"wrong-password-1","isAdmin":true}'
expect "login rejects an empty body" 400 POST /auth/login "" '{}'
big="$(head -c 300000 /dev/zero | tr '\0' 'a')"
expect "oversized JSON body is refused" "413|400" POST /auth/login "" "{\"username\":\"$big\",\"password\":\"x\"}"

echo "== 2. Role matrix (admin, org admin, unit manager, regular user)"
for role in TENANT_ADMIN ORG_ADMIN UNIT_MANAGER USER; do
  var="TOKEN_$role"
  guarded "$role can read its own profile" "$var" 200 GET /auth/me "${!var:-}"
done
for role in TENANT_ADMIN ORG_ADMIN UNIT_MANAGER USER; do
  var="TOKEN_$role"
  guarded "$role cannot create users" "$var" 403 POST /users "${!var:-}" '{"firstName":"Probe","lastName":"Probe","email":"probe@staging.test","username":"probe.user","password":"Probe-Password-1234"}'
  guarded "$role cannot create roles" "$var" 403 POST /roles "${!var:-}" '{"code":"PROBE_ROLE","name":"Probe"}'
  guarded "$role cannot create permissions" "$var" 403 POST /permissions "${!var:-}" '{"code":"probe.all","name":"Probe"}'
  guarded "$role cannot list permissions" "$var" 403 GET /permissions "${!var:-}"
done
guarded "regular user cannot list organization users" "TOKEN_USER ORG_A_ID" 403 GET "/organizations/${ORG_A_ID:-x}/users" "${TOKEN_USER:-}"
guarded "tenant admin can list organization users (positive control)" "TOKEN_TENANT_ADMIN ORG_A_ID" 200 GET "/organizations/${ORG_A_ID:-x}/users" "${TOKEN_TENANT_ADMIN:-}"
guarded "regular user cannot read form submissions" "TOKEN_USER FORM_VERSION_A_ID" 403 GET "/forms/versions/${FORM_VERSION_A_ID:-x}/submissions" "${TOKEN_USER:-}"
guarded "regular user cannot export submissions" "TOKEN_USER FORM_VERSION_A_ID" 403 GET "/forms/versions/${FORM_VERSION_A_ID:-x}/submissions/export.csv" "${TOKEN_USER:-}"
guarded "regular user cannot grant roles" "TOKEN_USER USER_A_ID" "403" POST /user-roles "${TOKEN_USER:-}" "{\"userId\":\"${USER_A_ID:-x}\",\"roleId\":\"00000000-0000-0000-0000-000000000001\"}"
guarded "unit manager cannot deactivate users" "TOKEN_UNIT_MANAGER USER_A_ID" 403 PATCH "/users/${USER_A_ID:-x}/active" "${TOKEN_UNIT_MANAGER:-}" '{"isActive":false}'

echo "== 3. Tenant isolation (both directions)"
isolation() { # attacker_token_var victim_suffix label
  local tv="$1" sfx="$2" label="$3"
  local tok="${!tv:-}" org="ORG_${sfx}_ID" fv="FORM_VERSION_${sfx}_ID" sub="SUBMISSION_${sfx}_ID" att="ATTACHMENT_${sfx}_ID" tsk="TASK_${sfx}_ID" usr="USER_${sfx}_ID"
  guarded "$label: organization users" "$tv $org" "403|404" GET "/organizations/${!org:-x}/users" "$tok"
  guarded "$label: form submissions" "$tv $fv" "403|404" GET "/forms/versions/${!fv:-x}/submissions" "$tok"
  guarded "$label: submissions CSV export" "$tv $fv" "403|404" GET "/forms/versions/${!fv:-x}/submissions/export.csv" "$tok"
  guarded "$label: attachment list" "$tv $fv $sub" "403|404" GET "/forms/versions/${!fv:-x}/submissions/${!sub:-x}/attachments" "$tok"
  guarded "$label: attachment download" "$tv $fv $sub $att" "403|404" GET "/forms/versions/${!fv:-x}/submissions/${!sub:-x}/attachments/${!att:-x}/download" "$tok"
  guarded "$label: task history" "$tv $tsk" "403|404" GET "/workflow/tasks/${!tsk:-x}/history" "$tok"
  guarded "$label: deactivate user" "$tv $usr" "403|404" PATCH "/users/${!usr:-x}/active" "$tok" '{"isActive":false}'
  if need "$tv" "$usr" >/dev/null; then
    code="$(status GET "/users/${!usr}/positions" "$tok" "")"
    if [[ "$code" =~ ^(403|404)$ ]]; then ok "$label: user positions -> $code"
    elif [[ "$code" == "200" && "$(jq -c 'if type=="array" then length else -1 end' "$tmp/body")" == "0" ]]; then ok "$label: user positions -> 200 with an empty list"
    else bad "$label: user positions -> got $code with data"; fi
  else skip "$label: user positions" "set $tv $usr"; fi
}
isolation TOKEN_TENANT_B A "tenant B -> tenant A"
isolation TOKEN_TENANT_ADMIN B "tenant A admin -> tenant B"
guarded "X-Tenant-Id spoof by a tenant A admin" "TOKEN_TENANT_ADMIN TENANT_B_ID" "401|403" GET /forms "${TOKEN_TENANT_ADMIN:-}" "" -H "X-Tenant-Id: ${TENANT_B_ID:-x}"

echo "== 4. Input hardening"
guarded "non-UUID form version id" "TOKEN_TENANT_ADMIN" "400|403|404" GET "/forms/versions/not-a-uuid/submissions" "${TOKEN_TENANT_ADMIN:-}"
guarded "SQL-looking form version id" "TOKEN_TENANT_ADMIN" "400|403|404" GET "/forms/versions/%27%20OR%201%3D1--/submissions" "${TOKEN_TENANT_ADMIN:-}"
guarded "path traversal in attachment id" "TOKEN_TENANT_ADMIN FORM_VERSION_A_ID SUBMISSION_A_ID" "400|403|404" GET "/forms/versions/${FORM_VERSION_A_ID:-x}/submissions/${SUBMISSION_A_ID:-x}/attachments/..%2f..%2f..%2fetc%2fpasswd/download" "${TOKEN_TENANT_ADMIN:-}"
guarded "non-UUID user id on positions" "TOKEN_TENANT_ADMIN" "400|403|404" GET "/users/not-a-uuid/positions" "${TOKEN_TENANT_ADMIN:-}"

echo "== 5. Response headers and CORS"
curl -sSI --max-time 20 "$API/health" -o "$tmp/headers" 2>/dev/null || true
hdr() { grep -i "^$1:" "$tmp/headers" | head -1 | tr -d '\r'; }
[[ -s "$tmp/headers" ]] || skip "response headers" "could not fetch $API/health"
if [[ -s "$tmp/headers" ]]; then
  hdr x-content-type-options | grep -qi nosniff && ok "X-Content-Type-Options: nosniff" || bad "X-Content-Type-Options missing"
  hdr x-frame-options | grep -qi deny && ok "X-Frame-Options: DENY" || bad "X-Frame-Options missing"
  hdr cache-control | grep -qi no-store && ok "Cache-Control: no-store" || bad "Cache-Control: no-store missing"
  hdr content-security-policy | grep -qi "frame-ancestors" && ok "Content-Security-Policy present" || bad "Content-Security-Policy missing"
  [[ -z "$(hdr x-powered-by)" ]] && ok "X-Powered-By is not advertised" || bad "X-Powered-By leaks the framework"
  if [[ "$BASE_URL" == https://* ]]; then hdr strict-transport-security | grep -qi max-age && ok "HSTS present" || bad "HSTS missing on HTTPS"; else skip "HSTS" "BASE_URL is not https"; fi
fi
if [[ "${FSB_EXPECT_PRODUCTION_CORS:-}" == "true" ]]; then
  curl -sSI --max-time 20 -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET' "$API/auth/me" -o "$tmp/cors" 2>/dev/null || true
  grep -qi 'access-control-allow-origin: https://evil.example' "$tmp/cors" && bad "CORS reflects an untrusted origin" || ok "CORS does not reflect an untrusted origin"
else skip "CORS origin check" "set FSB_EXPECT_PRODUCTION_CORS=true"; fi

echo "== 6. Session lifecycle (refresh rotation, reuse detection, logout)"
if [[ "${FSB_TEST_SESSIONS:-}" == "true" && -n "${FSB_TEST_LOGIN:-}" && -n "${FSB_TEST_PASSWORD:-}" ]]; then
  login_body="$(jq -nc --arg u "$FSB_TEST_LOGIN" --arg p "$FSB_TEST_PASSWORD" '{username:$u,password:$p}')"
  code="$(status POST /auth/login "" "$login_body")"
  if [[ "$code" =~ ^(200|201)$ ]]; then
    access0="$(jq -r .accessToken "$tmp/body")"; refresh0="$(jq -r .refreshToken "$tmp/body")"
    [[ "$refresh0" != "null" && -n "$refresh0" ]] && ok "login returns a refresh token" || bad "login returned no refresh token"
    expect "access token works after login" 200 GET /auth/me "$access0"
    code="$(status POST /auth/refresh "" "$(jq -nc --arg t "$refresh0" '{refreshToken:$t}')")"
    if [[ "$code" =~ ^(200|201)$ ]]; then
      access1="$(jq -r .accessToken "$tmp/body")"; refresh1="$(jq -r .refreshToken "$tmp/body")"
      [[ "$refresh1" != "$refresh0" ]] && ok "refresh rotates the refresh token" || bad "refresh token was not rotated"
      echo "  ...waiting 12s so the reuse is outside the double-submit grace window"; sleep 12
      expect "reusing a rotated refresh token is rejected" 401 POST /auth/refresh "" "$(jq -nc --arg t "$refresh0" '{refreshToken:$t}')"
      expect "reuse revokes the whole session (newest refresh token)" 401 POST /auth/refresh "" "$(jq -nc --arg t "$refresh1" '{refreshToken:$t}')"
      expect "reuse revokes the session's access token" 401 GET /auth/me "$access1"
    else bad "refresh failed with HTTP $code"; fi
    code="$(status POST /auth/login "" "$login_body")"
    if [[ "$code" =~ ^(200|201)$ ]]; then
      access2="$(jq -r .accessToken "$tmp/body")"; refresh2="$(jq -r .refreshToken "$tmp/body")"
      expect "logout succeeds" "200|201" POST /auth/logout "$access2" "$(jq -nc --arg t "$refresh2" '{refreshToken:$t}')"
      expect "access token is dead after logout" 401 GET /auth/me "$access2"
      expect "refresh token is dead after logout" 401 POST /auth/refresh "" "$(jq -nc --arg t "$refresh2" '{refreshToken:$t}')"
    else bad "second login failed with HTTP $code"; fi
  else bad "test user login failed with HTTP $code"; fi
else skip "session lifecycle" "set FSB_TEST_SESSIONS=true FSB_TEST_LOGIN FSB_TEST_PASSWORD"; fi

echo "== 7. Brute-force protection"
if [[ "${FSB_TEST_LOGIN_THROTTLE:-}" == "true" ]]; then
  probe="lockout-probe-$RANDOM$RANDOM@staging.test"; codes=""
  for _ in 1 2 3 4 5 6; do codes="$codes $(status POST /auth/login "" "$(jq -nc --arg u "$probe" '{username:$u,password:"wrong-password-1"}')")"; done
  [[ "$codes" == " 401 401 401 401 401 429" ]] && ok "6th failed sign-in is locked out (429)" || bad "unexpected status sequence:$codes"
else skip "failed-login lockout" "set FSB_TEST_LOGIN_THROTTLE=true"; fi
if [[ "${FSB_TEST_RATE_LIMIT:-}" == "true" ]]; then
  limit="${FSB_AUTH_RATE_LIMIT_PER_MINUTE:-120}"; seen429=0; retry=""
  for _ in $(seq 1 $((limit + 20))); do
    code="$(status GET /auth/me "" "")"
    if [[ "$code" == "429" ]]; then seen429=1; break; fi
  done
  [[ $seen429 -eq 1 ]] && ok "auth endpoints answer 429 under flood" || bad "no 429 after $((limit + 20)) requests"
else skip "API flood rate limit" "set FSB_TEST_RATE_LIMIT=true (blocks this IP for ~1 minute)"; fi

echo
echo "Summary: $pass passed, $failed failed, $skipped skipped"
[[ $failed -eq 0 ]] || exit 1
