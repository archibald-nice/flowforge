import { expect, test } from '@playwright/test';

test.describe('slice 3.2 · plan card', () => {
  test('the plan card shows steps and an estimate, and only runs after confirmation', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-draft').click();
    await page.getByRole('checkbox', { name: '引用 01 / Creative brief' }).check();
    await page.getByLabel('给 Agent 发消息').fill('生成一张 1:1 的图');
    await page.getByTestId('composer-send').click();

    const card = page.getByTestId('plan-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('未执行');
    await expect(card.locator('li')).toHaveCount(2);
    await expect(page.getByTestId('plan-estimate')).toContainText('5');
    await expect(page.getByTestId('credits')).toContainText('200');
    await expect(page.getByTestId('snapshot-count')).toHaveText('0');

    await page.getByTestId('plan-confirm').click();
    await expect(page.getByTestId('plan-card')).toHaveCount(0);
    await expect(page.getByTestId('run-state')).toHaveText('succeeded', { timeout: 10_000 });
    await expect(page.getByTestId('credits')).toContainText('195');
    await expect(page.getByTestId('snapshot-count')).toHaveText('1');
  });

  test('canceling a plan executes nothing', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-draft').click();
    await page.getByRole('checkbox', { name: '引用 01 / Creative brief' }).check();
    await page.getByLabel('给 Agent 发消息').fill('生成一张 1:1 的图');
    await page.getByTestId('composer-send').click();
    await page.getByTestId('plan-cancel').click();
    await expect(page.getByTestId('plan-card')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('没有执行任何动作');
    await expect(page.getByTestId('credits')).toContainText('200');
    await expect(page.getByTestId('snapshot-count')).toHaveText('0');
  });
});
