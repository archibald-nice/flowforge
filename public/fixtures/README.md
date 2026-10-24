# Original benchmark fixtures

These 30 small geometric bottle studies are original procedural test assets,
created by `scripts/create-fixtures.mjs`, with no reference images, downloads,
third-party bundles or model calls. They are not generated advertising results.

To the extent copyright applies, these fixture images are dedicated to the
public domain under CC0-1.0. This dedication covers only the fixture PNG images,
not the application source or dependencies. The project license is undecided.

`manifest.json` records dimensions, size, origin, license and SHA-256. Regenerate
with `pnpm fixtures`; deterministic output is suitable for benchmark previews.
The same generator writes `src/assets/fixture-manifest.json` as the compiled
validation manifest; the app does not fetch a network manifest as a trust root.
