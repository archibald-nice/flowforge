import { expect, test } from '@playwright/test';

/**
 * Slice 6.6: `.workspace` used to declare three columns while only two
 * in-flow children exist (`aside.rail` is absolutely positioned). The
 * ≥1700px and ≤1050px media queries wrote that three-column declaration
 * back, so on wide screens the canvas was squeezed into the 64px column and
 * the inspector took the whole `1fr` row. These assertions pin the grid
 * against a regression at both breakpoints.
 */
const cases = [
  { width: 1920, height: 1080, inspector: 360 },
  { width: 1600, height: 900, inspector: 320 },
];

for (const view of cases) {
  test(`workspace keeps two columns at ${view.width}×${view.height}`, async ({ page }) => {
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.goto('/');
    await page.waitForSelector('.react-flow__pane');

    const inspector = await page.locator('.inspector').boundingBox();
    const stage = await page.locator('.canvas-stage').boundingBox();
    expect(inspector).not.toBeNull();
    expect(stage).not.toBeNull();
    if (!inspector || !stage) return;

    // The inspector keeps its declared column width instead of spanning a row.
    expect(Math.abs(inspector.width - view.inspector)).toBeLessThanOrEqual(4);
    // The canvas stage starts at the left edge and stops where the inspector begins.
    expect(Math.abs(stage.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(stage.width - (view.width - view.inspector))).toBeLessThanOrEqual(4);
    // Both sit on the same row: identical top and bottom edges.
    expect(Math.abs(stage.y - inspector.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(stage.height - inspector.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(inspector.x - (view.width - view.inspector))).toBeLessThanOrEqual(4);
  });
}
