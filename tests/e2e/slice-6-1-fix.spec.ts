import { expect, test } from '@playwright/test';

test.describe('slice 6.1-fix · simulated placeholder matches the dark interface', () => {
  test('the simulated result placeholder is dark, Chinese and free of all-caps labels', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('card-draft').click();
    await page.getByRole('checkbox', { name: '引用 01 / Creative brief' }).check();
    await page.getByTestId('run-button').click();
    await expect(page.getByTestId('run-state')).toHaveText('succeeded', { timeout: 10_000 });

    const image = page.getByTestId('card-draft').locator('img');
    await expect(image).toHaveCount(1);
    await expect(image).toHaveAttribute('alt', '节点图片');

    const src = await image.getAttribute('src');
    expect(src).toContain('data:image/svg+xml');
    const svg = decodeURIComponent(src!.slice(src!.indexOf(',') + 1));

    // Dark surface: `--surface-3` background with a `--line` stroke.
    expect(svg).toContain('fill="#121212"');
    expect(svg).toContain('stroke="#3b3b38"');

    // System font stack instead of the old serif face.
    expect(svg).not.toContain('Georgia');
    expect(svg).toContain('PingFang SC');

    const labels = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/gu)].map(match => match[1]);
    expect(labels[0]).toBe('图片 · 模拟结果');
    expect(labels).toContain('本地占位图，无模型产物');
    for (const label of labels) {
      expect(label).not.toMatch(/[A-Z]{3,}/u);
      expect(label).not.toContain('SIMULATED');
    }
  });
});
