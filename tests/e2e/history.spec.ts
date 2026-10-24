import { test, expect, type Page } from '@playwright/test';

const external = (page: Page) => {
  const seen: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:5174/') && !url.startsWith('blob:http://127.0.0.1:5174/')) seen.push(url);
  });
  return seen;
};

const counts = async (page: Page) => ({
  nodes: await page.locator('.react-flow__node').count(),
  edges: await page.locator('.react-flow__edge').count(),
});

const depth = (page: Page) => page.getByTestId('history-depth');
const undo = (page: Page) => page.getByRole('button', { name: '撤销画布操作' });
const redo = (page: Page) => page.getByRole('button', { name: '重做画布操作' });

test('M14: create, edit, copy and delete undo and redo one step at a time', async ({ page }) => {
  const outside = external(page);
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await expect(depth(page)).toHaveText('0 back / 0 forward');
  await expect(undo(page)).toBeDisabled();

  // create
  await page.getByRole('button', { name: '添加节点' }).click();
  await page.getByRole('menuitem', { name: 'Text' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await expect(depth(page)).toHaveText('1 back / 0 forward');
  await undo(page).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(depth(page)).toHaveText('0 back / 1 forward');
  await redo(page).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(5);

  // edit: the title field belongs to the selected node
  await page.getByRole('button', { name: '添加节点' }).click();
  await page.getByRole('menuitem', { name: 'Text' }).click();
  await page.getByLabel('节点标题').fill('History check');
  await undo(page).click();
  await expect(page.getByLabel('节点标题')).not.toHaveValue('History check');
  await redo(page).click();
  await expect(page.getByLabel('节点标题')).toHaveValue('History check');

  // copy
  const before = await counts(page);
  await page.getByTestId('inspector-copy').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(before.nodes + 1);
  await undo(page).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(before.nodes);
  await redo(page).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(before.nodes + 1);

  // delete
  await page.getByTestId('inspector-delete').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(before.nodes);
  await undo(page).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(before.nodes + 1);

  await page.getByText('存储诊断', { exact: true }).click();
  await expect(page.getByTestId('provider-calls')).toHaveText('0');
  expect(outside).toEqual([]);
});

test('M14: one drag is one step, and undo restores the position', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  const card = page.getByTestId('card-brief');
  const start = (await card.boundingBox())!;
  await page.mouse.move(start.x + 40, start.y + 20);
  await page.mouse.down();
  await page.mouse.move(start.x + 100, start.y + 70, { steps: 12 });
  await page.mouse.up();
  await expect(depth(page)).toHaveText('1 back / 0 forward');

  const dragged = (await card.boundingBox())!;
  expect(Math.round(dragged.x - start.x)).toBeGreaterThan(40);
  await undo(page).click();
  await expect.poll(async () => Math.abs(((await card.boundingBox())?.x ?? 0) - start.x)).toBeLessThanOrEqual(2);
  await expect.poll(async () => Math.abs(((await card.boundingBox())?.y ?? 0) - start.y)).toBeLessThanOrEqual(2);
  await redo(page).click();
  await expect.poll(async () => Math.abs(((await card.boundingBox())?.x ?? 0) - dragged.x)).toBeLessThanOrEqual(2);
});

test('M14: a candidate edge undoes and redoes without provider calls', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByRole('button', { name: 'Map' }).click();
  const source = page.getByTestId('card-other').locator('.react-flow__handle.source');
  const target = page.getByTestId('card-draft').locator('.react-flow__handle.target');
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await undo(page).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);
  await redo(page).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
});
