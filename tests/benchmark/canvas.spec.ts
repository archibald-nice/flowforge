import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';

test('production canvas baseline and original-app visual captures', async ({ browser }) => {
  await mkdir('docs/research/benchmarks', { recursive: true });
  const variant = process.env.FLOWFORGE_HEADED === '1' ? 'headed' : 'headless';
  const samples = [];
  for (const count of [300, 300, 1000]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.goto(`/?benchmark=${count}`);
    await expect(page.locator('.react-flow__node')).toHaveCount(count);
    await expect(page.locator('.react-flow__edge')).toHaveCount(count === 300 ? 500 : 1600);
    await page.locator('.node-card img').evaluateAll(async images => {
      await Promise.all(images.map(image => (image as HTMLImageElement).decode()));
    });
    await expect(page.getByTestId('save-status')).toContainText('Saved locally');
    const coldReadyMs = await page.evaluate(() => performance.now());
    const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
    const rect = (await page.locator('.canvas-stage').boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.waitForTimeout(500);
    const metricsBefore = await cdp.send('Performance.getMetrics');
    await page.evaluate(() => {
      const intervals: number[] = [];
      let previous = performance.now();
      const start = previous;
      const wheelDomMs: number[] = []; const longTasksMs: number[] = [];
      let wheelStart: number | null = null;
      const wheel = () => { wheelStart = performance.now(); };
      document.addEventListener('wheel', wheel, { capture: true });
      const mutations = new MutationObserver(() => {
        if (wheelStart !== null) { wheelDomMs.push(performance.now() - wheelStart); wheelStart = null; }
      });
      mutations.observe(document.querySelector('.react-flow__viewport')!, { attributes: true, attributeFilter: ['style'] });
      const tasks = new PerformanceObserver(entries => entries.getEntries().forEach(entry => longTasksMs.push(entry.duration)));
      tasks.observe({ type: 'longtask' });
      (window as any).__frames = new Promise(resolve => {
        const tick = (time: number) => {
          intervals.push(time - previous); previous = time;
          if (time - start < 10_000) requestAnimationFrame(tick);
          else {
            mutations.disconnect(); tasks.disconnect(); document.removeEventListener('wheel', wheel, true);
            resolve({ intervals, durationMs: time - start, wheelDomMs, longTasksMs });
          }
        };
        requestAnimationFrame(tick);
      });
    });
    const started = Date.now(); let iteration = 0;
    while (Date.now() - started < 10_000) {
      if (iteration % 4 === 0) {
        await page.keyboard.down('Control'); await page.mouse.wheel(0, iteration % 8 === 0 ? -20 : 20); await page.keyboard.up('Control');
      } else await page.mouse.wheel(iteration % 8 < 4 ? 35 : -35, iteration % 6 < 3 ? 25 : -25);
      iteration++; await page.waitForTimeout(40);
    }
    const frames = await page.evaluate(async () => await (window as any).__frames) as { intervals: number[]; durationMs: number; wheelDomMs: number[]; longTasksMs: number[] };
    const metricsAfter = await cdp.send('Performance.getMetrics');
    const cpuDurationDelta = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map(name => [name,
      (metricsAfter.metrics.find(metric => metric.name === name)?.value ?? 0) - (metricsBefore.metrics.find(metric => metric.name === name)?.value ?? 0)]));
    const sorted = [...frames.intervals].sort((a, b) => a - b);
    // Event-to-next-two-rAF is a rendering proxy, not proof of visible pixels.
    const inputRafMs: number[] = [];
    const inputDomMs: number[] = [];
    const selectionRafMs: number[] = [];
    await page.getByRole('button', { name: 'Fit view', exact: true }).click();
    for (let index = 0; index < 20; index++) {
      await page.evaluate(() => {
        (window as any).__selectionFrame = new Promise(resolve => {
          document.addEventListener('pointerdown', () => {
            const start = performance.now();
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
          }, { once: true });
        });
      });
      await page.getByTestId(`card-node-${count / 2 + (index + 1) % 2}`).click();
      selectionRafMs.push(await page.evaluate(async () => await (window as any).__selectionFrame));
      await expect(page.getByRole('textbox', { name: 'Prompt draft' })).toBeVisible();
    }
    for (let index = 0; index < 20; index++) {
      await page.evaluate(() => {
        (window as any).__inputFrame = new Promise(resolve => {
          document.addEventListener('input', () => {
            const start = performance.now();
            const value = (document.activeElement as HTMLTextAreaElement).value;
            const node = document.querySelector('.react-flow__node.selected .node-card p')!;
            const dom = new Promise<number>(resolveDom => {
              const observer = new MutationObserver(() => {
                if (node.textContent === value) { observer.disconnect(); resolveDom(performance.now() - start); }
              });
              observer.observe(node, { childList: true, characterData: true, subtree: true });
            });
            const raf = new Promise<number>(resolveRaf => requestAnimationFrame(() => requestAnimationFrame(() => resolveRaf(performance.now() - start))));
            void Promise.all([dom, raf]).then(([domCommitMs, twoRafMs]) => resolve({ domCommitMs, twoRafMs }));
          }, { once: true });
        });
      });
      await page.getByRole('textbox', { name: 'Prompt draft' }).fill(`Original benchmark input ${index}.`);
      const timing = await page.evaluate(async () => await (window as any).__inputFrame);
      inputRafMs.push(timing.twoRafMs); inputDomMs.push(timing.domCommitMs);
    }
    await expect(page.getByTestId('save-status')).toContainText('Saved locally');
    const saveStart = Date.now();
    await page.getByRole('textbox', { name: 'Prompt draft' }).fill('Final original benchmark input.');
    await expect(page.getByTestId('save-status')).toContainText('Saved locally');
    const editToSavedMs = Date.now() - saveStart;
    const saveTiming = JSON.parse((await page.getByTestId('save-timing').textContent())!);
    const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] ?? null;
    samples.push({ count, edges: count === 300 ? 500 : 1600, previews: 30, dimensions, coldReadyMs,
      durationMs: frames.durationMs, frameCount: frames.intervals.length, averageRafFps: frames.intervals.length * 1000 / frames.durationMs,
      p95RafIntervalMs: sorted[Math.ceil(sorted.length * .95) - 1], inputToTwoRafP95Ms: [...inputRafMs].sort((a, b) => a - b)[18],
      selectionToTwoRafP95Ms: [...selectionRafMs].sort((a, b) => a - b)[18],
      inputToDomCommitP95Ms: p95(inputDomMs), wheelToTransformP95Ms: p95(frames.wheelDomMs), saveTiming, cpuDurationDelta,
      editToSavedMs, wheelIterations: iteration, rawFrameIntervalsMs: frames.intervals, rawInputToTwoRafMs: inputRafMs, rawSelectionToTwoRafMs: selectionRafMs,
      rawInputToDomCommitMs: inputDomMs, rawWheelToTransformMs: frames.wheelDomMs, rawLongTasksMs: frames.longTasksMs });
    if (samples.length === 1) await page.screenshot({ path: `docs/research/benchmarks/slice02-${variant}-300.png` });
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('Saved locally');
  await page.screenshot({ path: `docs/research/benchmarks/slice02-${variant}-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `docs/research/benchmarks/slice02-${variant}-mobile.png`, fullPage: true });
  await context.close();
  await mkdir('docs/research/benchmarks', { recursive: true });
  await writeFile(`docs/research/benchmarks/m1-slice02-${variant}.json`, JSON.stringify({ date: new Date().toISOString(),
    environment: { platform: os.platform(), architecture: os.arch(), cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem(), browser: browser.version(), node: process.version, build: 'production / vite preview', headless: variant === 'headless', reducedMotion: true },
    method: 'Full DOM; fresh isolated context per sample; verified 30 fixture Blobs in IndexedDB; decoded previews; saved readiness; 10s real wheel input; rAF scheduling / two-rAF proxies, DOM mutation observer and CDP CPU duration, not presented-frame measurement. Cold readiness includes polling and initial autosave; same browser process / OS caches may be warm. One initial draft selected; unlike Slice01, inspector initialized for benchmark. All timing overhead disclosed.', samples }, null, 2) + '\n');
});
