#!/usr/bin/env sh
set -eu

[ -f .env ] || { echo "ERROR: .env is missing; copy .env.example and configure production values." >&2; exit 1; }
[ -s package-lock.json ] || { echo "ERROR: generate and commit the root package-lock.json before Production (sh scripts/ops/prepare-lockfile.sh)." >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker CLI is required." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: Docker Compose plugin is required." >&2; exit 1; }

# Let Compose parse the dotenv file and all required substitutions; never source .env as shell code.
node <<'NODE'
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const composeConfig = JSON.parse(execFileSync('docker', [
  'compose', '--env-file', '.env', '-f', 'compose.production.yaml', 'config', '--format', 'json',
], { encoding: 'utf8' }));
const apiEnvironment = composeConfig.services?.api?.environment ?? {};
if (apiEnvironment.NODE_ENV !== 'production') throw new Error('Production Compose API must set NODE_ENV=production.');
if (String(apiEnvironment.DB_SYNCHRONIZE) === 'true') throw new Error('Production Compose API must set DB_SYNCHRONIZE=false.');
const workerFlags = [
  'FSB_NOTIFICATION_WORKER_ENABLED',
  'FSB_REPORT_WORKER_ENABLED',
  'FSB_WORKFLOW_AUTOMATION_ENABLED',
  'FSB_WORKFLOW_RECOVERY_ENABLED',
];
const expectedWorkers = {
  api: null,
  'report-worker': 'FSB_REPORT_WORKER_ENABLED',
  'notification-worker': 'FSB_NOTIFICATION_WORKER_ENABLED',
  'workflow-automation-worker': 'FSB_WORKFLOW_AUTOMATION_ENABLED',
  'workflow-recovery-worker': 'FSB_WORKFLOW_RECOVERY_ENABLED',
};
for (const [service, enabledFlag] of Object.entries(expectedWorkers)) {
  const environment = composeConfig.services?.[service]?.environment;
  if (!environment) throw new Error('Missing Compose service: ' + service);
  for (const flag of workerFlags) {
    const expected = flag === enabledFlag ? 'true' : 'false';
    if (String(environment[flag]) !== expected) {
      throw new Error(service + ' must set ' + flag + '=' + expected + ' to prevent worker overlap.');
    }
  }
}
if (composeConfig.services?.db?.ports?.length) throw new Error('PostgreSQL must not publish a host port in Production Compose.');
for (const service of ['api', 'web']) {
  const ports = composeConfig.services?.[service]?.ports ?? [];
  if (!ports.length || ports.some(port => port.host_ip !== '127.0.0.1')) {
    throw new Error(service + ' ports must be published only on 127.0.0.1 behind the TLS reverse proxy.');
  }
}
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
const postgresPassword = required('POSTGRES_PASSWORD');
if (postgresPassword === 'change_me_locally' || postgresPassword.length < 24) fail('Replace POSTGRES_PASSWORD with at least 24 random characters.');
if (required('JWT_SECRET') === 'replace_with_a_long_random_secret_at_least_32_chars' || values.JWT_SECRET.length < 32) fail('Replace JWT_SECRET with at least 32 random characters.');
if (required('BOOTSTRAP_TOKEN') === 'replace_with_a_separate_one_time_secret' || values.BOOTSTRAP_TOKEN.length < 32) fail('Replace BOOTSTRAP_TOKEN with at least 32 random characters.');
const corsOrigins = required('CORS_ORIGINS');
if (corsOrigins.includes('*')) fail('CORS_ORIGINS must not contain wildcard origins.');
if (/localhost|127\.0\.0\.1/i.test(corsOrigins)) fail('CORS_ORIGINS must not contain local development origins in Production.');
const publicUrl = required('FSB_PUBLIC_APP_URL');
if (!publicUrl.startsWith('https://') || /example\.com|localhost|127\.0\.0\.1/i.test(publicUrl)) fail('FSB_PUBLIC_APP_URL must be a real HTTPS production URL.');
const apiUrl = required('NEXT_PUBLIC_API_URL');
if (!apiUrl.startsWith('https://') || /example\.com|localhost|127\.0\.0\.1/i.test(apiUrl)) fail('NEXT_PUBLIC_API_URL must be a real HTTPS production URL.');
const key = required('FSB_OUTBOX_ENCRYPTION_KEY');
let decoded;
if (/^[0-9a-fA-F]{64}$/.test(key)) decoded = Buffer.from(key, 'hex');
else {
  try { decoded = Buffer.from(key, 'base64'); } catch { decoded = Buffer.alloc(0); }
}
if (decoded.length !== 32) fail('FSB_OUTBOX_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars or base64).');
const smtpHost = required('FSB_SMTP_HOST');
if (/example\.com|localhost|127\.0\.0\.1/i.test(smtpHost)) fail('FSB_SMTP_HOST must point to the real SMTP provider, not an example or local host.');
const emailFrom = required('FSB_EMAIL_FROM');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailFrom) || /example\.com/i.test(emailFrom)) fail('FSB_EMAIL_FROM must be a valid non-example sender address.');
if (Boolean(values.FSB_SMTP_USER) !== Boolean(values.FSB_SMTP_PASS)) fail('Configure both SMTP username and password, or neither.');
const port = Number(values.FSB_SMTP_PORT || 587);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail('FSB_SMTP_PORT is invalid.');
if (values.FSB_SMTP_SECURE && !['true', 'false'].includes(values.FSB_SMTP_SECURE.toLowerCase())) fail('FSB_SMTP_SECURE must be true or false.');
if (values.FSB_METRICS_TOKEN && values.FSB_METRICS_TOKEN.length < 32) fail('FSB_METRICS_TOKEN must contain at least 32 characters when configured.');
// ---- Secret hygiene and abuse protection (security phase) ----
for (const [name, value] of Object.entries(values)) {
  if (/replace_with|change_me|changeme|your_?secret|password123/i.test(value)) fail(name + ' still contains a placeholder value.');
}
const secretNames = ['POSTGRES_PASSWORD', 'JWT_SECRET', 'BOOTSTRAP_TOKEN', 'FSB_OUTBOX_ENCRYPTION_KEY', 'FSB_METRICS_TOKEN'];
const secretValues = secretNames.map(name => values[name]).filter(Boolean);
if (new Set(secretValues).size !== secretValues.length) fail('POSTGRES_PASSWORD, JWT_SECRET, BOOTSTRAP_TOKEN, FSB_OUTBOX_ENCRYPTION_KEY and FSB_METRICS_TOKEN must all differ from each other.');
if (new Set(values.JWT_SECRET).size < 12) fail('JWT_SECRET has too little variety. Generate one with: openssl rand -base64 48');
if (new Set(key).size < 8) fail('FSB_OUTBOX_ENCRYPTION_KEY looks low-entropy. Generate one with: openssl rand -hex 32');
const envMode = fs.statSync('.env').mode & 0o777;
if ((envMode & 0o077) !== 0 && process.env.FSB_ALLOW_LOOSE_ENV_PERMS !== 'YES') fail('.env is readable by other users (mode ' + envMode.toString(8) + '). Run: chmod 600 .env');
let envTracked = false;
try { execFileSync('git', ['ls-files', '--error-unmatch', '.env'], { stdio: 'ignore' }); envTracked = true; } catch { /* not tracked, or git is not installed */ }
if (envTracked) fail('.env is tracked by Git. Remove it from the repository and rotate every secret it contained.');
const trustProxy = (values.FSB_TRUST_PROXY || '').trim().toLowerCase();
if (!trustProxy || trustProxy === 'true' || trustProxy === 'false' || trustProxy === '0') fail('Set FSB_TRUST_PROXY to the number of reverse-proxy hops in front of the API (usually 1). Without it every client shares the proxy IP and rate limits cannot tell users apart.');
for (const name of ['FSB_RATE_LIMIT_PER_MINUTE', 'FSB_AUTH_RATE_LIMIT_PER_MINUTE']) {
  if (values[name] && !(Number.isInteger(Number(values[name])) && Number(values[name]) >= 1)) fail(name + ' must be a positive integer.');
}
if (values.FSB_RATE_LIMIT_ENABLED === 'false') fail('FSB_RATE_LIMIT_ENABLED=false is not allowed in Production.');
process.stdout.write('Production configuration preflight passed.\n');
NODE

echo "NOTE: This preflight does not connect to SMTP, apply migrations, or prove PDF glyph rendering."
