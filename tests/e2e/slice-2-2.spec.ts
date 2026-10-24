import { expect, test } from '@playwright/test';

const png = (name = 'ok.png', size = 10) => ({ name, mimeType: 'image/png', buffer: Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  Buffer.alloc(Math.max(0, size - 68), 0),
]) });

test.describe('slice 2.2 · upload validation', () => {
  test('a valid PNG is accepted and reported as local only', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-product').click();
    await page.getByTestId('asset-input').setInputFiles(png('accepted.png'));
    await expect(page.getByTestId('asset-accepted.png')).toBeVisible();
    await expect(page.locator('.notice, [role="alert"]').first()).toContainText('未上传');
  });

  test('SVG, empty and oversized files are refused with a reason and stored nowhere', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-product').click();
    const input = page.getByTestId('asset-input');

    await input.setInputFiles({ name: 'vector.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
    await expect(page.getByText('只能添加 PNG / JPEG / WebP 图片或 MP4 视频。')).toBeVisible();

    await input.setInputFiles({ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
    await expect(page.getByText('这个文件是空的。')).toBeVisible();

    await input.setInputFiles(png('huge.png', 5 * 1024 * 1024 + 10));
    await expect(page.getByText(/本地上限 5 MB/)).toBeVisible();

    await expect(page.getByTestId('asset-vector.svg')).toHaveCount(0);
    await expect(page.getByTestId('asset-huge.png')).toHaveCount(0);
    await expect(page.getByTestId('asset-empty.png')).toHaveCount(0);
  });
});
