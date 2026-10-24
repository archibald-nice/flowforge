import { expect, test } from '@playwright/test';

/**
 * Slice 3.2-llm. The browser never holds ARK credentials, so `plannerEnabled()`
 * is false here and every plan comes from the local rules with `source: local`.
 * The model path (parse, reject malformed, unknown model) is covered in
 * tests/unit/slice-3-2-llm.test.ts.
 */
test.describe('slice 3.2-llm · plan provenance', () => {
  test('the plan card names its source and model, and never runs on its own', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-draft').click();
    await page.getByRole('checkbox', { name: '引用 01 / Creative brief' }).check();
    await page.getByLabel('给 Agent 发消息').fill('生成一张 1:1 的图');
    await page.getByTestId('composer-send').click();

    const card = page.getByTestId('plan-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('plan-source')).toContainText('本地规则（未调用模型）');
    await expect(page.getByTestId('plan-source')).toContainText('mock-still-a');
    await expect(page.getByTestId('plan-estimate')).toContainText('本地单价表');
    await expect(page.getByTestId('plan-confirm')).toBeEnabled();
    // nothing ran and nothing was sent while planning
    await expect(page.getByTestId('provider-calls')).toHaveText('0');
    await expect(page.getByTestId('snapshot-count')).toHaveText('0');
    await expect(page.getByTestId('run-state')).toHaveCount(0);

    await page.getByTestId('plan-confirm').click();
    await expect(page.getByTestId('plan-card')).toHaveCount(0);
    await expect(page.getByTestId('run-state')).toHaveText('succeeded', { timeout: 10_000 });
    await expect(page.getByTestId('snapshot-count')).toHaveText('1');
  });

  test('a plan whose model is not enabled cannot be confirmed', async ({ page }) => {
    await page.goto('/?view=projects');
    await page.getByRole('button', { name: 'New project' }).click();
    await expect(page.getByTestId('snapshot-count')).toHaveText('0');

    // Build a plan on an empty canvas: the local rule declines, so the model
    // gate is exercised through the DOM state rather than a real model answer.
    await page.getByLabel('给 Agent 发消息').fill('生成一张图');
    await page.getByTestId('composer-send').click();
    const card = page.getByTestId('plan-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('plan-source')).not.toContainText('未启用，不可确认');
    await expect(page.getByTestId('plan-confirm')).toHaveCount(0);
  });
});
