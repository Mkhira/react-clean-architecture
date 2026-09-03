# `feature-spec.json` format

The single input to `generate.js`, `register-di.js`, and `audit.js`. Claude writes it after the
interactive intake; `audit.js --persist-spec` later stores a **sanitized** copy (secrets
replaced by `<env:KEY>` references) at `src/features/<feature-dir>/feature-spec.json` for append
mode and documentation.

## Top level

| Field | Type | Notes |
|---|---|---|
| `feature` | string | PascalCase — the identifier, not the path. The directory is derived kebab-case (`ProductVerification` → `src/features/product-verification`); append/lifecycle scripts resolve a legacy PascalCase directory when one exists. Grep `tokens.ts`/`container.ts` for collisions first |
| `mode` | `"create"` \| `"append"` | append = feature dir already exists (anchors expected) |
| `mock` | boolean (optional) | `true` = the real backend doesn't exist yet: generate.js additionally emits `data/services/<Feature>MockService.ts` (sample DTOs through the REAL mappers) and register-di.js registers **it** for `TOKENS.<Feature>Service` with a swap comment. The real service class is still generated for the later swap. Set it when the user says "mock backend" / "API not ready" (SKILL.md Step 2) |
| `legacyDir` | boolean (optional) | `true` = this feature's on-disk directory deliberately stays off the kebab-case convention — a pre-1.14.0 PascalCase name, or a leaf inside a category directory (`Signup/EstablishmentSignup`, `verificationFeatures/TaxStampValidation`). Suppresses ONLY the `review-conventions` kebab-directory finding, and only for a directory that already exists; never set it on a new feature |
| `appHost` | string | `EXPO_PUBLIC_API_URL` as read from `.env.development` at spec time |
| `endpoints` | Endpoint[] | one entry per endpoint (non-empty — design-only records have none and never feed generate.js) |
| `skillVersion` | string | PERSISTED specs only (never in the generate.js input — audit stamps it). Hand-written design-only records: copy the `SKILL_VERSION` constant from `<skill>/scripts/generate.js` |

## Endpoint

| Field | Type | Notes |
|---|---|---|
| `action` | string | camelCase verb — becomes the service/repo method and `<Action>UseCase` |
| `method` | `GET` \| `POST` \| `PUT` \| `DELETE` | PUT/DELETE need `IHttpClient` uncommented (manual, see SKILL.md) |
| `path` | string | path only, query split out; app-host paths have the base-URL prefix stripped; `{param}` segments allowed |
| `pathParams` | `{name, type}[]` | produces a function entry in endpoints.ts: `` KEY: (id: string) => `/v1/x/${id}` `` |
| `queryParams` | `{name, type, optional?}[]` | app host → axios `config.params`; external → URL-appended with `encodeURIComponent`. `optional: true` renders `name?: type` in the service/interface signatures and the input type |
| `hostType` | `"app"` \| `"external"` | app = axios `IHttpClient`; external = `fetch` + AbortController + `AppConfig.timeout` |
| `baseUrl` | object \| null | external only — see below |
| `headers` | Header[] | external/custom only — see below |
| `requestSample` | object \| null | raw pasted request JSON; null = no body |
| `requestFieldSources` | map | provenance per request field — see below |
| `responseSample` | object \| array \| null | raw pasted JSON; `[…]` = top-level array; null = "none" → `Result<void, E>` |
| `typeOverrides` | map | answers to ambiguity questions — see below |
| `dateFields` | string[] | dot-paths formatted with `formatNumericGregorianDate` in the mapper |
| `statusEnum` | `{field, values[]}` \| null | emits `domain/constants/<featureCamel>.ts` (the one source for the value list — the entity derives its union from it) ; the DERIVATION is hand-written (TODO in mapper, audit-enforced) |
| `userStory` | string \| null | kept as doc comment; drives rules + Arabic strings |
| `rules` | string[] | short rule statements → TODO bullets in the use case + tests |
| `cache` | duration \| `"always-fresh"` \| null | GET only, asked per endpoint during intake. **Two cache layers exist** — a duration (`"6-hours"` \| `"8-hours"` \| `"12-hours"` \| `"24-hours"` \| `"2-days"` \| `"1-week"`) enables the PERSISTENT device cache (`useApiQuery` `storeDuration`, survives restarts); omit/null disables only that — react-query's app-wide IN-MEMORY defaults (staleTime 5 min) still apply; `"always-fresh"` emits `staleTime: 0` so every mount/param-change refetches (pick for lists whose server state changes between visits, e.g. "my requests") |

### `baseUrl` (external endpoints)

```jsonc
{
  "envKey": "EXPO_PUBLIC_TAX_VALIDATION_BASE_URL",  // omit for app-owned internal/BFF hosts
  "configField": "taxValidationBaseUrl",            // internal/BFF: reuse "internalBaseUrl"/"baseUrl"
  "devValue": "https://api.example-dts.test/ECA"    // goes to .env + .env.development only
}
```

With `envKey` present, `register-di.js` adds the field to `AppConfig`/`ConfigService`
(collision-checked) and appends the key to all SIX env files — real value in `.env` +
`.env.development`, empty placeholders in `.env.example`/`.env.staging`/`.env.preprod`/
`.env.production` (all committed to git; audit FAILS on a real value in `.env.example`).

### Header

```jsonc
{ "name": "client_id", "value": "…", "source": "env",
  "envKey": "EXPO_PUBLIC_TAX_VALIDATION_CLIENT_ID", "configField": "taxValidationClientId" }
```

`source`: `"literal"` (emitted verbatim) · `"env"` (read from ConfigService; value wired into
env files) · `"session"` (OMITTED from generated code — the HttpClient auth layer owns
Bearer/session tokens).

### `requestFieldSources`

One entry per request-body field:

| Source | Generated code |
|---|---|
| `"input"` | use-case input field (camelCased) |
| `"device"` | the SERVICE's `getDeviceMetadata()` (backed by the DI-registered `TaxpayerAuthDeviceContextService`, `Platform.Version`, and the stored app language; id/name/os/osVersion/language matched by field-name suffix) |
| `"timestamp"` | `new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')` at call time |
| `{ "constant": X }` | the literal `X` |
| `"session"` | input field + `// TODO: from auth session` |

### `typeOverrides`

Dot-paths from the response root. Values: `"nullable"` (inferred → `| null`),
`"string|null"`, `"date|null"` (string in the DTO — formatting is the mapper's job),
`"string[]"`, or any verbatim TS type. Unanswered `null`/`[]` fields become `unknown` /
`unknown[]` plus an audit warning.

## `design` (top level, optional — design lane)

Written by the design lane (see [DESIGN.md](DESIGN.md)); ignored by generate.js's file plan
and persisted verbatim by audit.js, which makes design/append runs resumable. **Design-only
features** (no endpoints — generate.js/audit.js never run) persist a hand-written
`feature-spec.json` containing only `{ "feature", "skillVersion", "design" }`; that file is a
resume record for design-append, never a generate.js input.

| Field | Type | Notes |
|---|---|---|
| `fileKey` | string | Figma file key (the `:fileKey` segment of the design URL) |
| `screens` | Screen[] | ordered — the generation order the user gave |
| `serviceCard` | object \| null | the service-card values (Step 2c defaults unless the user edited them — the questionnaire is retired): `{ cost, serviceTypes, userTypes, fees, processingTimeMinutes, requiresAuth, homeShortcut }` |
| `transitions` | Edge[] \| absent | flow edges from a Step 2c flow description: `{ from, trigger, to, presentation: "push" \| "sheet" \| "modal" }` — screen names in `from`/`to`; built as real handlers by DESIGN.md §2 |

Screen: `{ name, screenNodeId, componentNodeIds: { <componentName>: nodeId }, stateNodeIds: { <state>: nodeId }, status: "pending" | "generated" | "verified", role?: "screen" | "sheet" | "modal" }` (`role` defaults to `"screen"`; sheets/modals from a flow description carry theirs).

**Node IDs only, never full figma.com URLs** — URLs can carry tokens and the spec is
persisted into the repo; validateSpec rejects a design block containing figma.com URLs.

## Minimal GET example

```json
{
  "feature": "ItemHistory",
  "mode": "create",
  "appHost": "https://api.example-app.test/mobile/",
  "endpoints": [{
    "action": "getItemHistory",
    "method": "GET",
    "path": "/v1/items/{id}/history",
    "pathParams": [{ "name": "id", "type": "string" }],
    "queryParams": [],
    "hostType": "app",
    "baseUrl": null,
    "headers": [],
    "requestSample": null,
    "requestFieldSources": {},
    "responseSample": [{ "EventId": 3, "OccurredAt": "2025-03-01T09:30:00Z" }],
    "typeOverrides": {},
    "dateFields": ["OccurredAt"],
    "statusEnum": null,
    "userStory": null,
    "rules": []
  }]
}
```

See [examples/feature-spec.example.json](examples/feature-spec.example.json) for the full
2-endpoint case (external POST with env headers + provenance + statusEnum, app GET with query
params and an array response).
