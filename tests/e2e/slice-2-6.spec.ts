import { expect, test } from '@playwright/test';

test.describe('slice 2.6 · editor save semantics', () => {
  test('saving to the node is undoable and leaves the node count unchanged', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-product').click();
    await page.getByTestId('open-editor').click();
    await page.getByLabel('编辑器提示词').fill('Tighter crop.');
    await page.getByRole('button', { name: '生成变体' }).click();
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('card-product')).toContainText('已模拟');
    await expect(page.locator('.react-flow__node')).toHaveCount(4);

    await page.getByRole('button', { name: '撤销画布操作' }).click();
    await expect(page.getByTestId('card-product')).not.toContainText('已模拟');
  });

  test('saving as copy adds one draft and keeps the source unchanged', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-product').click();
    await page.getByTestId('open-editor').click();
    await expect(page.getByTestId('editor-save-copy')).toBeDisabled();
    await page.getByLabel('编辑器提示词').fill('Alternative framing.');
    await page.getByRole('button', { name: '生成变体' }).click();
    await page.getByTestId('editor-save-copy').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(5);
    await expect(page.getByRole('alert')).toContainText('源节点未改动');
    await expect(page.getByTestId('provider-calls')).toHaveText('0');
  });
});
