import { expect, test } from '@playwright/test';

test.describe('slice 1.1 · five node kinds and in-node results', () => {
  test('the add menu offers five kinds and 3D is deferred', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '添加节点' }).click();
    const menu = page.getByRole('menu', { name: 'Node types' });
    for (const label of ['Text', 'Image', 'Video', 'Audio']) await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
    const scene = menu.getByRole('menuitem', { name: '3D · 暂缓' });
    await expect(scene).toBeDisabled();
    await expect(scene).toHaveAttribute('title', /deferred/);
  });

  test('empty media drafts exist, survive a reload and never show an asset', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '添加节点' }).click();
    await page.getByRole('menuitem', { name: 'Video', exact: true }).click();
    await expect(page.getByText('空视频草稿')).toBeVisible();
    await expect(page.getByText('空图片草稿')).toBeVisible();
    await expect(page.getByTestId('save-status')).toContainText(/已保存到本地|Saving/, { timeout: 10_000 });

    await page.reload();
    await expect(page.getByText('空视频草稿')).toBeVisible();
    expect(await page.locator('.react-flow__node').count()).toBe(5);
    const header = page.getByText('空视频草稿').locator('xpath=ancestor::article[1]');
    await expect(header.locator('header')).toContainText('视频 · 草稿');
  });

  test('a simulated run renders its result inside the same node', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-draft').click();
    await page.getByRole('checkbox', { name: '引用 01 / Creative brief' }).check();
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('run-state')).toHaveText('succeeded', { timeout: 10_000 });
    const card = page.getByTestId('card-draft');
    await expect(card.locator('img')).toHaveCount(1);
    await expect(card).toContainText('已模拟');
    expect(await page.locator('.react-flow__node').count()).toBe(4);
    await expect(page.getByTestId('snapshot-count')).toHaveText('1');
  });
});
