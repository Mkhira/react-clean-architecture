# Changelog

## 1.11.0 — repo-convention layout: data/services interface, domain/repositories, use-cases

Aligned the generated structure with the zatcaReact repo's dominant convention (surfaced by
PR #305 review; integrated-tariff documents the rule):

- `domain/IServices/I<F>Service.ts` → **`data/services/I<F>Service.ts`** — the service
  contract is a data-layer port (only the repository implementation consumes it); the
  domain's only port stays the repository interface. Signatures still speak domain
  entities, never DTOs.
- `domain/IRepositories/` → **`domain/repositories/`**.
- `domain/usecases/` → **`domain/use-cases/`**.

All templates, register-di.js imports, audit anchor checks, the example output tree, and
tests updated. **migrate-feature.js now relocates old-layout features first** (moves the
three dirs content-preserved, rewrites old import paths in preserved hand-written files —
use cases, tests — then regenerates machine-owned files); dry run reports the planned
relocation without touching disk. New lifecycle test covers the relocation end-to-end.
Suite 146/146. SKILL_VERSION → 1.11.0.

Migrating an existing feature (e.g. the ApplicationStatus PR):
`node <skill>/scripts/migrate-feature.js <Feature> --repo <root>` (dry run) then `--apply`,
finish with audit.js.

## 1.10.0 — scripted navigation registration (register-navigation.js)

DESIGN.md §5's nine registration steps are now one deterministic script:
`node <skill>/scripts/register-navigation.js <spec> --repo <root>` (spec must carry the
`design` block). In one idempotent run it patches RouteContract.ts (type + toHref + flat
map), Routes.ts, the page registry, SERVICES_DATA (from `design.serviceCard`, `addedAt`
today, `requiresAuth` only when true), DeepLinkingService aliases, and en/ar.json
placeholder keys (TODO(claude), minimal-diff JSON edit); creates the
`app/service-flow/<id>.tsx` route file and the feature's `presentation/routes.ts` (never
overwrites); and merges created/patched into the manifest (creating a `mode: "design"`
manifest when generate.js never ran). Design-only with no starter screen gets a placeholder
flow host flagged in `needsClaude`. First run plants permanent `// <design-lane:...>`
anchors (same one-time policy as register-di.js); compact JSON stdout with
needsClaude/needsManual verbatim. Still by hand: translation values, optional card tags,
design-only merger.ts wiring, Home shortcuts.

Verified against copies of the real zatcaReact navigation files (correct 2-space/4-space
indents, minimal JSON diffs, idempotent rerun) + 10 new fixture tests (suite 145/145).
Saves ~7 read+edit round trips (~8–12k tokens) per design run and de-risks the most
error-prone manual step. SKILL_VERSION → 1.10.0.

## 1.9.1 — mandatory context-compaction checkpoints

Long runs must no longer drown in stale intake/Figma/fix-cycle context. New SKILL.md
section "Context-compaction checkpoints": the agent pauses and asks the USER to run the
host's compaction command — Claude Code → `/compact`, Cursor → `/summarize`, Codex CLI →
`/compact`, Gemini CLI → `/compress`, other hosts → their equivalent (no command → skip,
never block). Three mandatory checkpoints:

1. After the final intake confirmation, before any implementation (backend/full: after the
   Step 3 tables; design-only: after the Step 2c summary table + persisted design record).
2. After every per-screen checkpoint (DESIGN.md §4) — folded into the go-ahead message;
   the design record's screen `status` is updated BEFORE the pause.
3. After the test/audit phase passes (backend/full: audit PASS; design-only: the §7
   tsc + jest gate), before the design lane / final report.

Rule: everything needed to resume must be on disk before the pause (spec path named in the
pause message, design record, manifest, todo state); post-compaction work re-reads files,
never chat history. Checklist items 3/8/8b carry inline markers. SKILL_VERSION → 1.9.1.

## 1.9.0 — token-optimization pass: leaner router docs + compact script output

Applied the applicable parts of the 2026-08-22 token-optimization review. Explicitly NOT
applied (user re-confirmed): grouped intake (one-question-per-message stays), grep-only
COMPONENTS.md/TOKEN_MAP.md loading (full reads stay — decision 22), shorter cache question,
fewer confirmation tables, compressed final report, splitting DESIGN.md. No safeguard,
question, or rule was removed — content only moved to where it's loaded on demand.

- **SKILL.md 419 → 336 lines**: append mode → new `APPEND.md` (loaded only when Step 1 finds
  an existing feature); remove/rename/migrate → new `LIFECYCLE.md`; Step 2c screen
  collection → DESIGN.md's new "Screen collection" section (backend-only runs no longer
  carry it; full/design runs load DESIGN.md at collection time, which they need anyway).
  Step 2c/lifecycle/append stubs with hard non-negotiables remain in SKILL.md as routers.
- **History out of the operational docs**: date-stamped user decisions and live-finding
  anecdotes moved to `docs/decisions.md` (never loaded during runs); the rules they produced
  stay in place, undated.
- **Compact machine-readable stdout** (full detail always on disk, failures always verbatim):
  `generate.js` prints `{status, created/skipped/patched counts, needsClaude, needsManual,
  manifest path}` instead of the whole manifest (which is still written to
  `.claude-skill-manifest.json`); `register-di.js` prints counts + full `needsManual`;
  `audit.js` collapses passing checks to one `PASS: a, b, c` line — WARN/FAIL rows,
  reminders, and the RESULT line are unchanged.
- Tests updated to read the on-disk manifest / new summary shapes; suite green (135/135).
- **Round 2** (same review, second pass): the progress checklist is tracked in the agent's
  todo tool instead of being re-printed in chat every update (every step still runs);
  audit.js prints the standing reminders only on PASS runs (failing fix-cycles show only the
  actionable FAIL/WARN rows); the design-only persistence rules moved from SKILL.md Step 1b
  into DESIGN.md's Screen collection section (backend-only runs never needed them).
- Measured on the OrderTracking fixture (2 endpoints): generate+register+audit stdout
  8,323B → 1,777B (−79%, ≈1.6k tokens per pass; audit savings repeat per fix-cycle).
  Docs loaded per run: backend-only −~7.6KB (~1.9k tokens), backend append −~5.2KB,
  full/design −~2.5KB (content mostly relocated, history stripped).

## 1.8.0 — strict clean-architecture boundaries + error taxonomy

Closing the two valid P0s (and one P1) from the external architecture review
(2026-08-19): the domain layer imported the transport RequestDTO through
`domain/IServices`, nothing enforced layer boundaries, and every unknown failure
collapsed to `NETWORK_ERROR`.

- **Domain purity (the review's P0)**: body-endpoint `IService` signatures now take the
  DOMAIN input (`input: XInput`), not `payload: XRequestDTO` — `mapper.toDTO(input)` moved
  from the repository into the SERVICE, so the transport DTO never crosses into `domain/`.
  The repository is a pure passthrough. GET endpoints were already clean. The mock lane is
  untouched (MockService implements the same interface, samples still flow through real
  mappers).
- **`arch-boundaries` audit check (FAIL-level)**: `domain/` may import only within
  `domain/` plus `@domain/*`/`@shared/*` — never `data/`, `@core`, react, expo, axios,
  react-query; `data/` may never import `presentation/`. Locks the fix in forever;
  exported as `archBoundaryProblems` for reuse. Verified clean against the real
  ApplicationStatus feature.
- **Error taxonomy**: generated feature error codes gain `AUTH_ERROR` + `TIMEOUT`; the
  use-case catch classifies axios rejections (401/403 → `AUTH_ERROR`, `ECONNABORTED`/
  `ETIMEDOUT` → `TIMEOUT`) before the envelope-description `NETWORK_ERROR` fallback.
  Generated use-case tests cover both classifications.
- **Device provenance fixed for real** (latent since v1): the old template imported a
  `getDeviceInfo` util that does not exist in the target repo — device features never
  typechecked. The service now injects the DI-registered `TaxpayerAuthDeviceContextService`
  (register-di passes it), plus `Platform.Version` and `getStoredLanguage()` for
  osVersion/language. Verified end-to-end in the real repo: a scratch POST feature with
  body + device + query + mock passed the FULL audit (tsc-diff clean, jest green).
- `examples/expected-output/` regenerated; new suite `tests/arch-boundaries.test.js` —
  **135 tests**.

## 1.7.0 — verification tools + infra automation

Closing the three residual gaps from the 1.6.0 rating (user decisions 2026-08-19):

- **install.sh auto-installs idb** (Facebook's iOS debug bridge) so the design lane can
  VERIFY WITH REAL TAPS: DESIGN.md §3 gains an interactive verification preflight
  (`idb ui tap/text` — exercise every transition edge and interactive state; the
  ApplicationStatus pagination bug needed a 3-tap sequence to reproduce). Companion via
  `brew tap facebook/fb && brew install facebook/fb/idb-companion`; **no Homebrew** → the
  prebuilt `idb-companion.universal.tar.gz` from the GitHub release into `~/.local`
  (user-writable, no sudo) behind an exec wrapper named `idb_companion` (the binary resolves
  its Frameworks/ relative to its real path — and note the underscore: that's the archive's
  binary name and what the client searches PATH for). Client via pipx (with a
  `--python /usr/bin/python3` retry — Homebrew's python 3.14 was broken live) or
  `python3 -m pip install --user fb-idb`. Homebrew itself is NEVER auto-installed (an
  installer must not pipe remote scripts with admin rights). Every step non-fatal;
  `--no-tools` opts out; screenshot-only fallback when idb is absent. The no-brew path is
  tested end-to-end in an isolated $HOME.
- **`scripts/setup-test-infra.js`** — render-test infra is now AUTOMATIC (SKILL.md Step 1.5,
  checklist 0b): installs `@testing-library/react-native` with the repo's own package
  manager (lockfile detection), creates the `jest.setup.js` starter (gesture-handler / MMKV /
  reanimated / safe-area mocks) only when absent, wires `setupFilesAfterEnv` into the
  package.json jest block (standalone jest.config.* → reported for a hand edit, never
  rewritten). Idempotent; install failure never blocks the run (logic tests + explicit
  report). DESIGN.md §2.4: render tests are REQUIRED, with priority cases named.
- **`scripts/check-components-md.js`** — COMPONENTS.md drift detector (DRIFT: repo component
  with no dictionary entry — the List case; STALE: entry matching no component), wired into
  audit as a WARN-level `components-md` check. Detection only — prose entries stay
  hand-written.
- New test suite `tests/infra-tools.test.js` — **127 tests**.

## 1.6.0 — live-run fixes (ApplicationStatus, 2026-08-19)

Seven improvements from the first full mock-backend feature run:

- **Mock backend lane is first-class** (`spec.mock: true`): generate.js emits
  `data/services/<Feature>MockService.ts` — the spec's responseSample typed as the DTO and
  fed through the REAL mappers, underscore-prefixed params, append anchor — next to the
  still-generated real service; register-di.js registers the MOCK for
  `TOKENS.<Feature>Service` with a one-line swap comment (real service not imported — no
  dead import). SKILL.md Step 2 detects "use mock backend / API not ready", skips curl
  execution (sample asked for or Figma-derived with user confirmation), pre-answers
  DESIGN.md §1, and Step 5.3 requires enriching the sample catalog (filters × statuses ×
  pages). Audit reminds about the swap.
- **tsc baseline diff is line-number-insensitive**: errors compared by file + code + message
  as a multiset, so an insertion that shifts a pre-existing error's line no longer reports
  a false "NEW error" (live false positive: Routes.ts). Pure `freshTscErrors` exported for
  tests.
- **Cache question names both cache layers** and gains **`"always-fresh"`** → `staleTime: 0`
  in the generated query hook (defeats the app-wide 5-min in-memory react-query default);
  durations still map to `storeDuration`; "no" is documented as device-cache-only (live
  confusion: "no cache" ≠ no in-memory reuse).
- **Stale template fixed**: `formatDateTimeDateMonthYear` (no longer exported by the repo's
  dateFormat) → `formatNumericGregorianDate` across templates, tests, examples, docs.
- **Footerless PageStepper pattern documented** (DESIGN.md §2 + StepperActions entry):
  `footerActions={{ containerStyle: styles.hiddenFooter } as StepperActionsProps}` — the
  default "التالي" footer always renders otherwise.
- **Paginated-list gotcha documented** (DESIGN.md §2 + new COMPONENTS.md `List` entry +
  quick-lookup row): react-query cache hits swap FlashList datasets within one render and
  leave stale row layout next to a fresh pager — remount via `key={listContextKey}` (every
  query param except the page) + the settled-empty gate /
  `ListEmptyComponent={showEmptyState ? undefined : null}` idiom.
- **Render-test infra surfaced, not silent**: audit reminds once when
  `@testing-library/react-native` is missing; the final report must offer the one-time
  install instead of silently shipping logic-only tests.
- New regression suite `tests/mock-and-cache.test.js` — **118 tests**.

## 1.5.0 — design lane

- **DESIGN.md**: full Figma → screens → simulator lane — per-screen build procedure, RTL
  ground rules (trust rendered screenshots over metadata order; logical vs physical
  positioning), reuse gate against the shared-components dictionary, iOS simulator
  verification loop (AR light / AR dark / EN mirror), per-screen user checkpoints,
  9-step navigation registration (routes, deep links, service card), design-append (§6),
  definition of done.
- **SKILL.md**: mode question (full / backend only / design only), Step 2c screen collection
  (flow-description style preferred; bare-links fallback loop), service-card defaults row
  instead of a questionnaire, design-record persistence for crash-safe resume.
- **COMPONENTS.md** (shared-components dictionary) and **TOKEN_MAP.md** (Figma → theme
  tokens) shipped with the skill.
- Scripts understand the spec's `design` block (screens / transitions / serviceCard);
  audit + lifecycle updated for design mode.
- Examples restructured (controller.ts, queries.ts, screens/, translations barrel);
  hostile-input test suite added — **106 tests**.

## 1.4.0

- Response body is no longer a question: the skill EXECUTES the pasted curl and captures the
  live response (GET immediately; POST/PUT/DELETE after explicit confirmation); sample-paste /
  "none" remain only as fallbacks when execution fails.
- User story asked ONCE per run (write or skip) after all curls are in — in multi mode its
  rules are mapped onto each endpoint's use case.
- Multi mode: "next curl, or done?" after every capture; summary table on "done".

## 1.3.1

- Intake protocol hardened (live-run finding): the Step 2 question order is fixed and
  unconditional — "single or multiple endpoints?" first, alone; then the curl; then response
  body; then user story — ONE question per message, never bundled, regardless of Step 1's
  folder/mode outcome.

## 1.3.0

- Generated tests live in `test/` (was `__tests__/`) — pre-1.3.0 features keep their existing
  `__tests__/` dir automatically (append/audit/migrate detect it).
- The `@shared/components` barrel mock is emitted in BOTH test templates unconditionally —
  shared utils (dateFormat, regex, digitNormalization…) pull the barrel and crash jest
  otherwise.
- SKILL.md final report notes the expo-router typed-routes caveat (`as Href` until the next
  `expo start`).

## 1.2.1

- App-host transport follows the HttpClient mapper-config convention (live-test finding):
  `{ mapper: <Action>Mapper.toDomain }` with the domain type as the generic; use-case catch
  surfaces the API envelope's status description; controller logs errors visibly.

## 1.2.0

- Feature lifecycle: `remove-feature.js` (full unwire), `rename-feature.js`
  (derived-identifier-safe), `migrate-feature.js` (template upgrades with error-code merge,
  hand-written files preserved).
- Deep core review fixes: POST/PUT with path/query params now generates consistent
  service/repository/interface signatures; non-nullable nested objects map directly (no
  contradictory `: null` fallback); GET/DELETE with a body and colliding input names are
  rejected at validation time.
- Test suite grown to 83.

## 1.1.0

- `rollback.js`: deterministic manifest-scoped undo (register-di edits now recorded in the
  manifest so DI/i18n/config/env patches are restorable too).
- Spec validation in generate.js: duplicate actions, unsupported methods, orphan
  `{placeholders}`, provenance/sample mismatches, empty statusEnum — refused with clear
  messages.
- Persisted specs stamped with `skillVersion` for future template migrations.
- json-to-dto: `[null, {…}]` arrays infer from the first non-null item.
- Audit tolerates a corrupt tsc baseline file.
- Test suite grown to 72 (aggressive/hostile-input scenarios, rollback, mis-ordered runs).

## 1.0.0

Initial release: create + append modes, app/external/mixed transports, curl parsing, DTO
inference, DI/i18n/config/env wiring, audit with tsc-baseline diff + jest, 4 eval scenarios.
