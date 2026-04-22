import { test, expect } from '@playwright/test';

function json(route, payload, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

test('overview does not render report history controls', async ({ page }) => {
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

    return json(route, {});
  });

  await page.goto('/platform/clients/org-1');
  await expect(page.getByRole('heading', { name: 'Past Reports' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Generate Report' })).toHaveCount(0);
});
