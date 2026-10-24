# Self-hosting with real providers

The hosted demo runs in **simulated mode**: no keys, no provider calls, every result labelled `simulated`. This page is for running FlowForge yourself with real generation.

## 1 What changes when you self-host

Nothing in the product changes — the same client code runs. What changes is *who talks to the provider*:

- The browser only ever sends requests to **your own origin** (`/api/...`).
- A Node process on that origin reads the keys from the environment, calls the provider, and returns bytes.
- Keys and provider endpoint ids never enter the browser bundle. `dist/` contains booleans only.

## 2 Run it locally (real generation, mock UI still the default)

```bash
pnpm install
cp .env.example .env.local     # then fill the values you want to use
pnpm build && pnpm server      # serves dist/ + /api on http://127.0.0.1:8787
```

`pnpm dev` still works and keeps its own copy of the proxy as Vite middleware; both use the same code (`src/server/proxy.ts`).

## 3 Run it with Docker

```bash
docker build -t flowforge .
docker run --rm -p 8787:8787 \
  --env-file .env.local \
  flowforge
```

Then open `http://127.0.0.1:8787`.

The image is two stages: a build stage that produces `dist/`, and a runtime stage with only `dist/`, `src/` and `server/`. No `node_modules` are needed at runtime — the server and providers use the Node standard library only, and Node 24 runs the TypeScript directly.

## 4 Environment variables

| Variable | Purpose |
| --- | --- |
| `ARK_API_KEY` | Ark console key. Real calls bill against it. |
| `ARK_ENABLED` | `1` enables the real image path in the client. |
| `ARK_IMAGE_ENDPOINT` | Ark inference endpoint id for images (`ep-…`). Required for real images; the browser only knows a placeholder. |
| `ARK_VIDEO_ENDPOINT` / `ARK_VIDEO_ENABLED` | Video endpoint id and switch (task submit → poll → download). |
| `ARK_TEXT_ENDPOINT` / `ARK_TEXT_ENABLED` | Text endpoint id and switch (one chat completion, no retry). |
| `SPEECH_API_KEY` / `SPEECH_APP_ID` / `SPEECH_ENABLED` | Doubao speech credentials and switch (billed per minute). |
| `PORT` | Port for the standalone server (default `8787`). |
| `PROXY_ALLOW_REMOTE` | Off by default. `1` lets non-loopback callers trigger real generation. |
| `FORCE_PROXY_AVAILABLE` | Build-time only. `1` tells the client a proxy exists even when no `.env.local` was read (Docker sets it). |

## 5 Security posture

- **Loopback only by default.** The proxy refuses callers that are not `127.0.0.1` / `::1`. Setting `PROXY_ALLOW_REMOTE=1` exposes real generation to anyone who can reach the port — that means anyone who can spend your credits.
- **One request in flight.** A second concurrent request gets `429`. There are no automatic retries; a failure is final.
- **No secrets in responses.** Errors carry a message, never a key or an upstream body.
- **Nothing is sent anywhere else.** The client makes no third-party requests; `/api/*` is the only outbound path, and it goes to the provider you configured.

## 6 Deploying for a group

The hosted demo deliberately has no server, so it cannot spend credits. If you want a shared instance with real generation:

1. Build with `FORCE_PROXY_AVAILABLE=1` so the client offers real models.
2. Run the standalone server behind a reverse proxy you control.
3. Keep `PROXY_ALLOW_REMOTE` off unless the reverse proxy itself performs authentication — otherwise anyone with the URL can generate on your account.

There is no multi-user account model: projects live in the browser's IndexedDB, one user per browser profile.
