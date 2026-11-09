import http from 'k6';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errors = new Rate('fsb_request_errors');
const latency = new Trend('fsb_request_latency_ms', true);
const base = (__ENV.BASE_URL || '').replace(/\/$/, '');
const token = __ENV.ACCESS_TOKEN || '';

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || '2m',
  thresholds: {
    fsb_request_errors: ['rate<0.01'],
    fsb_request_latency_ms: ['p(95)<1500'],
  },
};

export default function () {
  if (!base || !token) throw new Error('Set BASE_URL and ACCESS_TOKEN to an isolated staging environment');
  if (!/(localhost|127\\.0\\.0\\.1|staging|test)/i.test(base)) throw new Error('Refusing to load test a non-staging host');
  const response = http.get(`${base}/api/tenant/dashboard/me`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { endpoint: 'tenant_dashboard_read' },
  });
  const ok = check(response, { 'dashboard responds 200': r => r.status === 200 });
  errors.add(!ok);
  latency.add(response.timings.duration);
}
