import { expect, test } from '@playwright/test';

const png = { name: 'library-shot.png', mimeType: 'image/png', buffer: Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') };

test.describe('slice 2.1 · asset library', () => {
  test('uploaded assets appear in the library and can be filtered', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-product').click();
    await page.getByTestId('asset-input').setInputFiles(png);
    await expect(page.getByTestId('asset-library-shot.png')).toBeVisible();
    await page.getByTestId('library-toggle').click();
    const panel = page.getByTestId('library-panel');
    const row = panel.getByTestId('library-library-shot.png');
    await expect(row).toBeVisible();
    await expect(row).toContainText('其他');

    await panel.getByRole('button', { name: '场景', exact: true }).click();
    await expect(row).toHaveCount(0);
    await panel.getByRole('button', { name: '分类：全部' }).click();
    await expect(row).toBeVisible();

    await panel.getByLabel('搜索素材').fill('nothing-matches');
    await expect(row).toHaveCount(0);
    await panel.getByLabel('搜索素材').fill('shot');
    await expect(row).toBeVisible();

    await panel.getByLabel('Category of library-shot.png').selectOption('prop');
    await expect(row).toContainText('道具');
    await panel.getByLabel('Favorite library-shot.png').click();
    await panel.getByRole('tab', { name: '收藏' }).click();
    await expect(row).toBeVisible();
  });

  test('a node can be saved into the library without uploading', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-product').click();
    await page.getByTestId('save-to-library').click();
    await expect(page.getByRole('alert')).toContainText('未上传');
    await page.getByTestId('library-toggle').click();
    await expect(page.getByTestId('library-panel').locator('li')).toHaveCount(1);
  });
});
