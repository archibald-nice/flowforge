/**
 * Standalone server (server/app.ts): static hosting + the generation proxy.
 *
 * Proven here without a browser or a provider: the app shell fallback, asset
 * caching, path traversal refusal, the API method contract, and loopback-only
 * proxying. Real provider calls stay in the provider unit tests.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createApp } from '../../server/app.ts';

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'flowforge-server-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>flowforge-shell</title>');
  writeFileSync(join(root, 'assets', 'app.js'), 'console.log("shell")');
  return root;
}

function call(port: number, path: string, method = 'GET', body?: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  return new Promise((done, failed) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on('error', failed);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('standalone server: shell, assets, SPA fallback and 404s', async () => {
  const app = createApp({ root: makeRoot() });
  await new Promise<void>((ready) => app.listen(0, '127.0.0.1', ready));
  const { port } = app.address() as AddressInfo;
  try {
    const page = await call(port, '/');
    assert.equal(page.status, 200);
    assert.match(page.text, /flowforge-shell/u);

    const asset = await call(port, '/assets/app.js');
    assert.equal(asset.status, 200);
    assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.match(String(asset.headers['content-type']), /javascript/u);

    // Extension-less paths render the shell (the app uses query params, but a
    // deep link must still load).
    const deepLink = await call(port, '/projects');
    assert.equal(deepLink.status, 200);
    assert.match(deepLink.text, /flowforge-shell/u);

    const missing = await call(port, '/assets/nope.js');
    assert.equal(missing.status, 404);
  } finally {
    app.close();
  }
});

test('standalone server: traversal is refused, API contract holds', async () => {
  const app = createApp({ root: makeRoot() });
  await new Promise<void>((ready) => app.listen(0, '127.0.0.1', ready));
  const { port } = app.address() as AddressInfo;
  try {
    const traversal = await call(port, '/..%2f..%2fetc%2fpasswd');
    assert.ok([403, 404].includes(traversal.status), `expected 403/404, got ${traversal.status}`);

    const health = await call(port, '/api/health');
    assert.equal(health.status, 200);
    assert.match(health.text, /"ok":true/u);

    const getApi = await call(port, '/api/ark/generate');
    assert.equal(getApi.status, 405);

    // No ARK_IMAGE_ENDPOINT in this environment: the proxy must refuse to call
    // upstream instead of falling back to a placeholder.
    const generate = await call(port, '/api/ark/generate', 'POST', JSON.stringify({ prompt: 'x', size: '1024x1024' }));
    assert.equal(generate.status, 503);
    assert.match(generate.text, /ARK_IMAGE_ENDPOINT/u);
  } finally {
    app.close();
  }
});
