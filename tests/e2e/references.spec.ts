import { test, expect, type Page } from '@playwright/test';

const external = (page: Page) => {
  const seen: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:5174/') && !url.startsWith('blob:http://127.0.0.1:5174/')) seen.push(url);
  });
  return seen;
};

const connectThirdCandidate = async (page: Page) => {
  // The minimap sits above the lower-right node, so hide it before dragging a handle.
  await page.getByRole('button', { name: 'Map' }).click();
  const source = page.getByTestId('card-other').locator('.react-flow__handle.source');
  const target = page.getByTestId('card-draft').locator('.react-flow__handle.target');
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('handles not measurable');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole('alert')).toContainText('已添加候选；未调用模型。');
};

const providerCalls = async (page: Page) => {
  await page.getByText('存储诊断', { exact: true }).click();
  return page.getByTestId('provider-calls');
};

test('M09: only referenced inputs enter the snapshot, the edge-only neighbour does not', async ({ page }) => {
  const outside = external(page);
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await connectThirdCandidate(page);
  await page.getByTestId('card-draft').click();

  await expect(page.getByRole('checkbox', { name: '引用 Unconnected note' })).toHaveCount(1);
  await page.getByRole('checkbox', { name: '引用 01 / Creative brief' }).check();
  await page.getByRole('checkbox', { name: '引用 02 / Original study' }).check();
  await expect(page.getByTestId('reference-brief')).toHaveCount(1);
  await expect(page.getByTestId('reference-product')).toHaveCount(1);
  await expect(page.getByTestId('reference-other')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '引用 Unconnected note' })).not.toBeChecked();

  await page.getByTestId('run-button').click();
  await expect(page.getByRole('alert')).toContainText('模拟运行已记录；未发起网络请求。');
  await expect(page.getByTestId('simulated-result')).toContainText('simulated-only');
  await expect(await providerCalls(page)).toHaveText('1');

  const snapshot = JSON.parse(await page.getByTestId('snapshot-json').innerText());
  expect(snapshot.inputs.map((input: { nodeId: string }) => input.nodeId)).toEqual(['brief', 'product']);
  expect(snapshot.inputs.every((input: { revision: number }) => Number.isSafeInteger(input.revision))).toBe(true);
  expect(snapshot.inputs.some((input: { nodeId: string }) => input.nodeId === 'other')).toBe(false);
  expect(outside).toEqual([]);
});

test('M10: a reference can be removed and repurposed without touching the line or spending a call', async ({ page }) => {
  const outside = external(page);
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByRole('checkbox', { name: '引用 01 / Creative brief' }).check();
  await page.getByRole('checkbox', { name: '引用 02 / Original study' }).check();
  await expect(page.getByTestId('reference-product')).toHaveCount(1);

  await page.getByLabel('Purpose of 01 / Creative brief').selectOption('first-frame');
  await expect(page.getByLabel('Purpose of 01 / Creative brief')).toHaveValue('first-frame');
  await expect(page.getByRole('alert')).toContainText('用途已设为首帧（本地标签，未调用模型）。');

  await page.getByRole('button', { name: 'Remove reference 02 / Original study' }).click();
  await expect(page.getByRole('alert')).toContainText('已从提示词移除引用；连线与源节点保持不变，未调用模型。');
  await expect(page.getByTestId('reference-product')).toHaveCount(0);
  await expect(page.getByTestId('reference-brief')).toHaveCount(1);
  // The candidate line and the image node survive the prompt-level removal.
  await expect(page.getByRole('checkbox', { name: '引用 02 / Original study' })).not.toBeChecked();
  await expect(page.locator('.project-stats strong').nth(1)).toHaveText('2');

  await page.getByTestId('run-button').click();
  await expect(await providerCalls(page)).toHaveText('1');
  const snapshot = JSON.parse(await page.getByTestId('snapshot-json').innerText());
  expect(snapshot.inputs.map((input: { nodeId: string }) => input.nodeId)).toEqual(['brief']);
  expect(snapshot.inputs[0].role).toBe('first-frame');
  expect(outside).toEqual([]);
});
