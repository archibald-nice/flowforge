import { test, expect, type Page } from '@playwright/test';

const external = (page: Page) => {
  const seen: string[] = [];
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:5174/') && !url.startsWith('blob:http://127.0.0.1:5174/')) seen.push(url);
  });
  return seen;
};

test('M03: new project, rename, reload the list and reopen with content intact', async ({ page }) => {
  const outside = external(page);
  await page.goto('/?view=projects');
  await expect(page.getByTestId('projects-empty')).toContainText('还没有本地项目。');

  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page).toHaveURL(/\?project=project-/);
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await expect(page.locator('.project-stats strong').first()).toHaveText('0');

  await page.getByRole('button', { name: '添加节点' }).click();
  await page.getByRole('menuitem', { name: 'Text', exact: true }).click();
  await page.getByRole('textbox', { name: '节点标题' }).fill('M03 note');
  await page.getByRole('textbox', { name: '简报正文' }).fill('Written after the project was created.');
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');

  await page.getByRole('link', { name: '← 项目' }).click();
  await expect(page.getByRole('list', { name: 'Local projects' })).toBeVisible();
  const row = page.locator('.project-row').first();
  await expect(row.locator('.project-name input')).toHaveValue('Untitled project');
  await expect(row.locator('.project-meta')).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  await expect(row.locator('.project-meta')).toContainText(/r\d+/);

  await row.locator('.project-name input').fill('Rehearsal one');
  await row.locator('.project-name input').press('Enter');
  await expect(page.getByTestId('list-status')).toHaveText('本地列表就绪');
  await expect(page.locator('.project-name input').first()).toHaveValue('Rehearsal one');

  await page.reload();
  await expect(page.getByRole('list', { name: 'Local projects' })).toBeVisible();
  await expect(page.locator('.project-name input').first()).toHaveValue('Rehearsal one');
  await expect(page.getByTestId('projects-empty')).toHaveCount(0);

  await page.getByRole('button', { name: 'Open Rehearsal one' }).click();
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await expect(page.getByTestId('card-M03 note')).toHaveCount(0);
  await expect(page.locator('.node-card', { hasText: 'M03 note' })).toBeVisible();
  await expect(page.locator('.node-card', { hasText: 'Written after the project was created.' })).toBeVisible();
  expect(outside).toEqual([]);
});
