import { expect, test } from '@playwright/test';

// M2 end-to-end: availability, engagement and the HMI basics (doc 17 M2).

test('[R33][IR6][R17] S01 plays out: available, engaged, solid green, set speed 62 mph', async ({
  page,
}) => {
  await page.goto('./#scenario=s01-activation-success');
  await expect(page.getByTestId('available-indicator')).toHaveClass(/on/);
  await expect(page.getByTestId('checklist-summary')).toContainText('All 22 checks pass');
  await expect(page.getByTestId('hfds-mode')).toHaveText('HANDS_FREE', { timeout: 10_000 });
  await expect(page.getByTestId('light-bar')).toHaveAttribute('data-state', 'SolidGreen');
  await expect(page.getByTestId('light-bar-label')).toContainText('Solid green');
  await expect(page.getByTestId('set-speed')).toHaveText('62 mph');
  await expect(page.getByTestId('indicators')).toContainText('FCS: Alert and Brake');
  await expect(page.locator('#event-log-body')).toContainText('HFDS engaged');
});

test('[R12][IR7] H engages and disengages HFDS in the sandbox', async ({ page }) => {
  await page.goto('./#scenario=s00-sandbox');
  await expect(page.getByTestId('hfds-mode')).toHaveText('AVAILABLE');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('h');
  await expect(page.getByTestId('hfds-mode')).toHaveText('STARTING');
  await expect(page.getByTestId('hfds-mode')).toHaveText('HANDS_FREE', { timeout: 5_000 });
  await expect(page.getByTestId('transfer-banner')).toHaveText('HFDS steering');
  await page.waitForTimeout(700); // beyond the 0.5 s debounce (R43)
  await page.keyboard.press('h');
  await expect(page.getByTestId('hfds-mode')).toHaveText('AVAILABLE');
  await expect(page.getByTestId('transfer-banner')).toHaveText('You are in control');
  await expect(page.getByTestId('light-bar')).toHaveAttribute('data-state', 'Off');
});

test('[R16][R49][IR16] S02 rejects the press with the reason and "Update needed"', async ({
  page,
}) => {
  await page.goto('./#scenario=s02-rejected-outdated-map');
  await expect(page.getByTestId('update-needed')).toBeVisible();
  await expect(page.locator('#checklist-body li[data-check-id="IR16"]')).toContainText(
    'Update needed',
  );
  await expect(page.getByTestId('dashboard-error')).toContainText('LiDAR map', { timeout: 6_000 });
  await expect(page.getByTestId('cluster-message')).toContainText('Activation rejected');
  await expect(page.getByTestId('light-bar')).toHaveAttribute('data-state', 'Error');
  await expect(page.getByTestId('hfds-mode')).toHaveText('UNAVAILABLE');
});
