import { test, expect } from '@playwright/test';
import { injectAxe, checkA11y } from 'axe-playwright';

test('login page renders required auth controls', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});

test('public pulse link handles invalid token safely', async ({ page }) => {
  await page.goto('/rhythm-engine/link/invalid-token-for-e2e');
  await expect(
    page.getByText(
      /expired|invalid|not found|could not load rhythm engine|could not start the questionnaire/i
    )
  ).toBeVisible();
});

test('a11y scan: login page has no critical axe violations', async ({ page }) => {
  await page.goto('/login');
  await injectAxe(page);
  await checkA11y(page, undefined, {
    detailedReport: true,
    detailedReportOptions: { html: true },
  });
});
