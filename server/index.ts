/**
 * Entry point for the standalone server (`pnpm server`).
 *
 * Reads `.env.local` when present so a local run behaves like `pnpm dev`, then
 * serves `dist/` and the generation proxy from a single origin.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createApp } from './app.ts';
import { proxyConfigured } from '../src/server/proxy.ts';

if (existsSync('.env.local') && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // A malformed file only means real generation stays off.
  }
}

const port = Number(process.env.PORT ?? 8787);
const allowRemote = process.env.PROXY_ALLOW_REMOTE === '1';
const app = createApp({ root: resolve('dist'), allowRemote });

app.listen(port, () => {
  const proxy = proxyConfigured() ? 'on (real generation available)' : 'off (no provider configured)';
  console.log(`FlowForge on http://127.0.0.1:${port} — proxy ${proxy}`);
  if (allowRemote) {
    console.log('PROXY_ALLOW_REMOTE=1: anyone who can reach this port can spend your provider credits.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.close();
    process.exit(0);
  });
}
