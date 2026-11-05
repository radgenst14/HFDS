import { expect, test, type Page } from '@playwright/test';

// Doc 17 test inventory: "switch scenario (state resets, URL hash)".
const num = async (page: Page, testid: string) =>
  parseFloat((await page.getByTestId(testid).textContent()) ?? 'NaN');

test('switching scenario resets the engine and updates the hash and caption', async ({ page }) => {
  await page.goto('./#scenario=s00-sandbox');
  await expect.poll(() => num(page, 'sim-time')).toBeGreaterThan(1.5);

  await page.getByTestId('scenario-picker').selectOption('s13-driver-brakes');
  await expect(page).toHaveURL(/#scenario=s13-driver-brakes$/);
  await expect(page.locator('#caption-body')).toContainText('Driver brakes to regain control');
  await expect(page.locator('#caption-body')).toContainText('Customer Scenario 4');
  // Sim time restarted from 0 for the new preset.
  expect(await num(page, 'sim-time')).toBeLessThan(1.5);
  await expect(page.locator('#event-log-body')).toContainText('s13-driver-brakes');
});

test('Reset restarts the current preset', async ({ page }) => {
  await page.goto('./#scenario=s01-activation-success');
  await expect.poll(() => num(page, 'sim-time')).toBeGreaterThan(1.5);
  await page.locator('#btn-reset').click();
  await expect.poll(() => num(page, 'sim-time')).toBeLessThan(1.0);
});

test('an invalid hash falls back to the first preset', async ({ page }) => {
  await page.goto('./#scenario=does-not-exist');
  await expect(page.getByTestId('scenario-picker')).toHaveValue('s00-sandbox');
  await expect(page).toHaveURL(/#scenario=s00-sandbox$/);
});
