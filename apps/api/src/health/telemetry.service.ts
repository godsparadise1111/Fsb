import { Injectable } from '@nestjs/common';

type MetricRow = { count: number; durationSumMs: number; durationMaxMs: number };
@Injectable()
export class TelemetryService {
  private readonly requests = new Map<string, MetricRow>();
  private readonly startedAt = Date.now();

  record(method: string, route: string, status: number, durationMs: number) {
    const safeMethod = /^[A-Z]{1,12}$/.test(method) ? method : 'OTHER';
    const safeRoute = route.startsWith('/') ? route.slice(0, 180) : '/unknown';
    const key = `${safeMethod}| ${safeRoute}| ${Math.floor(status / 100)}xx`;
    const current = this.requests.get(key) ?? { count: 0, durationSumMs: 0, durationMaxMs: 0 };
    current.count += 1;
    current.durationSumMs += Math.max(0, durationMs);
    current.durationMaxMs = Math.max(current.durationMaxMs, durationMs);
    this.requests.set(key, current);
  }

  renderPrometheus() {
    const lines = [
      '# HELP fsb_process_uptime_seconds Process uptime in seconds',
      '# TYPE fsb_process_uptime_seconds gauge',
      `fsb_process_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`,
      '# HELP fsb_http_requests_total Completed HTTP requests grouped by method, route and status class',
      '# TYPE fsb_http_requests_total counter',
      '# HELP fsb_http_request_duration_ms_sum Total observed HTTP request duration in milliseconds',
      '# TYPE fsb_http_request_duration_ms_sum counter',
      '# HELP fsb_http_request_duration_ms_max Maximum observed HTTP request duration in milliseconds',
      '# TYPE fsb_http_request_duration_ms_max gauge',
    ];
    for (const [key, value] of this.requests) {
      const [method, route, status] = key.split('| ');
      const labels = `method="${method}",route="${route.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}",status_class="${status}"`;
      lines.push(`fsb_http_requests_total{${labels}} ${value.count}`);
      lines.push(`fsb_http_request_duration_ms_sum{${labels}} ${value.durationSumMs.toFixed(2)}`);
      lines.push(`fsb_http_request_duration_ms_max{${labels}} ${value.durationMaxMs.toFixed(2)}`);
    }
    return lines.join('\n') + '\n';
  }
}
