import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: '**/*.spec.ts',

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,

  timeout: 60000,
  expect: { timeout: 10000 },

  reporter: [
    ['html', { open: 'never', outputFolder: '../test-results/html-report' }],
    ['json', { outputFile: '../test-results/results.json' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.RETROBOX_URL || 'http://localhost:3333',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    headless: true,
    actionTimeout: 10000,
    navigationTimeout: 20000,
  },

  outputDir: '../test-results/artifacts',

  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        // Use NixOS system Chromium instead of downloaded binary
        launchOptions: {
          executablePath: '/nix/store/c0s8bbj4s9ijzrqy9m21zkbmx29shzg8-chromium-143.0.7499.192/bin/chromium',
        },
      },
    },
  ],

  globalSetup: './e2e/global/setup.ts',
  globalTeardown: './e2e/global/teardown.ts',
});
