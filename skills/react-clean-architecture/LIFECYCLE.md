# LIFECYCLE.md — remove / rename / migrate a feature

All three need the feature's persisted `feature-spec.json`; all are dry-run by default and
execute only with `--apply` (confirm with the user first). Pre-skill features are refused —
those stay manual.

- **Remove**: `node <skill>/scripts/remove-feature.js <Feature> [--apply]` — deletes the
  feature dir and unwires TOKENS/TokenRegistry/container/i18n/config/env everywhere (anchors
  stay — they are permanent). It reports `app/` route files that still import the feature —
  delete those by hand, then run `npx tsc --noEmit`.
- **Rename**: `node <skill>/scripts/rename-feature.js <Old> <New> [--apply]` — renames the
  dir, files, derived identifiers, TOKENS entries, i18n namespace, config fields, env keys,
  and the persisted spec. Only derived identifiers are replaced (a feature "Order" can't
  corrupt "OrderTracking"); use-case/entity names are action-scoped and stay. Afterwards:
  review `git diff`, fix `app/` routes, re-run audit.
- **Migrate**: `node <skill>/scripts/migrate-feature.js <Feature> [--apply]` — regenerates the
  MACHINE-OWNED files (endpoints, service, repository, interfaces, errors) with the current
  templates; hand-added error codes are merged; use cases, mappers, tests, and presentation
  are never touched (dtos/entities only with `--include-types`). Always finish with audit.js.
