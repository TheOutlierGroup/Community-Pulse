import http from 'k6/http';
import { check } from 'k6';

const baseUrl = __ENV.K6_BASE_URL || 'http://127.0.0.1:3001';
const dashboardPath = __ENV.K6_DASHBOARD_PATH || '/api/admin/overview';
const submitPath = __ENV.K6_SURVEY_SUBMIT_PATH || '/api/pulse-link/response/complete?token=replace-me';
const soakVus = Number.parseInt(__ENV.K6_SOAK_VUS || '200', 10) || 200;
const soakDuration = __ENV.K6_SOAK_DURATION || '30m';
const soakSubmitRatio = Number.parseFloat(__ENV.K6_SOAK_SUBMIT_RATIO || '0.6');
const soakP95Ms = Number.parseInt(__ENV.K6_SOAK_P95_MS || '1500', 10) || 1500;
const soakMaxFailRate = Number.parseFloat(__ENV.K6_SOAK_MAX_FAIL_RATE || '0.001');
const allow429 = String(__ENV.K6_ALLOW_429 || 'false').trim().toLowerCase() === 'true';

const submitPayload = JSON.stringify({
  step1: { answers: { Q1: 3, Q2: 3, Q3: 3, Q4: 3 } },
  step2: { answers: { Q5: 3, Q6: 3, Q7: 3, Q8: 3 } },
  step3: { answers: { Q9: 3, Q10: 3, Q11: 3, Q12: 3 } },
  step4: { answers: { Q13: 3, Q14: 3, Q15: 3, Q16: 3 } },
});

http.setResponseCallback(
  http.expectedStatuses(
    200,
    400,
    401,
    403,
    404,
    ...(allow429 ? [409, 429] : [409])
  )
);

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: soakVus,
      duration: soakDuration,
    },
  },
  thresholds: {
    http_req_duration: [`p(95)<${soakP95Ms}`],
    http_req_failed: [`rate<${Number.isFinite(soakMaxFailRate) ? soakMaxFailRate : 0.001}`],
  },
};

export default function () {
  const headers = { 'Content-Type': 'application/json' };
  if (__ENV.K6_AUTH_BEARER) headers.Authorization = `Bearer ${__ENV.K6_AUTH_BEARER}`;

  const isSubmit = Math.random() < (Number.isFinite(soakSubmitRatio) ? soakSubmitRatio : 0.6);
  const url = isSubmit ? `${baseUrl}${submitPath}` : `${baseUrl}${dashboardPath}`;
  const res = isSubmit
    ? http.post(url, submitPayload, { headers })
    : http.get(url, { headers });

  check(res, {
    'soak request status is acceptable': (r) => (
      allow429
        ? [200, 400, 401, 403, 404, 409, 429].includes(r.status)
        : [200, 400, 401, 403, 404, 409].includes(r.status)
    ),
  });
}
