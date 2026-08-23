# What `audit.js` checks — and how to fix each failure

Run `node <skill>/scripts/audit.js --baseline` BEFORE generation (snapshots existing
`tsc --noEmit` errors to `.claude-skill-tsc-baseline.json` in the repo root), then
`node <skill>/scripts/audit.js <spec> --persist-spec` after `register-di.js`.

Exit 0 = PASS (warnings allowed) · exit 1 = FAIL. Max **3 fix-cycles**, then stop and report.

Flags: `--repo <path>` (default: cwd) · `--persist-spec` · `--skip-tsc` · `--skip-jest` · `--help`.
Skipping tsc or jest is for debugging a single check — never for the run that signs the
feature off.

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
| `arch-boundaries` | FAIL | The clean-architecture dependency rule: `domain/` may import only within `domain/` plus `@domain/*` and `@shared/*` — never `data/` (DTOs!), `@core`, react, expo, axios, react-query, navigation; `data/` may never import from `presentation/`. A violation means a hand-edit crossed a layer — move the type/logic to the right layer (transport DTOs belong behind `mapper.toDTO` in the service) |
| `review-conventions` | FAIL | The conventions PR reviewers enforce by hand (all from real review rounds): the feature directory is kebab-case; no dead pre-1.11.0 directories (`domain/usecases/`, `domain/IServices/`) — note the current interface layout `data/IServices/` + `domain/IRepositories/` is the owner's standing decision and is NOT flagged; the feature error type does not widen `AppError` (no `Omit<AppError,'code'>`, no invented `HTTP_ERROR`/`PARSE_ERROR`); no enum literal array repeated across files (move it to `domain/constants/`); no raw numbers or RN keyword strings in a `styles.ts` (use theme tokens, adding one to `baseStyles.ts` + the `Theme` type if it is missing); no presentation module that nothing imports. Fix the code — never silence the check |
| `components-md` | WARN | COMPONENTS.md drift: a `src/shared/components` component with no dictionary entry (DRIFT) or an entry matching no component (STALE) — write/fix the entry so the reuse gate stays complete (`node <skill>/scripts/check-components-md.js` for details) |
| `tsc-diff` | FAIL | `npx tsc --noEmit` compared against the baseline — only NEW errors fail, matched by file+code+message (line/column shifts of baseline errors are ignored). No baseline file → warns and treats all errors as new |
| `jest` | FAIL | `npx jest src/features/<feature-dir> --watchAll=false --passWithNoTests` — suites must be green; 0 tests ran → WARN |

## After PASS

- `--persist-spec` writes the **sanitized** spec to `src/features/<feature-dir>/feature-spec.json`
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
- MOCK backend (spec.mock): the container serves the MockService — the swap steps once the
  real API exists.
- Render-test infra missing → run `node <skill>/scripts/setup-test-infra.js` (automatic
  install of `@testing-library/react-native` + `jest.setup.js` wiring).
- Navigation: backend-only runs add an expo-router route file under `app/` by hand; in
  full/design modes the design lane registers navigation instead (DESIGN.md §5).
