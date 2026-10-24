import { expect, test, type Page } from '@playwright/test';

// Slice 2.3-real: the image editor routes its generate button to the Ark provider
// when a real image model is selected. The endpoint and key stay out of the
// client, so a browser-side real variant is refused by the provider (no key)
// and the variant list must stay unchanged; the simulated path keeps working.

const openEditor = async (page: Page) => {
  await page.goto('/');
  const draft = page.locator('[data-id="draft"]');
  await expect(draft).toBeVisible();
  await draft.click();
  await page.getByTestId('open-editor').click();
  await expect(page.getByTestId('editor-shell')).toBeVisible();
};

test('slice 2.3-real · simulated variants still work and cost nothing', async ({ page }) => {
  await openEditor(page);
  await expect(page.getByLabel('Editor model')).toHaveValue('simulated');
  await expect(page.getByTestId('editor-cost')).toContainText('模拟 · 0 平台代币');
  await page.getByLabel('编辑器提示词').fill('a cobalt bottle on linen');
  await page.getByTestId('editor-generate').click();
  await expect(page.getByTestId('editor-shell')).toContainText('模拟变体 1 / 1');
  await expect(page.getByTestId('provider-calls')).toHaveText('0');
  await expect(page.getByTestId('editor-save')).toBeEnabled();
});

test('slice 2.3-real · flag on offers the real model and its Ark price', async ({ page }) => {
  test.skip(process.env.E2E_ARK_ENABLED !== '1', 'requires E2E_ARK_ENABLED=1');
  await openEditor(page);
  const model = page.getByLabel('Editor model');
  await expect(model.locator('option').filter({ hasText: '真实' })).toHaveCount(1);
  await model.selectOption({ index: 1 });
  await expect(page.getByTestId('editor-cost')).toContainText('20 平台代币 · 真实（方舟）');
  await expect(page.getByTestId('editor-shell')).toContainText('真实（方舟）');
});

test('slice 2.3-real · a browser-side real variant is refused and adds nothing', async ({ page }) => {
  test.skip(process.env.E2E_ARK_ENABLED !== '1', 'requires E2E_ARK_ENABLED=1');
  await openEditor(page);
  await page.getByLabel('Editor model').selectOption({ index: 1 });
  await page.getByLabel('编辑器提示词').fill('a cobalt bottle on linen');
  await page.getByTestId('editor-generate').click();
  // The provider refuses before any network call because the key is node-only.
  await expect(page.getByTestId('editor-run-state')).toContainText('failed');
  await expect(page.getByTestId('editor-shell')).toContainText('还没有变体');
  await expect(page.getByTestId('editor-save')).toBeDisabled();
  await expect(page.getByTestId('provider-calls')).toHaveText('0');
});

test('slice 2.3-real · flag off hides the real editor model entirely', async ({ page }) => {
  test.skip(process.env.E2E_ARK_ENABLED === '1', 'requires the Ark flag off');
  await openEditor(page);
  await expect(page.getByLabel('Editor model').locator('option').filter({ hasText: '真实' })).toHaveCount(0);
  await expect(page.getByTestId('editor-cost')).toContainText('模拟');
});
