import http from 'k6/http';
import { check } from 'k6';

const baseUrl = __ENV.K6_BASE_URL || 'http://127.0.0.1:3001';
const slugPath = __ENV.K6_SLUG_PATH || '/api/rhythm-engine-link/themes?token=replace-me';
const slugRate = Number.parseInt(__ENV.K6_SLUG_RATE || '17', 10) || 17;
const slugDuration = __ENV.K6_SLUG_DURATION || '2m';
const slugPreAllocatedVus = Number.parseInt(__ENV.K6_SLUG_PREALLOCATED_VUS || '30', 10) || 30;
const slugMaxVus = Number.parseInt(__ENV.K6_SLUG_MAX_VUS || '200', 10) || 200;
const slugP95Ms = Number.parseInt(__ENV.K6_SLUG_P95_MS || '200', 10) || 200;
const slugMaxFailRate = Number.parseFloat(__ENV.K6_SLUG_MAX_FAIL_RATE || '0.001');
const allow429 = String(__ENV.K6_ALLOW_429 || 'false').trim().toLowerCase() === 'true';

http.setResponseCallback(
  http.expectedStatuses(
    200,
    401,
    404,
    ...(allow429 ? [429] : [])
  )
);

export const options = {
  scenarios: {
    slugResolution: {
      executor: 'constant-arrival-rate',
      // k6 requires integer `rate`; ~1000 req/min becomes ~17 req/s.
      rate: slugRate,
      timeUnit: '1s',
      duration: slugDuration,
      preAllocatedVUs: slugPreAllocatedVus,
      maxVUs: slugMaxVus,
    },
  },
  thresholds: {
    http_req_duration: [`p(95)<${slugP95Ms}`],
    http_req_failed: [`rate<${Number.isFinite(slugMaxFailRate) ? slugMaxFailRate : 0.001}`],
  },
};

export default function () {
  const headers = { 'Content-Type': 'application/json' };
  if (__ENV.K6_AUTH_BEARER) headers.Authorization = `Bearer ${__ENV.K6_AUTH_BEARER}`;
  const res = http.get(`${baseUrl}${slugPath}`, { headers });
  check(res, {
    'slug endpoint status is acceptable': (r) => (
      allow429
        ? [200, 401, 404, 429].includes(r.status)
        : [200, 401, 404].includes(r.status)
    ),
  });
}
