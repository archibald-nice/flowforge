import { test, expect } from '@playwright/test';

test('explicit snapshot and edited content survive reload without external requests', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:5174/') && !url.startsWith('blob:http://127.0.0.1:5174/')) external.push(url);
  });
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByTestId('freeze-button').click();
  await expect(page.getByRole('alert')).toContainText('请至少勾选一项显式输入');
  await expect(page.getByTestId('snapshot-count')).toHaveText('0');
  await page.getByRole('checkbox', { name: '引用 01 / Creative brief' }).check();
  await page.getByTestId('freeze-button').click();
  const snapshot = JSON.parse(await page.getByTestId('snapshot-json').innerText());
  expect(snapshot.inputs.map((input: { nodeId: string }) => input.nodeId)).toEqual(['brief']);
  await page.getByTestId('card-brief').click();
  await page.getByRole('textbox', { name: '简报正文' }).fill('A new, original draft after the snapshot.');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.reload();
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await expect(page.getByTestId('card-brief')).toContainText('A new, original draft');
  expect(JSON.parse(await page.getByTestId('snapshot-json').innerText())).toEqual(snapshot);
  await expect(page.getByRole('checkbox', { name: '引用 01 / Creative brief' })).toBeChecked();
  expect(external).toEqual([]);
});

test('transaction error does not show saved; local retry recovers', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByText('存储诊断', { exact: true }).click();
  await page.getByRole('button', { name: '模拟下一次写失败' }).click();
  await expect(page.getByTestId('save-status')).toContainText('保存失败');
  await expect(page.getByRole('alert')).toContainText('模拟的本地写入失败');
  await page.getByRole('button', { name: '重试本地保存' }).click();
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
});

test('two tabs cannot overwrite a newer persisted revision', async ({ page, context }) => {
  await page.goto('/'); await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  const second = await context.newPage(); await second.goto('/'); await expect(second.getByTestId('save-status')).toContainText('已保存到本地');
  // Loading a saved revision must not itself write a new revision.
  await second.waitForTimeout(700);
  const before = await page.getByTestId('save-status').innerText();
  expect(await second.getByTestId('save-status').innerText()).toEqual(before);
  await page.getByRole('textbox', { name: '提示词草稿' }).fill('First tab wins a committed revision.');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await second.getByRole('textbox', { name: '提示词草稿' }).fill('Second tab stale draft.');
  await expect(second.getByTestId('save-status')).toContainText('有冲突');
  await expect(second.getByRole('textbox', { name: '提示词草稿' })).toHaveValue('Second tab stale draft.');
  await second.getByText('存储诊断', { exact: true }).click();
  await second.getByRole('button', { name: '重载已存版本' }).click();
  await expect(second.getByRole('textbox', { name: '提示词草稿' })).toHaveValue('First tab wins a committed revision.');
});

test('drag, anchored zoom, pan, multiselect and fit work; text editing does not remove nodes', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  const brief = page.getByTestId('card-brief');
  const header = (await brief.locator('header').boundingBox())!;
  await page.mouse.move(header.x + 70, header.y + 12); await page.mouse.down();
  // React Flow starts at the threshold-crossing pointer, not pointerdown.
  await page.mouse.move(header.x + 75, header.y + 12);
  const before = (await brief.boundingBox())!;
  await page.mouse.move(header.x + 155, header.y + 62, { steps: 12 }); await page.mouse.up();
  const after = (await brief.boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(80, 0); expect(after.y - before.y).toBeCloseTo(50, 0);
  await page.keyboard.down('Shift'); await page.getByTestId('card-draft').click(); await page.keyboard.up('Shift');
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  const rect = (await page.locator('.canvas-stage').boundingBox())!;
  const point = { x: after.x + 90, y: after.y + 70 };
  await page.mouse.move(point.x, point.y); await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await expect.poll(async () => (await brief.boundingBox())!.width).toBeGreaterThan(after.width);
  const zoomed = (await brief.boundingBox())!;
  const scale = zoomed.width / after.width;
  expect(Math.abs((point.x - zoomed.x) - (point.x - after.x) * scale)).toBeLessThanOrEqual(2);
  expect(Math.abs((point.y - zoomed.y) - (point.y - after.y) * scale)).toBeLessThanOrEqual(2);
  await page.mouse.move(rect.x + rect.width - 30, rect.y + 50); await page.mouse.wheel(80, 70);
  await expect.poll(async () => (await brief.boundingBox())!.x).not.toBe(zoomed.x);
  await page.getByRole('button', { name: '适应视图', exact: true }).click();
  await expect(page.locator('.react-flow__minimap')).toBeVisible();
  await brief.click(); await page.getByRole('textbox', { name: '简报正文' }).focus();
  await page.keyboard.press('Meta+z'); await page.keyboard.press('Backspace');
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await expect(page.getByRole('textbox', { name: '简报正文' })).toBeFocused();
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  const persisted = await brief.boundingBox(); await page.reload();
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  const recovered = (await brief.boundingBox())!;
  expect(recovered.x).toBeCloseTo(persisted!.x, 0); expect(recovered.y).toBeCloseTo(persisted!.y, 0);
});

test('small screens show a readable project summary without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await expect(page.getByText('需要更大的屏幕。')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '提示词草稿' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('selected nodes move together and discarding a pending draft does not write', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByTestId('card-brief').click();
  await page.getByTestId('card-draft').click({ modifiers: ['Shift'] });
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  const brief = page.getByTestId('card-brief'); const draft = page.getByTestId('card-draft');
  const startA = (await brief.boundingBox())!; const startB = (await draft.boundingBox())!;
  const header = (await brief.locator('header').boundingBox())!;
  await page.mouse.move(header.x + 40, header.y + 12); await page.mouse.down();
  await page.mouse.move(header.x + 45, header.y + 12);
  await page.mouse.move(header.x + 105, header.y + 42, { steps: 10 }); await page.mouse.up();
  const endA = (await brief.boundingBox())!; const endB = (await draft.boundingBox())!;
  expect(endA.x - startA.x).toBeCloseTo(60, 0);
  expect(endB.x - startB.x).toBeCloseTo(60, 0);
  expect(endB.y - endA.y).toBeCloseTo(startB.y - startA.y, 0);
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByText('存储诊断', { exact: true }).click();
  const revision = await page.getByTestId('stored-revision').innerText();
  await page.getByRole('textbox', { name: '提示词草稿' }).fill('Discard me before autosave.');
  await page.getByRole('button', { name: '重载已存版本' }).click();
  await expect(page.getByRole('textbox', { name: '提示词草稿' })).toHaveValue('A quieter direction, with clear product focus.');
  await page.waitForTimeout(700);
  await expect(page.getByTestId('stored-revision')).toHaveText(revision);
});
