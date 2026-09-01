---
name: react-clean-architecture
description: >-
  Scaffold a clean-architecture feature in src/features for the zatcaReact app —
  three modes: full feature (backend + Figma design), backend only, or design only. Backend
  generates dtos, endpoints, mappers, service, repository, entities, interfaces, errors,
  use cases, react-query presentation starter, translations, Jest tests, and registers
  everything in the tsyringe DI container. The design lane (DESIGN.md) builds pixel-accurate
  screens from Figma links, verifies them on the iOS simulator, and registers the service in
  navigation. Screens that collect input are built with @shared/formBuilder by default
  (FORMS.md). Use when the user asks to create a feature, add a feature, scaffold an
  endpoint/API, implement Figma screens or a form screen for a feature, or generate a
  repository, service, or use case from a curl/endpoint. Supports append mode for endpoints
  and screens.
---

# react-clean-architecture

Scaffolds a complete clean-architecture feature in the zatcaReact app from an endpoint
(preferably a curl paste), a sample response, and a user story — and, in design mode, builds
the feature's real screens from Figma. **Script-driven for low token usage and accuracy**: you
hand-write only a small `feature-spec.json` and the use-case business rules — deterministic
Node scripts generate every file, patch DI/i18n/query-keys/config/env, and audit. Screens are
hand-built by Claude following [DESIGN.md](DESIGN.md).

**Run every script from the TARGET REPO ROOT.** `<skill>` below means this skill's directory.

- Spec schema: [SPEC_FORMAT.md](SPEC_FORMAT.md) · Audit details: [AUDIT.md](AUDIT.md)
- Endpoint intake, question by question (Step 2): [INTAKE.md](INTAKE.md) — backend/full only
- Review conventions for everything you hand-write (Step 4b): [REVIEW.md](REVIEW.md)
- Design lane (Figma → screens → simulator verification): [DESIGN.md](DESIGN.md)
- Forms (form-builder-first rule, coverage, render contract): [FORMS.md](FORMS.md)
- Shared components: [COMPONENTS.md](COMPONENTS.md) — **read it through
  `node <skill>/scripts/components.js`, not with a whole-file read.** No argument prints the
  index (the "I need X → use Y" table); `components.js Card List PageHeader` prints those
  entries verbatim and complete. Ask for every component the screen plausibly touches, and
  more whenever you are unsure — there is no cap, and a skipped entry is how a duplicate
  gets built.
- Form builder API: `node <skill>/scripts/formref.js` — the repo's
  `src/shared/formBuilder/HOW_TO_USE.md`, served the same way
  (`formref.js "Text input" Dropdown Date`). [FORMS.md](FORMS.md) decides *whether* it is a
  form and *which* field type; formref.js gives the exhaustive props behind that choice.
- Filled example: [examples/feature-spec.example.json](examples/feature-spec.example.json),
  expected tree in `examples/expected-output/`

In terminal Claude Code there is no clickable-question UI — fall back to plain-text numbered
questions for every choice point below.

## Progress checklist (track it in your todo tool — don't re-print it)

Load these steps into your task/todo tracker (one item per step, statuses updated there).
Do NOT paste the whole checklist into chat messages on every update — name only the step
you're on. Every step still runs; only the narration is trimmed.

```
- [ ] 0. Update check: node <skill>/scripts/check-update.js — UPDATE AVAILABLE → tell the
        user before your first question, then continue the run ("Update check" section below)
- [ ] 0a. Baseline: node <skill>/scripts/audit.js --baseline
- [ ] 0b. Test infra: node <skill>/scripts/setup-test-infra.js (auto-installs
        @testing-library/react-native + jest.setup.js wiring; failure → logic tests + report)
- [ ] 0c. Shared-component dictionary: node <skill>/scripts/check-components-md.js —
        WRITE an entry for every DRIFT before any component work (Step 4; procedure in
        DESIGN.md "Keeping COMPONENTS.md current"). Read the dictionary by section:
        node <skill>/scripts/components.js (index) → components.js <Name>... (full entries)
- [ ] 0d. Any screen with inputs? → read FORMS.md; the form-first gate runs BEFORE the
        component reuse gate on every such screen. Exhaustive builder props by section:
        node <skill>/scripts/formref.js (index) → formref.js "Text input" Dropdown ...
- [ ] 1. Feature name → new feature or append?  Git tree clean?
- [ ] 1b. Mode: full (backend + design) / backend only / design only
- [ ] 2. (backend, full) READ INTAKE.md, then follow it: single or multiple? → curls
        one-by-one (auto-EXECUTE for the response; per GET: cache question; multi: "next or
        done?") → summary table → ONE user story (skip/write; append: offer existing
        userStory/*.md first) → login/token question  [one question per message]
- [ ] 2b. Story given → save it to userStory/<StoryID>.md (skip → NO userStory/ dir)
- [ ] 2c. (full, design) Screen collection: flow description preferred (screens + narrated
        transitions in one paste → ONE summary table with service-card defaults, single
        confirm); bare-links fallback loops "next screen, or done?" (see DESIGN.md).
        NEVER ask the service-card questionnaire
- [ ] 3. (backend, full) Confirmation tables: headers / request-field provenance / status enum
        → COMPACTION PAUSE (see "Context-compaction checkpoints")
- [ ] 4. (backend, full) Write feature-spec.json (scratch dir, NOT the repo)
- [ ] 5. (backend, full) node <skill>/scripts/generate.js <spec>
- [ ] 6. (backend, full) Hand-write use-case execute() rules (+ mapper status derivation if statusEnum)
- [ ] 7. (backend, full) node <skill>/scripts/register-di.js <spec>
- [ ] 8. (backend, full) node <skill>/scripts/audit.js <spec> --persist-spec   (fix → max 3
        cycles) → on PASS: COMPACTION PAUSE
- [ ] 8b. (full, design) Design lane per DESIGN.md: persist the design record → REGISTER
        NAVIGATION FIRST (scripted: node <skill>/scripts/register-navigation.js <spec> —
        DESIGN.md §5; verification needs the screen tappable) → build
        each screen → verify on the iOS simulator (AR + dark) → checkpoint with the user
        (every screen checkpoint ends with a COMPACTION PAUSE)
- [ ] 9. Final report to the user (Step 6 section; full/design: include the design-lane
        bullets)
```

## Update check (checklist item 0 — runs on EVERY run, before anything else)

```
node <skill>/scripts/check-update.js
```

One line back, and the first word says everything: **UP TO DATE** (say nothing, go to 0a) ·
**UPDATE CHECK SKIPPED** (offline or no git — say nothing, go to 0a) · **UPDATE AVAILABLE**.

On UPDATE AVAILABLE, put it in your FIRST message to the user — before the mode question,
before any other Step-0 output — as two or three plain lines: the versions (`1.17.0 → 1.18.0`),
the update command the script printed for their install, and that this run continues on the
version they have. Then carry on with 0a immediately. Repeat the same notice in the final
report (Step 6).

Non-negotiables:

- **Never block on it.** The user does not have to update to run the skill, and an update
  mid-run would swap the scripts under a half-finished feature. Offer it, continue working.
- **Never update the skill yourself** — no `git pull`, no `/plugin update`, no re-running
  `install.sh`. It is their install; the command is theirs to run, between runs.
- **Never suppress it.** There is deliberately no "dismissed" state: if they say "later" or
  ignore it, tell them again on the next run, and every run after that, until the versions
  match. Saying it once and going quiet is how a copy stays six versions behind.
- **Never ask a question about it.** It is a notice inside your first message, not a
  question — it does not consume the one-question-per-message turn that Step 1b owns.

Checklist items 3–8 expand under "Step 3" / "Step 5 — Generate, fill, register, audit"
below (Step 5's sub-items 1–5 are checklist items 4–8); the FORM-FIRST rule (FORMS.md),
the REUSE-FIRST rule (Step 4 section) and the REVIEW CONVENTIONS ([REVIEW.md](REVIEW.md))
apply throughout
Step 5–8b hand-writing.

## Context-compaction checkpoints (mandatory pauses)

Skill runs are long; intake + Figma context + fix-cycles will otherwise crowd out the
implementation work. You cannot compact the conversation yourself — the USER runs the host
command — so at each checkpoint below, PAUSE and ask them to compact, then continue when
they say so:

> "Good moment to free up context — please run **`<command>`**, then say **continue**.
> All state is saved on disk (spec: `<path>`); nothing will be lost."

Host → command: **Claude Code** → `/compact` · **Cursor** → `/summarize` · **Codex CLI** →
`/compact` · **Gemini CLI** → `/compress` · any other agent → that host's own
context-summarize/compaction command. Detect the host from your own environment (you know
which harness you are running in); if the host has no such command, skip the pause and
continue — never block on it.

The checkpoints (all mandatory, none skippable when the host supports compaction):

1. **After the final intake confirmation, BEFORE any implementation starts** — backend/full:
   right after the Step 3 confirmation tables are confirmed; design-only: right after the
   Step 2c summary table is confirmed AND the design record is persisted.
2. **After EVERY screen checkpoint** (DESIGN.md §4) — fold it into the same message: once
   the user confirms the screen, ask for the compaction before starting the next screen.
3. **After the test/audit phase passes** — backend/full: when Step 5's audit finally PASSes
   (before the design lane in full mode, before the final report in backend-only);
   design-only: when the §7 tsc + jest gate passes, before the final report.

Before every pause, make sure everything needed to resume is ON DISK — the spec file
(name its exact path in the pause message so it survives the summary), the persisted
design record, `.claude-skill-manifest.json`, and your todo-tool checklist state. After
the user returns, re-read those files as needed; never rely on pre-compaction chat detail.

## Step 1 — Feature name

1. Normalize to PascalCase for IDENTIFIERS (classes, tokens, types) — but the on-disk
   directory is **kebab-case**: `src/features/application-status`, matching
   `e-declarations` / `integrated-tariff` / `content-management`. Reviewers reject
   PascalCase feature directories. The scripts handle this split for you (`f.featureDir`
   is the path, `f.feature` the identifier); never build a feature path from `f.feature`.
   Reject an empty name. (Legacy PascalCase features still on disk keep working — the
   lifecycle scripts resolve whichever directory exists — but new features are kebab.)
2. Existence check is **case-insensitive** (macOS FS) and must also scan ONE level of nested
   category dirs (e.g. `verificationFeatures/TaxStampValidation`).
   - Exists → **append mode** (read [APPEND.md](APPEND.md) now). New → full scaffold.
3. `git status --porcelain`: dirty tree → warn that manifest-based rollback is only reliable on
   a clean tree, offer "continue anyway". Not a hard refusal.
4. Run the tsc baseline NOW (before any generation): `node <skill>/scripts/audit.js --baseline`.
5. Ensure render-test infra (AUTOMATIC — never ask):
   `node <skill>/scripts/setup-test-infra.js` — installs `@testing-library/react-native` as a
   devDependency with the repo's own package manager, creates `jest.setup.js`
   (native-module mocks) only if absent, and wires `setupFilesAfterEnv` when jest config
   lives in package.json (a standalone jest.config.* is reported for a hand edit).
   Idempotent — instant no-op when already set up. On install failure (exit 2): continue the
   run with logic-level tests and SAY SO in the final report; never block the feature on it.
   Note: this edits package.json + the lockfile — rollback.js does NOT undo an npm install;
   mention the new devDependency in the report.

## Step 1b — Mode

Ask ONLY (one question, wait for the answer):

> **What are we building?** 1. Full feature (backend + design) · 2. Backend only · 3. Design only

- **Full** → Step 2 (endpoint intake, [INTAKE.md](INTAKE.md)), then Step 2c (screen collection), then generate/register/
  audit, then the design lane (DESIGN.md).
- **Backend only** → Step 2 onward exactly as before; no screen collection, no design lane.
- **Design only** → skip Step 2 entirely (generate.js/register-di.js/audit.js never run — a
  spec without endpoints is rejected by design). Ask the user-story question (write/skip — the
  story covers states Figma doesn't draw), then Step 2c screen collection, then the design
  lane (DESIGN.md). If the feature has no backend slice yet, create ONLY the presentation
  directory structure — never invent data wiring or scaffold a backend the user didn't ask
  for. No login/token question in this mode; `requiresAuth` defaults to no — ask only when
  the flow description or story mentions login (then the token question follows, next
  message, runtime-only as in Step 2).
  Persistence: **immediately after Step 2c** write the design record — exact rules in
  DESIGN.md's Screen collection section ("Design-only persistence").

**Mode × Step 1 "exists":** when Step 1 found the feature already exists, the mode answer
selects the append lane — **full/backend** → endpoint append ([APPEND.md](APPEND.md); full
additionally runs design work after); **design** → design append (DESIGN.md §6). To fully
(re)design an existing feature's screens, run design-append iterated per screen. The
service-card defaults row is shown ONLY if the persisted spec has no `serviceCard`; values
already on disk are reused silently.

## Step 2 — Endpoint intake (repeat per endpoint)

**Backend-only and full modes.** The full procedure — the mandatory one-question-per-message
ordering, curl parsing, host classification, response capture by EXECUTING the curl, the GET
cache question, the mock-backend lane, the user story and `userStory/` rules, and the login/
token question — lives in **[INTAKE.md](INTAKE.md)**. Read it now and follow it exactly;
the question ordering is not reconstructable from memory and getting it wrong re-asks the
user things they already answered.

Design-only mode skips this step entirely.

## Step 2c — Screen collection (full and design modes)

Read [DESIGN.md](DESIGN.md) NOW and run its **"Screen collection"** section (you will need
the rest of DESIGN.md right after anyway). Non-negotiables it enforces: flow-description
intake (style A) is PREFERRED over the bare-links loop (style B); NEVER ask the service-card
questionnaire (defaults shown as ONE summary-table row); the spec's `design` block stores
node IDs only, never figma.com URLs.

## Step 3 — Three confirmation tables (never guess silently)

1. **Headers** — auto-classify, show the table, let the user adjust:
   `literal` (static, e.g. Content-Type) / `env` → `EXPO_PUBLIC_<FEATURE>_<KEY>` (credentials)
   / `session` (Bearer/session tokens — excluded from generated code; the HttpClient auth
   layer owns them).
2. **Request-field provenance** — every request-body field → `input` / `device` (via the
   service's `getDeviceMetadata()`) / `timestamp` / `constant` / `session` (input field +
   TODO comment).
3. **Status enum** — response has boolean/status flags? Ask "what are the possible result
   states?" → that exact union goes in the spec's `statusEnum`.

Tables confirmed → **compaction pause** (checkpoint 1 in "Context-compaction checkpoints")
before writing the spec / any implementation.

## Step 4 — REUSE-FIRST RULE (mandatory)

Before writing ANY helper (dates, location, device info, currency, digits, regex, images…):
search `src/shared/utils/` → `src/shared/hooks/` → the feature's own `utils/`. Never duplicate
an existing utility. Only if nothing fits: create it in the FEATURE's `presentation/utils/` —
never silently add to `src/shared/utils`. The generated templates already import
`formatNumericGregorianDate`, `useResolve`, `getStoredLanguage`, etc. — keep it that way in
everything you hand-write. (`cleanString` stays mapper-local; that is the repo convention.)

Before writing ANY input, the FORM-FIRST rule runs first: a screen that collects input for a
submission is a form, and a form is a `FormFieldConfig[]` handed to `<FormBuilder />` from `@shared/formBuilder`
— never hand-wired `TextInput` / `DraftTextInput` / `DropdownInput` / `DatePicker` /
`FileUpload` / `Checkbox` / `OptionGroup` JSX. The builder covers 14 field types plus
conditional visibility, cross-field validation, reset-on-change and i18n messages; a feature
that hand-wires a form re-implements all of it and inherits none of the later fixes. Anything
the builder does not cover goes down [FORMS.md](FORMS.md) §3's ladder — `type: 'custom'` first,
a shared component beside the form second, the hand-wired login pattern (draft refs, no React
state per keystroke) only as a documented last resort. Read [FORMS.md](FORMS.md) before
building any screen with inputs; its §4 render contract (`subscribeHost: false`, stable
`fields` identity, `commitOnBlur`) is not optional.

Before writing ANY component, the same rule runs against `@shared/components` through
[COMPONENTS.md](COMPONENTS.md). **Read it with the reader script, in two moves** — the file is
~75KB and a whole-file read costs more than the screen you are building:

    node <skill>/scripts/components.js                    # index: "I need X → use Y"
    node <skill>/scripts/components.js Card List Modal     # those entries, verbatim

The index is what the gate decides on; the entries are what you build from. This is
retrieval, NOT a budget — pull every component the screen plausibly touches, and pull more
whenever you are unsure. Extra entries cost you nothing; a component you failed to look up is
a hand-built duplicate a reviewer sends back. `--list` shows all 64 names, `--all` prints the
whole file. A name with no entry prints a MISS, never silence: "no output" must never be read
as "no shared component exists".

The dictionary only works if it is current. Other teams add shared components between skill
runs, and a component missing from it is invisible to the gate: Claude concludes "no shared
match" and hand-builds a duplicate. So **whenever you are about to build or audit
components, run**

    node <skill>/scripts/check-components-md.js [--repo <path>]

**and WRITE the entries for anything it reports as DRIFT before continuing** — it detects,
you write the prose. Full procedure and entry format: DESIGN.md → "Keeping COMPONENTS.md
current". This is not optional and not deferrable to the user: `audit.js`'s `components-md`
check is a WARN only so it never blocks a run, but leaving drift unwritten means the next
run repeats the duplication. Same rule when YOU add a prop to a shared component: update its
COMPONENTS.md entry and its `HOW_TO_USE.md` in the same change.

## Step 4b — REVIEW CONVENTIONS (mandatory for everything you hand-write)

Every rule comes from a real PR review round on this repo. They live in
**[REVIEW.md](REVIEW.md)** — read it before hand-writing use-case rules (Step 5.3), screens,
components or controllers, and keep it in view while you do. `audit.js`'s
`review-conventions` check enforces the mechanical ones; the rest are on you.

## Step 5 — Generate, fill, register, audit

1. Write `feature-spec.json` in a scratch dir (never the repo — audit.js persists a sanitized
   copy later). Schema + collision rules: [SPEC_FORMAT.md](SPEC_FORMAT.md). Before finalizing
   names, grep `tokens.ts`/`container.ts`: name taken → pick another verb (e.g.
   `ValidateTaxStampUseCase` exists → `VerifyTaxStampUseCase`). generate.js VALIDATES the spec
   (PascalCase feature, no duplicate actions, GET/POST/PUT/DELETE only, path `{placeholders}`
   ↔ pathParams matching both ways, provenance covering the request sample exactly, non-empty
   statusEnum values) — on rejection, fix the spec per the stderr messages, don't work around
   the script.
2. `node <skill>/scripts/generate.js <spec>` — creates all files (never overwrites), prints a
   compact summary; the full file manifest is written to `.claude-skill-manifest.json` (read
   it when you need the exact paths). `needsClaude`/`needsManual` entries in the summary are
   YOUR hand-edit list.
3. Hand-write ONLY: the use-case `execute()` rules from the story, the mapper's
   `TODO(claude): status derivation` block (if statusEnum), the rule tests marked
   `TODO(claude)` in `test/`, and Arabic translation values. Match the generated code
   style; keep the sample-derived test inputs valid under your new rules. New error codes go
   into the `<FEATURE>_ERROR_CODE_VALUES` array in the errors file — the union type and the
   runtime guard both derive from it. **`mock: true` additionally**: enrich the generated
   `<Feature>MockService`'s sample catalog — enough items to exercise every filter option,
   status value, search, and multiple pages (the ApplicationStatus reference: 20 items =
   5 statuses × 4 tax types, realistic Arabic titles, honoring the endpoint's
   search/filter/pagination params); write a mock-service test suite covering catalog
   coverage + param handling; then remove the mock's `TODO(claude)` marker.
4. `node <skill>/scripts/register-di.js <spec>` — DI + i18n + AppConfig/ConfigService + all
   SIX env files (real values only in `.env` + `.env.development`; the rest get placeholders —
   they are committed to git). First run plants permanent anchors (approved one-time edit).
5. `node <skill>/scripts/audit.js <spec> --persist-spec` — full checks + tsc baseline diff +
   the feature's jest suites. See [AUDIT.md](AUDIT.md) for every check and how to fix each.
6. Audit PASS → **compaction pause** (checkpoint 3 in "Context-compaction checkpoints")
   before the design lane (full) / final report (backend-only).
   Failures → fix and re-audit, **max 3 fix-cycles**, then stop and report what still fails.
   Rollback on abort: `node <skill>/scripts/rollback.js` (dry run — shows the plan), then
   `--apply` after the user confirms. It deletes the manifest's `created` files and
   `git checkout --`s the `patched` ones (generate + register-di edits both) — nothing outside
   the manifest is ever touched.

## Step 6 — Final report

Report: files created; TOKENS added; env keys still to fill (staging/preprod/production);
session-value TODOs; core edits made (put/delete, first-run anchors). **`mock: true`**: state
that the container serves `<Feature>MockService` and the exact swap (container.ts factory →
real service, delete the mock file, restore `requiresAuth` if it was relaxed for testing).
**Test infra**: report what setup-test-infra.js did (devDependency installed, jest.setup.js
created/wired — these edits are NOT covered by rollback.js); if its install failed, state
plainly that this feature ships logic-level tests only and what to run to fix it. **Full/design modes
additionally**: screens built with their verification status (AR light/dark, EN mirror),
deviations the user accepted at checkpoints, icons added to the registry, COMPONENTS.md
entries you added or corrected (Step 4), and the
translations flagged for Corporate Communication review. And navigation:

- **Backend-only mode**: the reminder — **expo-router**: "to expose the screen, add a route
  file under `app/` that renders the feature's screen" (backend-only never touches
  navigators/routes).
- **Full / design modes**: navigation IS registered by the design lane (dedicated route file
  under `app/service-flow/`, RouteContract + Routes, page registry, SERVICES_DATA — see
  DESIGN.md's registration checklist). New route paths are not in the typed-routes union
  until the next `expo start` regenerates it — use an `as Href` cast temporarily and note it
  in the report.

**Skill update**: if checklist item 0 reported UPDATE AVAILABLE, close the report with the
same two lines (versions + their update command) — the end of a run is when acting on it is
actually safe. Nothing else about the report changes; the work above was done on the
installed version and stands.

## Feature lifecycle (remove / rename / migrate)

Read [LIFECYCLE.md](LIFECYCLE.md) when the user asks to remove, rename, or migrate a
skill-generated feature. All three scripts need the persisted `feature-spec.json`, are
dry-run by default (`--apply` only after user confirmation), and refuse pre-skill features.

## Append mode

Read [APPEND.md](APPEND.md) when Step 1 found the feature already exists (endpoint append —
behavior table, persisted-spec reuse, append user-story rule). Design append (one screen) is
DESIGN.md §6.
