# What `audit.js` checks — and how to fix each failure

Run `node <skill>/scripts/audit.js --baseline` BEFORE generation (snapshots existing
`tsc --noEmit` errors to `.claude-skill-tsc-baseline.json` in the repo root), then
`node <skill>/scripts/audit.js <spec> --persist-spec` after `register-di.js`.

Exit 0 = PASS (warnings allowed) · exit 1 = FAIL. Max **3 fix-cycles**, then stop and report.

| Check | Level | Meaning / fix |
|---|---|---|
| `structure` | FAIL | Every file `generate.js` should have produced exists. Missing → re-run generate (it never overwrites, so re-running is safe) |
| `anchors` | WARN | Append anchors present in endpoints/service/repository/interfaces. Missing → future appends need manual edits; re-add the comment lines |
| `di-wiring` | FAIL | TOKENS keys + TokenRegistry entries + container registrations all present. Missing → re-run `register-di.js`; a collision report means rename and regenerate |
| `i18n` | FAIL | Feature registered in `src/core/localization/merger.ts` `featureTranslations` (barrel import + shorthand entry). Missing → re-run `register-di.js` |
| `env-files` | FAIL | Every env key present in all SIX env files; real values in `.env`+`.env.development`; **a real value in `.env.example` is a FAIL** (committed file) |
| `secret-hygiene` | FAIL | No env-sourced header value appears as a literal anywhere in the generated feature |
| `duplicate-paths` | WARN | Endpoint path string found in another feature — confirm with the user it is intentional |
| `status-derivation` | FAIL | `TODO(claude): status derivation` still in a mapper — hand-write the flag→state mapping |
| `todos` | WARN | Other `TODO(claude)` markers remain (skipped user story, session wiring) — fine to ship, listed so nothing is forgotten |
| `reuse-first` | WARN | A generated/hand-written file re-declares a helper that already exists in `src/shared/utils` — import the shared one instead (`cleanString` is exempt: mapper-local by repo convention) |
| `tsc-diff` | FAIL | `npx tsc --noEmit` compared against the baseline — only NEW errors fail. No baseline file → warns and treats all errors as new |
| `jest` | FAIL | `npx jest src/features/<Feature> --watchAll=false --passWithNoTests` — suites must be green; 0 tests ran → WARN |

## After PASS

- `--persist-spec` writes the **sanitized** spec to `src/features/<Feature>/feature-spec.json`
  (header values → `<env:KEY>`, devValues → `<env:KEY>`, session values → `<session>`).
  Grep it — it must contain no real secret values before committing. On an APPEND run the
  new endpoints are MERGED into the already-persisted spec (keyed by action; the `design`
  block is kept), so the file always stays the feature's full record. The persisted path is
  also recorded in the manifest's `created` list so rollback removes it on abort.
- Working-file cleanup is MODE-GATED: **backend-only runs** delete
  `.claude-skill-tsc-baseline.json` and `.claude-skill-manifest.json` from the repo root now
  (working files, not for commit). **Full/design runs KEEP BOTH** until the design lane
  finishes — the lane diffs tsc against the baseline and appends its navigation files to the
  manifest — and deletes them at DESIGN.md §7. The manifest is also the rollback map: on
  abort, delete its `created` files and `git checkout --` its `patched` files.

## Reminders the audit prints

- Env placeholders still to fill (`.env.staging` / `.env.preprod` / `.env.production`).
- Session-sourced request fields still passed as plain input (wire to the auth session later).
- Navigation: backend-only runs add an expo-router route file under `app/` by hand; in
  full/design modes the design lane registers navigation instead (DESIGN.md §5).
