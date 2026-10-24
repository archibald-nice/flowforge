import { expect, test } from '@playwright/test';

test.describe('slice 2.5 · templates', () => {
  test('the gallery lists twelve templates, previews one and instantiates it', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('templates-toggle').click();
    const panel = page.getByTestId('template-panel');
    await expect(panel.locator('li')).toHaveCount(12);

    await panel.getByTestId('template-product-still').getByRole('button', { name: '预览' }).click();
    const preview = page.getByTestId('template-preview');
    await expect(preview).toContainText('产品静物');
    await expect(preview).toContainText('不生成内容');
    await page.getByRole('button', { name: '关闭预览' }).click();
    await expect(preview).toHaveCount(0);

    await panel.getByRole('button', { name: 'Use 产品静物' }).click();
    await expect(page).toHaveURL(/project=/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('产品静物');
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(page.getByTestId('provider-calls')).toHaveText('0');
  });
});
