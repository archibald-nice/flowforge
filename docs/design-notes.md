# Design notes

Short records of the decisions that shape FlowForge, each with the constraint
behind it and what it costs. If a change here looks arbitrary, this is the file
to argue with.

## 1. Edges are references, not a pipeline

**Decision.** Drawing an edge never runs anything. Runs are created only from an
explicit submit, and only the inputs listed at submit time are used.

**Why.** A free-form canvas is ambiguous about execution order, and users
rearrange it constantly. Treating edges as a DAG would turn every drag into a
semantic edit and every cycle into an error the user cannot see.

**Cost.** The graph alone cannot express "run this branch". Inputs must be
selected explicitly, which is more work per run than a pipeline would be.

## 2. Inputs freeze into an immutable snapshot

**Decision.** Submitting records `(nodeId, revision)` pairs. Editing a node
afterwards bumps its revision and never touches snapshots already recorded.

**Why.** Reproducibility. "Which version of this text produced that image" has
to stay answerable weeks later, including after the text was rewritten.

**Cost.** Runs pin older revisions, so the history grows and the UI has to make
the difference between current content and frozen input visible.

## 3. Simulated and real results are distinct

**Decision.** Mock runs return a placeholder labelled `simulated` at zero cost.
Real runs record the provider and model. Nothing silently upgrades one to the
other.

**Why.** A demo that quietly fakes output is worse than one that admits it. The
label also keeps tests honest: an assertion can prove a run was simulated.

**Cost.** Two result paths, and end-to-end tests that must keep them from
drifting apart.

## 4. Provider keys never reach the browser

**Decision.** Real generation goes through a dev-server proxy. The browser
bundle only receives booleans describing what is configured.

**Why.** Anything in a bundle is readable by anyone who opens devtools. A key in
the client is a key published.

**Cost.** Running with real providers requires a Node process. A static deploy
runs in simulated mode, which is why the hosted demo is simulated.

## 5. Local-first storage with revision checks

**Decision.** Projects live in IndexedDB with a monotonic revision, media stored
as blobs, and writes rejected when the revision moved underneath them.

**Why.** No account required, saves are instant, and the app works offline.

**Cost.** No cross-device sync. Two tabs editing one project need an explicit
conflict story, so a stale write is refused rather than merged.

## 6. Undo is command based

**Decision.** Every content change records an edit command; consecutive drags
and typing coalesce inside a short window. The stack is capped at 100 entries.

**Why.** The canvas library owns view state such as selection and viewport. Undo
has to act on the data model, not on the view, or it desynchronises the two.

**Cost.** Some actions are not undoable by design (deleting an edge, for
instance), and the cap means very long sessions lose the oldest steps.

## 7. Capability entries are inert placeholders

**Decision.** Skills and connector rows render with their requirements spelled
out but never do anything. No request leaves the browser.

**Why.** Showing what is not built is more honest than hiding it, and it keeps
the cost of a real integration visible.

**Cost.** The panel is decoration until a connector actually ships.

## 8. What this project is not

- not a general workflow engine — there is no scheduler, no fan-out, no retries;
- not collaborative — no accounts, no sharing, no realtime channel;
- not a cloud service — there is no backend to deploy beyond the static bundle;
- not connected to any provider by default — simulated mode is the default and
  the only mode a static deployment can offer.

These are scope decisions, not missing features: each one was considered and
left out to keep the model small enough to reason about.
