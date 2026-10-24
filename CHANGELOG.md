# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-24

### Added

- Infinite-canvas workbench with text, image, video, audio and 3D placeholder
  nodes; edges express candidate references only — nothing enters a generation
  unless it is explicitly referenced in the prompt.
- Immutable run snapshots: submitted inputs are frozen as `(nodeId, revision)`
  pairs and later edits to source nodes never leak into existing snapshots.
- Mock generation for every media type, always labelled `simulated`; the
  provider-call counter stays at zero unless a real provider path fires.
- Real generation paths behind explicit switches: Ark image (Seedream), Ark
  video (task submit → poll → download), Ark text (single chat completion) and
  Doubao speech (per-minute billing), all proxied through the local dev server
  so API keys never reach the browser.
- Local persistence: IndexedDB project store, original media blobs with
  checksum validation, full-bundle import/export, readonly HTML export.
- Asset library with categories, favourites and search; image editor with
  simulated variants; timeline-based simulated cutting.
- Agent composer producing plan cards (local rules, or an LLM planner when
  configured) that never execute without explicit confirmation.
- Undo/redo command stack for all project mutations; debounced autosave with
  revision conflict detection across tabs.
- Dark visual system with tokenised colours, spacing and motion.
