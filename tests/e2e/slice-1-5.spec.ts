import { expect, test } from '@playwright/test';

test.describe('slice 1.5 · simulated wallet and cost display', () => {
  test('the top bar shows the wallet and the cost badge shows the exact price', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('credits')).toContainText('200');
    await page.getByTestId('card-draft').click();
    await expect(page.getByTestId('cost-badge')).toContainText('5 平台代币');
  });

  test('a simulated run deducts exactly the shown price', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-draft').click();
    await page.getByRole('checkbox', { name: '引用 01 / Creative brief' }).check();
    await expect(page.getByTestId('cost-badge')).toContainText('5 平台代币');
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('run-state')).toHaveText('succeeded', { timeout: 10_000 });
    await expect(page.getByTestId('credits')).toContainText('195');
    await expect(page.getByTestId('run-cost')).toContainText('5');
  });

  test('the wallet panel is explicitly simulated and tops up locally', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('credits').click();
    const panel = page.getByTestId('wallet-panel');
    await expect(panel).toContainText(/本地模拟额度/);
    await expect(panel).toContainText('本版本不提供支付。');
    await page.getByRole('button', { name: 'Top up Starter pack' }).click();
    await expect(page.getByTestId('credits')).toContainText('700');
  });
});
