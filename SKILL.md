---
name: react-clean-architecture
description: Scaffold a clean-architecture feature in src/features for the zatcaReact app —
  generates dtos, endpoints, mappers, service, repository, entities, interfaces, errors,
  use cases, presentation starter, translations, Jest tests, and registers everything in the
  tsyringe DI container (tokens.ts + container.ts). Use when the user asks to create a feature,
  add a feature, scaffold an endpoint/API, or generate a repository, service, or use case
  from a curl/endpoint. Supports append mode for adding endpoints to existing features.
---

# react-clean-architecture

Scaffolds a complete clean-architecture feature in the zatcaReact app from an endpoint
(preferably a curl paste), a sample response, and a user story. **Script-driven for low token
usage and accuracy**: you hand-write only a small `feature-spec.json` and the use-case business
rules — deterministic Node scripts generate every file, patch DI/i18n/config/env, and audit.

**Run every script from the TARGET REPO ROOT.** `<skill>` below means this skill's directory.

- Spec schema: [SPEC_FORMAT.md](SPEC_FORMAT.md) · Audit details: [AUDIT.md](AUDIT.md)
- Filled example: [examples/feature-spec.example.json](examples/feature-spec.example.json),
  expected tree in `examples/expected-output/`

In terminal Claude Code there is no clickable-question UI — fall back to plain-text numbered
questions for every choice point below.

## Progress checklist (copy this and keep it updated)

```
- [ ] 0. Baseline: node <skill>/scripts/audit.js --baseline
- [ ] 1. Feature name → new feature or append?  Git tree clean?
- [ ] 2. Single or multiple? → curls one-by-one (auto-EXECUTE for the response; multi: "next
        or done?") → summary table → ONE user story (skip/write)  [one question per message]
- [ ] 3. Confirmation tables: headers / request-field provenance / status enum
- [ ] 4. Write feature-spec.json (scratch dir, NOT the repo)
- [ ] 5. node <skill>/scripts/generate.js <spec>
- [ ] 6. Hand-write use-case execute() rules (+ mapper status derivation if statusEnum)
- [ ] 7. node <skill>/scripts/register-di.js <spec>
- [ ] 8. node <skill>/scripts/audit.js <spec> --persist-spec   (fix → max 3 cycles)
- [ ] 9. Final report to the user
```

## Step 1 — Feature name

1. Normalize to PascalCase (strip symbols/spaces); reject empty. Flat PascalCase under
   `src/features/` is the standard (existing kebab-case/nested features are legacy).
2. Existence check is **case-insensitive** (macOS FS) and must also scan ONE level of nested
   category dirs (e.g. `verificationFeatures/TaxStampValidation`).
   - Exists → **append mode** (see below). New → full scaffold.
3. `git status --porcelain`: dirty tree → warn that manifest-based rollback is only reliable on
   a clean tree, offer "continue anyway". Not a hard refusal.
4. Run the tsc baseline NOW (before any generation): `node <skill>/scripts/audit.js --baseline`.

## Step 2 — Endpoint intake (repeat per endpoint)

**ONE QUESTION PER MESSAGE — this ordering is mandatory and unconditional.** It does not
change based on Step 1's outcome (new feature, append, empty skeleton, dirty tree — none of
that alters the intake order; report Step 1 results in one short line, not an analysis dump).
Never bundle two questions into one message, and never invite combined answers like "paste
the curl along with your choice". Ask, stop, wait for the answer, then ask the next.

The fixed sequence:

1. Ask ONLY: **"Single or multiple endpoints?"** — nothing else in that message. Wait.
2. Ask ONLY for the curl paste (or "no curl" → guided intake). Wait.
3. **No response-body question** — capture the response by EXECUTING the curl (see
   "Response capture" below). Not asked, just done.
4. Multiple mode: ask **"next curl, or done?"** — on "next", loop back to 2 for the next
   endpoint. Single mode: skip this.
5. When all curls are in ("done", or the single curl is captured): show the endpoint summary
   table (user can say "edit #N"), then ask the **user story** question — ONCE for the whole
   feature, with an explicit **"skip"** option. In multi mode you map the story's rules onto
   each endpoint's use case; endpoints the story doesn't cover get pass-through + `// TODO`.

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
`ar.json`.

**Multi mode:** after each curl is captured, ask **"next curl, or done?"**. On "done" show the
summary table of ALL endpoints (user can say "edit #N"), then the single user story question,
then the Step 3 confirmation tables.

**PUT/DELETE:** `IHttpClient` has them commented out. If the spec needs one, YOU edit
`src/core/http/IHttpClient.ts` + `HttpClientService.ts` by hand, mirroring the existing
`get`/`post` implementations (one-time, owner-approved core edit — mention it in the report).

## Step 3 — Three confirmation tables (never guess silently)

1. **Headers** — auto-classify, show the table, let the user adjust:
   `literal` (static, e.g. Content-Type) / `env` → `EXPO_PUBLIC_<FEATURE>_<KEY>` (credentials)
   / `session` (Bearer/session tokens — excluded from generated code; the HttpClient auth
   layer owns them).
2. **Request-field provenance** — every request-body field → `input` / `device` (via
   `getDeviceInfo()`) / `timestamp` / `constant` / `session` (input field + TODO comment).
3. **Status enum** — response has boolean/status flags? Ask "what are the possible result
   states?" → that exact union goes in the spec's `statusEnum`.

## Step 4 — REUSE-FIRST RULE (mandatory)

Before writing ANY helper (dates, location, device info, currency, digits, regex, images…):
search `src/shared/utils/` → `src/shared/hooks/` → the feature's own `utils/`. Never duplicate
an existing utility. Only if nothing fits: create it in the FEATURE's `presentation/utils/` —
never silently add to `src/shared/utils`. The generated templates already import
`getDeviceInfo`, `formatDateTimeDateMonthYear`, `useResolve`, etc. — keep it that way in
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
   runtime guard both derive from it.
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
session-value TODOs; core edits made (put/delete, first-run anchors); and the navigation
reminder — **expo-router**: "to expose the screen, add a route file under `app/` that renders
`<featureCamel>Screen`" (the skill never touches navigators/routes). New route paths are not
in the typed-routes union until the next `expo start` regenerates it — use an `as Href` cast
temporarily and note it in the report.

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

| Target | Behavior |
|---|---|
| Skill-generated feature (anchors present) | Scripts insert at anchors + add missing imports; new per-endpoint files created; never overwrites |
| Pre-skill feature (no anchors, e.g. TaxStampValidation, account, integrated-tariff) | Scripts report NEEDS_MANUAL → YOU edit by hand, matching THAT feature's own conventions (even singular folder names) |
| Append turns same-host feature into mixed-host | Scripts detect + report — YOU patch the service ctor, its imports, and the DI registration args |
| New endpoint uses device provenance, repo lacks `getDeviceMetadata()` | Reported → add the private helper by hand |
| Anchor hand-deleted / same action twice | Reported → careful manual edit / skip or suffix |
| Translations | Append generates NO new keys (they are feature-level) — hand-add any new screen strings to the existing `en.json`/`ar.json`, never removing existing keys |
