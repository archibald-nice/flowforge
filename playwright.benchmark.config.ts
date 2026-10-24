import { defineConfig } from '@playwright/test';
import config from './playwright.config.ts';

export default defineConfig({
  ...config,
  testDir: './tests/benchmark',
  timeout: 90_000,
  use: { ...config.use, baseURL: 'http://127.0.0.1:5175', headless: process.env.FLOWFORGE_HEADED !== '1' },
  webServer: { command: 'pnpm exec vite preview --host 127.0.0.1 --port 5175 --strictPort', url: 'http://127.0.0.1:5175', reuseExistingServer: false },
});
