import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errors = new Rate('fsb_enterprise_read_errors');
const latency = new Trend('fsb_enterprise_read_latency_ms', true);
const base = (__ENV.BASE_URL || '').replace(/\/$/, '');
const token = __ENV.ACCESS_TOKEN || '';
const tenantId = __ENV.TENANT_ID || '';
const organizationId = __ENV.ORGANIZATION_ID || '';

export const options = {
  vus: Number(__ENV.VUS || 20),
  duration: __ENV.DURATION || '3m',
  thresholds: {
    fsb_enterprise_read_errors: ['rate<0.01'],
    fsb_enterprise_read_latency_ms: ['p(95)<1500'],
  },
};

export default function () {
  if (!base || !token || !organizationId) throw new Error('Set BASE_URL, ACCESS_TOKEN and ORGANIZATION_ID');
  const host = base.replace('https://', '').replace('http://', '').split('/')[0].split(':')[0].toLowerCase();
  const staging = host === 'localhost' || host === '127.0.0.1' || host === 'staging' || host.startsWith('staging.') || host.includes('.staging.') || host.startsWith('test.') || host.endsWith('.test') || host.includes('.test.');
  if (!staging) throw new Error('Refusing to load test a non-staging host');
  const headers = { Authorization: 'Bearer ' + token, ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}) };
  const paths = [
    '/tenant/dashboard/me',
    '/organizations/' + organizationId + '/units',
    '/forms?organizationId=' + encodeURIComponent(organizationId),
    '/process-definitions?organizationId=' + encodeURIComponent(organizationId),
    '/tasks/my',
    '/process-instances/my',
    '/tenant/reports/overview',
  ];
  for (const path of paths) {
    const response = http.get(base + '/api' + path, { headers, tags: { endpoint: path.split('?')[0] } });
    const ok = check(response, { 'tenant-scoped read returns 200': r => r.status === 200 });
    errors.add(!ok);
    latency.add(response.timings.duration);
  }
}
