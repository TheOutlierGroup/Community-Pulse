import { test, expect } from '@playwright/test';

function json(route, payload, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

test('overview report modal generates and downloads report', async ({ page }) => {
  const capturedGeneratePayloads = [];

  await page.addInitScript(() => {
    sessionStorage.setItem('pulse_token', 'e2e-token');
  });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    if (path === '/api/auth/me' && method === 'GET') {
      return json(route, {
        id: 'u-platform-admin',
        role: 'admin',
        organizationKind: 'platform',
        organizationId: 'platform-org',
        email: 'platform-admin@example.com',
      });
    }

    if (path === '/api/platform/organizations/org-1' && method === 'GET') {
      return json(route, {
        organization: {
          id: 'org-1',
          name: 'Client A',
          slug: 'client-a',
          settings: { services: ['pulse'] },
          client_status: 'active',
          company_logo_filename: null,
        },
      });
    }

    if (path === '/api/platform/organizations/org-1/dashboard' && method === 'GET') {
      return json(route, {
        userCount: 12,
        totalTasks: 3,
        taskCountsByStatus: { todo: 1, working: 1, review: 0, completed: 1 },
        tasksDueThisWeek: [],
      });
    }

    if (path === '/api/platform/service-catalog' && method === 'GET') {
      return json(route, { services: [{ id: 'pulse', name: 'Rhythm Engine' }] });
    }

    if (path === '/api/platform/organizations/org-1/rhythm-engine-sessions' && method === 'GET') {
      return json(route, { sessions: [] });
    }

    if (path === '/api/reports' && method === 'GET') {
      return json(route, { reports: [] });
    }

    if (path === '/api/reports/generate' && method === 'POST') {
      const payload = req.postDataJSON();
      capturedGeneratePayloads.push(payload);
      return json(route, {
        report_id: 'report-123',
        download_url: '/api/reports/report-123',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        response_count: 17,
      });
    }

    if (path === '/api/reports/report-123' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: 'fake-report-binary',
      });
    }

    return json(route, {});
  });

  await page.goto('/platform/clients/org-1');
  await page.getByRole('button', { name: 'Generate Report' }).click();

  const dialog = page.getByRole('dialog', { name: 'Generate client report' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Assessment Stage').selectOption('mid');
  await dialog.getByLabel('Date from').fill('2026-01-01');
  await dialog.getByLabel('Date to').fill('2026-01-31');
  await dialog.getByLabel('Export format').selectOption('docx');
  await dialog.getByLabel('Programme name').fill('Project Phoenix');
  await dialog.getByLabel('Industry / sector').fill('Healthcare');
  await dialog.getByLabel('Change type').selectOption('Technology');
  await dialog.getByLabel('Programme timeline').fill('Q1 2026');
  await dialog.getByLabel('Consultant notes').fill('Watch manager capacity risk.');
  await dialog.getByRole('button', { name: 'Generate report', exact: true }).click();

  await expect(dialog.getByText('Report generated successfully.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Download report' })).toBeVisible();
  await expect(dialog.getByText('17 responses in selected range')).toBeVisible();

  await dialog.getByRole('button', { name: 'Download report' }).click();

  await expect.poll(() => capturedGeneratePayloads.length).toBe(1);
  const payload = capturedGeneratePayloads[0];
  expect(payload.stage).toBe('mid');
  expect(payload.context.programme_name).toBe('Project Phoenix');
  expect(payload.context.change_type).toBe('Technology');
  expect(payload.date_from).toBe('2026-01-01T00:00:00.000Z');
  expect(payload.date_to).toBe('2026-01-31T23:59:59.999Z');
});

test('report modal surfaces backend generation error', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('pulse_token', 'e2e-token');
  });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    if (path === '/api/auth/me' && method === 'GET') {
      return json(route, {
        id: 'u-platform-admin',
        role: 'admin',
        organizationKind: 'platform',
        organizationId: 'platform-org',
        email: 'platform-admin@example.com',
      });
    }

    if (path === '/api/platform/organizations/org-1' && method === 'GET') {
      return json(route, {
        organization: {
          id: 'org-1',
          name: 'Client A',
          slug: 'client-a',
          settings: { services: ['pulse'] },
          client_status: 'active',
          company_logo_filename: null,
        },
      });
    }

    if (path === '/api/platform/organizations/org-1/dashboard' && method === 'GET') {
      return json(route, {
        userCount: 12,
        totalTasks: 3,
        taskCountsByStatus: { todo: 1, working: 1, review: 0, completed: 1 },
        tasksDueThisWeek: [],
      });
    }

    if (path === '/api/platform/service-catalog' && method === 'GET') {
      return json(route, { services: [{ id: 'pulse', name: 'Rhythm Engine' }] });
    }

    if (path === '/api/platform/organizations/org-1/rhythm-engine-sessions' && method === 'GET') {
      return json(route, { sessions: [] });
    }

    if (path === '/api/reports' && method === 'GET') {
      return json(route, { reports: [] });
    }

    if (path === '/api/reports/generate' && method === 'POST') {
      return json(route, { error: 'Minimum 10 completed responses required' }, 400);
    }

    return json(route, {});
  });

  await page.goto('/platform/clients/org-1');
  await page.getByRole('button', { name: 'Generate Report' }).click();
  const dialog = page.getByRole('dialog', { name: 'Generate client report' });
  await dialog.getByRole('button', { name: 'Generate report', exact: true }).click();

  await expect(dialog.getByText('Minimum 10 completed responses required')).toBeVisible();
});

test('overview past reports table renders and supports download action', async ({ page }) => {
  const downloadRequests = [];

  await page.addInitScript(() => {
    sessionStorage.setItem('pulse_token', 'e2e-token');
  });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    if (path === '/api/auth/me' && method === 'GET') {
      return json(route, {
        id: 'u-platform-admin',
        role: 'admin',
        organizationKind: 'platform',
        organizationId: 'platform-org',
        email: 'platform-admin@example.com',
      });
    }

    if (path === '/api/platform/organizations/org-1' && method === 'GET') {
      return json(route, {
        organization: {
          id: 'org-1',
          name: 'Client A',
          slug: 'client-a',
          settings: { services: ['pulse'] },
          client_status: 'active',
          company_logo_filename: null,
        },
      });
    }

    if (path === '/api/platform/organizations/org-1/dashboard' && method === 'GET') {
      return json(route, {
        userCount: 12,
        totalTasks: 3,
        taskCountsByStatus: { todo: 1, working: 1, review: 0, completed: 1 },
        tasksDueThisWeek: [],
      });
    }

    if (path === '/api/platform/service-catalog' && method === 'GET') {
      return json(route, { services: [{ id: 'pulse', name: 'Rhythm Engine' }] });
    }

    if (path === '/api/platform/organizations/org-1/rhythm-engine-sessions' && method === 'GET') {
      return json(route, { sessions: [] });
    }

    if (path === '/api/reports' && method === 'GET') {
      return json(route, {
        reports: [
          {
            id: 'report-abc',
            stage: 'pre',
            format: 'docx',
            status: 'complete',
            generated_at: '2026-01-20T10:00:00.000Z',
            expires_at: '2026-02-20T10:00:00.000Z',
            response_count: 15,
            generated_by: {
              id: 'u-platform-admin',
              email: 'platform-admin@example.com',
              first_name: 'Alex',
              last_name: 'Admin',
            },
          },
        ],
      });
    }

    if (path === '/api/reports/report-abc' && method === 'GET') {
      downloadRequests.push(path);
      return route.fulfill({
        status: 200,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: 'mock-report-bytes',
      });
    }

    return json(route, {});
  });

  await page.goto('/platform/clients/org-1');

  await expect(page.getByRole('heading', { name: 'Past Reports' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Pre-Change' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'DOCX' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '15' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Alex Admin' })).toBeVisible();

  await page.getByRole('button', { name: 'Download' }).click();
  await expect.poll(() => downloadRequests.length).toBe(1);
});
