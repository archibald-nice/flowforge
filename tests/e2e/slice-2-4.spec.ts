import { expect, test } from '@playwright/test';

const png = { name: 'clip-b.png', mimeType: 'image/png', buffer: Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') };

test.describe('slice 2.4 · timeline', () => {
  test('a timeline needs two clips, trims, and merges a simulated cut', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('timeline-toggle').click();
    await expect(page.getByRole('alert')).toContainText('至少需要 2 段素材');

    await page.getByTestId('card-draft').click();
    await page.getByTestId('asset-input').setInputFiles(png);
    await expect(page.getByTestId('asset-clip-b.png')).toBeVisible();
    await page.getByRole('button', { name: 'Use clip-b.png' }).click();
    await expect(page.getByRole('button', { name: 'Timeline' })).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('timeline-toggle').click();
    const panel = page.getByTestId('timeline-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('timeline-duration')).toHaveText('10 s');

    await panel.getByLabel('Out product').fill('3');
    await expect(panel.getByTestId('timeline-duration')).toHaveText('8 s');
    await panel.getByRole('button', { name: '在此剪切' }).first().click();
    await panel.getByTestId('timeline-merge').click();
    await expect(page.getByTestId('timeline-panel')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('已把模拟剪辑合并回画布');
    await expect(page.getByTestId('provider-calls')).toHaveText('0');
  });
});
