import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const failures = new Rate('fsb_workflow_idempotency_failures');
const base = (__ENV.BASE_URL || '').replace(/\/$/, '');
const token = __ENV.ACCESS_TOKEN || '';
const taskId = __ENV.TEST_TASK_ID || '';
const key = __ENV.IDEMPOTENCY_KEY || 'staging-acceptance-key-20261111';

export const options = {
  vus: Number(__ENV.VUS || 12),
  iterations: Number(__ENV.ITERATIONS || 24),
  thresholds: { fsb_workflow_idempotency_failures: ['rate<0.01'] },
};

export function setup() {
  if (__ENV.FSB_STAGING_TESTS !== 'true' || __ENV.TEST_FIXTURE_CONFIRMED !== 'true') {
    throw new Error('Set FSB_STAGING_TESTS=true and TEST_FIXTURE_CONFIRMED=true for a disposable workflow fixture');
  }
  if (!base || !token || !taskId || key.length < 16 || key.length > 128) {
    throw new Error('Set BASE_URL, ACCESS_TOKEN, TEST_TASK_ID and a 16-128 character IDEMPOTENCY_KEY');
  }
  const host = base.replace('https://', '').replace('http://', '').split('/')[0].split(':')[0].toLowerCase();
  const staging = host === 'localhost' || host === '127.0.0.1' || host === 'staging' || host.startsWith('staging.') || host.includes('.staging.') || host.startsWith('test.') || host.endsWith('.test') || host.includes('.test.');
  if (!staging) throw new Error('Refusing to mutate a non-staging host');
  return { url: base + '/api/tasks/' + taskId + '/actions' };
}

export default function (data) {
  const response = http.post(data.url, JSON.stringify({
    action: 'APPROVED',
    comment: 'Concurrent idempotency acceptance test',
  }), {
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
  });
  const isSuccess = response.status === 200 || response.status === 201;
  let hasJsonResponse = false;
  if (isSuccess) {
    try {
      const body = response.json();
      hasJsonResponse = body !== null && typeof body === 'object' && !Array.isArray(body);
    } catch (_) {
      hasJsonResponse = false;
    }
  }
  const ok = check(response, {
    'duplicate action returns a successful response': () => isSuccess,
    'idempotent replay returns a JSON object': () => hasJsonResponse,
  });
  failures.add(!ok);
}
