#!/usr/bin/env sh
set -eu

[ -f .env ] || { echo "ERROR: .env is missing; copy .env.example and configure production values." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker CLI is required." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: Docker Compose plugin is required." >&2; exit 1; }

# Let Compose parse the dotenv file and all required substitutions; never source .env as shell code.
docker compose --env-file .env -f compose.production.yaml config --quiet

node <<'NODE'
const fs = require('node:fs');
const values = {};
for (const rawLine of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, '');
  }
  values[match[1]] = value;
}
const fail = message => { process.stderr.write('ERROR: ' + message + '\n'); process.exit(1); };
const required = key => {
  if (!values[key]) fail(key + ' is required.');
  return values[key];
};
if ((values.NODE_ENV || 'production') !== 'production') fail('NODE_ENV must be production.');
if ((values.DB_SYNCHRONIZE || 'false') === 'true') fail('DB_SYNCHRONIZE=true is forbidden in production.');
if (required('POSTGRES_PASSWORD') === 'change_me_locally') fail('Replace the example PostgreSQL password.');
if (required('JWT_SECRET') === 'replace_with_a_long_random_secret_at_least_32_chars' || values.JWT_SECRET.length < 32) fail('Replace JWT_SECRET with at least 32 random characters.');
if (required('BOOTSTRAP_TOKEN') === 'replace_with_a_separate_one_time_secret' || values.BOOTSTRAP_TOKEN.length < 32) fail('Replace BOOTSTRAP_TOKEN with at least 32 random characters.');
if (required('CORS_ORIGINS').includes('*')) fail('CORS_ORIGINS must not contain wildcard origins.');
const publicUrl = required('FSB_PUBLIC_APP_URL');
if (!publicUrl.startsWith('https://')) fail('FSB_PUBLIC_APP_URL must use HTTPS.');
const apiUrl = required('NEXT_PUBLIC_API_URL');
if (!apiUrl.startsWith('https://')) fail('NEXT_PUBLIC_API_URL must use HTTPS.');
const key = required('FSB_OUTBOX_ENCRYPTION_KEY');
let decoded;
if (/^[0-9a-fA-F]{64}$/.test(key)) decoded = Buffer.from(key, 'hex');
else {
  try { decoded = Buffer.from(key, 'base64'); } catch { decoded = Buffer.alloc(0); }
}
if (decoded.length !== 32) fail('FSB_OUTBOX_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars or base64).');
required('FSB_SMTP_HOST');
required('FSB_EMAIL_FROM');
if (Boolean(values.FSB_SMTP_USER) !== Boolean(values.FSB_SMTP_PASS)) fail('Configure both SMTP username and password, or neither.');
const port = Number(values.FSB_SMTP_PORT || 587);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail('FSB_SMTP_PORT is invalid.');
process.stdout.write('Production configuration preflight passed.\n');
NODE

echo "NOTE: This preflight does not connect to SMTP, apply migrations, or prove PDF glyph rendering."
