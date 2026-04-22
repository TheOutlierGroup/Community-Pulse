import http from 'k6/http';
import { check } from 'k6';

const baseUrl = __ENV.K6_BASE_URL || 'http://127.0.0.1:3001';
const submitPath = __ENV.K6_SURVEY_SUBMIT_PATH || '/api/pulse-link/response/complete?token=replace-me';
const url = `${baseUrl}${submitPath}`;

const payload = JSON.stringify({
  step1: { answers: { Q1: 3, Q2: 3, Q3: 3, Q4: 3 } },
  step2: { answers: { Q5: 3, Q6: 3, Q7: 3, Q8: 3 } },
  step3: { answers: { Q9: 3, Q10: 3, Q11: 3, Q12: 3 } },
  step4: { answers: { Q13: 3, Q14: 3, Q15: 3, Q16: 3 } },
});

const authHeader = __ENV.K6_AUTH_BEARER ? { Authorization: `Bearer ${__ENV.K6_AUTH_BEARER}` } : {};

export const options = {
  stages: [
    { duration: '60s', target: 500 },
    { duration: '60s', target: 500 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(95)<500'],
  },
};

export default function () {
  const res = http.post(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
    },
  });
  check(res, {
    'submission status is success-or-validation': (r) => [200, 400, 401, 404].includes(r.status),
  });
}
