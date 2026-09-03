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
  The mock service is hand-owned too (its catalog is enriched after generation) and is never
  regenerated. Two refusals, both without writing anything: a **design-only record** (no
  endpoints — nothing machine-owned exists) and **spec drift** (the service's `async`
  methods no longer match the spec's endpoint actions: the team changed the feature after
  generation, so regenerating from the stale spec would overwrite their work — re-align the
  spec first, via an append run or by editing `feature-spec.json`, then migrate). Two more
  refusals of the same kind: a persisted spec whose `queryParams` / `pathParams` entries are
  not `{ "name", "type" }` objects (fix the spec), and **signature drift** — a method whose
  parameter list on disk differs from what the spec generates (its callers were hand-changed;
  re-align `queryParams` / `pathParams` / `requestSample` to the code).

## Migrate at scale (Claude Code dynamic workflow)

When a template change touches every generated feature, one conversation cannot hold N
migrations plus N audits. `<skill>/workflows/migrate-features.workflow.js` is a Claude Code
workflow script: one agent per feature runs dry-run → apply → audit → up to three fix-cycles
(machine-owned files only), then a second, adversarial agent per migrated feature tries to
prove the diff touched hand-written code or dropped a hand-added error code. Design-only
records and drifted specs are skipped by the script's own refusals and reported, never
forced. Run it from the target repo root on a clean tree — the user has to ask for a workflow
explicitly (say "use a workflow" or put `ultracode` in the prompt); pass
`{ skillDir, features: [{ name, specPath }] }` as `args`, one entry per
`src/features/**/feature-spec.json`. It returns `{ migratedClean, migratedSuspect,
skippedDrift, skippedDesignOnly, failed }`; commit only `migratedClean`, and read the
verifier's issues before touching the rest.
