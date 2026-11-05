import { expect, test } from '@playwright/test';

// M5 end-to-end: Director injections from the panel (doc 15 B6), SR4.4, SR3, R37.

test('[SR4.4][SR3][R37] Director sensor faults: redundant switch, then a takeover request', async ({
  page,
}) => {
  await page.goto('./#scenario=s00-sandbox');
  await expect(page.getByTestId('hfds-mode')).toHaveText('AVAILABLE');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('h');
  await expect(page.getByTestId('hfds-mode')).toHaveText('HANDS_FREE', { timeout: 5_000 });
  await page.keyboard.press('g'); // hands off the wheel (R33.1), so a takeover needs the driver

  const director = page.locator('#director-body');
  await director.getByLabel('Sensor', { exact: true }).selectOption('RADAR_FRONT');
  await page.getByTestId('director-fail-sensor').click();
  await expect(page.getByTestId('error-list')).toContainText('E102');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('hfds-mode')).toHaveText('HANDS_FREE'); // SR4.4

  await director.getByLabel('Sensor', { exact: true }).selectOption('CAM_FRONT');
  await page.getByTestId('director-fail-sensor').click();
  await expect(page.getByTestId('hfds-mode')).toHaveText('TAKEOVER_REQUESTED'); // SR3
  await expect(page.getByTestId('active-warnings')).toContainText('SENSOR_FAULT');

  await page.getByTestId('director-clear-all').click();
  await expect(page.getByTestId('error-list')).toContainText('none');
});
