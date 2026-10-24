import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('M23: the exported view is static, complete and offline', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByTestId('card-draft').click();
  await page.getByRole('checkbox', { name: '引用 01 / Creative brief' }).check();

  const download = (await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-readonly').click(),
  ]))[0];
  const file = path.join(tmpdir(), `flowforge-readonly-${Date.now()}.html`);
  await download.saveAs(file);
  await expect(page.getByTestId('notice')).toContainText('只读视图已导出');
  const html = await readFile(file, 'utf8');
  expect(html).not.toMatch(/<script/i);
  expect(html).toContain('READ-ONLY · NO EDIT · NO RUN · NO AGENT');

  const viewer = await page.context().newPage();
  const requests: string[] = [];
  viewer.on('request', request => { if (!request.url().startsWith('file:')) requests.push(request.url()); });
  const failures: string[] = [];
  viewer.on('pageerror', error => failures.push(String(error)));
  await viewer.goto(`file://${file}`);
  await expect(viewer.locator('input, textarea, select, button')).toHaveCount(0);
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('The Quiet Launch');
  for (const title of ['01 / Creative brief', '02 / Original study', '03 / Input draft']) {
    await expect(viewer.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
  }
  await expect(viewer.locator('svg line')).toHaveCount(2);
  await expect(viewer.locator('img')).toHaveCount(1);
  const width = await viewer.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth);
  expect(width).toBeGreaterThan(0);
  expect(requests).toEqual([]);
  expect(failures).toEqual([]);
  await viewer.close();
});
