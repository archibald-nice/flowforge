import { expect, test } from '@playwright/test';

test.describe('slice 6.5-fix · local MP4 replacement for video nodes', () => {
  test('replacing a video node with a local mp4 renders a playable video and calls no provider', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.react-flow__pane');

    // Create a video draft, then replace its media from the hover toolbar.
    await page.getByRole('button', { name: '添加节点' }).click();
    await page.getByRole('menuitem', { name: 'Video' }).click();
    // Node ids are generated, so address the newest card by its toolbar label.
    const card = page.locator('article.node-card', { has: page.getByLabel('替换素材 New video') });
    await expect(card).toBeVisible();

    await card.hover();
    await card.getByLabel('替换素材 New video').setInputFiles('public/fixtures/sample-clip.mp4');

    await expect(page.getByTestId('notice')).toContainText('素材已替换为 sample-clip.mp4');
    const video = card.getByTestId('node-video');
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute('src', /^blob:/u);
    await expect(video).toHaveAttribute('controls', '');
    await expect(video).toHaveAttribute('playsinline', '');

    // A replacement is local file handling, never a model call.
    await expect(page.getByTestId('provider-calls')).toHaveText('0');
    // The empty-draft placeholder is gone and no `<img>` fallback is left.
    await expect(card.getByTestId('empty-asset')).toHaveCount(0);
    await expect(card.locator('img')).toHaveCount(0);
  });
});
