const baseUrl = String(process.env.K6_BASE_URL || process.env.PERF_BASE_URL || '').replace(/\/$/, '');
const authToken = String(process.env.K6_AUTH_BEARER || process.env.PERF_TOKEN || '');
const submitPath = String(process.env.K6_SURVEY_SUBMIT_PATH || '');
const dashboardPath = String(process.env.K6_DASHBOARD_PATH || '');

if (!baseUrl || !submitPath || !dashboardPath) {
  console.error('Missing K6_BASE_URL/PERF_BASE_URL, K6_SURVEY_SUBMIT_PATH, or K6_DASHBOARD_PATH');
  process.exit(1);
}

function headers(withAuth = true) {
  const baseHeaders = { 'Content-Type': 'application/json' };
  if (withAuth && authToken) {
    return { ...baseHeaders, Authorization: `Bearer ${authToken}` };
  }
  return baseHeaders;
}

async function request(path, method = 'GET', body = undefined, withAuth = true) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: headers(withAuth),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  return { status: res.status, body: parsed };
}

function row(name, passed, detail) {
  const marker = passed ? 'PASS' : 'FAIL';
  console.log(`${marker.padEnd(5)} | ${name.padEnd(40)} | ${detail}`);
}

function isControlledStatus(status) {
  return [200, 400, 401, 403, 404, 409, 429].includes(status);
}

async function main() {
  console.log('Token misuse and input abuse smoke checks');
  console.log(`Base URL: ${baseUrl}`);
  console.log('');

  let failed = 0;
  let total = 0;

  const missingAuthDashboard = await request(dashboardPath, 'GET', undefined, false);
  total += 1;
  {
    const passed = [401, 403].includes(missingAuthDashboard.status);
    row('dashboard missing auth blocked', passed, `status=${missingAuthDashboard.status}`);
    if (!passed) failed += 1;
  }

  const malformedAuthDashboard = await fetch(`${baseUrl}${dashboardPath}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer not-a-jwt' },
  });
  total += 1;
  {
    const passed = [401, 403].includes(malformedAuthDashboard.status);
    row('dashboard malformed auth blocked', passed, `status=${malformedAuthDashboard.status}`);
    if (!passed) failed += 1;
  }

  const tamperedAuthDashboard = await fetch(`${baseUrl}${dashboardPath}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${authToken}tampered` },
  });
  total += 1;
  {
    const passed = [401, 403].includes(tamperedAuthDashboard.status);
    row('dashboard tampered auth blocked', passed, `status=${tamperedAuthDashboard.status}`);
    if (!passed) failed += 1;
  }

  const invalidStepPayload = {
    step1: { answers: { Q1: 3 } },
    step2: { answers: {} },
    step3: { answers: {} },
    step4: { answers: {} },
  };
  const invalidStep = await request(submitPath, 'POST', invalidStepPayload, true);
  total += 1;
  {
    const passed = [400, 401, 409].includes(invalidStep.status);
    row('incomplete survey payload handled', passed, `status=${invalidStep.status}`);
    if (!passed) failed += 1;
  }

  const inputAbusePayload = {
    respondentCountryCode: '<script>alert(1)</script>'.repeat(10),
    privacyNoticeVersion: 'v1"><img src=x onerror=alert(1)>',
    step1: { answers: { Q1: 3, Q2: 3, Q3: 3, Q4: 3 } },
    step2: { answers: { Q5: 3, Q6: 3, Q7: 3, Q8: 3 } },
    step3: { answers: { Q9: 3, Q10: 3, Q11: 3, Q12: 3 } },
    step4: { answers: { Q13: 3, Q14: 3, Q15: 3, Q16: 3 } },
  };
  const abuseAttempt = await request(submitPath, 'POST', inputAbusePayload, true);
  total += 1;
  {
    const passed = isControlledStatus(abuseAttempt.status);
    row('abusive payload handled safely', passed, `status=${abuseAttempt.status}`);
    if (!passed) failed += 1;
  }

  const replayAttempt = await request(submitPath, 'POST', inputAbusePayload, true);
  total += 1;
  {
    const passed = [200, 400, 401, 409, 429].includes(replayAttempt.status);
    row('replay submission handled', passed, `status=${replayAttempt.status}`);
    if (!passed) failed += 1;
  }

  console.log('');
  console.log(`Checks: ${total}, Passed: ${total - failed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
