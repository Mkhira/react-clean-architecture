# Implementation plan — align `/react-clean-architecture` with the Claude Code skills, hooks, subagents, advanced-features, workflows and plugins guides

Source review: 2026-09-03, against https://claude.nagdy.me/learn/{skills,hooks,subagents,advanced-features,workflows,plugins}/.
Repo: `Mkhira/react-clean-architecture` (this file lives at the repo root, outside `skills/`, so no install path ships it).
Skill dir below = `skills/react-clean-architecture/`. Line numbers are from v1.18.1 (`SKILL_VERSION` at `scripts/generate.js:1951`).

Standing constraints (do not violate — see `skills/react-clean-architecture/docs/decisions.md`):
- No token-economy RULES (read budgets, fetch caps, grouped intake). Structural changes only.
- One question per message in intake stays. Confirmation tables stay. Compaction pauses stay.
- `data/IServices` + `domain/IRepositories` layout is settled. `IService` per endpoint stays.
- Never re-propose: grouped intake, grep-only reference loading, shorter cache question, compressed final report, splitting DESIGN.md.

Release cadence: Phase 0 ships as **1.18.2**; Phases 1–3 ship together as **1.19.0**; Phases 4–6 are outside the skill repo or optional and carry no version.
Every release phase ends with the same four edits: `scripts/generate.js:1951` `SKILL_VERSION`, `.claude-plugin/plugin.json` `version`, `.claude-plugin/marketplace.json` `plugins[0].version`, `README.md:5` badge + `README.md:198` "current release", plus a new top section in `CHANGELOG.md` (above line 3).

Test command for every gate: `node --test skills/react-clean-architecture/tests/*.test.js` (189 passing at start).

---

## Phase 0 — doc drift (1.18.2) — DONE 2026-09-03, commit 86ef7b7 (amended), tag v1.18.2 local (not pushed)

- [x] `README.md:5` — badge `version-1.18.0` → `version-1.18.1` (then 1.18.2 on release)
- [x] `README.md:198` — "The current release is **1.18.0**" → current version
- [x] `install.sh:183` — `write_agents_block` text "it links DESIGN.md, SPEC_FORMAT.md and AUDIT.md as needed" → "it links INTAKE.md, APPEND.md, LIFECYCLE.md, REVIEW.md, FORMS.md, COMPONENTS.md, DESIGN.md, SPEC_FORMAT.md and AUDIT.md as needed"
- [x] `install.sh:229-233` — Cursor `.mdc` rule body: add one sentence "Read INTAKE.md when it routes you there; the design lane, forms and review conventions live in DESIGN.md / FORMS.md / REVIEW.md."
- [x] `skills/react-clean-architecture/tests/update-check.test.js:200-205` — extend the existing version-drift test: read `README.md` and assert the badge (`/version-(\d+\.\d+\.\d+)-blue/`) and the "current release is **X**" line both equal `SKILL_VERSION`. This is what would have caught the 1.18.0/1.18.1 drift.
- [x] `CHANGELOG.md` — new `## 1.18.2 — README/install.sh doc drift + README version guard` section
- [x] Bump the four version sites to 1.18.2

Guards:
```bash
grep -n "1\.18\.0" README.md                                   # expect: no hits
grep -n "it links DESIGN.md, SPEC_FORMAT.md and AUDIT.md" install.sh   # expect: no hits
node --test skills/react-clean-architecture/tests/*.test.js   # expect: 190 passing (189 + README guard)
```
Commit: `1.18.2: README version guard; install.sh AGENTS/Cursor blocks name every routed doc`
Tag: `git tag v1.18.2` (or `claude plugin tag --push` once Phase 3.6 confirms the tag format).

---

## Phase 1 — SKILL.md frontmatter and arguments (1.19.0) — DONE 2026-09-03 (committed as 1/3; version sites still 1.18.2 until Phase 3 releases)

### 1.1 Frontmatter fields — `skills/react-clean-architecture/SKILL.md:1-15`

- [x] Add after `description:` (line 14):
  ```yaml
  argument-hint: "[feature name] [curl paste | figma link | 'design only' | 'mock']"
  effort: high
  allowed-tools: Bash(node *), Bash(npx tsc *), Bash(npx jest *), Bash(npx expo *), Bash(xcrun simctl *), Bash(idb *), Bash(git status *), Bash(git describe *), Bash(command -v *), Read, Edit, Write, Glob, Grep
  ```
  `effort: high` pins the design lane's reasoning depth for users without a global `effortLevel`. `allowed-tools` grants, never restricts; `Bash(curl *)` is deliberately NOT listed so mutating curls (INTAKE.md:77) still prompt for users outside auto mode.
- [x] Do NOT add `disable-model-invocation`, `user-invocable: false`, `paths`, `context: fork`, `model`, `shell` (see "Not planned").

### 1.2 `<skill>` resolution — `SKILL.md:26`

- [x] Append one sentence to line 26: "In Claude Code this is `${CLAUDE_SKILL_DIR}` (substituted before you read this; other hosts see the literal text and resolve the directory themselves)."
- [ ] (manual, next real run) Verify: invoke `/react-clean-architecture` in Claude Code, confirm the rendered line shows the absolute path, not the literal `${CLAUDE_SKILL_DIR}`. If it does NOT substitute inside a `>-` folded block or body text, keep the sentence but reword to "run `echo $CLAUDE_SKILL_DIR`".

### 1.3 `$ARGUMENTS` pre-fill — `SKILL.md:161-190`

- [x] New subsection immediately above `## Step 1 — Feature name` (line 161):
  ```
  ## Step 0z — Arguments already given
  Invocation arguments: `$ARGUMENTS`
  If that line is non-empty, extract what it already answers BEFORE asking: a feature name
  (Step 1), a mode word ("design only" / "backend only" / "full", Step 1b), "mock" / "API not
  ready" (INTAKE.md mock lane), and a pasted curl or figma.com link (Step 2 / Step 2c). Skip
  ONLY the questions those answer, in one short confirmation line ("Feature ApplicationStatus,
  design only — from your arguments"). Every question the arguments do not answer is still
  asked, one per message, in the fixed order. Empty → ask everything as before.
  ```
- [x] `SKILL.md:56` checklist — insert `- [ ] 0z. Arguments given? → pre-fill Step 1 / 1b / mock from $ARGUMENTS (never skip an unanswered question)` after item 0d (line 67)
- [x] `SKILL.md:188` Step 1b — prefix "Ask ONLY (one question, wait for the answer)" with "Unless 0z already answered it:"
- [x] `INTAKE.md:9-14` — add one sentence: "A curl or 'mock' captured from the invocation arguments (SKILL.md 0z) counts as the answer to sequence step 2 / the mock lane; the ordering of everything else is unchanged."
- [x] `README.md:214-231` Usage — add the three-argument example: `/react-clean-architecture ApplicationStatus design only`

### 1.4 Dynamic context for the deterministic pre-checks — `SKILL.md:96-127`

Claude Code only; other hosts see literal text, so the wording must degrade cleanly.

- [x] Add under `## Update check` (after line 97, before the fenced command):
  ```
  Claude Code pre-ran it at invocation — the result is on the next line (empty on other hosts → run the command yourself):
  !`node "${CLAUDE_SKILL_DIR}/scripts/check-update.js" 2>/dev/null`
  ```
- [x] Same pattern for the dirty-tree check at `SKILL.md:173`: `!`git status --porcelain 2>/dev/null | head -20``
- [x] Do NOT inline `audit.js --baseline` (it writes a file and takes seconds; keep it a deliberate step).
- [x] Verify the `!` output is not double-run: the checklist item 0 wording must say "if the line above is present, do not re-run".
- [x] (worded: "if it still shows a command … run it yourself") Verify in Cursor/Codex copy that the literal `` !`…` `` line reads as an instruction, not garbage (install.sh `--copy` then open SKILL.md).

### 1.5 Version + changelog

- [x] `CHANGELOG.md` — `## 1.19.0 — frontmatter fields, argument pre-fill, inlined pre-checks, compaction hooks, plugin rename` (Phases 1–3 share it)

Guards:
```bash
grep -n "argument-hint\|^effort:\|^allowed-tools:" skills/react-clean-architecture/SKILL.md   # expect: 3 hits inside frontmatter
grep -n '\$ARGUMENTS' skills/react-clean-architecture/SKILL.md                                # expect: ≥1
grep -c "ONE QUESTION PER MESSAGE" skills/react-clean-architecture/INTAKE.md                  # expect: unchanged (1)
```
Commit: `1.19.0 (1/3): SKILL.md frontmatter (argument-hint/effort/allowed-tools), $ARGUMENTS pre-fill, inlined update/dirty-tree checks`

---

## Phase 2 — hooks (1.19.0) — DONE 2026-09-03 except the manual verify gate (committed as 2/3)

All hook scripts: Node, zero deps, under `skills/react-clean-architecture/scripts/hooks/`, JSON on stdin, exit 0 with JSON stdout or exit 2 with a stderr message. Each gets a `tests/hooks.test.js` case driven by piped stdin.

### 2.1 Hook scripts (new files)

- [x] `scripts/hooks/pre-compact.js` — event `PreCompact`. Reads `cwd` from stdin JSON. Finds the resume artifacts: `.claude-skill-manifest.json` in cwd, and the spec path named inside it (`spec` key written by generate.js) or any `src/features/*/feature-spec.json` newer than the manifest. If a skill run is in progress (manifest exists) and the spec file is missing → print `{"decision":"block","reason":"react-clean-architecture: spec not on disk — persist it (audit.js --persist-spec or the design record) before compacting"}`. Otherwise exit 0 silently. No manifest → not a skill run → exit 0.
- [x] `scripts/hooks/post-compact.js` — event `PostCompact`. Same discovery. When a manifest exists, print `{"hookSpecificOutput":{"hookEventName":"PostCompact","additionalContext":"react-clean-architecture resume: spec=<path> manifest=<path> mode=<manifest.mode> screens=<n pending/<n> verified>. Re-read both before continuing; todo checklist state is authoritative."}}`.
- [x] `scripts/hooks/guard-self-update.js` — event `PreToolUse`, matcher `Bash`. Reads `tool_input.command`. Blocks (exit 2, stderr "SKILL.md: never update the skill yourself — tell the user the command instead") when the command matches `git pull` / `git fetch` / `git checkout` with a path inside `${CLAUDE_SKILL_DIR}` or its `realpath`, or `/plugin update`, or `install.sh`. Everything else exit 0.
- [x] `scripts/hooks/stop-gate.js` — event `Stop` (command hook, deterministic; NOT a prompt hook). Exit 0 with no output when: no manifest in cwd (not a skill run), OR the transcript's last assistant message contains one of the skill's own pause markers (`please run **\`/compact\`**`, `Good moment to free up context`, `correct, or edit #`, `next curl, or done?`, `next screen, or done?`) — those are legitimate stops. Otherwise, when a manifest exists and any of these hold, block with the list: `.claude-skill-tsc-baseline.json` still present after a backend-only run (AUDIT.md:40), `TODO(claude): status derivation` in any mapper under the manifest's feature dir, `check-components-md.js` reporting drift ≠ 0. Read `stop_hook_active` from stdin and exit 0 when true (never loop).
- [x] `scripts/hooks/format-feature-file.js` — event `PostToolUse`, matcher `Edit|Write`. If `tool_input.file_path` is under `src/features/` or `app/service-flow/` and ends `.ts|.tsx`, run `npx prettier --write <file>` with the repo's config; swallow failures (exit 0). Emits nothing.

### 2.2 Wire them in the skill frontmatter — `SKILL.md:1-15`

- [x] Add:
  ```yaml
  hooks:
    PreToolUse:
      - matcher: "Bash"
        hooks:
          - type: command
            command: node "${CLAUDE_SKILL_DIR}/scripts/hooks/guard-self-update.js"
    PostToolUse:
      - matcher: "Edit|Write"
        hooks:
          - type: command
            command: node "${CLAUDE_SKILL_DIR}/scripts/hooks/format-feature-file.js"
    PreCompact:
      - matcher: "manual"
        hooks:
          - type: command
            command: node "${CLAUDE_SKILL_DIR}/scripts/hooks/pre-compact.js"
    PostCompact:
      - hooks:
          - type: command
            command: node "${CLAUDE_SKILL_DIR}/scripts/hooks/post-compact.js"
    Stop:
      - hooks:
          - type: command
            command: node "${CLAUDE_SKILL_DIR}/scripts/hooks/stop-gate.js"
            timeout: 20
  ```
- [ ] (manual, next real session) VERIFY GATE (must pass before merging 2.2): start a session, invoke the skill, run `/compact` with no manifest → no block; create an empty `.claude-skill-manifest.json` in a scratch repo, `/compact` → block message appears. If skill-frontmatter hooks do not fire for `PreCompact`/`PostCompact`/`Stop` (the guide only demonstrates `PreToolUse` there), move those three to Phase 3.3's plugin `hooks/hooks.json` and document a copy-paste `settings.json` block in the README for non-plugin installs. Evidence so far: the 2.1.259 binary registers frontmatter `hooks` for file-based skills (only MCP-sourced skills are refused) and knows PreCompact/PostCompact/stop_hook_active/CLAUDE_SKILL_DIR; the scripts themselves are unit-tested against piped stdin.
- [ ] (only if the gate fails) If `${CLAUDE_SKILL_DIR}` is not expanded inside frontmatter `command:` strings, fall back to `"$CLAUDE_PROJECT_DIR"`-relative discovery: the hook scripts locate the skill dir via `path.join(__dirname, '..', '..')` anyway, so only the invoking path matters — use `node "$(dirname "$(readlink -f ~/.claude/skills/react-clean-architecture/SKILL.md)")/scripts/hooks/…"` as the documented fallback.

### 2.3 Docs that mention the new behaviour

- [x] `SKILL.md:129-160` compaction section — add: "A PreCompact hook refuses compaction while the spec is not on disk; a PostCompact hook re-injects the spec/manifest paths. They are a backstop — still write the paths in the pause message."
- [x] `SKILL.md:115` — add "(a PreToolUse hook blocks it mechanically in Claude Code)"
- [x] `AUDIT.md:32-47` After PASS — add: "The Stop hook re-checks the working-file cleanup and status-derivation TODOs before the run can end."
- [x] `README.md` — new `### Hooks` subsection under `## Documentation map` (line 232) listing the five hooks, what each blocks, and that they only run inside a skill run (manifest present).
- [x] `tests/hooks.test.js` — new: one case per script, piping stdin JSON; block/allow assertions; `stop_hook_active: true` → allow; pause-marker → allow.

Guards:
```bash
ls skills/react-clean-architecture/scripts/hooks/           # 5 files
grep -n "^hooks:" skills/react-clean-architecture/SKILL.md  # 1 hit
echo '{"cwd":"/tmp/empty","trigger":"manual"}' | node skills/react-clean-architecture/scripts/hooks/pre-compact.js; echo "exit=$?"   # exit=0, no output
node --test skills/react-clean-architecture/tests/*.test.js # all green, count ≥ 200 (actual: 215)
```
Commit: `1.19.0 (2/3): skill-scoped hooks — PreCompact/PostCompact resume guard, never-self-update guard, Stop gate, prettier on feature files`

---

## Phase 3 — plugin packaging (1.19.0) — DONE 2026-09-03 (3.3 skipped pending the 2.2 gate, 3.4 skipped)

### 3.1 Rename the plugin to kill the doubled namespace — DECISION (user, 2026-09-03): plugin name `react-clean-plugin`; marketplace name kept as `react-clean-architecture` so already-added marketplaces survive

Result: `/rca:react-clean-architecture` instead of `/react-clean-architecture:react-clean-architecture`. Skill name unchanged (every non-plugin install keeps `/react-clean-architecture`).

- [x] `.claude-plugin/plugin.json:3` — `"name": "rca"`; keep `"skills": ["./skills/react-clean-architecture"]`
- [x] `.claude-plugin/marketplace.json:2` — `"name": "rca"`; `plugins[0].name` → `"rca"`
- [x] `scripts/check-update.js:35` — `PLUGIN_NAME` is used for BOTH the plugin commands (117-118) and the npx/cache paths (137, 147). Split: `const PLUGIN_NAME = 'rca'; const SKILL_NAME = 'react-clean-architecture';` — lines 137 and 147 use `SKILL_NAME`, 117-118 use `PLUGIN_NAME`.
- [x] `tests/update-check.test.js:94` — plugin cache fixture path → `/Users/x/.claude/plugins/cache/rca/skills/react-clean-architecture/scripts/check-update.js`; 105 regex → `/\/plugin marketplace update rca\n.*\/plugin update rca/`
- [x] `README.md:133-146` — install block becomes `/plugin marketplace add Mkhira/react-clean-architecture` then `/plugin install rca@rca`; replace the apology paragraph (140-145) with "Plugin skills are namespaced `<plugin>:<skill>`, so this install is `/rca:react-clean-architecture`."
- [x] `README.md:196-212` Update table, plugin row → `/plugin marketplace update rca` **then** `/plugin update rca`
- [x] `install.sh` — no change (does not know the plugin name)
- [x] Guard: `grep -rn "react-clean-architecture@react-clean-architecture\|react-clean-architecture:react-clean-architecture" README.md CHANGELOG.md` → hits only inside the 1.19.0 changelog entry explaining the rename.

### 3.2 Plugin-data cache path — `scripts/check-update.js:147`

- [x] `cachePath()` → `process.env.CLAUDE_PLUGIN_DATA ? path.join(process.env.CLAUDE_PLUGIN_DATA, 'update-check.json') : path.join(os.homedir(), '.cache', SKILL_NAME, 'update-check.json')`
- [x] `tests/update-check.test.js` — one case with `CLAUDE_PLUGIN_DATA` set in `env` asserting the path.

### 3.3 Plugin hooks file (only if the 2.2 verify gate fails, otherwise skip)

- [ ] (skipped: 2.2 gate not yet failed) `hooks/hooks.json` at the plugin root, same five hooks, commands as `node "${CLAUDE_PLUGIN_ROOT}/skills/react-clean-architecture/scripts/hooks/<name>.js"`
- [ ] (skipped: 2.2 gate not yet failed) `README.md` — settings.json snippet for symlink/copy installs (same JSON with an absolute path)

### 3.4 LSP for live TypeScript diagnostics — OPTIONAL (no official TypeScript LSP plugin exists in `claude-plugins-official`)

- [ ] (skipped: typescript-language-server not on PATH) `.lsp.json` at the plugin root:
  ```json
  { "typescript": { "command": "typescript-language-server", "args": ["--stdio"], "extensionToLanguage": { ".ts": "typescript", ".tsx": "typescriptreact" }, "restartOnCrash": true, "shutdownTimeout": 5000 } }
  ```
  `restartOnCrash`/`shutdownTimeout` need Claude Code ≥ 2.1.205 (you run 2.1.259). Requires `typescript-language-server` on PATH; README `## Requirements` (line 285) gains one line.
- [ ] (open) Decide after one design-lane run whether the diagnostics reduce audit fix-cycles; drop it if not.

### 3.5 Skip: `userConfig`, `experimental.monitors`, `settings.json`, `agents/`, `commands/` — see "Not planned".

### 3.6 Release plumbing

- [x] `claude plugin tag --dry-run` from the repo root → confirm it produces `v1.19.0` (with the `v` prefix `check-update.js:latestTag` parses, line ~66). If it does, `README.md:275-284` gains the release command and future tags use it; if the prefix differs, keep `git tag vX.Y.Z`.
- [x] `claude plugin validate .` → pass
- [ ] (manual: interactive `/` menu) `claude --plugin-dir /Users/mohamedkhira/ReactNative/react-clean-architecture` → `/rca:react-clean-architecture` appears in the `/` menu; `claude plugin details rca` reports the token estimate (record it in the changelog).
- [x] `skills/react-clean-architecture/docs/decisions.md` — new dated entry: plugin renamed to `rca`, hooks added, why the Stop hook is a command hook (deterministic, must not fight the mandatory pauses).
- [x] Bump the four version sites to 1.19.0; `CHANGELOG.md` 1.19.0 entry complete; tag.

Commit: `1.19.0 (3/3): plugin renamed rca (/rca:react-clean-architecture), CLAUDE_PLUGIN_DATA cache, optional .lsp.json`

---

## Phase 4 — zatcaReact side (no skill version) — DONE 2026-09-03 except the manual /doctor check; DESIGN.md/README edits folded into 1.19.0 (tag moved, unpushed)

Repo: `/Users/mohamedkhira/ReactNative/zatcaReact`.

- [x] (hand-written — the bundled generator is not exposed to this session; NOTE zatcaReact/.gitignore ignores `.claude/` entirely, so the file is local until `!.claude/skills/run-zatca/` is un-ignored) Run `/run-skill-generator` once from the zatcaReact root. Feed it DESIGN.md §3's recipe (lines 362-369): booted simulator, `npx expo run:ios` or `xcrun simctl launch booted com.zatca.app`, Metro via plain `npx expo start` (never `start:dev`, `--env-file` is rejected), wait for "Bundled … (N modules)", terminate + relaunch if the app started first, deep link `xcrun simctl openurl booted "zatca://service-flow/<id>"`. Output: `.claude/skills/run-zatca/SKILL.md` committed to zatcaReact.
- [x] `skills/react-clean-architecture/DESIGN.md:362-369` — prefix step 1 with: "If the target repo has a `run-<name>` skill (`ls .claude/skills/run-*`), invoke `/run` and let it drive the launch; the recipe below is the fallback." (skill change, ships with 1.19.0 if done in time, else 1.19.1)
- [x] `~/.claude/settings.json` — add `"autoMode": { "environment": ["$defaults", "Trusted app hosts: the EXPO_PUBLIC_API_URL / EXPO_PUBLIC_INTERNAL_BASE_URL values in zatcaReact/.env.development (no BFF url exists there); Metro localhost:8081; Figma MCP"] }` so the auto-mode classifier stops stalling on INTAKE.md's curl execution. Keep `"$defaults"` first.
- [x] `README.md:285` Requirements — one paragraph: "Sandbox / auto mode: the intake executes your curl and the design lane calls the Figma MCP; allowlist those hosts in `sandbox.network.allowedDomains` / `autoMode.environment`."
- [x] (default taken: personal symlink stays; teammates `/plugin install react-clean-plugin@react-clean-architecture` once the tags are pushed) Team distribution — DECISION: either `./install.sh claude --project /Users/mohamedkhira/ReactNative/zatcaReact --copy` (commits `.claude/skills/react-clean-architecture/` into the app repo) or leave personal. Default: leave personal until the plugin rename ships, then teammates use `/plugin install rca@rca`.
- [ ] (manual: `claude doctor` CLI reports no install issues but has no skill-budget line; run `/doctor` in a session) Run `/doctor` once and record whether the skill listing overflows its budget; if it does, disable unused Figma skills via `skillOverrides` rather than shortening this skill's description.

Commit (zatcaReact): `chore: add run-zatca skill so /run and /verify know the Expo + simulator launch`

---

## Phase 5 — delegation (OPTIONAL — deferred on 2026-08-22, not rejected) — DONE 2026-09-03, folded into 1.19.0 (tag moved, unpushed)

- [x] `skills/react-clean-architecture/DESIGN.md:203-230` "Keeping COMPONENTS.md current" — add: "In Claude Code, delegate the entry-writing to a `general-purpose` subagent (NOT `Explore`, it skips CLAUDE.md and cannot write): prompt = the DRIFT list + the house format from this section + `${CLAUDE_SKILL_DIR}/COMPONENTS.md` path; verify with `check-components-md.js` → `0 drift` before continuing." Main conversation stays interactive.
- [x] `SKILL.md:303-340` Step 5.6 fix-cycles — same optional delegation for cycles 2 and 3 only (cycle 1 stays inline so the model sees the first failure).
- [x] Do NOT fork the whole skill (`context: fork`) — intake is interactive.

---

## Phase 6 — one-off checks, no code — 2026-09-03: migration attempted for real → 1.19.1 + 1.19.2 (five data-loss refusals added to migrate-feature.js); no zatcaReact feature can migrate until its spec is re-aligned; the ultra-review item is cancelled

- [x] CANCELLED by the user 2026-09-03 — no ultra review of skill-generated PRs; the three conventions it was meant to surface were found by the migration attempt instead and shipped in 1.20.0. (Original item: run `/ultrareview` on the next skill-generated PR and fold what it catches into REVIEW.md + the `review-conventions` audit check.)
- [x] (prepared, not run — needs an explicit "use a workflow" from the user) Migration IS due (1.14.2 → 1.19.x templates on application-status and establishment-signup); the workflow lives at `skills/react-clean-architecture/workflows/migrate-features.workflow.js` (1.19.1). Preparing it exposed three data-loss bugs in migrate-feature.js, fixed in 1.19.1: crash on design-only records, mock service regenerated, stale-spec overwrite (application-status has real spec drift — must be re-aligned before it can migrate). Original item: When a template change next requires regenerating old features (`migrate-feature.js`), try a dynamic workflow (`ultracode` in the prompt): one agent per skill-generated feature → migrate → audit → report. Save the script via `/workflows` + `s` if it works.

---

## Not planned (and why)

| Item | Reason |
|---|---|
| `disable-model-invocation: true` | README's stated goal is auto-trigger from plain requests; the user chose this |
| `user-invocable: false`, `paths:`, `context: fork`, `model:`, `shell:` | not applicable (interactive skill run from repo root, bash only) |
| `CLAUDE_EFFORT`-gated reads in scripts | would be a token RULE — forbidden |
| Grouped intake, grep-only loading, shorter cache question, fewer tables, compressed report, DESIGN.md split | rejected 2026-08-22 |
| Removing `IServices`, configurable conventions, `application/` layer | rejected 2026-08-19 |
| `isolation: worktree` agents | design lane builds against the working tree; Step 1 already requires a clean tree |
| `memory:` agents, cross-session messaging, `/batch`, `/loop`, routines | no fit |
| `userConfig` (bundle id, scheme) | skill is zatca-internal by design |
| `experimental.monitors` (tail Metro) | experimental; revisit after Phase 4's run skill |
| Plugin `settings.json`, `agents/`, `commands/` | nothing to put there |
| Prompt-type Stop hook | non-deterministic and would fight the mandatory pauses; the command-hook gate in 2.1 covers the same criteria |
| `--bare`, `cleanupPeriodDays`, `--from-pr`, `/autofix-pr`, `worktree.baseRef` | unrelated to scaffolding |

## Order of execution

Phase 0 → Phase 1 → Phase 2 (verify gate decides 3.3) → Phase 3 → tag 1.19.0 → Phase 4 → Phase 5/6 when wanted.
