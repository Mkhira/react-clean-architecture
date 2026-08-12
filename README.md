# react-clean-architecture

An [Agent Skill](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
for Claude Code that scaffolds complete clean-architecture features in the **zatcaReact**
React Native (Expo) app — from a curl paste, a sample response, and a user story.

Give it an endpoint and it generates the entire stack, registers everything, tests it, and
audits itself:

```
src/features/<Feature>/
├── data/         dtos · endpoints · mappers · service · repository
├── domain/       entities · errors · IRepositories · IServices · use cases
├── presentation/ starter screen + controller · styles · translations (en/ar)
└── __tests__/    mapper + use-case Jest suites
```

plus tsyringe DI registration (`tokens.ts` + `container.ts`), i18next registration
(`i18n.ts`), `AppConfig`/`ConfigService` fields, and all six `.env` files.

## Why it's script-driven

**Low token usage + accuracy.** Claude hand-writes only a small `feature-spec.json` and the
use-case business rules. Deterministic Node scripts (zero npm dependencies) generate every
file, patch the DI files idempotently via anchor comments, and audit the result — script code
never enters the context window, only compact script output does.

| Script | Job |
|---|---|
| `scripts/parse-curl.js` | tolerant curl/Postman-paste → structured JSON |
| `scripts/json-to-dto.js` | sample JSON → TypeScript DTO declarations |
| `scripts/generate.js` | spec → every feature file (never overwrites; append via anchors) |
| `scripts/register-di.js` | DI + i18n + config + env wiring, idempotent |
| `scripts/audit.js` | tsc baseline diff · jest · structure/DI/env/secret checks |
| `scripts/rollback.js` | manifest-scoped undo: dry-run plan, `--apply` deletes created files + git-restores patched ones |
| `scripts/remove-feature.js` | delete a long-merged feature everywhere (dir + DI + i18n + config + env), spec-driven |
| `scripts/rename-feature.js` | rename a feature across code/DI/i18n/config/env via its derived identifiers only |
| `scripts/migrate-feature.js` | upgrade a feature to the current templates; merges hand-added error codes, preserves hand-written files |

All scripts run on plain Node (stdlib only) and support `--help`. generate.js validates the
spec up front (duplicate actions, unsupported methods, orphan path placeholders, incomplete
request-field provenance, …) so a bad spec is refused instead of becoming broken TypeScript.

## Install

Copy or symlink this directory into your skills folder:

```bash
# user-level
ln -s /path/to/react-clean-architecture ~/.claude/skills/react-clean-architecture
# or project-level
ln -s /path/to/react-clean-architecture <repo>/.claude/skills/react-clean-architecture
```

## Usage

In Claude Code, inside the zatcaReact repo:

> Create a TaxValidation feature from this curl: …

Claude walks you through: endpoint intake (curl or guided) → three confirmation tables
(headers / request-field provenance / status enum) → generation → DI registration → audit.
See [SKILL.md](SKILL.md) for the exact flow, [SPEC_FORMAT.md](SPEC_FORMAT.md) for the spec
schema, and [AUDIT.md](AUDIT.md) for every audit check.

Adding an endpoint to a feature the skill created earlier is automatic (**append mode** —
anchors + the persisted sanitized `feature-spec.json` give it full prior context).

## Testing the skill itself

The skill ships with its own suite (83 tests) built on Node's built-in runner — still zero
dependencies:

```bash
node --test tests/*.test.js
```

- `tests/parse-curl.test.js` / `tests/json-to-dto.test.js` — unit tests for the parsers
  (curl/Postman shapes, quotes/continuations, multipart, overrides, merged array items, …).
- `tests/generate.test.js` — scenario tests against temp fixture repos: create/append modes,
  never-overwrite, anchors, external transport helpers, session-header exclusion, statusEnum
  TODO, device provenance, pre-skill fallback, mixed-host ctor detection.
- `tests/register-di.test.js` — anchor planting, DI/i18n/config wiring, 6-file env policy,
  idempotency, token-collision refusal, internal/BFF reuse.
- `tests/audit.test.js` — every audit check driven to both PASS and FAIL, spec sanitization,
  persist-only-on-PASS.

The fixture repos in `tests/helpers.js` mirror the real app files' shapes, so the scripts'
regexes are exercised against realistic targets. The tsc-diff and jest audit steps are covered
by the eval scenarios (`evals/`) against a real repo copy rather than by these unit tests.

## Requirements

- The zatcaReact repo (or a fork with the same conventions: tsyringe `TOKENS`/`TokenRegistry`,
  `Result<T, E>`, `AppError`-style typed errors, `IHttpClient`, i18next `featureTranslations`,
  `@core`/`@features`/`@shared` path aliases, jest-expo).
- Node ≥ 18. No npm installs needed by the skill itself.

## Secret handling

Real env values are written only to `.env` + `.env.development`. `.env.example`, `.env.staging`,
`.env.preprod`, `.env.production` get empty placeholders (they are committed). The persisted
per-feature spec is sanitized (`<env:KEY>` references). The audit fails on a real-looking value
in `.env.example` and on raw secrets inside generated code. Session/Bearer headers are never
emitted — the HttpClient auth layer owns them.

## Out of scope

- Upload/multipart endpoints (use `IHttpClient.upload()` manually)
- Navigation wiring (expo-router route files are added by hand)
- Removing/renaming/migrating **pre-skill** features (no persisted spec — manual)

## Version

**1.2.0**
- feature lifecycle: `remove-feature.js` (full unwire), `rename-feature.js`
  (derived-identifier-safe), `migrate-feature.js` (template upgrades with error-code merge,
  hand-written files preserved)
- deep core review fixes: POST/PUT with path/query params now generates consistent
  service/repository/interface signatures; non-nullable nested objects map directly (no
  contradictory `: null` fallback); GET/DELETE with a body and colliding input names are
  rejected at validation time
- test suite grown to 83

**1.1.0**
- `rollback.js`: deterministic manifest-scoped undo (register-di edits now recorded in the
  manifest so DI/i18n/config/env patches are restorable too)
- spec validation in generate.js: duplicate actions, unsupported methods, orphan `{placeholders}`,
  provenance/sample mismatches, empty statusEnum — refused with clear messages
- persisted specs stamped with `skillVersion` for future template migrations
- json-to-dto: `[null, {…}]` arrays infer from the first non-null item
- audit tolerates a corrupt tsc baseline file
- test suite grown to 72 (aggressive/hostile-input scenarios, rollback, mis-ordered runs)

**1.0.0** — initial release: create + append modes, app/external/mixed transports, curl parsing,
DTO inference, DI/i18n/config/env wiring, audit with tsc-baseline diff + jest, 4 eval scenarios.

## License

[MIT](LICENSE)
