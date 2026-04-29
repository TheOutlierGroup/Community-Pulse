import http from 'k6/http';
import { check } from 'k6';

const baseUrl = __ENV.K6_BASE_URL || 'http://127.0.0.1:3001';
const dashboardPath = __ENV.K6_DASHBOARD_PATH || '/api/admin/overview';
const dashboardVus = Number.parseInt(__ENV.K6_DASHBOARD_VUS || '50', 10) || 50;
const dashboardDuration = __ENV.K6_DASHBOARD_DURATION || '60s';
const dashboardP95Ms = Number.parseInt(__ENV.K6_DASHBOARD_P95_MS || '2000', 10) || 2000;
const dashboardMaxFailRate = Number.parseFloat(__ENV.K6_DASHBOARD_MAX_FAIL_RATE || '0.001');
const allow429 = String(__ENV.K6_ALLOW_429 || 'false').trim().toLowerCase() === 'true';
const url = `${baseUrl}${dashboardPath}`;

http.setResponseCallback(
  http.expectedStatuses(
    200,
    401,
    403,
    ...(allow429 ? [429] : [])
  )
);

export const options = {
  scenarios: {
    dashboardBurst: {
      executor: 'constant-vus',
      vus: dashboardVus,
      duration: dashboardDuration,
    },
  },
  thresholds: {
    http_req_duration: [`p(95)<${dashboardP95Ms}`],
    http_req_failed: [`rate<${Number.isFinite(dashboardMaxFailRate) ? dashboardMaxFailRate : 0.001}`],
  },
};

export default function () {
  const headers = { 'Content-Type': 'application/json' };
  if (__ENV.K6_AUTH_BEARER) headers.Authorization = `Bearer ${__ENV.K6_AUTH_BEARER}`;
  const res = http.get(url, { headers });
  check(res, {
    'dashboard status is acceptable': (r) => (
      allow429
        ? [200, 401, 403, 429].includes(r.status)
        : [200, 401, 403].includes(r.status)
    ),
  });
}
