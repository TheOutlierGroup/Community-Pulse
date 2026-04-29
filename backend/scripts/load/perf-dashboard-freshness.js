import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = __ENV.K6_BASE_URL || 'http://127.0.0.1:3001';
const submitPath = __ENV.K6_SURVEY_SUBMIT_PATH || '/api/pulse-link/response/complete?token=replace-me';
const dashboardPath = __ENV.K6_DASHBOARD_PATH || '/api/admin/overview';
const freshnessKey = __ENV.K6_FRESHNESS_KEY || 'totalResponses';
const maxWaitSeconds = Number(__ENV.K6_MAX_WAIT_SECONDS || 90);
const targetWindowSeconds = Number(__ENV.K6_TARGET_WINDOW_SECONDS || 60);
const pollIntervalSeconds = Number(__ENV.K6_FRESHNESS_POLL_INTERVAL_SECONDS || 5);
const requireIncrease = String(__ENV.K6_FRESHNESS_REQUIRE_INCREASE || 'true').trim().toLowerCase() === 'true';
const allow429 = String(__ENV.K6_ALLOW_429 || 'false').trim().toLowerCase() === 'true';

const submitPayload = JSON.stringify({
  step1: { answers: { Q1: 3, Q2: 3, Q3: 3, Q4: 3 } },
  step2: { answers: { Q5: 3, Q6: 3, Q7: 3, Q8: 3 } },
  step3: { answers: { Q9: 3, Q10: 3, Q11: 3, Q12: 3 } },
  step4: { answers: { Q13: 3, Q14: 3, Q15: 3, Q16: 3 } },
});

function parseFreshnessValue(body) {
  if (!body || typeof body !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(body, freshnessKey)) return body[freshnessKey];
  if (body.kpis && Object.prototype.hasOwnProperty.call(body.kpis, freshnessKey)) return body.kpis[freshnessKey];
  return null;
}

function isAcceptableStatus(status) {
  if (allow429) return [200, 400, 401, 404, 409, 429].includes(status);
  return [200, 400, 401, 404, 409].includes(status);
}

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
  scenarios: {
    freshnessProbe: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '5m',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
  },
};

export default function () {
  const headers = { 'Content-Type': 'application/json' };
  if (__ENV.K6_AUTH_BEARER) headers.Authorization = `Bearer ${__ENV.K6_AUTH_BEARER}`;

  const baseline = http.get(`${baseUrl}${dashboardPath}`, { headers });
  const baselineBody = baseline.json();
  const baselineValue = parseFreshnessValue(baselineBody);

  const submitRes = http.post(`${baseUrl}${submitPath}`, submitPayload, { headers });
  const submitAccepted = isAcceptableStatus(submitRes.status);
  if (!submitAccepted) {
    check(false, {
      'freshness submit request status is acceptable': () => false,
    });
    return;
  }
  check(true, {
    'freshness submit request status is acceptable': () => true,
  });

  let reflectedWithinTarget = false;
  for (let elapsed = 0; elapsed <= maxWaitSeconds; elapsed += pollIntervalSeconds) {
    const poll = http.get(`${baseUrl}${dashboardPath}`, { headers });
    const value = parseFreshnessValue(poll.json());
    const moved =
      baselineValue != null
      && value != null
      && (requireIncrease ? value > baselineValue : value >= baselineValue);
    if (moved) {
      reflectedWithinTarget = elapsed <= targetWindowSeconds && isAcceptableStatus(poll.status);
      break;
    }
    sleep(pollIntervalSeconds);
  }

  check(reflectedWithinTarget, {
    'dashboard reflects updates within target freshness window': (ok) => ok === true,
  });
}
