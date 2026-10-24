import { test, expect, type Page } from '@playwright/test';

const external = (page: Page) => {
  const seen: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:5174/') && !url.startsWith('blob:http://127.0.0.1:5174/')) seen.push(url);
  });
  return seen;
};

test('M13: content, references and viewport roundtrip independently with no external requests', async ({ page }) => {
  const outside = external(page);
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');

  await page.getByTestId('card-brief').click();
  await page.getByRole('textbox', { name: '简报正文' }).fill('Roundtrip content, layer one.');

  await page.getByTestId('card-draft').click();
  await page.getByRole('checkbox', { name: '引用 01 / Creative brief' }).check();
  await page.getByLabel('Purpose of 01 / Creative brief').selectOption('style');
  await page.getByRole('checkbox', { name: '引用 02 / Original study' }).check();

  await page.getByRole('button', { name: '放大' }).click();
  await page.getByRole('button', { name: '放大' }).click();
  await expect(page.getByTestId('viewport')).not.toHaveText('90%');
  const zoom = await page.getByTestId('viewport').innerText();

  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.reload();
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');

  // Layer 1: node content
  await expect(page.getByTestId('card-brief')).toContainText('Roundtrip content, layer one.');
  // Layer 2: references, including the designed role value
  await expect(page.getByTestId('reference-brief')).toHaveCount(1);
  await expect(page.getByTestId('reference-product')).toHaveCount(1);
  await expect(page.getByLabel('Purpose of 01 / Creative brief')).toHaveValue('style');
  await expect(page.getByLabel('Purpose of 02 / Original study')).toHaveValue('first-frame');
  // Layer 3: viewport
  await expect(page.getByTestId('viewport')).toHaveText(zoom);
  expect(outside).toEqual([]);
});

test('M13: a failed write shows an error state instead of claiming a save', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByText('存储诊断', { exact: true }).click();
  const revision = await page.getByTestId('stored-revision').innerText();

  await page.getByRole('button', { name: '模拟下一次写失败' }).click();
  await expect(page.getByTestId('save-status')).toContainText('保存失败 / 草稿保留');
  await expect(page.getByRole('alert')).toContainText('模拟的本地写入失败；草稿已保留。');
  await expect(page.getByTestId('stored-revision')).toHaveText(revision);
  await expect(page.getByTestId('save-status')).not.toContainText('已保存到本地');

  await page.getByRole('button', { name: '重试本地保存' }).click();
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await expect(page.getByTestId('stored-revision')).not.toHaveText(revision);
});
