# Decision & live-finding history

Project history moved out of the operational docs (SKILL.md / DESIGN.md) so runs don't
carry it in context. The RULES these produced still live in the operational docs — this
file only records where they came from. Never load this during a feature run.

- **2026-08-16 — design lane confirmed** (iOS-simulator verification, Arabic-first RTL,
  auto icon export, screen-by-screen checkpoints, per-endpoint cache question,
  auto-registration of navigation, feature-local new components).
- **2026-08-17 — flow-description intake is PRIMARY (Step 2c style A).** First real user
  test (Dashboard/PayBill): 4 pasted links were 4 flow screens; the labeled-links loop
  misread them as 1 screen + 3 components. Narrated-flow parsing + transition edges added;
  bare-links loop demoted to fallback with the multi-full-frame guard.
- **2026-08-17 — service-card questionnaire RETIRED.** The user rejected the 6-question
  cost/serviceTypes/userTypes/fees/processingTime/Home-shortcut interrogation; defaults are
  shown as one summary-table row instead.
- **2026-08-17 — NO token limits in the skill.** A token-discipline section (Figma fetch
  caps, grep-only COMPONENTS.md) was added and fully REVERTED on user direction: quality,
  completeness, and accuracy always win over token cost. Never re-add read-budgets or fetch
  caps. (Re-confirmed 2026-08-22 during the token-optimization review: full reference reads
  and the one-question-per-message intake both stay.)
- **2026-08-19 — test infra is AUTOMATIC.** setup-test-infra.js runs in Step 1 with no
  question; on install failure the run continues with logic-level tests and says so.
- **2026-08-19 — cache question spells out both cache layers.** Live finding: a user who
  answered "no" was surprised react-query still answered from memory (~5 min app-wide
  default) — the question text now explains no/always-fresh/persistent explicitly.
- **2026-08-19 — v1.8.0 closed the external architecture review** (domain purity via
  mapper.toDTO in the service, arch-boundaries audit check, error taxonomy).
- **2026-08-22 — token-optimization pass (v1.9.0).** Applied: SKILL.md slimmed into more of
  a router (append/lifecycle/screen-collection moved to APPEND.md, LIFECYCLE.md, and
  DESIGN.md; history moved here); generate.js/register-di.js print compact summaries (full
  manifest on disk); audit.js collapses passing checks to one line (WARN/FAIL stay verbose).
  Rejected (user-confirmed): grouped intake, grep-only reference loading, shorter cache
  question, fewer confirmation tables, compressed final report, splitting DESIGN.md.
- **2026-08-22 — mandatory compaction checkpoints (v1.9.1).** User directive: the agent
  must PAUSE and ask the user to run the host's context-compaction command (Claude Code /
  Codex CLI → `/compact`, Cursor → `/summarize`, Gemini CLI → `/compress`, other hosts →
  their equivalent) at three points — after the final intake confirmation before any
  implementation, after every per-screen checkpoint, and after the test/audit phase passes.
  State must be on disk before each pause; a host with no such command → skip, never block.
- **2026-08-22 — navigation registration scripted (v1.10.0).** DESIGN.md §5's nine hand
  edits became `register-navigation.js` (routes, page registry, SERVICES_DATA from
  design.serviceCard, deep-link aliases, translation placeholders, route file, feature
  routes.ts, manifest). Chosen as the token optimization after the compaction checkpoints:
  saves ~7 read+edit round trips per design run and removes the most error-prone manual
  step. Verified against copies of the real zatcaReact files before landing. The verifier
  subagent idea (recommendation #1 of the same review) was explicitly deferred by the user
  ("do 2 only").
- **2026-08-22 — layout aligned with repo convention (v1.11.0).** PR #305 review
  (WalidAzgear) surfaced that skill output diverged from the codebase's dominant layout,
  which integrated-tariff documents: the service interface is a data-layer contract →
  `data/services/I<F>Service.ts`; `domain/repositories/` (not IRepositories);
  `domain/use-cases/` (not usecases). Templates + register-di + audit + examples updated;
  migrate-feature.js relocates old-layout features (content-preserved moves + import
  rewrites in hand-written files). Signatures still entity-only — never DTOs.
