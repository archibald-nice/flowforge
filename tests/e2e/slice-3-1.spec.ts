import { expect, test } from '@playwright/test';

async function emptyCanvas(page: import('@playwright/test').Page) {
  await page.goto('/?view=projects');
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByTestId('snapshot-count')).toHaveText('0');
}

test.describe('slice 3.1 · agent composer', () => {
  test('the composer carries the selected node as context and shows the mode', async ({ page }) => {
    await emptyCanvas(page);
    await expect(page.getByTestId('composer-context')).toContainText('先选一个节点');
    await expect(page.getByTestId('mode-toggle')).toHaveText('手动确认');
    await page.getByTestId('mode-toggle').click();
    await expect(page.getByTestId('mode-toggle')).toHaveText('自动执行');
    await page.getByTestId('mode-toggle').click();
    await expect(page.getByTestId('mode-toggle')).toHaveText('手动确认');

    await page.goto('/');
    await page.getByTestId('card-brief').click();
    await expect(page.getByTestId('composer-context')).toContainText('上下文：01 / Creative brief');
  });

  test('sending a message produces a local plan and never calls a provider', async ({ page }) => {
    await emptyCanvas(page);
    await page.getByLabel('给 Agent 发消息').fill('生成一张 1:1 的图');
    await page.getByTestId('composer-send').click();
    await expect(page.getByTestId('composer-log')).toContainText('先选一个节点作为上下文');
    await expect(page.getByTestId('provider-calls')).toHaveText('0');

    await page.goto('/');
    await page.getByTestId('card-product').click();
    await page.getByLabel('给 Agent 发消息').fill('生成一张 1:1 的图');
    await page.getByTestId('composer-send').click();
    await expect(page.getByTestId('composer-log')).toContainText('图片生成');
    await expect(page.getByTestId('provider-calls')).toHaveText('0');
    await expect(page.getByRole('alert')).toContainText('尚未执行');
  });
});
