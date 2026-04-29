import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = __ENV.K6_BASE_URL || 'http://127.0.0.1:3001';
const submitPath = __ENV.K6_SURVEY_SUBMIT_PATH || '/api/pulse-link/response/complete?token=replace-me';
const surveyStage1Duration = __ENV.K6_SURVEY_STAGE1_DURATION || '60s';
const surveyStage1Target = Number.parseInt(__ENV.K6_SURVEY_STAGE1_TARGET || '500', 10) || 500;
const surveyStage2Duration = __ENV.K6_SURVEY_STAGE2_DURATION || '60s';
const surveyStage2Target = Number.parseInt(__ENV.K6_SURVEY_STAGE2_TARGET || '500', 10) || 500;
const surveyStage3Duration = __ENV.K6_SURVEY_STAGE3_DURATION || '20s';
const surveyStage3Target = Number.parseInt(__ENV.K6_SURVEY_STAGE3_TARGET || '0', 10);
const surveyP95Ms = Number.parseInt(__ENV.K6_SURVEY_P95_MS || '500', 10) || 500;
const surveyMaxFailRate = Number.parseFloat(__ENV.K6_SURVEY_MAX_FAIL_RATE || '0.001');
const surveyIterationSleepSeconds = Number.parseFloat(__ENV.K6_SURVEY_ITERATION_SLEEP_SECONDS || '0');
const allow429 = String(__ENV.K6_ALLOW_429 || 'false').trim().toLowerCase() === 'true';
const url = `${baseUrl}${submitPath}`;

const payload = JSON.stringify({
  step1: { answers: { Q1: 3, Q2: 3, Q3: 3, Q4: 3 } },
  step2: { answers: { Q5: 3, Q6: 3, Q7: 3, Q8: 3 } },
  step3: { answers: { Q9: 3, Q10: 3, Q11: 3, Q12: 3 } },
  step4: { answers: { Q13: 3, Q14: 3, Q15: 3, Q16: 3 } },
});

const authHeader = __ENV.K6_AUTH_BEARER ? { Authorization: `Bearer ${__ENV.K6_AUTH_BEARER}` } : {};

http.setResponseCallback(
  http.expectedStatuses(
    200,
    400,
    401,
    404,
    409,
    ...(allow429 ? [429] : [])
  )
);

export const options = {
  stages: [
    { duration: surveyStage1Duration, target: surveyStage1Target },
    { duration: surveyStage2Duration, target: surveyStage2Target },
    { duration: surveyStage3Duration, target: Number.isInteger(surveyStage3Target) ? surveyStage3Target : 0 },
  ],
  thresholds: {
    http_req_failed: [`rate<${Number.isFinite(surveyMaxFailRate) ? surveyMaxFailRate : 0.001}`],
    http_req_duration: [`p(95)<${surveyP95Ms}`],
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
    'submission status is success-or-validation': (r) => (
      allow429
        ? [200, 400, 401, 404, 409, 429].includes(r.status)
        : [200, 400, 401, 404, 409].includes(r.status)
    ),
  });
  if (Number.isFinite(surveyIterationSleepSeconds) && surveyIterationSleepSeconds > 0) {
    sleep(surveyIterationSleepSeconds);
  }
}
