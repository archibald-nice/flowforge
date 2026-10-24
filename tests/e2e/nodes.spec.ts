import { test, expect } from '@playwright/test';

const external = (page: import('@playwright/test').Page) => {
  const seen: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:5174/') && !url.startsWith('blob:http://127.0.0.1:5174/')) seen.push(url);
  });
  return seen;
};

test('M07: the five node kinds can be created, edited and deleted without capability tools', async ({ page }) => {
  const outside = external(page);
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  const stats = page.locator('.project-stats strong').first();
  await expect(stats).toHaveText('4');

  await page.getByRole('button', { name: '添加节点' }).click();
  const menu = page.getByRole('menu', { name: 'Node types' });
  await expect(menu.getByRole('menuitem')).toHaveCount(5);
  await expect(menu.getByRole('menuitem').nth(0)).toHaveText('文本');
  await expect(menu.getByRole('menuitem').nth(1)).toHaveText('图片');
  await expect(menu.getByRole('menuitem').nth(2)).toHaveText('视频');
  await expect(menu.getByRole('menuitem').nth(3)).toHaveText('音频');
  await expect(menu.getByRole('menuitem').nth(4)).toHaveText('3D · 暂缓');
  await expect(menu.getByRole('menuitem').nth(4)).toBeDisabled();
  const menuText = await menu.innerText();
  for (const blocked of ['Timeline', 'Scene director', 'editor', 'Editor']) {
    expect(menuText).not.toContain(blocked);
  }

  await menu.getByRole('menuitem', { name: 'Text' }).click();
  await expect(stats).toHaveText('5');
  await expect(menu).toHaveCount(0);
  await page.getByRole('textbox', { name: '节点标题' }).fill('M07 note');
  await page.getByRole('textbox', { name: '简报正文' }).fill('Editable copy written in the inspector.');
  await expect(page.getByText('M07 note').first()).toBeVisible();
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');

  await page.getByRole('button', { name: '添加节点' }).click();
  await page.getByRole('menuitem', { name: 'Image', exact: true }).click();
  await expect(stats).toHaveText('6');
  await expect(page.getByRole('textbox', { name: '节点标题' })).toHaveValue('New image');
  await expect(page.getByTestId('empty-image')).toContainText('空图片草稿');

  await page.getByRole('button', { name: '添加节点' }).click();
  await page.getByRole('menuitem', { name: 'Video', exact: true }).click();
  await expect(stats).toHaveText('7');
  await expect(page.getByRole('textbox', { name: '提示词草稿' })).toHaveValue('');
  await page.getByRole('textbox', { name: '提示词草稿' }).fill('A calmer crop, nothing generated.');
  await expect(page.getByRole('textbox', { name: '提示词草稿' })).toHaveValue('A calmer crop, nothing generated.');

  await page.getByTestId('inspector-delete').click();
  await expect(stats).toHaveText('6');
  await page.getByTestId('card-brief').click();
  await expect(page.getByRole('textbox', { name: '节点标题' })).toHaveValue('01 / Creative brief');
  await page.getByText('存储诊断', { exact: true }).click();
  await expect(page.getByTestId('provider-calls')).toHaveText('0');
  expect(outside).toEqual([]);
});

test('M08: a candidate edge is created and removed with zero provider calls', async ({ page }) => {
  const outside = external(page);
  await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  // The minimap sits above the lower-right node, so hide it before dragging a handle.
  await page.getByRole('button', { name: 'Map' }).click();
  const source = page.getByTestId('card-other').locator('.react-flow__handle.source');
  const target = page.getByTestId('card-draft').locator('.react-flow__handle.target');
  await expect(source).toBeVisible();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('handles not measurable');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole('alert')).toContainText('已添加候选；未调用模型。');
  const candidates = page.getByRole('checkbox', { name: /引用 Unconnected note/ });
  await expect(candidates).toHaveCount(1);
  await expect(page.locator('.project-stats strong').nth(1)).toHaveText('3');
  await page.getByTestId('card-draft').click();
  await page.getByRole('checkbox', { name: /引用 Unconnected note/ }).check();
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByRole('button', { name: '移除候选 Unconnected note' }).click();
  await expect(page.getByRole('alert')).toContainText('候选已移除；未调用模型。');
  await expect(page.getByRole('checkbox', { name: /引用 Unconnected note/ })).toHaveCount(0);
  await expect(page.locator('.project-stats strong').nth(1)).toHaveText('2');
  await page.getByText('存储诊断', { exact: true }).click();
  await expect(page.getByTestId('provider-calls')).toHaveText('0');
  expect(outside).toEqual([]);
});
