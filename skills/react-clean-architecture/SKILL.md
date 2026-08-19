---
name: react-clean-architecture
description: >-
  Scaffold a clean-architecture feature in src/features for the zatcaReact app —
  three modes: full feature (backend + Figma design), backend only, or design only. Backend
  generates dtos, endpoints, mappers, service, repository, entities, interfaces, errors,
  use cases, react-query presentation starter, translations, Jest tests, and registers
  everything in the tsyringe DI container. The design lane (DESIGN.md) builds pixel-accurate
  screens from Figma links, verifies them on the iOS simulator, and registers the service in
  navigation. Use when the user asks to create a feature, add a feature, scaffold an
  endpoint/API, implement Figma screens for a feature, or generate a repository, service, or
  use case from a curl/endpoint. Supports append mode for endpoints and screens.
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
- Design lane (Figma → screens → simulator verification): [DESIGN.md](DESIGN.md)
- Filled example: [examples/feature-spec.example.json](examples/feature-spec.example.json),
  expected tree in `examples/expected-output/`

In terminal Claude Code there is no clickable-question UI — fall back to plain-text numbered
questions for every choice point below.

## Progress checklist (copy this and keep it updated)

```
- [ ] 0. Baseline: node <skill>/scripts/audit.js --baseline
- [ ] 0b. Test infra: node <skill>/scripts/setup-test-infra.js (auto-installs
        @testing-library/react-native + jest.setup.js wiring; failure → logic tests + report)
- [ ] 1. Feature name → new feature or append?  Git tree clean?
- [ ] 1b. Mode: full (backend + design) / backend only / design only
- [ ] 2. (backend, full) Single or multiple? → curls one-by-one (auto-EXECUTE for the
        response; per GET: cache question; multi: "next or done?") → summary table → ONE user
        story (skip/write; append: offer existing userStory/*.md first) → login/token
        question  [one question per message]
- [ ] 2b. Story given → save it to userStory/<StoryID>.md (skip → NO userStory/ dir)
- [ ] 2c. (full, design) Screen collection: flow description preferred (screens + narrated
        transitions in one paste → ONE summary table with service-card defaults, single
        confirm); bare-links fallback loops "next screen, or done?" (see DESIGN.md).
        NEVER ask the service-card questionnaire
- [ ] 3. (backend, full) Confirmation tables: headers / request-field provenance / status enum
- [ ] 4. (backend, full) Write feature-spec.json (scratch dir, NOT the repo)
- [ ] 5. (backend, full) node <skill>/scripts/generate.js <spec>
- [ ] 6. (backend, full) Hand-write use-case execute() rules (+ mapper status derivation if statusEnum)
- [ ] 7. (backend, full) node <skill>/scripts/register-di.js <spec>
- [ ] 8. (backend, full) node <skill>/scripts/audit.js <spec> --persist-spec   (fix → max 3 cycles)
- [ ] 8b. (full, design) Design lane per DESIGN.md: persist the design record → REGISTER
        NAVIGATION FIRST (DESIGN.md §5 — verification needs the screen tappable) → build
        each screen → verify on the iOS simulator (AR + dark) → checkpoint with the user
- [ ] 9. Final report to the user (Step 6 section; full/design: include the design-lane
        bullets)
```

Checklist items 3–8 expand under "Step 3" / "Step 5 — Generate, fill, register, audit"
below (Step 5's sub-items 1–5 are checklist items 4–8); the REUSE-FIRST rule (Step 4
section) applies throughout Step 5–8b hand-writing.

## Step 1 — Feature name

1. Normalize to PascalCase (strip symbols/spaces); reject empty. Flat PascalCase under
   `src/features/` is the standard (existing kebab-case/nested features are legacy).
2. Existence check is **case-insensitive** (macOS FS) and must also scan ONE level of nested
   category dirs (e.g. `verificationFeatures/TaxStampValidation`).
   - Exists → **append mode** (see below). New → full scaffold.
3. `git status --porcelain`: dirty tree → warn that manifest-based rollback is only reliable on
   a clean tree, offer "continue anyway". Not a hard refusal.
4. Run the tsc baseline NOW (before any generation): `node <skill>/scripts/audit.js --baseline`.
5. Ensure render-test infra (AUTOMATIC — user decision 2026-08-19, no asking):
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

- **Full** → Step 2 (endpoint intake), then Step 2c (screen collection), then generate/register/
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
  Persistence: **immediately after Step 2c** (before any screen is built), write the design
  record so a crash mid-lane loses nothing — all screens `status: "pending"`, updated per
  screen as the lane progresses (DESIGN.md §6): **no `feature-spec.json` exists** →
  hand-write one containing ONLY `{ "feature", "skillVersion", "design" }` (`skillVersion`
  = the `SKILL_VERSION` constant in `<skill>/scripts/generate.js`); **a spec file already
  exists** (backend previously generated) → MERGE the `design` block into it, never replace
  the file. Either way the record is a resume artifact, NOT a generate.js input.

**Mode × Step 1 "exists":** when Step 1 found the feature already exists, the mode answer
selects the append lane — **full/backend** → endpoint append (Append mode section; full
additionally runs design work after); **design** → design append (DESIGN.md §6). To fully
(re)design an existing feature's screens, run design-append iterated per screen. The
service-card defaults row is shown ONLY if the persisted spec has no `serviceCard`; values
already on disk are reused silently.

## Step 2 — Endpoint intake (repeat per endpoint)

**ONE QUESTION PER MESSAGE — this ordering is mandatory and unconditional** once Step 1b
routes here (backend-only and full modes; design-only skips this step). It does not
change based on Step 1's outcome (new feature, append, empty skeleton, dirty tree — none of
that alters the intake order; report Step 1 results in one short line, not an analysis dump).
Never bundle two questions into one message, and never invite combined answers like "paste
the curl along with your choice". Ask, stop, wait for the answer, then ask the next.

The fixed sequence:

1. Ask ONLY: **"Single or multiple endpoints?"** — nothing else in that message. Wait.
2. Ask ONLY for the curl paste (or "no curl" → guided intake). Wait.
3. **No response-body question** — capture the response by EXECUTING the curl (see
   "Response capture" below). Not asked, just done.
3b. GET endpoint → ask ONLY the **cache question**, with the two cache layers spelled out so
   "no" isn't misread as "no caching at all" (live finding 2026-08-19: a user was surprised
   react-query still answered from memory after answering "no"):
   > "How should this endpoint's responses be cached? 1. **no** — no device cache; react-query
   > still keeps responses in memory for ~5 min (app-wide default) · 2. **always-fresh** —
   > refetch on every visit, even the in-memory copy is bypassed (`staleTime: 0`; pick this
   > for lists whose server data changes between visits) · 3. a **persistent device cache**:
   > 6-hours / 8-hours / 12-hours / 24-hours / 2-days / 1-week (survives app restarts)"
   → the endpoint's `cache` field (`null` / `"always-fresh"` / the duration). Non-GET: skip,
   never ask.
4. Multiple mode: ask **"next curl, or done?"** — on "next", loop back to 2 for the next
   endpoint. Single mode: skip this.
5. When all curls are in ("done", or the single curl is captured): show the endpoint summary
   table (user can say "edit #N"), then ask the **user story** question — ONCE for the whole
   feature, with an explicit **"skip"** option. In multi mode you map the story's rules onto
   each endpoint's use case; endpoints the story doesn't cover get pass-through + `// TODO`.
6. After the story question (backend-only and full modes ONLY): ask ONLY the **login
   question** — "does this feature require login?" If yes, ask for an access token in the NEXT
   message. The token is used at runtime only (curl execution, simulator verification via
   `setAuthToken`/MMKV `authToken`) — it NEVER lands in any file; secret-hygiene enforces
   this. A login-required feature also gets `requiresAuth: true` in its SERVICES_DATA entry
   (design lane).

**MOCK BACKEND (spec.mock: true) — first-class lane, not improvisation.** When the user says
the backend doesn't exist yet ("use mock backend", "API not ready", "mock for now") — in the
initial request or at any intake point — set top-level `"mock": true` in the spec and confirm
it in one line. Consequences: (a) there is no live API, so **response capture cannot execute
the curl** — ask for a sample response, or (with the user's explicit OK, as in the
ApplicationStatus run) derive a realistic sample from the Figma screens/story and confirm it;
(b) generate.js emits `data/services/<Feature>MockService.ts` — sample DTOs flowing through
the REAL mappers — and register-di.js registers the MOCK for `TOKENS.<Feature>Service` with a
swap comment (the real service class is still generated, unreferenced, ready for the swap);
(c) YOU enrich the mock's sample catalog in Step 5.3 (filters, states, pagination — every
filter-sheet option should have matching items); (d) DESIGN.md §1's mock question is
pre-answered — never ask it again; (e) the final report states the one-line swap. The mock
seam is the SERVICE interface — never mock at the repository or query layer, that would
bypass the mappers.

**YES — curl path (target: ONE paste per endpoint — the curl itself):**
1. Paste → save to a scratch file → `node <skill>/scripts/parse-curl.js <file>`.
   Detection is loose: `--header`/`-H`/`--data`/`-d`/`--body` + a URL counts — no literal
   `curl` prefix required (Postman exports start with other text).
   Broken paste → the script reports what's found/missing; re-ask.
   `multipart: true` → reject: "not supported yet — add manually using IHttpClient.upload()".
2. **Host classification** — resolve the app's hosts from `.env.development` (fallback: the
   literal defaults in `src/core/config/ConfigService.ts`):
   - Matches `EXPO_PUBLIC_API_URL` (host + path prefix) → `hostType: "app"`. **Strip the
     base-URL path prefix from the endpoint path** (apiUrl `…/test/third-party/` + curl
     `…/test/third-party/v2/x` → path `/v2/x`), or URLs double the prefix.
   - Matches `EXPO_PUBLIC_INTERNAL_BASE_URL` / `EXPO_PUBLIC_BFF_BASE_URL` → `hostType:
     "external"` but **reuse the existing config fields** (`internalBaseUrl`/`baseUrl`) —
     no new env keys, omit `baseUrl.envKey`/`devValue`.
   - Anything else → `hostType: "external"` with a new `EXPO_PUBLIC_<FEATURE>_BASE_URL`.
3. Numeric/UUID path segments → propose them as path params, user confirms which are dynamic.
4. **Response capture — EXECUTE the curl, don't ask.** The live payload beats a hand-typed
   sample, so run the pasted curl and capture the real response:
   - **GET**: execute immediately, no question.
   - **POST/PUT/DELETE**: one-line confirmation first — the call hits the real API and may
     mutate state; get an explicit yes before running.
   - Model the `data` object when the response arrives in the app's `ApiResponse`
     `{header, data}` envelope. Any token in the paste is used for the call ONLY — it never
     lands in a file (secret-hygiene enforces this).
   - **Fallback (only if execution fails** — network/auth error, non-JSON, empty body, or the
     user declined a mutating call): then ask — paste a sample JSON response, or "none"
     (endpoint returns nothing useful → `Result<void, …>`).

**NO — guided manual path** (one question per message here too): URL → app or external host?
→ custom headers (paste or "none") → method (GET/POST/PUT/DELETE) → request body JSON or
"none" (POST/PUT) / query+path params (GET/DELETE) → response body (no curl to execute, so
ASK: paste a sample or "none") → back into the fixed sequence (next-curl loop / user story).

**Response shape rules (both paths):**
- `"none"` → use case returns `Result<void, FeatureError>`; no ResponseDTO, no `toDomain`.
- Top-level array `[...]` supported (array DTO + entity list).
- `null` values / empty `[]` → ask the user the type; unanswered → `unknown` + audit warning.
- Non-JSON / multipart / uploads → reject in v1 (message above).
- Endpoint path already present in ANY other feature (audit greps too) → warn, continue/cancel.

**User story:** asked ONCE per run, after all curls are captured (sequence step 5) — options:
write it, or **skip**. Drives use-case names, `execute()` validation, error codes; kept as a
doc comment on the use case(s). Skipped → pass-through + `// TODO`. NEVER invent a story
silently: made-up validation is worse than none. Arabic strings in the story flow into
`translations/ar.ts`.

**userStory/ directory:** story given → create `src/features/<Feature>/userStory/` and save
the FULL story text verbatim as one `.md` file per story, named by its story ID when it has
one (e.g. `ERD-PBM-001.md`); no ID → sequential fallback (`userStory-1.md`, `userStory-2.md`,
…). Story skipped → do NOT create the directory. In append mode a new story gets its OWN file
alongside the existing ones — never overwrite or delete a previous story file. (Create the
directory by hand — the scripts don't manage it; audit's structure check ignores extra dirs.)

**STORY IS THE CONTRACT:** once a story exists for the endpoint(s) — given this run or reused
from `userStory/` — ALL hand-written work (validation rules, error codes, status mappings,
screen behavior, translations) must follow it. Anything the story does NOT cover — extra
validation, renamed labels, added behavior, design deviations — ASK the user first; never
improvise beyond pass-through + `// TODO`.

**Multi mode:** after each curl is captured, ask **"next curl, or done?"**. On "done" show the
summary table of ALL endpoints (user can say "edit #N"), then the single user story question,
then the Step 3 confirmation tables.

**PUT/DELETE:** `IHttpClient` has them commented out. If the spec needs one, YOU edit
`src/core/http/IHttpClient.ts` + `HttpClientService.ts` by hand, mirroring the existing
`get`/`post` implementations (one-time, owner-approved core edit — mention it in the report).

## Step 2c — Screen collection (full and design modes)

Two intake styles — detect from the user's first design paste:

**A. Flow description (PREFERRED — user decision 2026-08-17).** The user narrates the flow in
free text, links mixed with prose, e.g.: *"this is my dashboard main screen `<link>`; the
'متابعة للسداد' button opens `<link>`; 'ادفع الآن' opens this modal sheet `<link>`; the
search button opens the results screen `<link>`"*. Any narration around the links
(role words — screen/sheet/modal/results; transition verbs — opens/redirects/shows; named
buttons) selects this style. Parse it — do NOT run the loop in B:

1. Every link the narration presents as its own screen/sheet/modal is ONE screen unit. The
   narration order is the build order; the screen described as main/default/first is the
   flow host. Links pasted as attachments of a screen (states, dropdowns) stay components of
   that unit, exactly as in B.
2. Record every described transition as an edge — `{from, trigger (the button/action text),
   to, presentation: "push" | "sheet" | "modal"}`. **Edges are built, not decoration**: the
   design lane wires each trigger to a real handler (DESIGN.md §2).
3. Fetch node names via `get_metadata` for every link, then show ONE summary table —
   screens (name, node-id, role) + transitions (from → trigger → to) + the service-card
   defaults row (below) — and ask a single confirmation: "correct, or edit #N / edit card?".
   Never guess silently, and never split this confirmation into multiple questions.

**B. Bare links, no narration (fallback loop)** — collect sequentially, ONE question per
message:

1. Ask ONLY for **screen 1**: its Figma link plus the links of its attached components in the
   same paste, lightly labeled — `screen:` for the frame, `sheet:` / `dropdown:` / `modal:`
   for overlay components, `state:empty` / `state:error` / … for extra state frames. One
   screen unit = the screen + everything pasted with it. **Unlabeled links**: treat the first
   as `screen:`; for the rest fetch the node names via `get_metadata` and put the INFERRED
   labels in the summary table for the user to confirm — never guess silently. **If the
   metadata shows several full-frame screens in one unlabeled paste** (multiple ~375pt-wide
   frames), they are almost certainly a FLOW, not one screen + components — say so and ask
   the user to describe the flow (style A) instead of forcing the first-link rule. Wait.
2. Ask **"next screen, or done?"** — on "next", loop back to 1 for the next screen. The paste
   order IS the generation order. **"done" with ZERO screens collected** → confirm intent;
   if the user really has none, drop the design lane for this run (treat it as backend-only,
   including its manual-navigation reminder) and record no `design` block.
3. On "done": show the screen summary table (name, node-id, components, states) with the
   service-card defaults row — user can say "edit #N" / "edit card".

**Service card — NO questionnaire (user decision 2026-08-17: the cost/serviceTypes/userTypes/
fees/processingTime/Home-shortcut interrogation is retired).** Apply defaults and show them
as ONE row in the summary table for correction in the same reply — never as questions:
`cost: free · fees: 0 · serviceTypes: inferred from the feature name/story/file context
(fallback tax) · userTypes: all · processingTimeMinutes: 5 · homeShortcut: no ·
requiresAuth: no`. In backend/full modes `requiresAuth` still comes from the Step 2 login
question; in design-only it stays `no` unless the flow/story mentions login (then ask, and
collect the token in the NEXT message — runtime only, never in any file). The user edits the
row with e.g. "edit card: paid, fees 50". Record the final values (edited or defaulted) in
`design.serviceCard`; the report lists them so they can be changed later. **Design-append /
persisted `serviceCard` exists** → reuse disk values silently, show nothing.

Extract fileKey + node IDs from the pasted URLs and record screens, transitions, and
serviceCard in the spec's `design` block ([SPEC_FORMAT.md](SPEC_FORMAT.md)) — **node IDs
only, never full URLs**.

Everything after collection — reading the frames, building the screens, wiring the
transitions, verification, navigation registration — follows [DESIGN.md](DESIGN.md).

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

## Step 4 — REUSE-FIRST RULE (mandatory)

Before writing ANY helper (dates, location, device info, currency, digits, regex, images…):
search `src/shared/utils/` → `src/shared/hooks/` → the feature's own `utils/`. Never duplicate
an existing utility. Only if nothing fits: create it in the FEATURE's `presentation/utils/` —
never silently add to `src/shared/utils`. The generated templates already import
`formatNumericGregorianDate`, `useResolve`, `getStoredLanguage`, etc. — keep it that way in
everything you hand-write. (`cleanString` stays mapper-local; that is the repo convention.)

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
   manifest; `needsManual` entries (append mode) are YOUR hand-edit list.
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
6. Failures → fix and re-audit, **max 3 fix-cycles**, then stop and report what still fails.
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
deviations the user accepted at checkpoints, icons added to the registry, and the
translations flagged for Corporate Communication review. And navigation:

- **Backend-only mode**: the reminder — **expo-router**: "to expose the screen, add a route
  file under `app/` that renders the feature's screen" (backend-only never touches
  navigators/routes).
- **Full / design modes**: navigation IS registered by the design lane (dedicated route file
  under `app/service-flow/`, RouteContract + Routes, page registry, SERVICES_DATA — see
  DESIGN.md's registration checklist). New route paths are not in the typed-routes union
  until the next `expo start` regenerates it — use an `as Href` cast temporarily and note it
  in the report.

## Feature lifecycle (remove / rename / migrate)

All three need the feature's persisted `feature-spec.json`; all are dry-run by default and
execute only with `--apply` (confirm with the user first). Pre-skill features are refused —
those stay manual.

- **Remove**: `node <skill>/scripts/remove-feature.js <Feature> [--apply]` — deletes the
  feature dir and unwires TOKENS/TokenRegistry/container/i18n/config/env everywhere (anchors
  stay — they are permanent). It reports `app/` route files that still import the feature —
  delete those by hand, then run `npx tsc --noEmit`.
- **Rename**: `node <skill>/scripts/rename-feature.js <Old> <New> [--apply]` — renames the
  dir, files, derived identifiers, TOKENS entries, i18n namespace, config fields, env keys,
  and the persisted spec. Only derived identifiers are replaced (a feature "Order" can't
  corrupt "OrderTracking"); use-case/entity names are action-scoped and stay. Afterwards:
  review `git diff`, fix `app/` routes, re-run audit.
- **Migrate**: `node <skill>/scripts/migrate-feature.js <Feature> [--apply]` — regenerates the
  MACHINE-OWNED files (endpoints, service, repository, interfaces, errors) with the current
  templates; hand-added error codes are merged; use cases, mappers, tests, and presentation
  are never touched (dtos/entities only with `--include-types`). Always finish with audit.js.

## Append mode

`audit.js --persist-spec` leaves `src/features/<Feature>/feature-spec.json` — load it FIRST for
full prior context (host types, provenance, enums) without re-asking.

**User story in append mode:** check `src/features/<Feature>/userStory/` right after loading
the spec. Story file(s) exist → at the story point of the intake sequence ask ONE question:
"use the existing story (<file names>) for the new endpoint(s), or write a new one?" (reading
the existing file(s) first so the reuse offer is informed). No directory → ask the usual
write/skip question. A NEW story → its own `.md` file per the naming rule (create the
directory if missing). Whichever story applies, the STORY IS THE CONTRACT rule holds.

| Target | Behavior |
|---|---|
| Skill-generated feature (anchors present) | Scripts insert at anchors + add missing imports; new per-endpoint files created; never overwrites |
| Pre-skill feature (no anchors, e.g. TaxStampValidation, account, integrated-tariff) | Scripts report NEEDS_MANUAL → YOU edit by hand, matching THAT feature's own conventions (even singular folder names) |
| Append turns same-host feature into mixed-host | Scripts detect + report — YOU patch the service ctor, its imports, and the DI registration args |
| New endpoint uses device provenance, repo lacks `getDeviceMetadata()` | Reported → add the private helper by hand |
| Anchor hand-deleted / same action twice | Reported → careful manual edit / skip or suffix |
| Translations | Append generates NO new keys (they are feature-level) — hand-add any new screen strings to the existing `en.ts`/`ar.ts`, never removing existing keys |
| User story | Existing `userStory/*.md` → offer reuse before asking for a new one; none → ask write/skip; a new story gets its own file — existing story files are never overwritten or deleted |
| Design append (add/rework ONE screen) | Ask which feature → load its spec's `design` block (or start one) → collect the screen unit (Step 2c, one screen) → build + verify per DESIGN.md, integrating into the EXISTING controller/translations without touching other screens. Pre-skill features (integrated-tariff, …): hand-edit matching THAT feature's conventions |
