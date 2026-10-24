import { expect, test } from '@playwright/test';

test.describe('slice 6.5 · node hover toolbar', () => {
  test('hovering a node shows the toolbar, delete works and leaving hides it', async ({ page }) => {
    await page.goto('/');
    const card = page.getByTestId('card-brief');
    const toolbar = card.getByTestId('hover-toolbar');

    // Hidden before hover.
    await expect(toolbar).toBeHidden();

    // Text nodes offer edit + copy + delete (no replace/download).
    await card.hover();
    await expect(toolbar).toBeVisible();
    await expect(card.getByRole('button', { name: /编辑 01 \/ Creative brief/u })).toBeVisible();
    await expect(card.getByRole('button', { name: /复制节点 01 \/ Creative brief/u })).toBeVisible();
    await expect(card.getByLabel(/替换素材/u)).toHaveCount(0);
    await expect(card.getByRole('button', { name: /下载 01 \/ Creative brief/u })).toHaveCount(0);

    // Moving off the node collapses the toolbar again.
    await page.getByTestId('inspector').hover();
    await expect(toolbar).toBeHidden();

    // Media nodes offer replace + download + delete, and delete actually removes
    // the node (reusing the inspector's delete path, provider count stays 0).
    const media = page.getByTestId('card-product');
    const mediaToolbar = media.getByTestId('hover-toolbar');
    await media.hover();
    await expect(mediaToolbar).toBeVisible();
    await expect(media.getByRole('button', { name: /下载 02 \/ Original study/u })).toBeVisible();
    await expect(media.getByLabel(/替换素材 02 \/ Original study/u)).toBeAttached();
    await expect(page.getByTestId('provider-calls')).toHaveText('0');
    await media.getByRole('button', { name: /删除节点 02 \/ Original study/u }).click();
    await expect(page.getByTestId('card-product')).toHaveCount(0);
    await expect(page.getByTestId('notice')).toContainText('节点与其候选已删除');
    await expect(page.getByTestId('provider-calls')).toHaveText('0');
  });

  test('the toolbar never blocks the node title and stays hidden while dragging', async ({ page }) => {
    await page.goto('/');
    const card = page.getByTestId('card-brief');
    await card.hover();

    // The toolbar floats above the card and cannot overlap the title row.
    const toolbarBox = await card.getByTestId('hover-toolbar').boundingBox();
    const titleBox = await card.locator('h3').boundingBox();
    expect(toolbarBox!.y + toolbarBox!.height).toBeLessThanOrEqual(titleBox!.y + 1);

    // Start dragging the node: the toolbar must collapse mid-drag.
    const title = card.locator('h3.node-drag');
    await title.hover();
    await page.mouse.down();
    await page.mouse.move(340, 420, { steps: 6 });
    const node = page.locator('.react-flow__node', { has: page.getByTestId('card-brief') });
    await expect(node).toHaveClass(/dragging/u);
    await expect(card.getByTestId('hover-toolbar')).toBeHidden();
    await page.mouse.up();
  });
});
