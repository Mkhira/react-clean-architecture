# react-clean-architecture

> An [Agent Skill](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) that scaffolds **complete clean-architecture features** in a React Native (Expo) app from a single curl paste — and builds their **pixel-accurate screens from Figma**, verified live on the iOS simulator.

![version](https://img.shields.io/badge/version-1.5.0-blue) ![tests](https://img.shields.io/badge/tests-106%20passing-brightgreen) ![deps](https://img.shields.io/badge/dependencies-zero-lightgrey) ![node](https://img.shields.io/badge/node-%E2%89%A518-339933) ![license](https://img.shields.io/badge/license-MIT-yellow)

Works with **Claude Code**, **Cursor**, **OpenAI Codex CLI**, and any agent that reads `AGENTS.md` / Markdown skills. One [install script](#install), three tools.

---

## What it does

Paste a curl. The skill interviews you (one question per message), writes a small `feature-spec.json`, and then **deterministic Node scripts** — not the LLM — generate every file, wire the DI container, i18n, react-query keys, config and env files, and audit the result against a TypeScript baseline and Jest.

```
src/features/<Feature>/
├── data/          dtos · endpoints · mappers · service · repository
├── domain/        entities · errors · IRepositories · IServices · use cases
├── presentation/  screens + controllers · styles · queries · translations (en/ar)
├── test/          mapper + use-case Jest suites
└── feature-spec.json   (sanitized, persisted — powers append/remove/rename/migrate)
```

### Why script-driven?

**Accuracy and low token usage.** The LLM hand-writes only the spec and the use-case business rules. Everything mechanical is done by dependency-free Node scripts whose code never enters the context window — only their compact output does. Generation is idempotent (anchor comments), never overwrites, and refuses bad specs up front.

---

## The pipeline

```mermaid
flowchart LR
    A["curl paste"] --> B["parse-curl.js"]
    B --> C["intake interview<br/>one question per message"]
    C --> D["feature-spec.json"]
    D --> E["generate.js<br/>all feature files"]
    E --> F["hand-written<br/>use-case rules"]
    F --> G["register-di.js<br/>DI · i18n · config · env"]
    G --> H["audit.js<br/>tsc diff · jest · 20+ checks"]
    H -->|pass| I["persisted spec<br/>append-ready"]
    H -->|fail| F
```

### Three modes

| Mode | Backend slice | Figma screens | When |
|---|---|---|---|
| **Full** | ✅ | ✅ | new feature, endpoint + designs ready |
| **Backend only** | ✅ | — | API first, screens later |
| **Design only** | — | ✅ | screens for an existing/legacy feature |

### The design lane (full / design modes)

Screens are built by the agent from Figma links following strict rules ([DESIGN.md](skills/react-clean-architecture/DESIGN.md)) — theme tokens only, shared-component reuse gate, Arabic-first RTL — then **verified on the iOS simulator** in three passes before sign-off.

```mermaid
flowchart LR
    A["Figma links +<br/>flow narration"] --> B["screen units +<br/>transition edges"]
    B --> C["reuse gate<br/>element → shared component"]
    C --> D["build screen<br/>controller · styles · i18n"]
    D --> E["register navigation<br/>routes · deep links · service card"]
    E --> F["verify on simulator<br/>AR light · AR dark · EN mirror"]
    F -->|diffs| D
    F -->|match| G["user checkpoint"]
    G --> B
```

### Generated architecture (backend slice)

```mermaid
flowchart TB
    subgraph presentation
        SC["Screen"] --> CT["controller.ts"] --> Q["queries.ts<br/>react-query"]
    end
    subgraph domain
        UC["UseCase<br/>business rules"] --> IR["IRepository"]
        UC --> ER["typed errors<br/>Result&lt;T,E&gt;"]
    end
    subgraph data
        RP["Repository"] --> SV["ApiService"] --> EP["endpoints"]
        SV --> MP["mapper<br/>DTO → entity"]
    end
    Q --> UC
    IR -. tsyringe DI .-> RP
```

---

## Install

### Universal (any agent, user-wide) — recommended

```bash
npx skills@latest add Mkhira/react-clean-architecture
```

Pick your agent when prompted (Claude Code, Cursor, Windsurf, Codex, …) — it installs into the right place automatically. The skill lives at [`skills/react-clean-architecture/`](skills/react-clean-architecture/) in the standard Agent-Skills layout.

### Claude Code — native plugin

```
/plugin marketplace add Mkhira/react-clean-architecture
/plugin install react-clean-architecture@react-clean-architecture
```

### install.sh (clone first)

```bash
git clone https://github.com/Mkhira/react-clean-architecture.git
cd react-clean-architecture
```

| Tool | User-wide (main skill) | One project |
|---|---|---|
| **Claude Code** | `./install.sh claude` → `~/.claude/skills/` | `./install.sh claude --project <app>` |
| **Cursor** | `./install.sh cursor` → `~/.cursor/skills/` | `./install.sh cursor --project <app>` (+ routing rule in `.cursor/rules/`) |
| **Codex CLI** | `./install.sh codex` → `~/.codex/skills/` + `~/.codex/AGENTS.md` | `./install.sh codex --project <app>` (+ `AGENTS.md` block) |
| Any `AGENTS.md` agent | — | `./install.sh agents --project <app>` |

Re-running is safe: symlinks are refreshed, copies are replaced, and `AGENTS.md` blocks are updated between markers instead of duplicated.

### Manual

Copy `skills/react-clean-architecture/` wherever your tool discovers skills, e.g.:

```bash
cp -R skills/react-clean-architecture ~/.claude/skills/
```

`SKILL.md` carries standard Agent-Skills frontmatter (`name`, `description`), so any compatible runtime indexes it automatically.

### Usage

Inside the target app repo, ask your agent:

> Create a **TaxValidation** feature from this curl: `curl -X POST https://…`

or for screens only:

> `/react-clean-architecture` I need to append on src/features/TaxStampValidation — design mode only

The agent walks the checklist in [SKILL.md](skills/react-clean-architecture/SKILL.md): intake → confirmation tables → generate → register → audit → (design lane) → final report. Appending an endpoint or a screen to a feature the skill built earlier is automatic — the persisted spec provides full prior context, no re-asking.

---

## Documentation map

| Doc | Contents |
|---|---|
| [SKILL.md](skills/react-clean-architecture/SKILL.md) | the agent's entry point — full workflow, progress checklist, intake protocol, append mode |
| [DESIGN.md](skills/react-clean-architecture/DESIGN.md) | design lane: Figma → screens → simulator verification loop, RTL ground rules, navigation registration |
| [SPEC_FORMAT.md](skills/react-clean-architecture/SPEC_FORMAT.md) | `feature-spec.json` schema + collision rules |
| [AUDIT.md](skills/react-clean-architecture/AUDIT.md) | every audit check and how to fix each failure |
| [COMPONENTS.md](skills/react-clean-architecture/COMPONENTS.md) | shared-components dictionary (props, variants, gotchas) used by the reuse gate |
| [TOKEN_MAP.md](skills/react-clean-architecture/TOKEN_MAP.md) | Figma px/hex/variables → theme token mapping |
| [CHANGELOG.md](CHANGELOG.md) | version history |
| [examples/](skills/react-clean-architecture/examples/) | filled spec + full expected output tree |
| [evals/](skills/react-clean-architecture/evals/) | end-to-end eval scenarios against a real repo copy |

## Scripts reference

| Script | Job |
|---|---|
| `scripts/parse-curl.js` | tolerant curl/Postman paste → structured JSON |
| `scripts/json-to-dto.js` | sample JSON → TypeScript DTO declarations |
| `scripts/generate.js` | spec → every feature file (validates spec; never overwrites; append via anchors) |
| `scripts/register-di.js` | DI + i18n + config + 6 env files, idempotent |
| `scripts/audit.js` | tsc-baseline diff · jest · structure/DI/env/secret checks (`--baseline`, `--persist-spec`) |
| `scripts/rollback.js` | manifest-scoped undo — dry-run plan, `--apply` to execute |
| `scripts/remove-feature.js` | delete a merged feature everywhere (dir + DI + i18n + config + env) |
| `scripts/rename-feature.js` | rename across code/DI/i18n/config/env via derived identifiers only |
| `scripts/migrate-feature.js` | upgrade machine-owned files to current templates; hand-written code preserved |

Paths are relative to [`skills/react-clean-architecture/`](skills/react-clean-architecture/). All scripts run on plain Node ≥ 18 (stdlib only) and support `--help`.

## Testing the skill itself

106 tests on Node's built-in runner — still zero dependencies:

```bash
node --test skills/react-clean-architecture/tests/*.test.js
```

Unit suites cover the parsers, generation scenarios (create/append/never-overwrite/anchors), DI wiring idempotency and collision refusal, every audit check driven to PASS and FAIL, lifecycle scripts, plus aggressive/hostile-input suites. The fixture repos in `tests/helpers.js` mirror the real app files, so the scripts' regexes hit realistic targets. `evals/` covers the tsc-diff and jest steps end-to-end.

## Requirements

- A repo following the zatcaReact conventions: tsyringe `TOKENS`/`TokenRegistry`, `Result<T, E>`, `AppError`-style typed errors, `IHttpClient`, i18next `featureTranslations`, `@core`/`@features`/`@shared` path aliases, jest-expo.
- Node ≥ 18. The design lane additionally needs the Figma MCP server and a booted iOS simulator.

## Secret handling

Real env values land only in `.env` + `.env.development`; the committed env files get placeholders. Persisted specs are sanitized (`<env:KEY>`). The audit fails on real-looking values in `.env.example` or raw secrets in generated code. Session/Bearer headers are never emitted — the HttpClient auth layer owns them, and runtime tokens (curl execution, simulator login) never touch a file.

## Out of scope

- Upload/multipart endpoints (use `IHttpClient.upload()` manually)
- Backend-only mode leaves expo-router wiring to you (full/design modes register navigation automatically)
- Removing/renaming/migrating **pre-skill** features (no persisted spec — manual)

## License

[MIT](LICENSE)
