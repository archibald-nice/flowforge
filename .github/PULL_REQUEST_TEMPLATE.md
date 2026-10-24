<!--
  Thanks for the PR! Please fill in the sections below.
  The project invariants (edges are not an execution graph, only explicit
  references enter a run, simulated results are labelled, keys stay Node-side,
  every mutation is undoable) are listed in CONTRIBUTING.md.
-->

## What does this PR do?

<!-- One or two sentences: the problem and the change. -->

## How was it tested?

<!-- Run and paste the results of: -->

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

## Checklist

- [ ] `pnpm typecheck`, `pnpm test` and `pnpm test:e2e` all pass
- [ ] New behaviour is covered by tests
- [ ] No new dependencies (if unavoidable, justify it)
- [ ] No provider call is triggered by edge/selection changes
- [ ] Simulated results stay labelled `simulated`; real results carry provider + model
- [ ] Keys/config never reach client-side code
- [ ] Data mutations record an undo command
- [ ] `CHANGELOG.md` updated if user-visible
