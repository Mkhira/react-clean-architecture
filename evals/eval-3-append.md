# Eval 3 — append an endpoint to the feature from eval 1

Verifies: persisted-spec loading, anchor inserts with import back-fill, idempotent DI, no
overwrites.

## Setup

Run eval 1 to completion first (`ProductVerification` exists, anchors + sanitized
`feature-spec.json` present).

## User input

"Add an endpoint to ProductVerification": app-host GET `/v1/items/{id}/history` (path param
`id` confirmed dynamic), response
`[{ "EventId": 3, "EventName": "SCANNED", "OccurredAt": "2025-03-01T09:30:00Z" }]`,
`OccurredAt` is a date field. Story skipped.

## Expected behavior

1. The skill loads `src/features/ProductVerification/feature-spec.json` FIRST — no re-asking
   about hosts/headers/provenance for existing endpoints.
2. Spec `mode: "append"` with only the new endpoint.
3. `generate.js`: creates ONLY the 6 per-endpoint files (DTO, mapper, entity, use case,
   2 tests); patches endpoints.ts / service / repository / both interfaces at their anchors,
   adding the new imports; touches nothing else; overwrites nothing.
4. `endpoints.ts` gains a function entry: `` GET_ITEM_HISTORY: (id: string) => `/v1/items/${id}/history`, ``
5. `register-di.js`: exactly the new use-case token/registry/import/registration inserted;
   every prior insertion reported as skipped (idempotent).
6. Re-running both scripts changes nothing (skipped/idempotent all the way).

## Pass criteria

audit (append spec) PASS · tsc diff 0 · all feature suites (old + new) green ·
`git diff --stat` shows no modifications outside the feature dir + DI files.

## Also verify (pre-skill fallback)

Ask to append to `TaxStampValidation` (pre-skill, no anchors): scripts must report
NEEDS_MANUAL and Claude must fall back to hand edits matching THAT feature's own conventions —
no anchor-style insertions attempted.
