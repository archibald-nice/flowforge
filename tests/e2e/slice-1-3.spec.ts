import { expect, test } from '@playwright/test';

// Slice 1.3: the dev server's video availability is pinned by playwright.config.ts
// (E2E_ARK_VIDEO_ENABLED, default '1'; a shell value overrides it). The client
// only ever learns a boolean: the endpoint id and the key stay in node context,
// so a browser-side real video run refuses with a clear notice and no request.

const VIDEO_OPTION = /Seedance/;

async function addVideoDraft(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '添加节点' }).click();
  await page.getByRole('menuitem', { name: 'Video', exact: true }).click();
  const card = page.getByText('空视频草稿').locator('xpath=ancestor::article[1]');
  await card.click();
  return card;
}

test.describe('slice 1.3 · real video generation gating', () => {
  test('flag on: a video draft offers the real model, its shape and its 平台代币 cost', async ({ page }) => {
    test.skip(process.env.E2E_ARK_VIDEO_ENABLED !== '1', 'requires E2E_ARK_VIDEO_ENABLED=1');
    await addVideoDraft(page);
    const model = page.getByLabel('Model');
    await expect(model.locator('option').filter({ hasText: VIDEO_OPTION })).toHaveCount(1);
    await expect(page.getByTestId('cost-badge')).toContainText('模拟');
    await model.selectOption('ark-video-endpoint');
    await expect(page.getByTestId('cost-badge')).toContainText('24 平台代币');
    await expect(page.getByTestId('cost-badge')).toContainText('真实（视频）');
    await expect(page.getByLabel('Size')).toHaveValue('480p · 4s');
  });

  test('flag off: no real video option exists at all', async ({ page }) => {
    test.skip(process.env.E2E_ARK_VIDEO_ENABLED === '1', 'requires E2E_ARK_VIDEO_ENABLED off');
    await addVideoDraft(page);
    await expect(page.getByLabel('Model').locator('option').filter({ hasText: VIDEO_OPTION })).toHaveCount(0);
  });

  test('a real video selection arms nothing by itself: no reference, no run, no provider call', async ({ page }) => {
    test.skip(process.env.E2E_ARK_VIDEO_ENABLED !== '1', 'requires E2E_ARK_VIDEO_ENABLED=1');
    await addVideoDraft(page);
    await page.getByLabel('Model').selectOption('ark-video-endpoint');
    // Picking a real model only changes the form; the run button stays disarmed
    // until at least one explicit input is referenced (invariant from slice M09).
    await expect(page.getByTestId('run-button')).toBeDisabled();
    await expect(page.getByTestId('provider-calls')).toHaveText('0');
    await expect(page.getByTestId('video-panel')).toHaveCount(0);
    await expect(page.getByTestId('snapshot-count')).toHaveText('0');
  });
});
