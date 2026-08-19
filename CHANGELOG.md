# Changelog

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
