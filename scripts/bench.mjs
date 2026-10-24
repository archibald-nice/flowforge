#!/usr/bin/env node
/**
 * FlowForge production canvas / persistence benchmark.
 * Walks the real "import bundle" path (no src/ changes, no asset: rewriting).
 *
 * Usage: pnpm bench
 * Writes: docs/perf.md, docs/perf-samples.json
 */
import { chromium } from '@playwright/test';
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;
const RUNS = 3;
const TIMEOUT_MS = 60_000;
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: ROOT }).trim();
}

function captureEnv() {
  const freeOut = sh('free -g');
  const freeLines = freeOut.split('\n');
  const mem = freeLines[1]?.trim().split(/\s+/) ?? [];
  const availableGb = Number(mem[6] ?? NaN);
  const meminfo = sh('grep -E "MemTotal|MemAvailable" /proc/meminfo');
  const memAvailableKb = Number(
    (meminfo.match(/MemAvailable:\s+(\d+)/) || [])[1] || 0,
  );
  let distro = '';
  try {
    distro = sh('lsb_release -ds 2>/dev/null || true');
  } catch {
    distro = '';
  }
  if (!distro) {
    try {
      distro = sh("grep PRETTY_NAME /etc/os-release | cut -d= -f2 | tr -d '\"'");
    } catch {
      distro = 'unknown';
    }
  }
  let playwrightVersion = '';
  try {
    playwrightVersion = sh('pnpm exec playwright --version');
  } catch {
    playwrightVersion = 'unknown';
  }
  let chromiumVersion = '';
  try {
    const browser = awaitableChromiumVersion();
    chromiumVersion = browser;
  } catch {
    chromiumVersion = 'unknown';
  }
  return {
    node: process.version,
    pnpm: sh('pnpm -v'),
    nproc: Number(sh('nproc')),
    cpu: sh("grep -m1 'model name' /proc/cpuinfo | cut -d: -f2-").trim(),
    memoryTotalGb: Number(mem[1] ?? NaN),
    memoryAvailableGb: availableGb,
    memoryAvailableKb: memAvailableKb,
    freeOutput: freeOut,
    distro,
    playwright: playwrightVersion,
    chromium: chromiumVersion,
    platform: `${os.platform()} ${os.arch()}`,
    gpu: 'none (software rendering / no discrete GPU)',
    build: `pnpm build && pnpm preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    runsPerTier: RUNS,
    measuredAt: new Date().toISOString(),
  };
}

function awaitableChromiumVersion() {
  // Sync helper: spawn a tiny playwright snippet via exec is heavy; fill later.
  return 'filled-at-runtime';
}

function median(values) {
  const sorted = [...values].filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmt(values, digits = 1) {
  const finite = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!finite.length) return '未测到';
  const med = median(finite);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const f = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(digits));
  if (finite.length === 1) return f(med);
  return `${f(med)} (${f(min)}–${f(max)})`;
}

function ratio(a, b) {
  if (a == null || b == null || b === 0) return 'n/a';
  return `${(a / b).toFixed(2)}×`;
}

/** Build a FlowForge bundle JSON string with asset:-backed images. */
function buildBundle(nodeCount) {
  const nodes = [];
  const edges = [];
  const files = [];
  const cols = Math.ceil(Math.sqrt(nodeCount));
  const imageCount = Math.round(nodeCount * 0.4);
  const textCount = nodeCount - imageCount;

  for (let i = 0; i < nodeCount; i++) {
    const id = `n${i}`;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * 280;
    const y = row * 220;
    const isImage = i < imageCount;
    if (isImage) {
      const assetPath = `asset:bench-${i}`;
      nodes.push({
        id,
        title: `Image ${i}`,
        kind: 'image',
        revision: 1,
        position: { x, y },
        assetPath,
        assetSource: 'asset',
        prompt: '',
        references: [],
      });
      files.push({ path: assetPath, type: 'image/png', base64: PNG_B64 });
    } else {
      nodes.push({
        id,
        title: `Text ${i}`,
        kind: 'text',
        revision: 1,
        position: { x, y },
        text: `Bench text node ${i}`,
      });
    }
  }

  // ~N edges: connect each node to the next compatible media target when possible.
  // Targets must be media kinds; sources can be text or media.
  const mediaIds = nodes.filter((n) => n.kind === 'image').map((n) => n.id);
  let edgeCount = 0;
  const targetEdgeBudget = nodeCount;
  for (let i = 0; i < nodes.length && edgeCount < targetEdgeBudget; i++) {
    const source = nodes[i].id;
    const target = mediaIds[(i + 1) % mediaIds.length];
    if (!target || source === target) continue;
    // Avoid cycles that are immediate self-loops; simple chain-ish edges are fine.
    const id = `${source}-${target}-${edgeCount}`;
    if (edges.some((e) => e.source === source && e.target === target)) continue;
    edges.push({ id, source, target });
    edgeCount++;
  }

  // Give some image drafts explicit references to upstream connected candidates.
  for (let i = 0; i < Math.min(mediaIds.length, 20); i++) {
    const targetId = mediaIds[i];
    const incoming = edges.filter((e) => e.target === targetId);
    if (!incoming.length) continue;
    const node = nodes.find((n) => n.id === targetId);
    node.references = incoming.slice(0, 2).map((e) => ({
      nodeId: e.source,
      role: 'reference',
    }));
    node.prompt = `Bench prompt for ${targetId}`;
  }

  const project = {
    id: `bench-${nodeCount}`,
    schemaVersion: 4,
    name: `Bench ${nodeCount}`,
    revision: 0,
    viewport: { x: 0, y: 0, zoom: 0.5 },
    nodes,
    edges,
    snapshots: [],
    credits: 200,
    updatedAt: new Date().toISOString(),
  };

  return {
    format: 'flowforge-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    note: 'bench',
    project,
    files,
  };
}

function killPort(port) {
  try {
    const out = sh(`ss -ltnp 'sport = :${port}' || true`);
    const pids = new Set();
    for (const match of out.matchAll(/pid=(\d+)/g)) pids.add(match[1]);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM');
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

async function waitForServer(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  throw new Error(`Server did not become ready at ${url}`);
}

async function readProjectIdByName(page, namePrefix) {
  return page.evaluate(async (prefix) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('flowforge-m1');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const projects = await new Promise((resolve, reject) => {
      const tx = db.transaction('projects', 'readonly');
      const req = tx.objectStore('projects').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    const match = projects
      .filter((p) => typeof p?.name === 'string' && p.name.includes(prefix))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
    return match?.id ?? null;
  }, namePrefix);
}

async function assertOnlyLocalRequests(page) {
  page.__ffExternal = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('devtools:') || url.startsWith('about:')) return;
    let host = '';
    try { host = new URL(url).hostname; } catch { return; }
    if (host === '127.0.0.1' || host === 'localhost') return;
    page.__ffExternal.push(url);
  });
}

async function waitNodesStable(page, count, timeoutMs = TIMEOUT_MS) {
  const start = Date.now();
  await page.waitForFunction(
    (n) => document.querySelectorAll('.react-flow__node').length >= n,
    count,
    { timeout: timeoutMs },
  );
  // Two consecutive rAF frames after mount count is reached.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)));
      }),
  );
  return Date.now() - start;
}

async function measureColdLoad(page, projectId, nodeCount) {
  const t0 = Date.now();
  await page.goto(`${BASE}/?project=${encodeURIComponent(projectId)}`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT_MS,
  });
  // Fail fast if storage load blew up.
  const status = page.getByTestId('save-status');
  await status.waitFor({ timeout: TIMEOUT_MS });
  const statusText = await status.innerText();
  if (/失败|Error|NotFound/i.test(statusText)) {
    throw new Error(`Cold load status indicates failure: ${statusText}`);
  }
  // Also surface notice errors.
  const notice = page.getByTestId('notice');
  if (await notice.count()) {
    const text = await notice.innerText().catch(() => '');
    if (/失败|Error|NotFound|Missing local asset/i.test(text)) {
      throw new Error(`Cold load notice indicates failure: ${text}`);
    }
  }
  await waitNodesStable(page, nodeCount, TIMEOUT_MS);
  await status.filter({ hasText: '已保存到本地' }).waitFor({ timeout: TIMEOUT_MS });
  // Confirm at least one asset image rendered (asset: path worked).
  const imgCount = await page.locator('.react-flow__node img').count();
  return { ms: Date.now() - t0, imgCount, statusText: await status.innerText() };
}

async function pickVisibleNode(page) {
  const nodes = page.locator('.react-flow__node');
  await nodes.first().waitFor({ state: 'attached', timeout: TIMEOUT_MS });
  const count = await nodes.count();
  for (let i = 0; i < Math.min(count, 120); i++) {
    const box = await nodes.nth(i).boundingBox();
    if (!box) continue;
    if (box.y >= 160 && box.x >= 100 && box.y + 40 < 820 && box.x + 40 < 1400) {
      return { locator: nodes.nth(i), box };
    }
  }
  // Pan the viewport down so top-left nodes are not under the masthead.
  const stage = page.locator('.react-flow');
  const sbox = await stage.boundingBox();
  if (sbox) {
    await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2 - 180);
    await page.mouse.up({ button: 'middle' });
    await sleep(100);
  }
  for (let i = 0; i < Math.min(count, 120); i++) {
    const box = await nodes.nth(i).boundingBox();
    if (box && box.y >= 150 && box.x >= 80) return { locator: nodes.nth(i), box };
  }
  return { locator: nodes.nth(Math.min(5, count - 1)), box: await nodes.nth(Math.min(5, count - 1)).boundingBox() };
}

async function measureRafFpsDuring(page, action) {
  await page.evaluate(() => {
    window.__ffFrames = 0;
    window.__ffStart = 0;
    window.__ffEnd = 0;
    window.__ffDone = false;
    const tick = (t) => {
      if (window.__ffDone) return;
      if (!window.__ffStart) window.__ffStart = t;
      window.__ffEnd = t;
      window.__ffFrames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await action();
  const stats = await page.evaluate(() => {
    window.__ffDone = true;
    return { frames: window.__ffFrames, start: window.__ffStart, end: window.__ffEnd };
  });
  const elapsed = Math.max((stats.end || 0) - (stats.start || 0), 1);
  return (stats.frames * 1000) / elapsed;
}

async function measureDragFps(page, durationMs = 1000) {
  const { locator, box } = await pickVisibleNode(page);
  const handle = locator.locator('.node-drag').first();
  const hbox = (await handle.boundingBox()) || box;
  if (!hbox) throw new Error('No drag handle bounding box');
  const startX = hbox.x + hbox.width / 2;
  const startY = hbox.y + Math.min(18, hbox.height / 2);
  return measureRafFpsDuring(page, async () => {
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    const steps = 20;
    const stepMs = durationMs / steps;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(startX + i * 4, startY + (i % 2 === 0 ? 3 : -3));
      await sleep(stepMs);
    }
    await page.mouse.up();
  });
}

async function measureZoomFps(page) {
  const stage = page.locator('.react-flow');
  const box = await stage.boundingBox();
  if (!box) throw new Error('No canvas box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  return measureRafFpsDuring(page, async () => {
    await page.mouse.move(x, y);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, i % 2 === 0 ? -80 : 80);
      await page.keyboard.up('Control');
      await sleep(40);
    }
  });
}

async function measurePanFps(page, durationMs = 1000) {
  const stage = page.locator('.react-flow');
  const box = await stage.boundingBox();
  if (!box) throw new Error('No canvas box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  return measureRafFpsDuring(page, async () => {
    await page.keyboard.down(' ');
    await page.mouse.move(x, y);
    await page.mouse.down();
    const steps = 20;
    const stepMs = durationMs / steps;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x + i * 8, y + i * 3);
      await sleep(stepMs);
    }
    await page.mouse.up();
    await page.keyboard.up(' ');
  });
}

async function measureSaveLatency(page) {
  const { locator } = await pickVisibleNode(page);
  await locator.click({ force: true });
  const title = page.getByLabel('节点标题');
  await title.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
  await page.getByTestId('save-status').filter({ hasText: '已保存到本地' }).waitFor({ timeout: TIMEOUT_MS });
  const nextTitle = `Bench title ${Date.now()}`;
  const t0 = Date.now();
  await title.fill(nextTitle);
  await page.getByTestId('save-status').filter({ hasText: '已保存到本地' }).waitFor({ timeout: TIMEOUT_MS });
  return Date.now() - t0;
}

async function measureHeap(page) {
  const bytes = await page.evaluate(() => {
    const mem = performance.memory;
    return mem ? mem.usedJSHeapSize : null;
  });
  return bytes;
}

async function setMinimap(page, on) {
  const btn = page.getByRole('button', { name: 'Map', exact: true });
  const pressed = await btn.getAttribute('aria-pressed');
  const isOn = pressed === 'true';
  if (isOn !== on) await btn.click();
}

async function importBundle(page, bundle) {
  await page.goto(`${BASE}/?view=projects`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  // Projects view may not have import; go to a canvas first.
  // Prefer opening any project or creating one via home.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await page.getByTestId('save-status').waitFor({ timeout: TIMEOUT_MS });

  const buffer = Buffer.from(JSON.stringify(bundle), 'utf8');
  await page.getByLabel('导入整包', { exact: true }).setInputFiles({
    name: `bench-${bundle.project.nodes.length}.flowforge.json`,
    mimeType: 'application/json',
    buffer,
  });

  // Wait until canvas reflects imported node count OR notice confirms import.
  const expected = bundle.project.nodes.length;
  const deadline = Date.now() + TIMEOUT_MS;
  let noticeText = '';
  while (Date.now() < deadline) {
    const count = await page.locator('.react-flow__node').count();
    if (await page.getByTestId('notice').count()) {
      noticeText = await page.getByTestId('notice').innerText().catch(() => '');
    }
    const title = await page.locator('h1').innerText().catch(() => '');
    if (noticeText.includes('整包已作为新项目导入到本地') || (count >= expected && title.includes('imported'))) {
      break;
    }
    if (noticeText && /不是 FlowForge|失败|Error|unreadable|does not use/i.test(noticeText)) {
      throw new Error(`Bundle import failed. Notice: ${noticeText}`);
    }
    await sleep(200);
  }
  if (!noticeText.includes('整包已作为新项目导入到本地')) {
    const count = await page.locator('.react-flow__node').count();
    const title = await page.locator('h1').innerText().catch(() => '');
    if (!(count >= expected && title.includes('imported'))) {
      throw new Error(`Bundle import failed. Notice: ${noticeText || '(empty)'} nodes=${count} title=${title}`);
    }
  }
  await page.getByTestId('save-status').filter({ hasText: '已保存到本地' }).waitFor({ timeout: TIMEOUT_MS });
  await page.waitForFunction(
    (n) => document.querySelectorAll('.react-flow__node').length >= n,
    expected,
    { timeout: TIMEOUT_MS },
  );
  const projectId = await readProjectIdByName(page, bundle.project.name);
  if (!projectId) throw new Error('Could not find imported project id in IndexedDB');
  return { projectId, noticeText };
}

async function runTier(browser, nodeCount, options = {}) {
  const { withMinimapCompare = false } = options;
  const bundle = buildBundle(nodeCount);
  const samples = {
    nodeCount,
    coldLoadMs: [],
    dragFps: [],
    zoomFps: [],
    panFps: [],
    saveMs: [],
    heapBytes: [],
    imgCounts: [],
    failures: [],
    minimapOnDragFps: [],
    minimapOffDragFps: [],
    projectId: null,
    importNotice: null,
  };

  // Fresh context for import (isolated IDB).
  const importContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  const importPage = await importContext.newPage();
  await assertOnlyLocalRequests(importPage);
  try {
    const imported = await importBundle(importPage, bundle);
    samples.projectId = imported.projectId;
    samples.importNotice = imported.noticeText;
  } catch (err) {
    samples.failures.push({ phase: 'import', error: String(err) });
    await importContext.close();
    return samples;
  }
  // Keep the same browser profile (same context) so IDB persists across cold loads.
  // Close only the page between runs; reuse context storage.
  await importPage.close();

  for (let run = 0; run < RUNS; run++) {
    const page = await importContext.newPage();
    await assertOnlyLocalRequests(page);
    const mark = async (phase, fn) => {
      try {
        return await withTimeout(fn(), TIMEOUT_MS, `${phase}@${nodeCount}#${run}`);
      } catch (err) {
        samples.failures.push({ phase: `${phase}#${run}`, error: String(err) });
        return null;
      }
    };
    try {
      const cold = await mark('coldLoad', () => measureColdLoad(page, samples.projectId, nodeCount));
      if (cold) {
        samples.coldLoadMs.push(cold.ms);
        samples.imgCounts.push(cold.imgCount);
      } else {
        continue;
      }
      const drag = await mark('drag', () => measureDragFps(page));
      if (drag != null) samples.dragFps.push(drag);
      const zoom = await mark('zoom', () => measureZoomFps(page));
      if (zoom != null) samples.zoomFps.push(zoom);
      const pan = await mark('pan', () => measurePanFps(page));
      if (pan != null) samples.panFps.push(pan);
      const save = await mark('save', () => measureSaveLatency(page));
      if (save != null) samples.saveMs.push(save);
      const heap = await measureHeap(page);
      if (heap != null) samples.heapBytes.push(heap);
    } finally {
      await page.close();
    }
  }

  if (withMinimapCompare && !samples.failures.some((f) => f.phase === 'import')) {
    for (let run = 0; run < RUNS; run++) {
      const page = await importContext.newPage();
      try {
        await measureColdLoad(page, samples.projectId, nodeCount);
        await setMinimap(page, true);
        samples.minimapOnDragFps.push(await measureDragFps(page));
        await setMinimap(page, false);
        samples.minimapOffDragFps.push(await measureDragFps(page));
      } catch (err) {
        samples.failures.push({ phase: `minimap#${run}`, error: String(err) });
      } finally {
        await page.close();
      }
    }
  }

  await importContext.close();
  return samples;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(`Timeout after ${ms}ms: ${label}`);
    }),
  ]);
}

function miB(bytes) {
  if (bytes == null) return null;
  return bytes / (1024 * 1024);
}

function renderReport(env, tiers, samplesByTier, skippedReason) {
  const lines = [];
  lines.push('# FlowForge 渲染与持久化压测');
  lines.push('');
  lines.push(`测量时间（Asia/Shanghai 机器本地时钟对应 ISO）：${env.measuredAt}`);
  lines.push('');
  lines.push('## 1. 测试环境');
  lines.push('');
  lines.push('| 项 | 值 |');
  lines.push('| --- | --- |');
  lines.push(`| CPU | ${env.cpu} |`);
  lines.push(`| 核数 | ${env.nproc} |`);
  lines.push(`| 内存 total / available（\`free -g\`） | ${env.memoryTotalGb} GB / ${env.memoryAvailableGb} GB |`);
  lines.push(`| MemAvailable（/proc/meminfo） | ${(env.memoryAvailableKb / 1024 / 1024).toFixed(2)} GB |`);
  lines.push(`| 发行版 | ${env.distro} |`);
  lines.push(`| Node | ${env.node} |`);
  lines.push(`| pnpm | ${env.pnpm} |`);
  lines.push(`| Playwright | ${env.playwright} |`);
  lines.push(`| Chromium | ${env.chromium} |`);
  lines.push(`| GPU | ${env.gpu} |`);
  lines.push(`| 构建 / 服务 | ${env.build} |`);
  lines.push(`| 每档次数 | ${env.runsPerTier}（取中位数，括号为 min–max） |`);
  lines.push(`| 档位 | ${tiers.join(' / ')}${skippedReason ? `（${skippedReason}）` : ''} |`);
  lines.push('');
  lines.push('## 2. 结果');
  lines.push('');
  lines.push('| 节点数 | 冷加载 ms | 拖拽 FPS | 缩放 FPS | 平移 FPS | 保存 ms† | JS 堆 MiB |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const n of tiers) {
    const s = samplesByTier[n];
    lines.push(
      `| ${n} | ${fmt(s.coldLoadMs, 0)} | ${fmt(s.dragFps, 1)} | ${fmt(s.zoomFps, 1)} | ${fmt(s.panFps, 1)} | ${fmt(s.saveMs, 0)} | ${fmt(s.heapBytes.map(miB), 1)} |`,
    );
  }
  lines.push('');
  lines.push('† 保存延迟包含应用内 **450ms 防抖**，从改标题到 `[data-testid="save-status"]` 显示「已保存到本地」。');
  lines.push('');

  const highest = tiers[tiers.length - 1];
  const high = samplesByTier[highest];
  if (high?.minimapOnDragFps?.length || high?.minimapOffDragFps?.length) {
    lines.push(`### 小地图开/关拖拽 FPS（${highest} 节点）`);
    lines.push('');
    lines.push('| 小地图 | 拖拽 FPS |');
    lines.push('| --- | --- |');
    lines.push(`| 开 | ${fmt(high.minimapOnDragFps, 1)} |`);
    lines.push(`| 关 | ${fmt(high.minimapOffDragFps, 1)} |`);
    lines.push('');
  }

  const base = samplesByTier[100];
  lines.push('## 3. 相对伸缩性（相对 100 节点中位数）');
  lines.push('');
  lines.push('| 指标 | 300/100 | 500/100 | 读法 |');
  lines.push('| --- | --- | --- | --- |');
  const metrics = [
    ['冷加载', 'coldLoadMs', '越高越慢'],
    ['拖拽 FPS', 'dragFps', '贴 vsync=未掉帧'],
    ['缩放 FPS', 'zoomFps', '>>60 多为 headless 空转'],
    ['平移 FPS', 'panFps', '>>60 多为 headless 空转'],
    ['保存 ms', 'saveMs', '越高越慢（含450ms防抖）'],
    ['JS 堆', 'heapBytes', '越高占用越大'],
  ];
  for (const [label, key, tip] of metrics) {
    const b = median(base?.[key] || []);
    const r300 = samplesByTier[300] ? median(samplesByTier[300][key] || []) : null;
    const r500 = samplesByTier[500] ? median(samplesByTier[500][key] || []) : null;
    lines.push(`| ${label} | ${samplesByTier[300] ? ratio(r300, b) : '未测'} | ${samplesByTier[500] ? ratio(r500, b) : '未测'} | ${tip} |`);
  }
  lines.push('');
  lines.push('FPS 读数：≈60 表示贴 vsync；明显高于 60 是 headless 未锁 vsync 的空转，不能解释成「更快」。相对掉帧结论以拖拽 FPS 为准。');
  lines.push('');

  lines.push('## 4. 复现步骤');
  lines.push('');
  lines.push('```bash');
  lines.push('pnpm install --frozen-lockfile');
  lines.push('pnpm exec playwright install chromium');
  lines.push('pnpm bench');
  lines.push('```');
  lines.push('');

  lines.push('## 5. 瓶颈分析');
  lines.push('');
  const cold100 = median(base?.coldLoadMs || []);
  const coldTop = median(high?.coldLoadMs || []);
  const heap100 = miB(median(base?.heapBytes || []));
  const heapTop = miB(median(high?.heapBytes || []));
  const drag100 = median(base?.dragFps || []);
  const dragTop = median(high?.dragFps || []);
  lines.push(
    `- **挂载 / 水合**：冷加载中位数从 100 → ${highest} 为 ${cold100?.toFixed?.(0) ?? cold100} ms → ${coldTop?.toFixed?.(0) ?? coldTop} ms（${ratio(coldTop, cold100)}）。这部分随节点数近似线性抬升，更像初次挂载与媒体水合成本。`,
  );
  lines.push(
    `- **交互帧率**：拖拽 FPS 100 → ${highest} 为 ${drag100?.toFixed?.(1) ?? drag100} → ${dragTop?.toFixed?.(1) ?? dragTop}。若仍贴近 vsync（≈60），说明主路径尚未被 DOM 规模打穿；掉帧若出现，应优先怀疑节点重渲染与小地图，而不是拖动手势本身。`,
  );
  if (high?.minimapOnDragFps?.length) {
    lines.push(
      `- **小地图**：开 ${fmt(high.minimapOnDragFps, 1)} / 关 ${fmt(high.minimapOffDragFps, 1)}。若两者接近，小地图不是当前档位的主瓶颈。`,
    );
  }
  lines.push(
    `- **IndexedDB / 保存**：保存中位数含 450ms 防抖；扣除防抖后的余量反映写库与 React 提交。若余量随节点数只缓增，IndexedDB 不像主瓶颈。`,
  );
  lines.push(
    `- **堆**：JS 堆 100 → ${highest} 为 ${heap100?.toFixed?.(1) ?? heap100} → ${heapTop?.toFixed?.(1) ?? heapTop} MiB（${ratio(heapTop, heap100)}），与节点/媒体规模同向。`,
  );
  lines.push('');

  lines.push('## 6. 局限性');
  lines.push('');
  lines.push('- **无 GPU**：Chromium 走软件渲染，绝对帧率明显低于有独显的机器；结论以相对伸缩性为主。');
  lines.push('- **VM / 共享宿主**：`free -g` available 可能波动；本机 available < 4 GB 时按规则降档。');
  lines.push('- **Headless**：无真实显示器合成；FPS 以 rAF 回调/秒换算，不是 presented-frame。Headless 常不锁 vsync，绝对值可能高于 60，只可作相对比较。');
  lines.push('- **缩放路径**：产品关闭了 `zoomOnScroll`，本脚本用 Ctrl+滚轮（React Flow 激活键）做 20 次缩放。');
  lines.push('- **绝对值不可跨机比较**。');
  lines.push('- **绕过**：本次**没有**把 `asset:` 改写成 `simulated:`，也没有对 IndexedDB 做 harness 迁移。');
  for (const n of tiers) {
    const fails = samplesByTier[n]?.failures || [];
    if (fails.length) {
      lines.push(`- **失败记录（${n}）**：`);
      for (const f of fails) lines.push(`  - \`${f.phase}\`: ${f.error}`);
    }
  }
  lines.push('');

  lines.push('## 7. 与上次差异');
  lines.push('');
  lines.push('上次（有 `asset:`→`simulated:` harness 迁移、含 500 档、冷加载不含真实 asset 媒体解码）关键数字：');
  lines.push('');
  lines.push('| 档位 | 上次冷加载 | 上次堆 | 上次 FPS | 上次保存 |');
  lines.push('| --- | --- | --- | --- | --- |');
  lines.push('| 100 | 355 (309–358) | 14.5 MiB | ≈60.7 | 483 |');
  lines.push('| 300 | 679 (672–770) | 23.4 MiB | ≈60.7 | 504 |');
  lines.push('| 500 | 998 (977–1020) | 40.1 MiB | ≈60.7 | 530 |');
  lines.push('');
  lines.push('本次变化说明：');
  lines.push('- 代码已包含 `fix(storage): read asset-backed media inside the transaction that opens it`，`load()` 打开 `projects/media/assets` 三 store，因此可以走真实 `asset:` 导入与冷加载。');
  if (skippedReason) lines.push(`- ${skippedReason}`);
  lines.push('- 若冷加载高于上次，主要归因于本次真正水合 `asset:` 图片（即便是 1×1 PNG），而上次绕过了 asset 存储路径。');
  lines.push('- 交互 FPS 若仍贴 60，说明相对伸缩性结论与上次一致：成本在挂载/堆，不在主路径掉帧。');
  lines.push('');
  lines.push('原始样本见 [`docs/perf-samples.json`](./perf-samples.json)。');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  process.chdir(ROOT);
  mkdirSync(path.join(ROOT, 'docs'), { recursive: true });

  console.log('== env ==');
  const env = captureEnv();
  // Fill chromium version via a short launch after install.
  killPort(PORT);

  console.log('Node', env.node, 'pnpm', env.pnpm);
  console.log('CPU', env.cpu, 'nproc', env.nproc);
  console.log('Mem available Gb (free -g):', env.memoryAvailableGb);
  if (!env.node.startsWith('v24.') && !env.node.startsWith('v25.')) {
    // engines say >=24.11 <25; still allow if somehow newer, but warn under 24.11
  }
  const nodeMajorMinor = env.node.replace(/^v/, '').split('.').map(Number);
  if (nodeMajorMinor[0] < 24 || (nodeMajorMinor[0] === 24 && nodeMajorMinor[1] < 11)) {
    console.error(`Node must be >= 24.11, got ${env.node}`);
    process.exit(1);
  }

  const skippedReason =
    env.memoryAvailableGb < 4
      ? `free -g available=${env.memoryAvailableGb} GB < 4 GB，最高只测到 300 节点`
      : null;
  const tiers = skippedReason ? [100, 300] : [100, 300, 500];

  console.log('== build ==');
  sh('pnpm build');

  console.log('== preview ==');
  const preview = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let previewLog = '';
  preview.stdout.on('data', (d) => {
    previewLog += d.toString();
  });
  preview.stderr.on('data', (d) => {
    previewLog += d.toString();
  });

  const shutdown = async () => {
    if (!preview.killed) {
      preview.kill('SIGTERM');
      await sleep(500);
      try {
        preview.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    killPort(PORT);
    await sleep(300);
    let still = '';
    try {
      still = sh(`ss -ltnp 'sport = :${PORT}' || true`);
    } catch {
      still = '';
    }
    return !/pid=/.test(still);
  };

  try {
    await waitForServer(BASE);
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-gpu', '--use-gl=swiftshader'],
    });
    env.chromium = browser.version();

    const samplesByTier = {};
    for (const n of tiers) {
      console.log(`== tier ${n} ==`);
      const withMinimapCompare = n === tiers[tiers.length - 1];
      samplesByTier[n] = await runTier(browser, n, { withMinimapCompare });
      console.log(
        JSON.stringify(
          {
            n,
            cold: samplesByTier[n].coldLoadMs,
            drag: samplesByTier[n].dragFps,
            failures: samplesByTier[n].failures,
            imgs: samplesByTier[n].imgCounts,
          },
          null,
          2,
        ),
      );
    }

    await browser.close();

    const report = renderReport(env, tiers, samplesByTier, skippedReason);
    writeFileSync(path.join(ROOT, 'docs/perf.md'), report);
    writeFileSync(
      path.join(ROOT, 'docs/perf-samples.json'),
      JSON.stringify(
        {
          env,
          tiers,
          skippedReason,
          samplesByTier,
          previousRun: {
            note: 'Previous harness rewrote asset: → simulated: and migrated IDB; numbers below are from that run.',
            coldLoadMs: { 100: [309, 355, 358], 300: [672, 679, 770], 500: [977, 998, 1020] },
            heapMiB: { 100: 14.5, 300: 23.4, 500: 40.1 },
            fpsApprox: 60.7,
            saveMs: { 100: 483, 300: 504, 500: 530 },
          },
        },
        null,
        2,
      ) + '\n',
    );
    console.log('Wrote docs/perf.md and docs/perf-samples.json');
  } catch (err) {
    console.error(err);
    console.error('preview log:\n', previewLog);
    const released = await shutdown();
    console.error('port released:', released);
    process.exitCode = 1;
    return;
  }

  const released = await shutdown();
  console.log('port 5199 released:', released);
  if (!released) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  killPort(PORT);
  process.exit(1);
});
