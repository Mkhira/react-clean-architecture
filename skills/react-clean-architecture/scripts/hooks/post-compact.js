#!/usr/bin/env node
'use strict';
/**
 * post-compact.js — PostCompact hook.
 *
 * After a compaction the chat detail is gone; SKILL.md says "re-read the spec,
 * the manifest and your todo state". This re-injects the exact paths and the
 * screen progress as additionalContext, so the resume never depends on the
 * summary having kept them. Silent outside a skill run.
 */
const path = require('path');
const { readStdin, findRun, screenProgress, emit } = require('./_common.js');

function main() {
    const input = readStdin();
    const run = findRun(input.cwd);
    if (!run) return;
    const rel = (file) => (file ? path.relative(run.repo, file) || file : '(not on disk)');
    const mode = (run.manifest && run.manifest.mode) || 'unknown';
    const feature = (run.manifest && run.manifest.feature) || (run.spec && run.spec.feature) || 'unknown';
    const progress = screenProgress(run.spec);
    const screens = progress.total ? `${progress.pending} pending / ${progress.verified} verified of ${progress.total}` : 'none recorded';
    emit({
        hookSpecificOutput: {
            hookEventName: 'PostCompact',
            additionalContext:
                `react-clean-architecture resume — feature=${feature} mode=${mode} ` +
                `spec=${rel(run.specPath)} manifest=${rel(run.manifestPath)} screens=${screens}. ` +
                'Re-read the spec and the manifest before continuing; your todo-tool checklist state is authoritative for which step is next. ' +
                (run.specPath ? '' : 'The spec is NOT on disk — recover it from the summary and persist it before anything else. '),
        },
    });
}

if (require.main === module) main();
