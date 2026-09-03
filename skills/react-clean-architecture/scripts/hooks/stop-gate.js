#!/usr/bin/env node
'use strict';
/**
 * stop-gate.js — Stop hook (command hook: deterministic, never a model call).
 *
 * The skill is interactive: it stops to ask a question dozens of times per
 * run, and three times it stops on purpose to ask for /compact. None of that
 * may be blocked. So the gate is narrow — it only re-checks the definition of
 * done when ALL of these hold:
 *
 *   1. a skill run is in progress (manifest in cwd)
 *   2. the last assistant message is not one of the skill's own pauses and
 *      does not end on a question (see _common.isLegitimateStop)
 *   3. stop_hook_active is false (never loop)
 *
 * and then blocks only for things AUDIT.md / DESIGN.md §7 say must be done
 * before a run is reported finished:
 *
 *   - working files (.claude-skill-tsc-baseline.json / the manifest) still in
 *     the repo root after the run's implementation phase is over — i.e. the
 *     spec is persisted and either has no design block or every screen is
 *     "verified" (mid-lane the files are legitimately kept, DESIGN.md §7)
 *   - `TODO(claude):` left in the feature's own files — status derivation,
 *     business rules, mock catalog (the audit fails on them too)
 *   - COMPONENTS.md drift ≠ 0 (AUDIT.md: WARN, "but you MUST still write the
 *     missing entries before reporting the run finished")
 *
 * Output on block: {"decision":"block","reason":…} (exit 0), listing what is
 * left. Everything else: exit 0, no output.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
    readStdin,
    findRun,
    screenProgress,
    lastAssistantText,
    isLegitimateStop,
    BASELINE_FILE,
    MANIFEST_FILE,
    SKILL_DIR,
    emit,
} = require('./_common.js');

function walk(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
}

function leftoverTodos(repo, featureDir) {
    if (!featureDir) return [];
    const root = path.join(repo, 'src', 'features', featureDir);
    return walk(root)
        .filter((file) => {
            try {
                return /TODO\(claude\)/.test(fs.readFileSync(file, 'utf8'));
            } catch {
                return false;
            }
        })
        .map((file) => path.relative(repo, file));
}

function componentsDrift(repo) {
    const script = path.join(SKILL_DIR, 'scripts', 'check-components-md.js');
    const result = spawnSync('node', [script, '--repo', repo], { encoding: 'utf8', timeout: 15000 });
    if (result.status !== 0 || !result.stdout) return 0; // no shared components / script error → not this hook's problem
    const match = result.stdout.match(/components-md: \d+ components, (\d+) drift/);
    return match ? Number(match[1]) : 0;
}

function implementationFinished(run) {
    if (!run.spec) return false; // spec not persisted → audit has not passed yet
    const progress = screenProgress(run.spec);
    return progress.total === 0 || progress.pending === 0;
}

function main() {
    const input = readStdin();
    if (input.stop_hook_active) return;
    const run = findRun(input.cwd);
    if (!run) return;
    if (isLegitimateStop(lastAssistantText(input.transcript_path))) return;

    const left = [];
    if (implementationFinished(run)) {
        const working = [BASELINE_FILE, MANIFEST_FILE].filter((file) => fs.existsSync(path.join(run.repo, file)));
        if (working.length) left.push(`working files still in the repo root: ${working.join(', ')} (AUDIT.md "After PASS" / DESIGN.md §7 — delete them last, they are not for commit)`);
    }
    const featureDir = run.manifest && run.manifest.featureDir;
    const todos = leftoverTodos(run.repo, featureDir);
    if (todos.length) left.push(`TODO(claude) still in: ${todos.slice(0, 5).join(', ')}${todos.length > 5 ? ` (+${todos.length - 5})` : ''}`);
    const drift = componentsDrift(run.repo);
    if (drift) left.push(`COMPONENTS.md drift: ${drift} component(s) without an entry (DESIGN.md "Keeping COMPONENTS.md current")`);

    if (!left.length) return;
    emit({
        decision: 'block',
        reason: `react-clean-architecture: the run is not finished — ${left.join('; ')}. Finish these (or ask the user how to proceed) before stopping.`,
    });
}

if (require.main === module) main();
module.exports = { leftoverTodos, implementationFinished };
