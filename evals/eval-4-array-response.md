# Eval 4 — GET with path param + top-level array response

New feature `AuditTrail`, single app-host GET; verifies function endpoint entries, array
DTO/entity generation, and that no RequestDTO is emitted.

## User inputs

Manual path (user says they have no curl):
- URL: app host, path `/v1/audit/{entityId}/events`, `entityId` dynamic (string).
- Method GET, no request body, no query params, no custom headers.
- Response body:

```json
[
  { "EventId": 1, "Actor": "user-7", "Action": "CREATED", "At": "2025-02-01T10:00:00Z" },
  { "EventId": 2, "Actor": "user-9", "Action": "UPDATED", "At": "2025-02-02T11:30:00Z", "Note": "price fix" }
]
```

- `At` confirmed as a date field; `Note` appears only in some items (merged → optional).
- Story: "show the audit trail for an entity, newest first" → rule: "sort by At descending".

## Expected artifacts

- `GetAuditEventsDTO.ts`: `GetAuditEventsResponseItemDTO` (with `Note?: string`) +
  `GetAuditEventsResponseDTO = GetAuditEventsResponseItemDTO[]`. **No RequestDTO.**
- Entity: `GetAuditEventsItem` + `GetAuditEventsResult = GetAuditEventsItem[]` +
  `GetAuditEventsInput = { entityId: string }`.
- `endpoints.ts`: `` GET_AUDIT_EVENTS: (entityId: string) => `/v1/audit/${entityId}/events` ``
- Mapper: `toDomain` only (`dto.map(...)`, `At` through `formatDateTimeDateMonthYear`).
- Use case: `IUseCase<GetAuditEventsInput, Result<GetAuditEventsResult, AuditTrailError>>`;
  Claude implements the descending sort rule + its test.
- Mapper test mocks the `@shared/components` barrel (date field present) and asserts the
  mapped first item.

## Pass criteria

audit PASS · tsc diff 0 · jest green · no `RequestDTO`/`toDTO` anywhere in the feature.
