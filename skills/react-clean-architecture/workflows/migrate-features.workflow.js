// migrate-features.workflow.js — Claude Code dynamic workflow (LIFECYCLE.md "Migrate at scale").
//
// Run from the TARGET repo root with a clean git tree:
//   Workflow({ scriptPath: "<skill>/workflows/migrate-features.workflow.js",
//              args: { skillDir: "<skill>", features: [{ name: "OrderTracking", specPath: "src/features/order-tracking/feature-spec.json" }, …] } })
//
// One agent per feature, no barrier between stages: dry-run → (drift / design-only gate is
// migrate-feature.js's own) → --apply → audit.js → fix-cycles (machine-owned files only) →
// an adversarial reviewer that tries to prove the migration touched hand-written code.
// Plain JavaScript; no filesystem access here — every check runs inside an agent.

export const meta = {
  name: 'rca-migrate-features',
  description: 'Migrate every skill-generated feature to the current react-clean-architecture templates, audit each, and adversarially review each diff',
  whenToUse: 'After a react-clean-architecture template change, from the target repo root, with a clean git tree',
  phases: [
    { title: 'Baseline', detail: 'tsc baseline once, before any file changes' },
    { title: 'Migrate', detail: 'one agent per feature: dry-run, apply, audit, fix-cycles' },
    { title: 'Verify', detail: 'one skeptic per migrated feature: only machine-owned files changed' },
  ],
}

const SKILL = args && args.skillDir
const FEATURES = args && Array.isArray(args.features) ? args.features : null
if (!SKILL || !FEATURES || !FEATURES.length) {
  throw new Error('args must be { skillDir: "<absolute skill dir>", features: [{ name, specPath }, …] }')
}

const MACHINE_OWNED =
  'data/endpoints/, data/services/<Feature>Service.ts (NOT the MockService — its catalog is hand-enriched), ' +
  'data/repositories/, data/IServices/, domain/IRepositories/, domain/errors/, and feature-spec.json (skillVersion stamp)'

const RESULT = {
  type: 'object',
  properties: {
    feature: { type: 'string' },
    status: { type: 'string', enum: ['migrated', 'skipped-drift', 'skipped-design-only', 'failed'] },
    auditPass: { type: 'boolean' },
    updated: { type: 'array', items: { type: 'string' } },
    fixCycles: { type: 'integer' },
    problems: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['feature', 'status', 'auditPass', 'updated', 'fixCycles', 'problems', 'notes'],
}

const VERDICT = {
  type: 'object',
  properties: {
    clean: { type: 'boolean' },
    handWrittenTouched: { type: 'array', items: { type: 'string' } },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['clean', 'handWrittenTouched', 'issues'],
}

function migratePrompt(f) {
  return `You are migrating ONE skill-generated feature to the current react-clean-architecture templates. Repo root = cwd. Skill dir = ${SKILL}.
Feature: ${f.name}. Persisted spec: ${f.specPath}.

Steps, in order — stop at the first that says stop:
1. Dry run: node "${SKILL}/scripts/migrate-feature.js" ${f.name}
   - exit 1 mentioning "design-only record" → return status "skipped-design-only". Stop.
   - report.problems containing "spec drift" → return status "skipped-drift" with the problem text verbatim. Do NOT apply. Stop.
   - any other problem → return status "failed" with the problems. Stop.
2. Apply: node "${SKILL}/scripts/migrate-feature.js" ${f.name} --apply
3. Audit: node "${SKILL}/scripts/audit.js" ${f.specPath} (the tsc baseline already exists)
4. On FAIL: at most 3 fix-cycles. You may edit ONLY these machine-owned files: ${MACHINE_OWNED}. Never edit use cases, mappers, tests, presentation, translations, dtos or entities — if the failure needs one of those, stop and return status "failed" saying which file and why.
5. Return the structured result: updated = the report's "updated" list, auditPass = the final audit verdict, fixCycles = how many you ran, notes = one or two lines a reviewer needs (hand-added error codes merged, anything surprising).
Do not commit. Do not touch other features.`
}

function verifyPrompt(f, r) {
  return `Adversarial review of a template migration. Repo root = cwd. Feature: ${f.name}. Skill dir = ${SKILL}.
The migrating agent claims it touched only machine-owned files (${MACHINE_OWNED}) and reports: ${JSON.stringify(r)}.
Try to REFUTE that claim:
- git diff --name-only -- src/features (scoped to this feature's dir): list every changed path that is NOT machine-owned as handWrittenTouched.
- git diff on domain/errors: every error code present in the HEAD version must still be present (hand-added codes are merged, never dropped).
- git diff on data/services/<Feature>MockService.ts must be EMPTY.
- Read ${SKILL}/REVIEW.md and check the regenerated files against its conventions; list violations as issues.
clean = true ONLY if handWrittenTouched and issues are both empty. Default to clean = false when uncertain. Do not edit anything.`
}

phase('Baseline')
const baseline = await agent(
  `Repo root = cwd. Run: node "${SKILL}/scripts/audit.js" --baseline — then return the single summary line it prints. Do nothing else.`,
  { label: 'tsc baseline', effort: 'low' }
)
log(`baseline: ${baseline == null ? 'agent skipped' : String(baseline).trim().slice(0, 120)}`)

const results = await pipeline(
  FEATURES,
  (f) => agent(migratePrompt(f), { label: `migrate:${f.name}`, phase: 'Migrate', schema: RESULT }),
  (r, f) => {
    if (!r || r.status !== 'migrated') return r
    return agent(verifyPrompt(f, r), { label: `verify:${f.name}`, phase: 'Verify', schema: VERDICT, effort: 'high' })
      .then((v) => ({ ...r, verify: v }))
  }
)

const rows = results.filter(Boolean)
const summary = {
  migratedClean: rows.filter((r) => r.status === 'migrated' && r.verify && r.verify.clean).map((r) => r.feature),
  migratedSuspect: rows.filter((r) => r.status === 'migrated' && !(r.verify && r.verify.clean)).map((r) => ({ feature: r.feature, verify: r.verify })),
  skippedDrift: rows.filter((r) => r.status === 'skipped-drift').map((r) => ({ feature: r.feature, problems: r.problems })),
  skippedDesignOnly: rows.filter((r) => r.status === 'skipped-design-only').map((r) => r.feature),
  failed: rows.filter((r) => r.status === 'failed').map((r) => ({ feature: r.feature, problems: r.problems, notes: r.notes })),
  dropped: FEATURES.length - rows.length,
}
if (summary.dropped) log(`${summary.dropped} feature(s) returned nothing (agent skipped or died) — treat as not migrated`)
log(`migrated clean: ${summary.migratedClean.length} · suspect: ${summary.migratedSuspect.length} · drift: ${summary.skippedDrift.length} · design-only: ${summary.skippedDesignOnly.length} · failed: ${summary.failed.length}`)
return summary
