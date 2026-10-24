import { test, expect, type Page } from '@playwright/test';

const viewport = (page: Page) => page.getByTestId('viewport');

const viewportTransform = (page: Page) => page.locator('.react-flow__viewport').evaluate(el => (el as HTMLElement).style.transform);

/** Drift of the grabbed point must stay inside 2 CSS px (FlowForge's own bar). */
async function dragBy(page: Page, dx: number, dy: number) {
  const card = page.getByTestId('card-brief');
  const box = (await card.boundingBox())!;
  const grab = { x: box.x + 40, y: box.y + 20 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  // React Flow consumes the first pointer step to start the drag, so a coarse
  // move lands short by one step; the anchor bar is measured with fine moves.
  const steps = Math.max(24, Math.ceil(Math.hypot(dx, dy)));
  await page.mouse.move(grab.x + dx, grab.y + dy, { steps });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await expect.poll(async () => {
    const after = (await card.boundingBox())!;
    return Math.max(Math.abs(after.x - (box.x + dx)), Math.abs(after.y - (box.y + dy)));
  }).toBeLessThanOrEqual(2);
  return { before: box, after: (await card.boundingBox())!, grab };
}

test('M15: the grabbed point follows the cursor across zoom and pan', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');

  await dragBy(page, 60, 40);

  // zoom out, then drag again
  await page.getByRole('button', { name: '缩小' }).click();
  await expect(viewport(page)).not.toHaveText('100%');
  await dragBy(page, -50, 30);

  // pan with the middle button, then drag again
  const pane = page.locator('.react-flow__pane');
  const p = (await pane.boundingBox())!;
  await page.mouse.move(p.x + 60, p.y + 60);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(p.x + 140, p.y + 120, { steps: 10 });
  await page.mouse.up({ button: 'middle' });
  await dragBy(page, 40, -35);
});

test('M15: canvas shortcuts stay out of the way while text has focus', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByTestId('card-draft').click();
  const transformBefore = await viewportTransform(page);
  const prompt = page.getByLabel('提示词草稿');
  await prompt.click();
  await prompt.press('End');
  await prompt.type('Extra words.');
  await expect(prompt).toHaveValue(/Extra words\.$/);

  await prompt.press('ControlOrMeta+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.getByTestId('history-depth')).toHaveText('1 back / 0 forward');

  await prompt.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(4);

  await prompt.press('Space');
  expect(await viewportTransform(page)).toBe(transformBefore);
});

test('M15: shift click and marquee both raise a multi selection', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');

  await page.getByTestId('card-brief').click();
  await page.getByTestId('card-product').click({ modifiers: ['Shift'] });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);

  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);
  const brief = (await page.getByTestId('card-brief').boundingBox())!;
  const product = (await page.getByTestId('card-product').boundingBox())!;
  await page.mouse.move(brief.x - 8, brief.y - 8);
  await page.mouse.down();
  await page.mouse.move(product.x + product.width + 8, product.y + product.height + 8, { steps: 20 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
});

test('M15: fit recentres and the map toggles the minimap', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByRole('button', { name: '放大' }).click();
  const zoomed = await viewport(page).textContent();
  await page.getByRole('button', { name: '适应视图' }).click();
  await expect(viewport(page)).not.toHaveText(zoomed!);
  const fitted = parseInt((await viewport(page).textContent())!, 10);
  expect(fitted).toBeLessThanOrEqual(100);
  for (const id of ['brief', 'product', 'draft']) {
    const box = (await page.getByTestId(`card-${id}`).boundingBox())!;
    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    expect(box.x).toBeGreaterThan(pane.x - 1);
    expect(box.y).toBeGreaterThan(pane.y - 1);
  }

  await expect(page.locator('.react-flow__minimap')).toHaveCount(1);
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('.react-flow__minimap')).toHaveCount(0);
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('.react-flow__minimap')).toHaveCount(1);
});
