import { expect, test } from '@playwright/test';

/**
 * Slice 3.4 — capability entry is display only: no install, no request, no storage.
 */
test.describe('slice 3.4 · capability entry', () => {
  test('lists skills and connectors as placeholders without touching the network', async ({ page }) => {
    const external: string[] = [];
    page.on('request', request => {
      const url = request.url();
      const local = url.startsWith('http://127.0.0.1:5174') || url.startsWith('data:') || url.startsWith('blob:');
      if (!local) external.push(url);
    });

    await page.goto('/');
    await expect(page.getByTestId('snapshot-count')).toHaveText('0');
    await expect(page.getByTestId('provider-calls')).toHaveText('0');

    await page.getByTestId('capability-toggle').click();
    const panel = page.getByTestId('capability-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('占位条目');

    for (const kind of ['skill', 'connector']) {
      const section = page.getByTestId(`capability-section-${kind}`);
      await expect(section.locator('li')).toHaveCount(4);
      await expect(section.getByText('未接入')).toHaveCount(4);
    }

    await page.getByTestId('capability-skill-storyboard').click();
    await expect(page.getByTestId('capability-detail-skill-storyboard')).toContainText('placeholder');
    await expect(page.getByTestId('provider-calls')).toHaveText('0');
    await expect(page.getByTestId('snapshot-count')).toHaveText('0');
    expect(external).toEqual([]);
  });

  test('escape closes the panel and leaves the canvas untouched', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('card-draft')).toHaveCount(1);
    await page.getByTestId('capability-toggle').click();
    await expect(page.getByTestId('capability-panel')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('capability-panel')).toHaveCount(0);
    await expect(page.getByTestId('snapshot-count')).toHaveText('0');
    await expect(page.getByTestId('card-draft')).toHaveCount(1);

    // the close button path behaves the same
    await page.getByTestId('capability-toggle').click();
    await page.getByTestId('capability-connector-dam').click();
    await page.getByTestId('capability-close').click();
    await expect(page.getByTestId('capability-panel')).toHaveCount(0);
    await expect(page.getByTestId('snapshot-count')).toHaveText('0');
  });
});
