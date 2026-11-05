import { expect, test } from '@playwright/test';

// M4 end-to-end: Class B alert, R39 pulsing blue and resume, minimal risk maneuver.

test('[R29][R32] S10: flashing green first alert, then solid green again after looking back', async ({
  page,
}) => {
  // Time links seek the deterministic run, so the 2 s flashing-red window (43–45 s) cannot
  // be missed under load the way it could at 4× real time.
  const at = async (t: number) => {
    await page.goto(`./#scenario=s10-inattention-recovered&t=${t}`);
    await expect(page.locator('#app')).toHaveAttribute('data-sim-time', t.toFixed(2), {
      timeout: 10_000,
    });
  };
  const lightBar = page.getByTestId('light-bar');
  await at(20);
  await expect(lightBar).toHaveAttribute('data-state', 'FlashingGreen');
  await expect(page.getByTestId('cluster-message')).toHaveText('Pay attention to the road.');
  await at(44);
  await expect(lightBar).toHaveAttribute('data-state', 'FlashingRed');
  await at(46);
  await expect(lightBar).toHaveAttribute('data-state', 'SolidGreen');
});

test('[R39.1][R39.2] S14: pulsing blue while the driver steers, then HFDS resumes', async ({
  page,
}) => {
  await page.goto('./#scenario=s14-driver-steers-resume');
  await page.locator('#time-scale').selectOption('2');
  await expect(page.getByTestId('light-bar')).toHaveAttribute('data-state', 'PulsingBlue', {
    timeout: 10_000,
  });
  await expect(page.getByTestId('hfds-mode')).toHaveText('DRIVER_STEERING');
  await expect(page.getByTestId('hfds-mode')).toHaveText('HANDS_FREE', { timeout: 10_000 });
});

test('[SR7][SR1.2] S12: an ignored takeover request ends in a minimal risk maneuver with hazards on', async ({
  page,
}) => {
  await page.goto('./#scenario=s12-takeover-ignored-stop-in-lane');
  await page.locator('#time-scale').selectOption('4');
  await expect(page.getByTestId('hfds-mode')).toHaveText('TAKEOVER_REQUESTED', { timeout: 15_000 });
  await expect(page.getByTestId('hfds-mode')).toHaveText('MINIMAL_RISK_MANEUVER', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('indicators')).toContainText('Hazards: on');
  await expect(page.getByTestId('hfds-mode')).toHaveText('STOPPED_LOCKOUT', { timeout: 10_000 });
});
