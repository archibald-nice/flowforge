import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const png = { name: 'study.png', mimeType: 'image/png', buffer: Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') };

test('M20: a bundle round trips nodes, references and media into a fresh browser profile', async ({ page, browser }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByTestId('card-product').click();
  await page.getByTestId('asset-input').setInputFiles(png);
  await page.getByRole('button', { name: 'Use study.png' }).click();
  await page.getByTestId('card-draft').click();
  await page.getByRole('checkbox', { name: '引用 02 / Original study' }).check();

  const download = (await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出整包' }).click(),
  ]))[0];
  const file = await download.path();
  const bundle = JSON.parse(await readFile(file!, 'utf8'));
  expect(bundle.format).toBe('flowforge-bundle');
  expect(bundle.files.length).toBeGreaterThan(0);
  await expect(page.getByTestId('notice')).toContainText('整包已导出');

  const fresh = await browser.newContext();
  const second = await fresh.newPage();
  await second.goto('/');
  await expect(second.getByTestId('save-status')).toContainText('已保存到本地');
  await second.getByLabel('导入整包', { exact: true }).setInputFiles(file!);
  await expect(second.getByTestId('notice')).toContainText('整包已作为新项目导入到本地');
  await expect(second.locator('.react-flow__node')).toHaveCount(4);
  await expect(second.locator('.react-flow__edge')).toHaveCount(2);
  await expect(second.locator('h1')).toContainText('(imported)');
  await second.getByTestId('card-product').click();
  await expect(second.getByText('本地素材，仅存在此浏览器', { exact: false })).toBeVisible();
  await second.getByTestId('card-draft').click();
  await expect(second.getByRole('checkbox', { name: '引用 02 / Original study' })).toBeChecked();
  await fresh.close();
});

test('M20: a broken file is refused and a result export keeps its simulated marker', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByLabel('导入整包', { exact: true }).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
  await expect(page.getByTestId('notice')).toContainText('这不是 FlowForge 整包文件。');
  await expect(page.locator('.react-flow__node')).toHaveCount(4);

  await page.getByTestId('card-draft').click();
  await page.getByRole('checkbox', { name: '引用 01 / Creative brief' }).check();
  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('run-state')).toHaveText('succeeded');
  const download = (await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-result').click(),
  ]))[0];
  const body = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(body.format).toBe('flowforge-result');
  expect(body.simulated).toBe(true);
  expect(body.files.length).toBeGreaterThan(0);
});
