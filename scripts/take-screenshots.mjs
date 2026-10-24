import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = 'http://127.0.0.1:5173';
mkdirSync('docs/assets', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('.node-card', { timeout: 15000 });
await page.waitForTimeout(800);

// 1. Canvas: the workbench as it loads (demo project, reference edges visible).
await page.screenshot({ path: 'docs/assets/screenshot-canvas.png' });

// 2. Agent: send a message so the plan card renders, then capture.
await page.getByLabel('给 Agent 发消息').fill('把这张图扩成视频脚本');
await page.getByTestId('composer-send').click();
await page.waitForSelector('[data-testid="plan-card"]', { timeout: 10000 });
await page.waitForTimeout(400);
await page.screenshot({ path: 'docs/assets/screenshot-agent.png' });

await browser.close();
console.log('screenshots written');
