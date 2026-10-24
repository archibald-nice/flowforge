import { test, expect } from '@playwright/test';

test('image bytes and snapshot paths survive refresh without fixture network', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  const image = page.getByTestId('card-product').locator('img');
  const oldUrl = await image.getAttribute('src'); expect(oldUrl).toMatch(/^blob:/);
  await page.getByRole('checkbox', { name: '引用 02 / Original study' }).check();
  await page.getByTestId('freeze-button').click();
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  const snapshot = JSON.parse(await page.getByTestId('snapshot-json').innerText());
  expect(snapshot.inputs[0].assetPath).toBe('/fixtures/study-01.png');
  let fixtureRequests = 0;
  await page.route('**/fixtures/*.png', route => { fixtureRequests++; return route.abort(); });
  await page.reload(); await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(320);
  expect(await image.getAttribute('src')).not.toBe(oldUrl);
  expect(JSON.parse(await page.getByTestId('snapshot-json').innerText())).toEqual(snapshot);
  expect(fixtureRequests).toBe(0);
});

test('project and Blob writes roll back together, then retry commits both', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  const result = await page.evaluate(async () => {
    const storePath: string = '/src/persistence/project-store.ts'; const domainPath: string = '/src/domain/project.ts';
    const { ProjectStore } = await import(storePath); const { demoProject } = await import(domainPath);
    const store = new ProjectStore('atomic-proof'); const project = demoProject();
    store.failNextSave = true; let failure = '';
    try { await store.save(project, null); } catch (error) { failure = String(error); }
    const counts = () => new Promise<number[]>(resolve => {
      const open = indexedDB.open('atomic-proof');
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction(['projects', 'media'], 'readonly');
        const projects = tx.objectStore('projects').count(); const media = tx.objectStore('media').count();
        tx.oncomplete = () => { resolve([projects.result, media.result]); db.close(); };
      };
    });
    const afterFailure = await counts(); const saved = await store.save(project, null);
    return { failure, afterFailure, afterRetry: await counts(), revision: saved.revision, mediaVersion: saved.mediaVersion };
  });
  expect(result.failure).toContain('模拟'); expect(result.afterFailure).toEqual([0, 0]);
  expect(result.afterRetry).toEqual([1, 1]); expect(result.revision).toBe(1); expect(result.mediaVersion).toBe(1);
});

for (const damage of ['missing', 'checksum'] as const) test(`${damage} media blocks recovery without silently refetching`, async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.evaluate(async damage => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('flowforge-m1');
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction('media', 'readwrite'); const store = tx.objectStore('media');
        if (damage === 'missing') store.delete('/fixtures/study-01.png');
        else {
          const read = store.get('/fixtures/study-01.png');
          read.onsuccess = () => store.put({ ...read.result, blob: new Blob([new Uint8Array(read.result.blob.size)], { type: 'image/png' }) });
        }
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
      };
    });
  }, damage);
  let fixtureRequests = 0; await page.route('**/fixtures/*.png', route => { fixtureRequests++; return route.abort(); });
  await page.reload(); await expect(page.getByTestId('save-status')).toContainText('恢复失败 / 未覆盖本地');
  await expect(page.getByRole('alert')).toContainText(damage === 'missing' ? 'Missing or invalid' : 'checksum mismatch');
  expect(fixtureRequests).toBe(0); await expect(page.locator('.react-flow__node')).toHaveCount(0);
});

test('legacy metadata-only DB upgrades without losing edits or snapshot history', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__seedLegacy = new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('flowforge-m1', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('projects', { keyPath: 'id' });
      open.onsuccess = () => {
        const db = open.result;
        // The app opening v2 waits for this seed transaction to finish.
        db.onversionchange = () => db.close();
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put({ id: 'm1-workbench', schemaVersion: 1, name: 'Legacy original draft', revision: 7,
          viewport: { x: 20, y: 30, zoom: 1 },
          nodes: [{ id: 'brief', title: 'Legacy text', revision: 2, kind: 'text', text: 'Keep this edit.', position: { x: 0, y: 0 } },
            { id: 'product', title: 'Legacy image', revision: 1, kind: 'image', assetPath: '/fixtures/study-01.png', position: { x: 0, y: 240 } },
            { id: 'draft', title: 'Legacy input', revision: 2, kind: 'generation', prompt: 'Keep this prompt.', references: [{ nodeId: 'product', role: 'product' }], position: { x: 400, y: 100 } }],
          edges: [{ id: 'legacy-edge', source: 'product', target: 'draft' }], snapshots: [{ id: 'legacy-snap', targetNodeId: 'draft', prompt: 'Old immutable prompt.', createdAt: '2026-10-13T00:00:00.000Z', mode: 'inspection-only', inputs: [{ nodeId: 'product', revision: 1, role: 'product', kind: 'image', assetPath: '/fixtures/study-01.png' }] }] });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
      };
    });
  });
  await page.goto('/'); await expect(page.getByTestId('save-status')).toContainText('已保存到本地 / r8');
  await expect(page.getByRole('heading', { name: 'Legacy original draft' })).toBeVisible();
  await expect(page.getByTestId('card-brief')).toContainText('Keep this edit.');
  await expect(page.getByRole('textbox', { name: '提示词草稿' })).toHaveValue('Keep this prompt.');
  expect(JSON.parse(await page.getByTestId('snapshot-json').innerText()).prompt).toBe('Old immutable prompt.');
  await expect(page.getByTestId('card-product').locator('img')).toHaveAttribute('src', /^blob:/);
});

test('simulated quota failure keeps the committed revision and allows retry', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  await page.getByText('存储诊断', { exact: true }).click();
  const revision = await page.getByTestId('stored-revision').innerText();
  await page.getByRole('button', { name: '模拟配额耗尽' }).click();
  await expect(page.getByTestId('save-status')).toContainText('保存失败');
  await expect(page.getByRole('alert')).toContainText('模拟配额耗尽');
  await expect(page.getByTestId('stored-revision')).toHaveText(revision);
  await page.getByRole('button', { name: '重试本地保存' }).click();
  await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
});

test('shared fixture bytes remain available to another project and historical snapshot', async ({ page }) => {
  await page.goto('/'); await expect(page.getByTestId('save-status')).toContainText('已保存到本地');
  const result = await page.evaluate(async () => {
    const storePath: string = '/src/persistence/project-store.ts'; const domainPath: string = '/src/domain/project.ts';
    const { ProjectStore } = await import(storePath); const { demoProject, freezeInputs } = await import(domainPath);
    const store = new ProjectStore('shared-media-proof');
    const first = demoProject(); first.id = 'first';
    first.nodes.find((node: any) => node.id === 'draft').references = [{ nodeId: 'product', role: 'product' }];
    first.snapshots = [freezeInputs(first, 'draft')];
    const savedFirst = await store.save(first, null);
    const second = demoProject(); second.id = 'second'; await store.save(second, null);
    savedFirst.nodes = savedFirst.nodes.filter((node: any) => node.id !== 'product');
    savedFirst.edges = savedFirst.edges.filter((edge: any) => edge.source !== 'product');
    savedFirst.nodes.find((node: any) => node.id === 'draft').references = [];
    await store.save(savedFirst, 1);
    const fresh = new ProjectStore('shared-media-proof');
    const firstRestored = await fresh.load('first'); const secondRestored = await fresh.load('second');
    const firstAssets = await fresh.prepareMedia(firstRestored); const secondAssets = await fresh.prepareMedia(secondRestored);
    return { firstImages: firstRestored.nodes.filter((node: any) => node.assetPath).length,
      firstPaths: [...firstAssets.keys()], secondPaths: [...secondAssets.keys()],
      frozen: Object.isFrozen(firstRestored.snapshots[0]), hasObjectUrl: JSON.stringify(firstRestored).includes('blob:') };
  });
  expect(result.firstImages).toBe(0); // the draft itself carries no asset expect(result.firstPaths).toEqual(['/fixtures/study-01.png']);
  expect(result.secondPaths).toEqual(result.firstPaths); expect(result.frozen).toBe(true); expect(result.hasObjectUrl).toBe(false);
});
