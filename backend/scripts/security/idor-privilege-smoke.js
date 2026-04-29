const baseUrl = String(process.env.PERF_BASE_URL || '').replace(/\/$/, '');
const token = String(process.env.PERF_TOKEN || '');
const orgId = String(process.env.PERF_ORG_ID || '');

if (!baseUrl || !token || !orgId) {
  console.error('Missing PERF_BASE_URL, PERF_TOKEN, or PERF_ORG_ID');
  process.exit(1);
}

const randomOrgId = '00000000-0000-4000-8000-000000000000';
const randomTaskId = '00000000-0000-4000-8000-000000000001';
const randomReportId = '00000000-0000-4000-8000-000000000002';

const checks = [
  {
    name: 'tasks own-org list',
    path: `/api/platform/organizations/${orgId}/tasks?limit=10&offset=0`,
    allowed: [200],
  },
  {
    name: 'tasks cross-org list blocked',
    path: `/api/platform/organizations/${randomOrgId}/tasks?limit=10&offset=0`,
    allowed: [401, 403, 404],
  },
  {
    name: 'task cross-org detail blocked',
    path: `/api/platform/organizations/${randomOrgId}/tasks/${randomTaskId}`,
    allowed: [401, 403, 404],
  },
  {
    name: 'reports cross-org blocked',
    path: `/api/reports?organizationId=${randomOrgId}`,
    allowed: [400, 401, 403, 404],
  },
  {
    name: 'report cross-org download-link blocked',
    path: `/api/reports/${randomReportId}/download-link?organizationId=${randomOrgId}`,
    allowed: [401, 403, 404],
  },
  {
    name: 'report cross-org page blocked',
    path: `/api/reports/${randomReportId}?organizationId=${randomOrgId}`,
    allowed: [401, 403, 404],
  },
];

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
  console.log(`${marker.padEnd(5)} | ${name.padEnd(36)} | ${detail}`);
}

async function main() {
  console.log('IDOR and privilege smoke checks');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Org ID: ${orgId}`);
  console.log('');

  let failed = 0;
  for (const check of checks) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(check.path, `Bearer ${token}`);
    const passed = check.allowed.includes(res.status);
    row(check.name, passed, `status=${res.status}`);
    if (!passed) failed += 1;
  }

  console.log('');
  console.log(`Checks: ${checks.length}, Passed: ${checks.length - failed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
