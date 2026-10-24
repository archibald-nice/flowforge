import { test, expect, type Page } from '@playwright/test';

const png = (name = 'study.png') => ({ name, mimeType: 'image/png', buffer: Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });

async function openImageInspector(page: Page) {
  await page.getByTestId('card-product').click();
  await expect(page.getByTestId('asset-input')).toBeAttached();
}

test('M19: a local asset can be added, previewed and used by an image node', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await openImageInspector(page);
  await page.getByTestId('asset-input').setInputFiles(png('bottle-study.png'));
  await expect(page.getByTestId('asset-bottle-study.png')).toBeVisible();
  await expect(page.getByTestId('card-product').locator('img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Use bottle-study.png' }).click();
  await expect(page.getByText('本地素材，仅存在此浏览器', { exact: false })).toBeVisible();
  await page.getByTestId('card-draft').click();
  await page.getByRole('checkbox', { name: '引用 02 / Original study' }).check();
  await page.getByTestId('run-button').click();
  await expect(page.getByTestId('snapshot-json')).toContainText('asset:');
});

test('M19: wrong type, empty and oversized files are refused with a reason', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await openImageInspector(page);
  await page.getByTestId('asset-input').setInputFiles({ name: 'vector.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.getByTestId('notice')).toContainText('只能添加 PNG / JPEG / WebP 图片或 MP4 视频。');
  await page.getByTestId('asset-input').setInputFiles({ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
  await expect(page.getByTestId('notice')).toContainText('这个文件是空的。');
  const big = Buffer.alloc(5 * 1024 * 1024 + 1);
  await page.getByTestId('asset-input').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: big });
  await expect(page.getByTestId('notice')).toContainText('超过本地上限 5 MB');
  await expect(page.locator('.asset-list li')).toHaveCount(0);
});

test('an asset-backed project survives a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await openImageInspector(page);
  await page.getByTestId('asset-input').setInputFiles(png('reload-study.png'));
  await page.getByRole('button', { name: 'Use reload-study.png' }).click();
  await expect(page.getByTestId('card-product').locator('img')).toHaveCount(1);
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.reload();
  // Reading a project whose media is asset-backed touches the reserved 'assets'
  // object store; before the fix it was outside the read transaction and every
  // reload threw NotFoundError instead of restoring the canvas.
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await expect(page.getByTestId('card-product').locator('img')).toHaveCount(1);
});
