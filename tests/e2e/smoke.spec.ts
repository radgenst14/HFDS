import { expect, test } from '@playwright/test';

// M0 placeholder smoke test (doc 17 M0; doc 15 Part A "Smoke test").
test('page loads with every UI region from doc 15 B6', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle(/HFDS Prototype/);
  for (const id of [
    'top-bar',
    'road-view',
    'cluster',
    'caption-panel',
    'checklist-panel',
    'driver-panel',
    'director-panel',
    'event-log-panel',
    'trace-panel',
  ]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
});

test('scenario picker lists the 20 presets', async ({ page }) => {
  await page.goto('./');
  const picker = page.getByTestId('scenario-picker');
  await expect(picker).toHaveAttribute('data-loaded', 'true');
  await expect(picker.locator('option')).toHaveCount(20);
  await expect(picker.locator('option').first()).toHaveText(/^S00/);
  await expect(picker.locator('option').last()).toHaveText(/^S19/);
});

test('picking a preset writes #scenario=<id> and a link opens it', async ({ page }) => {
  await page.goto('./');
  const picker = page.getByTestId('scenario-picker');
  await expect(picker).toHaveAttribute('data-loaded', 'true');
  await picker.selectOption('s13-driver-brakes');
  await expect(page).toHaveURL(/#scenario=s13-driver-brakes$/);

  await page.goto('./#scenario=s09-inattention-ignored');
  await expect(page.getByTestId('scenario-picker')).toHaveValue('s09-inattention-ignored');
});
