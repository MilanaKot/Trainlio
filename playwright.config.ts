import { defineConfig, devices } from '@playwright/test'

/**
 * Some environments ship a preinstalled Chromium whose build number does not
 * match the one this Playwright version downloads. Point
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE at that binary rather than pinning the project
 * to whatever a sandbox happens to have.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
const chromium = executablePath ? { launchOptions: { executablePath } } : {}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [
    // Mobile-first: the guardian flows are specified for a phone, so that is
    // the default viewport rather than an afterthought.
    { name: 'mobile', use: { ...devices['Pixel 7'], ...chromium } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...chromium } },
  ],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
