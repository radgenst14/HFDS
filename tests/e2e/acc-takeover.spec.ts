import { expect, test } from '@playwright/test';

// M3 end-to-end: ACC following, zone readout, lead highlight, Class A takeover (doc 17 M3).

test('[R4][R21] S05: a lead is selected and the zone moves from Closing to Coast', async ({
  page,
}) => {
  await page.goto('./#scenario=s05-follow-lead-vehicle');
  await page.locator('#time-scale').selectOption('4');
  await expect(page.getByTestId('acc-lead')).toHaveText('#1 Car', { timeout: 10_000 });
  await expect(page.getByTestId('acc-zone')).toHaveText('Closing');
  await expect(page.getByTestId('acc-zone')).toHaveText('Coast', { timeout: 15_000 });
  await expect(page.getByTestId('road-canvas')).toBeVisible();
});

test('[R23][UC19] S06: the too-close cut-in raises a Class A reclaim warning with flashing red', async ({
  page,
}) => {
  await page.goto('./#scenario=s06-cut-in-braking');
  await page.locator('#time-scale').selectOption('4');
  // Fast-forward to just before the second cut-in (30 s), then watch it at 1×.
  const simTime = async () => parseFloat((await page.getByTestId('sim-time').textContent()) ?? '0');
  await expect.poll(simTime, { timeout: 15_000 }).toBeGreaterThan(27);
  await page.locator('#time-scale').selectOption('1');
  await expect(page.getByTestId('light-bar')).toHaveAttribute('data-state', 'FlashingRed', {
    timeout: 8_000,
  });
  await expect(page.getByTestId('cluster-message')).toHaveText(
    'Take steering control immediately.',
  );
  await expect(page.getByTestId('active-warnings')).toContainText('Class A BRAKING_INSUFFICIENT');
  await expect(page.getByTestId('takeover-countdown')).toContainText('Take over within');
  // 31.5 s: the driver brakes → control returns, re-check countdown (R38.4).
  await expect(page.getByTestId('hfds-mode')).toHaveText('UNAVAILABLE', { timeout: 10_000 });
  await expect(page.getByTestId('takeover-countdown')).toContainText('Re-check in');
});
