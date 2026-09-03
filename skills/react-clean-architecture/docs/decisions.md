# Decision & live-finding history

Project history moved out of the operational docs (SKILL.md / DESIGN.md) so runs don't
carry it in context. The RULES these produced still live in the operational docs — this
file only records where they came from. Never load this during a feature run.

- **2026-08-16 — design lane confirmed** (iOS-simulator verification, Arabic-first RTL,
  auto icon export, screen-by-screen checkpoints, per-endpoint cache question,
  auto-registration of navigation, feature-local new components).
- **2026-08-17 — flow-description intake is PRIMARY (Step 2c style A).** First real user
  test (Dashboard/PayBill): 4 pasted links were 4 flow screens; the labeled-links loop
  misread them as 1 screen + 3 components. Narrated-flow parsing + transition edges added;
  bare-links loop demoted to fallback with the multi-full-frame guard.
- **2026-08-17 — service-card questionnaire RETIRED.** The user rejected the 6-question
  cost/serviceTypes/userTypes/fees/processingTime/Home-shortcut interrogation; defaults are
  shown as one summary-table row instead.
- **2026-08-17 — NO token limits in the skill.** A token-discipline section (Figma fetch
  caps, grep-only COMPONENTS.md) was added and fully REVERTED on user direction: quality,
  completeness, and accuracy always win over token cost. Never re-add read-budgets or fetch
  caps. (Re-confirmed 2026-08-22 during the token-optimization review: full reference reads
  and the one-question-per-message intake both stay.)
- **2026-08-19 — test infra is AUTOMATIC.** setup-test-infra.js runs in Step 1 with no
  question; on install failure the run continues with logic-level tests and says so.
- **2026-08-19 — cache question spells out both cache layers.** Live finding: a user who
  answered "no" was surprised react-query still answered from memory (~5 min app-wide
  default) — the question text now explains no/always-fresh/persistent explicitly.
- **2026-08-19 — v1.8.0 closed the external architecture review** (domain purity via
  mapper.toDTO in the service, arch-boundaries audit check, error taxonomy).
- **2026-08-22 — token-optimization pass (v1.9.0).** Applied: SKILL.md slimmed into more of
  a router (append/lifecycle/screen-collection moved to APPEND.md, LIFECYCLE.md, and
  DESIGN.md; history moved here); generate.js/register-di.js print compact summaries (full
  manifest on disk); audit.js collapses passing checks to one line (WARN/FAIL stay verbose).
  Rejected (user-confirmed): grouped intake, grep-only reference loading, shorter cache
  question, fewer confirmation tables, compressed final report, splitting DESIGN.md.
- **2026-08-22 — mandatory compaction checkpoints (v1.9.1).** User directive: the agent
  must PAUSE and ask the user to run the host's context-compaction command (Claude Code /
  Codex CLI → `/compact`, Cursor → `/summarize`, Gemini CLI → `/compress`, other hosts →
  their equivalent) at three points — after the final intake confirmation before any
  implementation, after every per-screen checkpoint, and after the test/audit phase passes.
  State must be on disk before each pause; a host with no such command → skip, never block.
- **2026-08-22 — navigation registration scripted (v1.10.0).** DESIGN.md §5's nine hand
  edits became `register-navigation.js` (routes, page registry, SERVICES_DATA from
  design.serviceCard, deep-link aliases, translation placeholders, route file, feature
  routes.ts, manifest). Chosen as the token optimization after the compaction checkpoints:
  saves ~7 read+edit round trips per design run and removes the most error-prone manual
  step. Verified against copies of the real zatcaReact files before landing. The verifier
  subagent idea (recommendation #1 of the same review) was explicitly deferred by the user
  ("do 2 only").
- **2026-08-22 — layout aligned with repo convention (v1.11.0).** PR #305 review
  (WalidAzgear) surfaced that skill output diverged from the codebase's dominant layout,
  which integrated-tariff documents: the service interface is a data-layer contract →
  `data/services/I<F>Service.ts`; `domain/repositories/` (not IRepositories);
  `domain/use-cases/` (not usecases). Templates + register-di + audit + examples updated;
  migrate-feature.js relocates old-layout features (content-preserved moves + import
  rewrites in hand-written files). Signatures still entity-only — never DTOs.
- **2026-08-23 — interface folders reverted to IServices/IRepositories (v1.12.0).** User
  directive: "i need my skill to keep naming IRepositories and IServices" — overrides the
  v1.11.0 alignment with the PR #305 reviewer's convention. Service interface back at
  `domain/IServices/I<F>Service.ts`, repository interface at `domain/IRepositories/`;
  `domain/use-cases/` (hyphenated) stays, as does the impl/mock location in
  `data/services/`. migrate-feature.js now relocates both older layouts (pre-1.11
  `usecases` and the one-day 1.11.x locations) to this one; relocation of the interface
  out of data/services is exact-filename-scoped so features named "I…" keep their impls.
  Note: this means generated output intentionally differs from the layout PR #305's
  reviewer asked for — the user's naming preference wins.
- **2026-08-23 — final interface layout: data/IServices + domain/IRepositories (v1.13.0).**
  User clarified the v1.12.0 directive: the PR #305 reviewer's LOCATION is correct ("the
  location wlid said about is correct") — the service contract belongs in the data layer —
  but the folder NAMING stays IServices/IRepositories. Result: service interface at
  `data/IServices/I<F>Service.ts` (entity-only imports from domain), repository interface
  at `domain/IRepositories/`, use-cases hyphenated, impl/mock in `data/services/`. This is
  the settled layout — v1.11.0 (data/services + domain/repositories naming) and v1.12.0
  (everything under domain/) were each superseded within a day; don't re-open either.
  migrate-feature.js relocates all three older layouts here, with `domain/IServices` →
  `data/IServices` covering both pre-1.11 features and the one-day 1.12.0.
- **2026-08-23 — v1.14.0: PR #305 review-round hardening (kebab dirs, shared enums,
  AppError alignment, logging, review-conventions audit).** Second review round on PR #305
  (WalidAzgear + abdlafi) produced 41 comments; the mechanical causes are now generator
  rules, not review findings. Changes: (1) feature DIRECTORY is kebab-case
  (`src/features/application-status`) while identifiers stay PascalCase — `f.featureDir` is
  the path, `f.feature` the identifier, and `resolveFeatureDir()` keeps legacy PascalCase
  dirs working for append/audit/lifecycle; (2) `domain/constants/<featureCamel>.ts` is
  generated whenever an endpoint has a `statusEnum` and is the ONLY place the value list
  exists — the entity imports+re-exports the derived union, mappers/mocks/filters import it
  (the review found the same array retyped in five files); (3) the feature error type IS
  `AppError` — no `Omit<AppError,'code'>`, no invented `HTTP_ERROR`/`PARSE_ERROR` (they map
  to `NETWORK_ERROR`/`VALIDATION_ERROR`); migrate DROPS a hand-added code outside AppError's
  union, reports it, and refuses to re-stamp the spec, and it now reads the allowed union
  from `src/shared/types/errors.ts` so it tracks AppError; (4) use cases take an `ILogger`
  and log before every `Result.err` — `register-di.js` wires them through `withLogger`, and
  `@core/logging/ILogger` is an explicit arch-boundary exception (a pure interface, the
  integrated-tariff precedent); (5) the dead placeholder `presentation/types.ts` is no
  longer generated; (6) generated styles use theme tokens (`theme.flex1`); (7) a new
  `review-conventions` audit check enforces all of the above plus theme-token usage and
  dead presentation-root modules, and `register-navigation.js` now flags a
  `serviceFlow.pages.<camel>` object duplicating `services.<camel>`. Also fixed a real
  generator bug: a nullable date field produced
  `formatNumericGregorianDate(string | null)`, which does not typecheck. Suite 146/146.
  **Interface-folder layout unchanged and now CONFIRMED settled** (`data/IServices` +
  `domain/IRepositories`). The owner clarified what the PR #305 comment actually asked
  for: the reviewer's point was the LAYER — "the service should be inside the data
  directory not domain" — not the folder name. v1.13.0 already satisfies it: the service
  contract sits in `data/IServices/` (data layer, as the reviewer required) with the
  owner's `IServices`/`IRepositories` naming. Nothing to change in the skill; the
  zatcaReact application-status feature was corrected to this same layout on the PR
  branch. Reviewer comments asking for `data/services`/`domain/repositories` as NAMES are
  answered by the naming decision and need no further action.

- **2026-08-31 — v1.15.0: `@shared/formBuilder` is the DEFAULT for every screen with inputs.**
  User directive after the form-builder hardening pass on branch `feature/fix-form-builder`
  (nine structural defects fixed in the shared layer so the builder can carry every feature).
  New [FORMS.md](../FORMS.md) holds the form-first gate, the 14-type element→field-type
  coverage table, the escape-hatch ladder (`type: 'custom'` → shared component beside the form
  → hand-wired login pattern as a documented last resort), the render/performance contract
  (`subscribeHost: false`, stable `fields` identity via a memoised `use<Flow>Fields` hook,
  `commitOnBlur`, `getValues()` in handlers, PageStepper store written once per step boundary),
  the file layout, validation rules and a per-screen checklist. Wired in: SKILL.md doc links +
  Step 4 (form-first runs BEFORE the component reuse gate) + Step 4b review conventions;
  DESIGN.md §0 FORM-FIRST ground rule, §2 form gate ahead of the reuse gate, a Forms bullet in
  the generate step, form test cases, and a definition-of-done line; COMPONENTS.md a
  forms-come-first callout above the quick-lookup table plus split rows ("in a form" → field
  type / "outside a form" → the component). Reference implementations named in the docs:
  Add-IBAN (`src/features/BankAccountManagement/presentation/screens/`) for the builder path,
  SubmitReport (`fields/*.ts`) for multi-step, taxAccountLogin
  (`src/presentation/account/screens/taxAccountLogin/`) for the rung-4 draft-ref fallback.
  Deliberately NOT added: a mechanical audit check for hand-wired inputs — a filter dropdown or
  a list-header search box is a legitimate standalone input, so the detector would be noisy;
  the rule is enforced the same way REUSE-FIRST is, by the gate in the docs.


## 2026-09-01 — v1.16.0: COMPONENTS.md served on demand; the nine builder-owned entries trimmed

User raised that a first run costs ~92k tokens and asked for it to come down. Two prior
sessions (2026-08-17, 2026-08-22) had rejected retrieval-based COMPONENTS.md access; this
reverses that specific decision, at the user's explicit instruction ("do both"), and only that
one. The standing directive in [[no-token-limits-in-skill]] is UNCHANGED: no read budgets, no
fetch caps, no screenshot limits, no grouped intake. What changed is retrieval shape, not how
much the agent is allowed to read.

**Measured before deciding** (this is why "just delete the component docs, we have the form
builder now" was rejected):
- `src/shared/components` = 729,355 chars ≈ **197k tokens** across 64 components. COMPONENTS.md
  is a **9× compression** of it. Falling back to sources costs MORE: `List` alone is 48,591c
  ≈ 13k tokens — over half the whole dictionary, for one component. `Filtration` is 11.6k.
  A screen touches 5-8 shared components; source-reading four exceeds the entire dictionary.
- The form builder owns **9 of 64** entries (3.1k tokens). The other 55 (16.8k) are display and
  navigation components — List, Card, PageHeader, EmptyView, ErrorView, CardStatus, Tag,
  Accordion, Carousel, Table, Modal, BottomSheetModal, Toast, StepperActions, ContactOtpSheet,
  CloseService… A result screen or a list screen has zero form fields.
- Sources also carry none of the traps the entries exist for (`previoudButtonDisabled`,
  `LinearGradiantCard`, "never hand-build ContactOtpSheet", "never raw FlatList — use `List`").

**Changes:**
1. `scripts/components.js` — on-demand reader. No argument → the index (intro + "I need X → use
   Y" table, ~1.8k tokens). `components.js Card List Modal` → those entries **byte-identical**
   to the file. `--list` (64 names), `--all` (whole file), `--doc <path>`. Entries are sliced on
   `### <Name> — <kind>` with the same alias tokenisation `check-components-md.js` uses, so both
   tools agree on what a name matches.
2. An unmatched name prints a **MISS** with near-match guidance and the drift command — never
   silence. Silence read as "no shared match" is precisely how `ContactOtpSheet` was duplicated.
3. The nine builder-rendered entries (`TextInput`, `DropdownInput`, `Dropdown`, `DropdownItem`,
   `OptionGroup`, `Checkbox`, `Radio`, `DatePicker`, `FileUpload`) trimmed 11,464c → ~5,900c to
   **In a form** / **Outside a form** / **Traps**. They keep what survives the builder: the
   `variant` list (those are the field config's values), `titleSpacing`/`itemSpacing`
   pass-through, `DEFAULT_DATE_FORMAT`, the Dropdown `null`-when-hidden fix, FileUpload being
   presentational. Headings kept — the drift checker matches on them. The "outside a form" half
   is load-bearing: a list-header search box and a filter dropdown are not forms.
4. Read directives rewired in SKILL.md (doc list, checklist 0c, Step 4), DESIGN.md (references,
   §0 REUSE-FIRST, §2 reuse gate, "Keeping COMPONENTS.md current"), FORMS.md (intro, §1 gate,
   §2 coverage note) and AUDIT.md (`components-md` row).
5. `tests/components-reader.test.js` — 14 tests: index excludes entries and stays under a fifth
   of the file, entries are verbatim slices, MISS is loud and exits 0, `--all` round-trips, the
   nine short entries keep their headings and their surviving facts.

**Effect:** the reuse gate reads ~2.5k tokens instead of ~22k, with every entry one command
away, complete. Full-mode first-run docs ≈50k → ≈33k tokens.

**Not done, deliberately:** splitting COMPONENTS.md into per-component files (the drift checker
and the quick-lookup table both want one file); summarising entries (retrieval only — an entry
served is the entry written); any cap on how many entries a run may pull.

## 2026-09-01 — v1.17.0: generic section reader, form-builder reference on demand, SKILL.md split, cropped re-verification

Follow-up to v1.16.0, same user instruction ("do all but no limit"). Every item below is a
change to how content is *retrieved*; nothing caps what the agent may read, and the
run-time instructions now say so explicitly.

**1. `scripts/docref.js` — the reader generalised.** v1.16.0's components.js only understood
COMPONENTS.md's `## bucket` → `### component` shape. docref.js handles any reference doc:
the index is everything before the first `##` that has `###` children; a `##` WITH `###`
children is a group label; a `##` WITHOUT them is a section in its own right. `components.js`
and the new `formref.js` are thin wrappers over it.

Bug caught while generalising: a standalone `##` did not reset the running group, so
HOW_TO_USE.md listed "Conditional visibility" under "Field configuration reference" and
"Import path" under "Controlled vs uncontrolled" — a listing that sends the reader to the
wrong section. Fixed: any `##` ends the previous group.

**2. `scripts/formref.js` — `src/shared/formBuilder/HOW_TO_USE.md` served by section.**
FORMS.md told the agent to read all 23,730c of it on any form screen; it is 28 sections and a
form screen needs three or four. Index is title + Quick start (2,175c). Wired into FORMS.md's
intro and SKILL.md checklist 0d. Run from the repo root, or `--repo <path>`.

**3. Token-cost framing removed from every run-time instruction.** v1.16.0's own wording
("entries are ~250-600 tokens each") was exactly the kind of nudge the standing directive
forbids — a cost attached to reading biases toward reading less. All of it is gone from
COMPONENTS.md, SKILL.md, DESIGN.md, FORMS.md and both scripts, replaced with "there is no cap,
extra sections cost you nothing". A test now enforces this: `no reader instruction states a
token budget` fails on a numeric token cost or on cap language ("at most", "sparingly",
"only read", "budget"). It deliberately does NOT trip on "theme tokens", which is a design
token and unrelated.

**4. SKILL.md split 34,153c → 22,793c.** Step 2 (endpoint intake, 8.5KB) → `INTAKE.md`, read
at checklist step 2 and never in design-only mode. Step 4b (review conventions, 4.1KB) →
`REVIEW.md`, read before hand-writing. Both are read in full when their phase starts — the
same lazy-doc pattern as APPEND.md and LIFECYCLE.md. Honest accounting: the intake saving
lands only in design-only runs, and the review saving only before the first compaction
checkpoint, so this is worth ~1-3k depending on mode, not a headline number.

**5. Cropped re-verification shots (DESIGN.md §3).** Measured: a booted-simulator screenshot
is 1320×2868, which the API resizes to 722×1568 — around 1,500 tokens per image. §3 mandates
AR light + AR dark per screen plus a re-shoot per fix round, so a six-screen feature spends
more on images than on every skill doc combined. The comparison shots stay at FULL resolution
— that is what pixel accuracy rests on and shrinking them was explicitly rejected. What
changed is only the RE-CHECK after a fix: crop to the region you changed (`sips -c`), because
a full frame to confirm a 4px gap adds nothing you have not already approved. Anything not yet
judged gets the full frame, and unsure means take the full frame.

Suite: 149 → 172 tests, all green.

## v1.18.1 — translation rewrites keep the file's own `\uXXXX` escapes (2026-09-03)

**User request:** "why you removed \u20C1 from src/core/localization/translations/ in en and
ar? in currency it should be \u20C1" → "yes patch the script to keep \u20C1 escaped".

`register-navigation.js` adds `services.<camel>` to both core JSON files by parsing and
re-stringifying them. `JSON.stringify` writes non-ASCII literally, so the riyal sign the app
keeps as `"\u20C1"` came out as the literal glyph — the same string at runtime, but U+20C1 is a
combining character, unreadable in an editor and a diff the reviewer had to ask about.

Fix is `preserveUnicodeEscapes(original, output)`: the set of `\uXXXX` escapes is read off the
file being rewritten and only those codepoints are re-escaped in the output. Not a hardcoded
riyal, not "escape every symbol": the file's own convention is the spec, so Arabic copy stays
literal and a repo that writes everything literally is left untouched. One test seeds the
escape in both fixtures and asserts it survives while the Arabic string beside it stays literal.

## v1.18.0 — the update check (2026-09-01)

**User request:** "make the skill when user start using the skill check if there's update or
not — if there's an update tell the user with every run until the user updates."

`scripts/check-update.js`, checklist item 0, ahead of the tsc baseline. `git ls-remote --tags`
against the public repo (no clone, no auth, ~1s), newest `v*` tag vs the installed
`SKILL_VERSION`. Behind → the two versions plus the update command for the install actually
running, derived from paths: a `plugins`/`marketplaces` path segment → Claude Code plugin;
invoked path ≠ resolved path with a `.git` two levels above → symlinked clone (`git -C … pull`
is the whole update); same paths with a `.git` → clone; otherwise a copy.

Four constraints in SKILL.md's "Update check" section, all deliberate:
- **Not a blocker.** Updating mid-run would swap the scripts under a half-finished feature.
- **Never self-applied.** The agent does not `git pull`, `/plugin update`, or re-run
  install.sh — it is the user's install, and the command is theirs to run between runs.
- **Not a question.** It is a notice inside the first message, so it does not consume the
  one-question-per-message turn Step 1b owns.
- **No dismissal state.** This is the part the user asked for by name: "later" is not
  remembered, the notice repeats every run until the versions match. It is repeated once in
  the final report, which is the point where acting on it is safe.

Failure mode is silent-and-continue — no network, no git, firewall, renamed repo → `UPDATE
CHECK SKIPPED`, exit 0. `--strict` is the only path to a non-zero exit for being behind. The
GitHub answer is cached six hours under `~/.cache/react-clean-architecture/`; the notice still
prints every run, the cache only skips the round trip. Local ahead of the newest tag reads as a
development checkout, not an update.

**Version is now one number.** `SKILL_VERSION` was internal (stamped into persisted specs) and
the manifests were what the plugin system read. The check compares the local `SKILL_VERSION`,
so drift would advertise an update the user already had, or hide one they needed; a test pins
`SKILL_VERSION` = `plugin.json` = `marketplace.json`.

Suite: 172 → 189 tests, none touching the network (CLI cases run through `--cache`).

## 2026-09-03 — 1.19.0: alignment with the Claude Code skills/hooks/plugins guides

Review of the skill against the Claude Code skills, hooks, subagents, advanced-features,
workflows and plugins guides (plan: repo-root `IMPLEMENTATION_PLAN.md`). What was adopted
and why; what was not is in that plan's "Not planned" table and stays rejected.

**Frontmatter.** `argument-hint`, `effort: high`, `allowed-tools` (the skill's own scripts,
tsc/jest/expo, simctl/idb, read-only git — `curl` deliberately excluded so a mutating intake
curl still prompts outside auto mode). Not `disable-model-invocation` (auto-trigger from plain
requests is the README's stated goal), not `context: fork` (the intake is interactive).

**`$ARGUMENTS` pre-fill (Step 0z).** Arguments answer only the questions they cover; every
other question is still asked one per message. This is not a grouped intake — the ordering
rule in INTAKE.md is unchanged.

**Hooks are a backstop, not the rule.** PreCompact/PostCompact mirror the compaction
checkpoints (spec on disk before the pause; paths re-injected after); the self-update guard
enforces "never update the skill yourself"; prettier runs on feature files. All command hooks,
all inert outside a run (manifest present), all silent on other hosts.

**The Stop gate is a command hook, never a prompt hook.** A model-evaluated Stop hook is
non-deterministic and would fight the three mandatory compaction pauses and the dozens of
questions a run asks. The command hook only judges a stop that is neither a known pause
marker nor a question in the closing lines, and only blocks for AUDIT.md/DESIGN.md §7's
definition of done (working files after the implementation is finished, `TODO(claude)`,
COMPONENTS.md drift). It honours `stop_hook_active`, so it can never loop.

**Plugin renamed `react-clean-plugin`.** Plugin skills are `<plugin>:<skill>`; a plugin named
after its only skill produced `/react-clean-architecture:react-clean-architecture`. The
marketplace keeps the repo name so an already-added marketplace survives the rename;
`check-update.js` now carries the three names separately. `claude plugin tag` would create
`react-clean-plugin--v1.19.0`, which `latestTag` does not parse, so releases keep `git tag
vX.Y.Z`. No `.lsp.json`: `typescript-language-server` is not on the maintainer's PATH and
there is no official TypeScript LSP plugin to point at; revisit after a design-lane run.

## 2026-09-03 — 1.20.0: the codebase is the convention, not the template

Trying to migrate the four skill-generated zatcaReact features to 1.19 templates (see the
1.19.1–1.19.3 entries: six refusals added to `migrate-feature.js`, nothing migrated) showed
that reviewers had hand-converted every generated feature in the same three ways. The
template was teaching the wrong pattern, and the migration tool was about to undo the
reviewers' work. Decision: the repo's dominant form wins over the skill's own preference,
even where the skill's form is arguably tighter.

- Mapper functions (`to<Entity>(dto)`, `to<Action>RequestDTO(input)`) over a mapper
  object: 9 of 12 mapper directories use functions; the object form existed only where the
  skill had generated it.
- `INFRA_ERROR_CODES` alias over a local `as const satisfies` array: the alias cannot drift
  from `AppError`; the array form would silently lag when a code is added to the union.
  The values array stays (the `is<Feature>Error` guard needs a runtime list) but is typed
  from the alias.
- `optional: true` on query params: the spec could not express `status?: string`, so the
  team edited the service signature by hand — the exact edit that later blocked migration.

Each convention is enforced three ways, as REVIEW.md promises: the template emits it, the
`review-conventions` audit check fails its absence, and `migrate-feature.js` refuses to
regenerate a service against a mapper that still has the old contract.
