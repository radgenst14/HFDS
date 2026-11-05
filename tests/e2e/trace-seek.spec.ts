import { expect, test } from '@playwright/test';

// M6 end-to-end: time links (#scenario=<id>&t=<s>), the requirement trace panel and the
// event log filter (doc 15 B6 region 6, doc 17 M6).

test('[SR8][IR23] a time link opens S18 paused at 20 s with OnStar connected', async ({ page }) => {
  await page.goto('./#scenario=s18-collision-onstar&t=20');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-sim-time', '20.00', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-paused', 'true');
  await expect(page.getByTestId('hfds-mode')).toHaveText('UNAVAILABLE');
  await expect(page.getByTestId('error-list')).toContainText('E701');
  await expect(page.getByTestId('indicators')).toContainText('OnStar');
});

test('[R45] the trace panel marks exercised IDs and a click filters the event log', async ({
  page,
}) => {
  await page.goto('./#scenario=s19-unauthorized-command&t=14');
  await expect(page.locator('#app')).toHaveAttribute('data-sim-time', '14.00', {
    timeout: 10_000,
  });
  const ir19 = page.locator('#trace-body .trace-chip[data-req-id="IR19"]');
  await expect(ir19).toHaveAttribute('data-state', 'exercised');
  await expect(page.getByTestId('trace-summary')).toContainText('of 177 SRS requirements');
  await ir19.click();
  await expect(page.getByTestId('log-filter')).toHaveValue('IR19');
  const visible = page.locator('#event-log-body li:not([hidden])');
  await expect(visible).toHaveCount(3);
  await page.getByTestId('log-type-filter').selectOption('warning');
  await expect(visible).toHaveCount(1);
  await expect(visible.first()).toContainText('no authenticated service provider');
  await expect(page.getByTestId('log-count')).toContainText('1 of');
});
