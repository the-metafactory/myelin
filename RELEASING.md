# Releasing myelin

Myelin is pre-1.0. **A minor bump is a breaking change.** Field names are the
signed bytes, so a rename is wire-breaking; treat every release as potentially
breaking and cut it deliberately.

## Steps

1. **Bump the version** in `package.json` (`X.Y.Z`).
2. **Add a CHANGELOG anchor** for the new version with the date:
   `## [X.Y.Z] — YYYY-MM`. Move the relevant `## [Unreleased]` entries under it.
   Every `###` subsection must sit under a `## [x.y.z]` anchor.
3. **Tag and push:**
   ```bash
   git tag vX.Y.Z              # on the release commit
   git push origin vX.Y.Z      # push ONLY this tag, not `--tags`
   ```
   The tag SHA must be the commit whose `package.json` carries `X.Y.Z`.
   Push the single release tag by name — `git push --tags` would also
   publish any stale or experimental local tags.
4. **Announce the pin-bump** to every consumer so they can update their myelin
   dependency: **cortex, pilot, sage, grove, cedar, reflex**. Link the CHANGELOG
   anchor and call out any breaking cut explicitly (drained replay windows,
   field renames).

## Versioning rule (pre-1.0)

- **Minor = breaking.** `0.Y` → `0.(Y+1)` may break the wire, the schema, or the
  signed field set.
- **Consumers must never be more than one breaking minor behind.** A consumer on
  `0.(Y-2)` cannot safely interoperate with a `0.Y` producer. Keep the pin-bump
  train moving: cut the release, announce, and land the consumer bumps before the
  next breaking cut.
- Patch (`0.Y.Z` → `0.Y.(Z+1)`) is reserved for non-breaking fixes.

## Migration doctrine for breaking wire changes

- **Adding a signed field:** verifiers before emitters (old verifiers drop
  unknown fields from the signing payload and would reject new envelopes).
- **Closing a transition window / removing a field:** emitters before verifiers
  (every producer must stop emitting the legacy key before myelin starts
  rejecting it).

See `docs/migrations/` for worked examples.
