/**
 * N.5: the addition page in Chromium, against the API on an empty table. Adding stores the
 * result and the list shows it without a reload (the store invalidates the index query); a
 * field the API refuses shows its message and changes nothing.
 */
import { expect, test } from '@playwright/test';

test('adding two numbers stores the result, and the list shows it without a reload', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('No results yet.')).toBeVisible();

  await page.getByLabel('a', { exact: true }).fill('4');
  await page.getByLabel('b', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Add' }).click();

  await expect(page.getByRole('status')).toHaveText('4 + 3 = 7');
  await expect(page.getByRole('list', { name: 'Results' }).getByRole('listitem')).toHaveText(['7']);
});

test('a field the API refuses shows its message, and nothing is stored', async ({ page }) => {
  await page.goto('/');
  const results = page.getByRole('list', { name: 'Results' }).getByRole('listitem');
  await expect(results).toHaveText(['7']);

  await page.getByLabel('b', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Add' }).click();

  const a = page.getByLabel('a', { exact: true });
  await expect(a).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toContainText('expected number');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(results).toHaveText(['7']);
});
