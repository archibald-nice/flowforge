import { expect, test } from '@playwright/test';

// Slice 3.3: the dev server's ARK_ENABLED is pinned by playwright.config.ts
// (E2E_ARK_ENABLED, default '1'; a shell value overrides it). The host's
// .env.local no longer leaks into these tests. The HTTP layer is either the
// mock provider (no network) or route interception below; nothing leaves.

const ARK_OPTION = /方舟/;

test.describe('slice 1.2 · real Ark generation gating', () => {
  test('mock models stay offered; the default badge matches the selected model', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-draft').click();
    const model = page.getByLabel('Model');
    // Mock options are always present regardless of the flag.
    await expect(model).toContainText('mock-still-a');
    await expect(model).toContainText('mock-still-b');
    // Default selection is the first mock model, so the badge is simulated.
    await expect(page.getByTestId('cost-badge')).toContainText('模拟');
  });

  test('flag on: the Ark option appears, selecting it flips the badge to real', async ({ page }) => {
    test.skip(process.env.E2E_ARK_ENABLED !== '1', 'requires E2E_ARK_ENABLED=1');
    await page.goto('/');
    await page.getByTestId('card-draft').click();
    const model = page.getByLabel('Model');
    await expect(model.locator('option').filter({ hasText: ARK_OPTION })).toHaveCount(1);
    await model.selectOption({ index: 2 }); // the ark endpoint entry
    await expect(page.getByTestId('cost-badge')).toContainText('真实（方舟）');
  });

  test('flag off: no Ark option exists at all', async ({ page }) => {
    test.skip(process.env.E2E_ARK_ENABLED === '1', 'requires E2E_ARK_ENABLED off');
    await page.goto('/');
    await page.getByTestId('card-draft').click();
    const model = page.getByLabel('Model');
    await expect(model.locator('option')).toHaveCount(2);
    await expect(model.locator('option').filter({ hasText: ARK_OPTION })).toHaveCount(0);
  });
});
