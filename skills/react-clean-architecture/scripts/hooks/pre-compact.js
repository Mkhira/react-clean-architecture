#!/usr/bin/env node
'use strict';
/**
 * pre-compact.js — PreCompact hook (matcher: manual).
 *
 * SKILL.md's compaction checkpoints promise that everything needed to resume
 * is on disk before the user runs /compact. This is the mechanical backstop:
 * while a skill run is in progress (manifest present) and NO spec is on disk
 * — not the path generate.js recorded, not a persisted feature-spec.json —
 * the compaction is refused with the reason, so the model persists the spec
 * first. Outside a run, or when the spec is there, exit 0 silently.
 *
 * Only manual compactions are wired (auto = context already full; refusing it
 * would strand the session).
 */
const { readStdin, findRun, emit } = require('./_common.js');

function main() {
    const input = readStdin();
    const run = findRun(input.cwd);
    if (!run) return; // not a skill run
    if (run.specPath) return; // resume artifact present
    emit({
        decision: 'block',
        reason:
            'react-clean-architecture: a skill run is in progress (.claude-skill-manifest.json) but no spec is on disk — ' +
            'persist it first (audit.js --persist-spec, or write the design record to src/features/<feature-dir>/feature-spec.json), ' +
            'name its path in the pause message, then compact.',
    });
}

if (require.main === module) main();
