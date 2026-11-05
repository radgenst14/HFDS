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
  // 1.5 s at the 10 ft/s² default brake rate ≈ 10 mph; allow for real-time key timing.
  expect(await num(page, 'ego-speed')).toBeLessThan(faster - 7);
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

test('[A-34] time scale 4× advances sim time about 4× as fast as 1×', async ({ page }) => {
  // Compare against 1× measured in the same run, so a slow or busy machine cannot fail it.
  const rate = async () => {
    const t0 = await num(page, 'sim-time');
    await page.waitForTimeout(1000);
    return (await num(page, 'sim-time')) - t0;
  };
  const normal = await rate();
  await page.locator('#time-scale').selectOption('4');
  const fast = await rate();
  expect(normal).toBeGreaterThan(0.2);
  expect(
    fast,
    `1× advanced ${normal.toFixed(2)} s, 4× advanced ${fast.toFixed(2)} s`,
  ).toBeGreaterThan(2.5 * normal);
});
