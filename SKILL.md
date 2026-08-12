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
- [ ] 2. Per endpoint: curl / manual intake → response body → user story
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

Ask: single or multiple endpoints? Then per endpoint: **"Do you have a curl command?"**

**YES — curl path (target: 3 pastes total per endpoint):**
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
4. Then ask only: **response body** → **user story**.

**NO — guided manual path:** URL → app or external host? → custom headers (paste or "none") →
method (GET/POST/PUT/DELETE) → request body JSON or "none" (POST/PUT) / query+path params
(GET/DELETE) → response body → user story.

**Response body rules (both paths):**
- `"none"` → use case returns `Result<void, FeatureError>`; no ResponseDTO, no `toDomain`.
- Top-level array `[...]` supported (array DTO + entity list).
- `null` values / empty `[]` → ask the user the type; unanswered → `unknown` + audit warning.
- Non-JSON / multipart / uploads → reject in v1 (message above).
- Endpoint path already present in ANY other feature (audit greps too) → warn, continue/cancel.

**User story:** always asked, skippable. Drives use-case name, `execute()` validation, error
codes; kept as a doc comment on the use case. Skipped → pass-through + `// TODO`. Arabic
strings in the story flow into `ar.json`.

**Multi mode:** after each endpoint → "next" or "submit". On submit show a summary table of ALL
endpoints first; user can say "edit #N" before generation.

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
   `ValidateTaxStampUseCase` exists → `VerifyTaxStampUseCase`).
2. `node <skill>/scripts/generate.js <spec>` — creates all files (never overwrites), prints a
   manifest; `needsManual` entries (append mode) are YOUR hand-edit list.
3. Hand-write ONLY: the use-case `execute()` rules from the story, the mapper's
   `TODO(claude): status derivation` block (if statusEnum), the rule tests marked
   `TODO(claude)` in `__tests__/`, and Arabic translation values. Match the generated code
   style; keep the sample-derived test inputs valid under your new rules. New error codes go
   into the `<FEATURE>_ERROR_CODE_VALUES` array in the errors file — the union type and the
   runtime guard both derive from it.
4. `node <skill>/scripts/register-di.js <spec>` — DI + i18n + AppConfig/ConfigService + all
   SIX env files (real values only in `.env` + `.env.development`; the rest get placeholders —
   they are committed to git). First run plants permanent anchors (approved one-time edit).
5. `node <skill>/scripts/audit.js <spec> --persist-spec` — full checks + tsc baseline diff +
   the feature's jest suites. See [AUDIT.md](AUDIT.md) for every check and how to fix each.
6. Failures → fix and re-audit, **max 3 fix-cycles**, then stop and report what still fails.
   Rollback on abort: delete `created` files from `.claude-skill-manifest.json` and
   `git checkout --` the `patched` ones — never touch anything outside the manifest.

## Step 6 — Final report

Report: files created; TOKENS added; env keys still to fill (staging/preprod/production);
session-value TODOs; core edits made (put/delete, first-run anchors); and the navigation
reminder — **expo-router**: "to expose the screen, add a route file under `app/` that renders
`<featureCamel>Screen`" (the skill never touches navigators/routes).

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
| Translations | Scripts merge new keys into the existing JSON (existing keys win) |
