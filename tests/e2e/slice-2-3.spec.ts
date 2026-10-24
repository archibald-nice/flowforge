import { expect, test } from '@playwright/test';

test.describe('slice 2.3 · image editor', () => {
  test('the editor opens, generates a simulated variation and saves it back', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-product').click();
    await page.getByTestId('open-editor').click();
    const shell = page.getByTestId('editor-shell');
    await expect(shell).toBeVisible();
    await expect(shell).toContainText('不会自己调用模型');
    await expect(page.getByTestId('editor-save')).toBeDisabled();

    await page.getByLabel('编辑器提示词').fill('A softer crop, same bottle.');
    await page.getByRole('button', { name: '生成变体' }).click();
    await expect(shell).toContainText('模拟变体 1 / 1');
    await expect(page.getByTestId('editor-save')).toBeEnabled();
    await page.getByTestId('editor-save').click();
    await expect(shell).toHaveCount(0);
    await expect(page.getByTestId('card-product')).toContainText('已模拟');
    expect(await page.locator('.react-flow__node').count()).toBe(4);
    await expect(page.getByTestId('provider-calls')).toHaveText('0');
  });

  test('closing without saving leaves the node untouched', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-product').click();
    await page.getByTestId('open-editor').click();
    await page.getByLabel('编辑器提示词').fill('Discarded idea.');
    await page.getByRole('button', { name: '生成变体' }).click();
    await page.getByRole('button', { name: 'Close editor' }).click();
    await expect(page.getByTestId('editor-shell')).toHaveCount(0);
    await expect(page.getByTestId('card-product')).not.toContainText('已模拟');
  });
});
