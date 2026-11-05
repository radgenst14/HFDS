import { expect, test, type Page } from '@playwright/test';

// Doc 17 test inventory: "key press changes state" (M1: manual driving, A-26 / A-36).
const num = async (page: Page, testid: string) =>
  parseFloat((await page.getByTestId(testid).textContent()) ?? 'NaN');

test.beforeEach(async ({ page }) => {
  await page.goto('./#scenario=s00-sandbox');
  await expect(page.getByTestId('road-canvas')).toBeVisible();
  await expect.poll(() => num(page, 'sim-time')).toBeGreaterThan(0.5);
});

test('[A-26] with no input the ego holds 65 mph', async ({ page }) => {
  await page.waitForTimeout(1000);
  expect(await num(page, 'ego-speed')).toBeCloseTo(65, 1);
});

test('[IR25] holding ↑ accelerates and holding Space brakes', async ({ page }) => {
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(1500);
  await page.keyboard.up('ArrowUp');
  const faster = await num(page, 'ego-speed');
  expect(faster).toBeGreaterThan(67);

  await page.keyboard.down(' ');
  await page.waitForTimeout(1500);
  await page.keyboard.up(' ');
  expect(await num(page, 'ego-speed')).toBeLessThan(faster - 10);
});

test('P pauses the simulation and . steps one tick', async ({ page }) => {
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('p');
  await expect(page.getByTestId('run-status')).toContainText('Paused');
  const tick = await num(page, 'sim-tick');
  await page.waitForTimeout(500);
  expect(await num(page, 'sim-tick')).toBe(tick);
  await page.keyboard.press('.');
  await expect.poll(() => num(page, 'sim-tick')).toBe(tick + 1);
  await page.keyboard.press('p');
  await expect(page.getByTestId('run-status')).toContainText('Running');
});

test('[A-34] time scale 4× advances sim time about 4× as fast', async ({ page }) => {
  await page.locator('#time-scale').selectOption('4');
  const t0 = await num(page, 'sim-time');
  await page.waitForTimeout(1000);
  const dt = (await num(page, 'sim-time')) - t0;
  expect(dt).toBeGreaterThan(2.5);
});
