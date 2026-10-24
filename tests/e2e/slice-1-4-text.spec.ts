import { expect, test, type Page } from '@playwright/test';

// Slice 1.4-text: the text panel routes to a real Ark chat completion only when
// the flag is on; the simulated path never touches the network.
//
// The real endpoint id and key never reach the client: the browser only learns
// `ARK_TEXT_AVAILABLE`, so a browser-side real text run is refused with a
// notice and zero provider calls (the real path is covered by node smoke runs).

const TEXT_CARD = '[data-id="brief"]';
const openTextNode = async (page: Page) => {
  await page.goto('/');
  const card = page.locator(TEXT_CARD).first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByTestId('text-panel')).toBeVisible();
};

test('slice 1.4-text · simulated text stays offline and free', async ({ page }) => {
  await openTextNode(page);
  await expect(page.getByLabel('Text model')).toHaveValue('simulated');
  await expect(page.getByTestId('text-cost')).toContainText('模拟 · 0 平台代币');
  await page.getByTestId('text-run').click();
  await expect(page.getByTestId('notice')).toContainText('模拟文本已写入节点');
  await expect(page.getByTestId('provider-calls')).toHaveText('0');
  await expect(page.locator(TEXT_CARD)).toContainText('模拟输出，未联网');
});

test('slice 1.4-text · flag on offers the real model and its one-Tapie cost', async ({ page }) => {
  test.skip(process.env.E2E_ARK_TEXT_ENABLED !== '1', 'requires E2E_ARK_TEXT_ENABLED=1');
  await openTextNode(page);
  const model = page.getByLabel('Text model');
  await expect(model.locator('option').filter({ hasText: '真实' })).toHaveCount(1);
  await model.selectOption('ark-text-endpoint');
  await expect(page.getByTestId('text-cost')).toContainText('1 平台代币 · 真实（文本）');
  await expect(page.getByTestId('text-panel')).toContainText('真实（文本）');
});

// Slice 1.6-fix: the browser may now *start* a real text run (the placeholder
// model id is resolved server-side), but these e2e runs have the local proxy
// switched off, so the run must fail without reaching any provider and without
// writing the node.
test('slice 1.4-text · a browser-side real run without the proxy fails and writes nothing', async ({ page }) => {
  test.skip(process.env.E2E_ARK_TEXT_ENABLED !== '1', 'requires E2E_ARK_TEXT_ENABLED=1');
  await openTextNode(page);
  const before = await page.locator(TEXT_CARD).innerText();
  await page.getByLabel('Text model').selectOption('ark-text-endpoint');
  await page.getByTestId('text-run').click();
  await expect(page.getByTestId('text-state')).toHaveText('failed');
  await expect(page.getByTestId('provider-calls')).toHaveText('0');
  // The node keeps the original brief: the failed run writes nothing back.
  await expect(page.locator(TEXT_CARD)).toContainText('A calmer launch');
  await expect(page.locator(TEXT_CARD)).not.toContainText('模拟输出');
  expect(before).toContain('A calmer launch');
});

test('slice 1.4-text · flag off hides the real option entirely', async ({ page }) => {
  test.skip(process.env.E2E_ARK_TEXT_ENABLED === '1', 'requires the text flag off');
  await openTextNode(page);
  await expect(page.getByLabel('Text model').locator('option').filter({ hasText: '真实' })).toHaveCount(0);
  await expect(page.getByTestId('text-cost')).toContainText('模拟');
});
