# `feature-spec.json` format

The single input to `generate.js`, `register-di.js`, and `audit.js`. Claude writes it after the
interactive intake; `audit.js --persist-spec` later stores a **sanitized** copy (secrets
replaced by `<env:KEY>` references) at `src/features/<Feature>/feature-spec.json` for append
mode and documentation.

## Top level

| Field | Type | Notes |
|---|---|---|
| `feature` | string | PascalCase. Grep `tokens.ts`/`container.ts` for collisions first |
| `mode` | `"create"` \| `"append"` | append = feature dir already exists (anchors expected) |
| `appHost` | string | `EXPO_PUBLIC_API_URL` as read from `.env.development` at spec time |
| `endpoints` | Endpoint[] | one entry per endpoint |

## Endpoint

| Field | Type | Notes |
|---|---|---|
| `action` | string | camelCase verb — becomes the service/repo method and `<Action>UseCase` |
| `method` | `GET` \| `POST` \| `PUT` \| `DELETE` | PUT/DELETE need `IHttpClient` uncommented (manual, see SKILL.md) |
| `path` | string | path only, query split out; app-host paths have the base-URL prefix stripped; `{param}` segments allowed |
| `pathParams` | `{name, type}[]` | produces a function entry in endpoints.ts: `` KEY: (id: string) => `/v1/x/${id}` `` |
| `queryParams` | `{name, type}[]` | app host → axios `config.params`; external → URL-appended with `encodeURIComponent` |
| `hostType` | `"app"` \| `"external"` | app = axios `IHttpClient`; external = `fetch` + AbortController + `AppConfig.timeout` |
| `baseUrl` | object \| null | external only — see below |
| `headers` | Header[] | external/custom only — see below |
| `requestSample` | object \| null | raw pasted request JSON; null = no body |
| `requestFieldSources` | map | provenance per request field — see below |
| `responseSample` | object \| array \| null | raw pasted JSON; `[…]` = top-level array; null = "none" → `Result<void, E>` |
| `typeOverrides` | map | answers to ambiguity questions — see below |
| `dateFields` | string[] | dot-paths formatted with `formatDateTimeDateMonthYear` in the mapper |
| `statusEnum` | `{field, values[]}` \| null | emits the union type; the DERIVATION is hand-written (TODO in mapper, audit-enforced) |
| `userStory` | string \| null | kept as doc comment; drives rules + Arabic strings |
| `rules` | string[] | short rule statements → TODO bullets in the use case + tests |

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
| `"device"` | `getDeviceInfo()` via the repository's `getDeviceMetadata()` (id/name/os/osVersion/language matched by field-name suffix) |
| `"timestamp"` | `new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')` at call time |
| `{ "constant": X }` | the literal `X` |
| `"session"` | input field + `// TODO: from auth session` |

### `typeOverrides`

Dot-paths from the response root. Values: `"nullable"` (inferred → `| null`),
`"string|null"`, `"date|null"` (string in the DTO — formatting is the mapper's job),
`"string[]"`, or any verbatim TS type. Unanswered `null`/`[]` fields become `unknown` /
`unknown[]` plus an audit warning.

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
