import { existsSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { handleProxyRequest, proxyConfigured } from './src/server/proxy.ts';

// Slice 1.2: expose only a boolean flag to the client bundle. The API key stays
// out of the client entirely (read at call time in node contexts); nothing else
// from .env.local is inlined.
//
// e2e determinism (slice 3.3): the dev server used by Playwright must not
// inherit the host's .env.local state, otherwise the "mock stays default" test
// flips with the developer's machine. The E2E_* variables (set by
// playwright.config.ts) always win; the host file is only read for normal
// `pnpm dev` usage.
//
// Slice 1.6: the same dev server can host the local generation proxy (`/api/*`).
// It is registered for `serve` only, never for `build`, and the client learns
// about it as a single inlined boolean. Playwright pins E2E_ARK_PROXY_ENABLED=0
// so every existing assertion keeps its shape.
function localProxy(enabled: boolean): Plugin {
  return {
    name: 'flowforge-local-proxy',
    apply: 'serve',
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) { next(); return; }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => { body += chunk; });
        req.on('end', () => {
          void handleProxyRequest({
            method: req.method ?? 'GET',
            path: url.split('?')[0],
            remoteAddress: req.socket.remoteAddress,
            body,
          }).then((reply) => {
            res.statusCode = reply.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(reply.body));
          }).catch(() => {
            res.statusCode = 502;
            res.end(JSON.stringify({ ok: false, error: 'The local proxy failed.' }));
          });
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const pinnedArk = process.env.E2E_ARK_ENABLED;
  const pinnedSpeech = process.env.E2E_SPEECH_ENABLED;
  const pinnedVideo = process.env.E2E_ARK_VIDEO_ENABLED;
  const pinnedText = process.env.E2E_ARK_TEXT_ENABLED;
  const pinnedProxy = process.env.E2E_ARK_PROXY_ENABLED;
  if (pinnedArk !== undefined || pinnedSpeech !== undefined || pinnedVideo !== undefined || pinnedText !== undefined) {
    return {
      define: {
        'process.env.ARK_ENABLED': JSON.stringify(pinnedArk ?? ''),
        'process.env.SPEECH_ENABLED': JSON.stringify(pinnedSpeech ?? ''),
        'process.env.ARK_VIDEO_AVAILABLE': JSON.stringify(pinnedVideo ?? ''),
        // Slice 1.4-text: only a boolean; the text endpoint id stays in node context.
        'process.env.ARK_TEXT_AVAILABLE': JSON.stringify(pinnedText ?? ''),
        // e2e never talks to the proxy, so every probe must fail closed.
        'process.env.ARK_PROXY_AVAILABLE': JSON.stringify(''),
      },
    };
  }
  // Slice 1.6: the dev middleware runs provider code in this process, so the
  // real values have to exist in `process.env` — `loadEnv` only feeds `define`.
  // Keys stay in the dev server process; the client bundle still gets booleans.
  // Playwright's pinned branch never reaches this point (proxy stays off).
  if (existsSync('.env.local') && typeof process.loadEnvFile === 'function') {
    try { process.loadEnvFile('.env.local'); } catch { /* missing or malformed: proxy just stays off */ }
  }
  // Only booleans leave the file; the keys themselves are never inlined.
  const arkEnv = loadEnv(mode, process.cwd(), 'ARK_');
  const speechEnv = loadEnv(mode, process.cwd(), 'SPEECH_');
  const proxyOn = proxyConfigured(
    { ...arkEnv, ...speechEnv, ARK_PROXY_ENABLED: pinnedProxy ?? arkEnv.ARK_PROXY_ENABLED },
    'serve',
  );
  return {
    plugins: [localProxy(proxyOn)],
    define: {
      'process.env.ARK_ENABLED': JSON.stringify(arkEnv.ARK_ENABLED ?? ''),
      'process.env.SPEECH_ENABLED': JSON.stringify(speechEnv.SPEECH_ENABLED ?? ''),
      // Slice 1.3: the client only learns whether a video endpoint exists; the
      // endpoint id and the key stay in node context.
      'process.env.ARK_VIDEO_AVAILABLE': JSON.stringify(arkEnv.ARK_VIDEO_ENDPOINT ? '1' : ''),
      'process.env.ARK_TEXT_AVAILABLE': JSON.stringify(arkEnv.ARK_TEXT_ENDPOINT ? '1' : ''),
      // Slice 1.6: proxy reachability is a boolean; keys and endpoints never
      // appear in the client bundle.
      'process.env.ARK_PROXY_AVAILABLE': JSON.stringify(proxyOn ? '1' : ''),
    },
  };
});
