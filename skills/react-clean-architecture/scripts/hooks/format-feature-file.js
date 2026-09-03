#!/usr/bin/env node
'use strict';
/**
 * format-feature-file.js — PostToolUse hook (matcher: Edit|Write).
 *
 * Runs the target repo's prettier on every .ts/.tsx the model writes under
 * src/features/ or app/service-flow/, so hand-written use cases, mappers and
 * screens land already formatted (REVIEW.md: reviewers reject formatting
 * diffs). Uses the repo's own config via `npx prettier`; any failure — no
 * prettier, syntax error mid-edit, timeout — is swallowed: formatting is a
 * convenience, never a blocker. Emits nothing.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { readStdin } = require('./_common.js');

function shouldFormat(file, repo) {
    if (!file || !/\.(ts|tsx)$/.test(file)) return false;
    const relative = path.relative(repo, path.resolve(repo, file));
    if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
    return /^(src\/features|app\/service-flow)\//.test(relative.split(path.sep).join('/'));
}

function main() {
    const input = readStdin();
    const repo = input.cwd || process.cwd();
    const file = input.tool_input && input.tool_input.file_path;
    if (!shouldFormat(file, repo)) return;
    if (process.env.RCA_HOOK_DRY_RUN) {
        process.stdout.write(`would format ${path.relative(repo, path.resolve(repo, file))}\n`);
        return;
    }
    try {
        spawnSync('npx', ['--no-install', 'prettier', '--write', path.resolve(repo, file)], {
            cwd: repo,
            stdio: 'ignore',
            timeout: 15000,
        });
    } catch {
        // formatting is best-effort
    }
}

if (require.main === module) main();
module.exports = { shouldFormat };
