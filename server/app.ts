/**
 * Standalone server: static hosting for the built app plus the generation proxy.
 *
 * Why it exists: the browser must never hold a provider key or endpoint id. In
 * development Vite runs the same proxy as middleware (see vite.config.ts); for
 * self-hosting this process does the same job and also serves `dist/`, so one
 * origin covers both the page and `/api/*` — no CORS, no second port.
 *
 * The proxy itself is unchanged: `handleProxyRequest` from src/server/proxy.ts.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { handleProxyRequest, proxyConfigured } from '../src/server/proxy.ts';

const MIME: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
});

export type AppOptions = Readonly<{
  /** Directory holding the built client (usually `dist`). */
  root: string;
  /**
   * Off by default: only loopback callers may spend credits. Turn it on only on
   * a machine you trust to expose real generation to whoever can reach it.
   */
  allowRemote?: boolean;
}>;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function sendFile(res: ServerResponse, path: string, cache: string): void {
  const bytes = readFileSync(path);
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[extname(path).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', cache);
  res.end(bytes);
}

/** Resolves a URL path inside `root`, or null when it would escape it. */
function safeJoin(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const relative = normalize(decoded).replace(/^([/\\])+/u, '');
  const candidate = resolve(join(root, relative));
  const base = resolve(root);
  if (candidate !== base && !candidate.startsWith(base + sep)) return null;
  return candidate;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done, failed) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      // The proxy never needs more than a few hundred KB (bundle/media ride as
      // base64 in the browser, not here); refuse anything that looks abusive.
      if (body.length > 4_000_000) failed(new Error('Request body too large.'));
    });
    req.on('end', () => done(body));
    req.on('error', failed);
  });
}

export function createApp(options: AppOptions): Server {
  const root = resolve(options.root);
  const indexFile = join(root, 'index.html');

  return createServer((req, res) => {
    const rawUrl = req.url ?? '/';
    const [pathOnly] = rawUrl.split('?');
    const path = pathOnly || '/';
    const method = (req.method ?? 'GET').toUpperCase();

    void (async () => {
      if (path.startsWith('/api/')) {
        if (method === 'GET' && path === '/api/health') {
          sendJson(res, 200, { ok: true, proxy: proxyConfigured() });
          return;
        }
        if (method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'Only POST is served here.' });
          return;
        }
        const body = await readBody(req);
        const remote = options.allowRemote ? '127.0.0.1' : req.socket.remoteAddress;
        const reply = await handleProxyRequest({ method, path, remoteAddress: remote, body });
        sendJson(res, reply.status, reply.body);
        return;
      }

      if (method !== 'GET' && method !== 'HEAD') {
        res.statusCode = 405;
        res.end('Method not allowed');
        return;
      }

      const file = safeJoin(root, path);
      if (!file) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }

      const asset = path.startsWith('/assets/');
      if (isFile(file)) {
        sendFile(res, file, asset ? 'public, max-age=31536000, immutable' : 'no-cache');
        return;
      }
      // SPA fallback: extension-less paths render the app shell.
      if (!extname(path)) {
        if (!isFile(indexFile)) {
          res.statusCode = 503;
          res.end('Build output missing: run `pnpm build` first.');
          return;
        }
        sendFile(res, indexFile, 'no-cache');
        return;
      }
      res.statusCode = 404;
      res.end('Not found');
    })().catch(() => {
      if (!res.headersSent) res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: 'Unhandled server error.' }));
    });
  });
}
