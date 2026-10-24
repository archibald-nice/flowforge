import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Slice 3.3: pin the Ark flag for the e2e dev server so the host's .env.local
// (which may carry ARK_ENABLED=1 for manual smoke runs) cannot flip the
// "mock stays default" expectations. vite.config.ts reads E2E_ARK_ENABLED
// first and only falls back to loadEnv when it is unset.
process.env.E2E_ARK_ENABLED ??= '1';
// Slice 1.4: same treatment for the real audio flag.
process.env.E2E_SPEECH_ENABLED ??= '1';
// Slice 1.3: and for the real video flag (drives ARK_VIDEO_AVAILABLE in the bundle).
process.env.E2E_ARK_VIDEO_ENABLED ??= '1';
process.env.E2E_ARK_TEXT_ENABLED ??= '1';
// Slice 1.6: the local generation proxy is a dev-server-only convenience. The
// e2e server must never expose it, so every probe of /api/* fails closed and the
// existing assertions keep their shape.
process.env.E2E_ARK_PROXY_ENABLED = '0';

// Local runs prefer the system Chrome because it matches what a developer sees
// by hand. CI runners (Linux) have no such binary and install Playwright's own
// chromium instead, so fall back to the bundled browser whenever the path is
// absent. PLAYWRIGHT_CHROME_PATH still forces a specific binary.
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromePath =
  process.env.PLAYWRIGHT_CHROME_PATH ??
  (process.platform === 'darwin' && existsSync(macChrome) ? macChrome : undefined);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 40_000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    launchOptions: chromePath ? { executablePath: chromePath } : {},
  },
  webServer: { command: 'pnpm dev --port 5174 --strictPort', url: 'http://127.0.0.1:5174', reuseExistingServer: false },
});
