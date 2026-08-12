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

All scripts run on plain Node (stdlib only) and support `--help`.

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

## Out of scope (v1)

- Feature removal/rename (DI + env + i18n cleanup)
- Migrating previously generated features to newer template versions
- Upload/multipart endpoints (use `IHttpClient.upload()` manually)
- Navigation wiring (expo-router route files are added by hand)

## Version

**1.0.0** — initial release: create + append modes, app/external/mixed transports, curl parsing,
DTO inference, DI/i18n/config/env wiring, audit with tsc-baseline diff + jest, 4 eval scenarios.

## License

[MIT](LICENSE)
