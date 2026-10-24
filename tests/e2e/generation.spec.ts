import { test, expect, type Page } from '@playwright/test';

const external = (page: Page) => {
  const seen: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:5174/') && !url.startsWith('blob:http://127.0.0.1:5174/')) seen.push(url);
  });
  return seen;
};

const openDraft = async (page: Page) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByTestId('card-draft').click();
  await page.getByRole('checkbox', { name: '引用 01 / Creative brief' }).check();
  await expect(page.getByTestId('reference-brief')).toHaveCount(1);
};

const counts = async (page: Page) => ({
  nodes: await page.locator('.react-flow__node').count(),
  edges: await page.locator('.react-flow__edge').count(),
});

test('M11 + M06: the four-segment form feeds the snapshot, costs 0 and offers no billing', async ({ page }) => {
  const outside = external(page);
  await openDraft(page);

  await expect(page.getByRole('combobox', { name: 'Model' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Size' })).toBeVisible();
  await expect(page.getByTestId('variants')).toHaveText('1×');
  await expect(page.getByTestId('cost-badge')).toContainText('平台代币');

  await page.getByRole('combobox', { name: 'Model' }).selectOption('mock-still-b');
  await expect(page.getByTestId('variants')).toHaveText('1×');
  await page.getByTestId('freeze-button').click();
  await expect(page.getByTestId('snapshot-json')).toContainText('"model": "mock-still-b"');
  const firstSnapshot = await page.getByTestId('snapshot-json').innerText();

  await page.getByRole('combobox', { name: 'Size' }).selectOption('1024');
  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('run-state')).toHaveText('succeeded', { timeout: 5000 });
  await expect(page.getByTestId('simulated-result')).toContainText('cost 0');
  await page.getByText('冻结快照').click();
  await expect(page.getByTestId('snapshot-json')).toContainText('"size": "1024"');

  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/充值|订阅|升级|购买 平台代币|价格页|套餐/i);
  expect(body).toContain('No payment');
  expect(outside).toEqual([]);
  expect(firstSnapshot).toContain('"mock-still-b"');
});

test('M12: the happy path walks queued → running → succeeded without touching the canvas', async ({ page }) => {
  const outside = external(page);
  await openDraft(page);
  const before = await counts(page);

  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('run-state')).toHaveText('queued');
  await expect(page.getByTestId('run-state')).toHaveText('succeeded', { timeout: 5000 });
  await expect(page.getByTestId('simulated-result')).toContainText('simulated-only');
  await expect(page.getByTestId('simulated-result')).toContainText('seed');

  await page.getByText('存储诊断', { exact: true }).click();
  await expect(page.getByTestId('provider-calls')).toHaveText('1');
  expect(await counts(page)).toEqual(before);
  expect(outside).toEqual([]);
});

test('M12: a controlled failure keeps the canvas and inserts no result', async ({ page }) => {
  await openDraft(page);
  const before = await counts(page);

  await page.getByRole('combobox', { name: 'Simulated outcome' }).selectOption('fail');
  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('run-state')).toHaveText('failed', { timeout: 5000 });
  await expect(page.getByText('模拟的模型失败；画布内容未变。')).toBeVisible();
  await expect(page.getByTestId('simulated-result')).toHaveCount(0);
  expect(await counts(page)).toEqual(before);
});

test('M12: cancel during the run blocks the result and leaves the canvas intact', async ({ page }) => {
  await openDraft(page);
  const before = await counts(page);

  await page.getByTestId('run-button').click();
  await page.getByRole('button', { name: '取消运行' }).click();
  await expect(page.getByTestId('run-state')).toHaveText('canceled');
  await page.waitForTimeout(900);
  await expect(page.getByTestId('run-state')).toHaveText('canceled');
  await expect(page.getByTestId('simulated-result')).toHaveCount(0);
  expect(await counts(page)).toEqual(before);
});
