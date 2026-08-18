# Changelog

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
