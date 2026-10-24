/**
 * Slice 1.6 — the local generation proxy must not leak into e2e.
 *
 * The proxy is what makes a real browser click possible during manual smoke
 * runs; the Playwright server pins it off so no test can accidentally spend a
 * real call, and so the mock-first expectations stay exactly as they were.
 */
import { expect, test } from '@playwright/test';

test('1.6 e2e: the /api proxy is not registered under the test server', async ({ page, request }) => {
  for (const path of ['/api/ark/generate', '/api/ark/chat', '/api/speech/tts']) {
    const response = await request.post(path, { data: { prompt: 'x', messages: [] } });
    const text = await response.text();
    // Vite's SPA fallback answers with the HTML shell; the proxy would have
    // answered JSON. Either way there must be no `{ok:true}` and no real bytes.
    expect(text.includes('"ok":true'), `${path} must not be served by the proxy`).toBe(false);
    expect(text.includes('ark.cn-beijing'), `${path} must not reach Ark`).toBe(false);
  }
  await page.goto('/');
  await expect(page.getByTestId('workspace-skeleton')).toBeVisible();
});

test('1.6 e2e: a mock run still makes zero /api requests', async ({ page }) => {
  const api: string[] = [];
  page.on('request', (call) => {
    const url = new URL(call.url());
    if (url.pathname.startsWith('/api/')) api.push(url.pathname);
  });
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByTestId('card-draft').click();
  await page.getByRole('checkbox', { name: '引用 01 / Creative brief' }).check();
  await page.getByTestId('freeze-button').click();
  await expect(page.getByTestId('snapshot-count')).toHaveText('1');
  expect(api).toEqual([]);
  expect(await page.getByTestId('provider-calls').textContent()).toContain('0');
});
