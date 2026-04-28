import http from 'k6/http';
import { check } from 'k6';

const baseUrl = __ENV.K6_BASE_URL || 'http://127.0.0.1:3001';
const slugPath = __ENV.K6_SLUG_PATH || '/api/rhythm-engine-link/themes?token=replace-me';

export const options = {
  scenarios: {
    slugResolution: {
      executor: 'constant-arrival-rate',
      // k6 requires integer `rate`; ~1000 req/min becomes ~17 req/s.
      rate: 17,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 30,
      maxVUs: 200,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.001'],
  },
};

export default function () {
  const headers = { 'Content-Type': 'application/json' };
  if (__ENV.K6_AUTH_BEARER) headers.Authorization = `Bearer ${__ENV.K6_AUTH_BEARER}`;
  const res = http.get(`${baseUrl}${slugPath}`, { headers });
  check(res, {
    'slug endpoint status is acceptable': (r) => [200, 401, 404].includes(r.status),
  });
}
