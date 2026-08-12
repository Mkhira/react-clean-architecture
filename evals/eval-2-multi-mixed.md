# Eval 2 — multi mode, mixed hosts (app POST + external GET with query params)

New feature `ShipmentTracking`, two endpoints entered in multi mode; verifies the summary/edit
step, the mixed-host service (both transports side by side), and the ctor gaining
`configService`. All values fabricated.

## User inputs

Endpoint 1 (app host — the curl targets whatever `EXPO_PUBLIC_API_URL` is in the repo's
`.env.development` at eval time, written here as `<APP_HOST><APP_BASE_PATH>`; note the base
path prefix must be STRIPPED from the stored path):

```
curl --location '<APP_HOST><APP_BASE_PATH>/v1/shipments/track' \
--header 'Content-Type: application/json' \
--data '{"TrackingNumber":"TRK123456","RequestedAt":"2025-01-01T00:00:00Z"}'
```

Response: `{ "ShipmentStatus": "IN_TRANSIT", "LastLocation": "Riyadh Hub", "UpdatedAt": "2025-01-02T08:00:00Z" }`
Provenance: TrackingNumber → input · RequestedAt → timestamp. Story: "track a shipment by
tracking number; number is required non-empty".

Endpoint 2 (external GET with query params):

```
curl 'https://logistics.example-partner.test/api/v1/shipments/events?from=2025-01-01&limit=20' \
--header 'x-api-key: demo-partner-key'
```

Response: top-level array `[{ "EventCode": "DEP", "EventTime": "2025-01-01T12:00:00Z" }]`.
Headers: x-api-key → `env` (`EXPO_PUBLIC_SHIPMENT_TRACKING_API_KEY`). Query params `from`,
`limit` confirmed dynamic. Story skipped.

Multi-mode flow: after endpoint 1 → "next"; after endpoint 2 → "submit" → summary table shown →
user says "edit #2" changing `limit` type to `number` → regenerated summary → confirm.

## Expected artifacts

- One `ShipmentTrackingService` with BOTH transports: axios post for `trackShipment`,
  fetch + AbortController for `getShipmentEvents` (query string URL-appended with
  `encodeURIComponent`); ctor `(httpClient, configService)`.
- `EXPO_PUBLIC_SHIPMENT_TRACKING_BASE_URL` + `..._API_KEY` wired to config + six env files.
- DI: service/repository + 2 use cases; second use case typed with an array entity.

## Pass criteria

audit PASS · tsc diff 0 · jest green · summary/edit step actually shown before generation.
