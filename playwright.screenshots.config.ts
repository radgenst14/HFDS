import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// `npm run screenshots` (doc 17 M6, SRS Section 5.2): same build and preview server as the
// e2e suite, a 1440 × 900 desktop viewport, output in docs/screenshots/ (git-ignored).
export default defineConfig({
  ...base,
  testDir: 'tests/screenshots',
  retries: 0,
  reporter: 'list',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
