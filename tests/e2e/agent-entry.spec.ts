import { test, expect } from '@playwright/test';

const providerCalls = async (page: import('@playwright/test').Page) =>
  (await page.getByTestId('provider-calls').textContent()) ?? '';

test('M01: the panel carries exactly the selected node, and an empty state without one', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.locator('.react-flow__pane').click({ position: { x: 900, y: 560 } });
  await expect(page.getByTestId('context-empty')).toContainText('先选一个节点作为上下文');
  await expect(page.getByTestId('advice-list')).toHaveCount(0);

  await page.getByTestId('card-brief').click();
  await expect(page.getByTestId('context-line')).toHaveText('上下文：01 / Creative brief');
  await expect(page.getByTestId('advice-list').locator('li')).toHaveCount(1);

  await page.getByTestId('card-product').click();
  await expect(page.getByTestId('context-line')).toHaveText('上下文：02 / Original study');
});

test('M21: advice never runs anything; approval uses the existing explicit path', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByTestId('card-brief').click();
  const before = await providerCalls(page);
  await expect(page.getByTestId('snapshot-count')).toHaveText('0');

  await page.getByRole('button', { name: 'Approve: 把它引用到下游草稿的提交前清单。' }).click();
  await expect(page.getByTestId('notice')).toContainText('没有运行，也没有调用模型。');
  expect(await providerCalls(page)).toBe(before);
  await expect(page.getByTestId('snapshot-count')).toHaveText('0');

  await page.getByTestId('card-draft').click();
  await expect(page.getByTestId('context-line')).toContainText('03 / Input draft');
  await expect(page.getByTestId('advice-list')).toContainText('可以提交一次模拟运行');
  await page.getByRole('button', { name: /Approve: 可以提交一次模拟运行/ }).click();
  await expect(page.getByTestId('notice')).toContainText('需要时点「模拟运行」提交');
  expect(await providerCalls(page)).toBe(before);
  await expect(page.getByTestId('snapshot-count')).toHaveText('0');

  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('run-state')).toHaveText('succeeded', { timeout: 5000 });
  expect(await providerCalls(page)).toBe('1');
  await expect(page.getByTestId('snapshot-count')).toHaveText('1');
});

test('M01: with several nodes selected the panel keeps the primary node and says so', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByTestId('card-brief').click();
  await page.getByTestId('card-product').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('context-line')).toContainText('多选');
  await expect(page.getByTestId('context-line')).toContainText('02 / Original study');
});
