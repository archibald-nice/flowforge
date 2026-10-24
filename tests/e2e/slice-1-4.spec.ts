import { expect, test } from '@playwright/test';

// Slice 1.4: the dev server's SPEECH_ENABLED is pinned by playwright.config.ts
// (E2E_SPEECH_ENABLED, default '1'; a shell value overrides it), so the host's
// .env.local cannot flip these expectations. Nothing here performs a real call.

const SPEECH_OPTION = /豆包语音/;

async function audioDraft(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '添加节点' }).click();
  await page.getByRole('menuitem', { name: 'Audio', exact: true }).click();
  const audio = page.locator('.react-flow__node[data-id^="audio-"]').last();
  await expect(audio).toBeVisible();
  await audio.click();
  return page.getByLabel('Model');
}

test.describe('slice 1.4 · real speech generation gating', () => {
  test('flag on: the audio form offers the real speech model', async ({ page }) => {
    test.skip(process.env.E2E_SPEECH_ENABLED !== '1', 'requires E2E_SPEECH_ENABLED=1');
    const model = await audioDraft(page);
    await expect(model.locator('option').filter({ hasText: SPEECH_OPTION })).toHaveCount(1);
    // Mock options stay available, so a user can always fall back to simulated.
    await expect(model).toContainText('mock-still-a');
  });

  test('flag on: selecting the speech model flips the badge and the audio shape', async ({ page }) => {
    test.skip(process.env.E2E_SPEECH_ENABLED !== '1', 'requires E2E_SPEECH_ENABLED=1');
    const model = await audioDraft(page);
    await expect(page.getByTestId('cost-badge')).toContainText('模拟');
    await model.selectOption('seed-audio-1.0');
    await expect(page.getByTestId('cost-badge')).toContainText('真实（语音）');
    await expect(page.getByTestId('cost-badge')).toContainText('100 平台代币/分钟');
    await expect(page.getByLabel('Size')).toHaveValue('mp3 48kHz');
  });

  test('flag off: the audio form never offers the real speech model', async ({ page }) => {
    test.skip(process.env.E2E_SPEECH_ENABLED === '1', 'requires E2E_SPEECH_ENABLED off');
    const model = await audioDraft(page);
    await expect(model.locator('option').filter({ hasText: SPEECH_OPTION })).toHaveCount(0);
    await expect(page.getByTestId('cost-badge')).toContainText('模拟');
  });
});
