# Contributing to FlowForge

Thanks for your interest in contributing! This document covers the environment,
the day-to-day scripts, and the rules a pull request must satisfy.

## Environment

- **Node.js 24** (see `.nvmrc`; `engines` in `package.json` enforces `>=24.11 <25`)
- **pnpm 12** (the repo pins `packageManager`; Corepack is the easiest way: `corepack enable`)
- No database, no external services. Everything runs locally in the browser.

```bash
pnpm install
pnpm dev        # http://127.0.0.1:5173
```

## Common scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Dev server with the `/api` local proxy on port 5173 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Unit tests via `node --test` (~1 s) |
| `pnpm test:e2e` | Playwright end-to-end suite (~2.5 min, port 5174) |
| `pnpm build` | Typecheck + production build to `dist/` |
| `pnpm benchmark` | Performance benchmark against a production build |

All three of `pnpm typecheck`, `pnpm test` and `pnpm test:e2e` must pass before
a change is considered done.

## Ground rules

These are the project's invariants; a PR that breaks them will be rejected.

1. **Edges are not an execution graph.** Creating, changing or deleting a
   connection must never trigger a provider call.
2. **Only explicit references enter the input.** A run snapshot records
   `(nodeId, revision)` pairs; edits after submission never affect it.
3. **Simulated results must be labelled.** Anything not produced by a real
   provider is marked `simulated`; real results carry the provider and model.
4. **Keys stay on the Node side.** The browser only sees boolean switches.
   Any change that leaks a key into client code is treated as a defect.
5. **Every data mutation is undoable.** Project changes must record an edit
   command, or undo/redo drifts out of sync.

## Tests

- New features must come with tests (unit tests under `tests/unit/`, end-to-end
  assertions under `tests/e2e/` that exercise real DOM behaviour).
- Bug fixes need a test that reproduces the bug first.
- Relative imports are required in test files: `node --test` does not resolve
  path aliases reliably.

## Commit messages

One logical change per commit, imperative mood, English:

```
fix: keep hover toolbar visible while dragging a node
```

For features tied to a numbered slice, prefix with the slice number:

```
6.6: fix wide-screen grid mismatch in .workspace
```

## Pull request process

1. Fork and create a branch from `main`.
2. Make your change, keeping it surgical — no drive-by reformatting.
3. Run `pnpm typecheck && pnpm test && pnpm test:e2e` and include the results
   in the PR description.
4. If your change affects `vite.config.ts` proxy logic, rerun the e2e suite:
   it boots its own server and will otherwise test a stale build.
5. Update `CHANGELOG.md` under the "Unreleased" heading if the change is
   user-visible.

## Reporting issues

Bug reports and feature requests use the issue templates (`.github/ISSUE_TEMPLATE/`).
For security vulnerabilities, see `SECURITY.md` — please do not open a public issue.
