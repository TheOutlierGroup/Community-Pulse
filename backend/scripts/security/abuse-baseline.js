const baseUrl = String(process.env.PERF_BASE_URL || '').replace(/\/$/, '');
const token = String(process.env.PERF_TOKEN || '');
const orgId = String(process.env.PERF_ORG_ID || '');

if (!baseUrl || !token || !orgId) {
  console.error('Missing PERF_BASE_URL, PERF_TOKEN, or PERF_ORG_ID');
  process.exit(1);
}

const tasksPath = `/api/platform/organizations/${orgId}/tasks?limit=10&offset=0`;
const randomOrgPath = `/api/platform/organizations/00000000-0000-4000-8000-000000000000/tasks?limit=10&offset=0`;

async function request(path, authHeader) {
  const headers = {};
  if (authHeader) headers.Authorization = authHeader;
  const res = await fetch(`${baseUrl}${path}`, { headers });
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep string body
  }
  return { status: res.status, body };
}

function row(name, passed, detail) {
  const marker = passed ? 'PASS' : 'FAIL';
  console.log(`${marker.padEnd(5)} | ${name.padEnd(32)} | ${detail}`);
}

function statusIn(status, allowed) {
  return allowed.includes(status);
}

async function main() {
  console.log('Security abuse baseline checks');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Org ID: ${orgId}`);
  console.log('');

  let failed = 0;

  const valid = await request(tasksPath, `Bearer ${token}`);
  const validOk = statusIn(valid.status, [200]);
  row('valid token own org access', validOk, `status=${valid.status}`);
  if (!validOk) failed += 1;

  const idor = await request(randomOrgPath, `Bearer ${token}`);
  const idorBlocked = statusIn(idor.status, [401, 403, 404]);
  row('cross-org IDOR attempt blocked', idorBlocked, `status=${idor.status}`);
  if (!idorBlocked) failed += 1;

  const missing = await request(tasksPath);
  const missingBlocked = statusIn(missing.status, [401, 403]);
  row('missing token blocked', missingBlocked, `status=${missing.status}`);
  if (!missingBlocked) failed += 1;

  const tampered = await request(tasksPath, `Bearer ${token}tampered`);
  const tamperedBlocked = statusIn(tampered.status, [401, 403]);
  row('tampered token blocked', tamperedBlocked, `status=${tampered.status}`);
  if (!tamperedBlocked) failed += 1;

  const malformed = await request(tasksPath, 'Bearer not-a-jwt');
  const malformedBlocked = statusIn(malformed.status, [401, 403]);
  row('malformed token blocked', malformedBlocked, `status=${malformed.status}`);
  if (!malformedBlocked) failed += 1;

  console.log('');
  console.log(`Checks: 5, Passed: ${5 - failed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
