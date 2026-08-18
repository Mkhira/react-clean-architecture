#!/usr/bin/env node
/**
 * rollback.js — undo a generation run using .claude-skill-manifest.json.
 * Node stdlib only.
 *
 * Usage:
 *   node rollback.js [--repo <path>]            dry run: print what WOULD happen
 *   node rollback.js [--repo <path>] --apply    actually delete/restore
 *   node rollback.js --help
 *
 * What it does (manifest-scoped ONLY — never touches anything else):
 *   - deletes every file in the manifest's `created` list (+ prunes empty dirs
 *     left behind inside the feature directory)
 *   - restores every file in `patched` via `git checkout -- <file>`
 *   - on --apply success, removes the manifest and the tsc baseline file
 *
 * Reliable only when the tree was clean before generation (SKILL.md step 1
 * warns about this): `git checkout` restores the last committed state, so any
 * pre-existing uncommitted edits to a patched file are lost with it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HELP = `rollback.js — undo a generation run using .claude-skill-manifest.json.

Usage:
  node rollback.js [--repo <path>]           dry run (default): print the plan
  node rollback.js [--repo <path>] --apply   delete created files + git-restore patched ones
  node rollback.js --help

Only files listed in the manifest are touched. Patched files are restored with
\`git checkout --\`, so a clean pre-generation tree is required for a faithful undo.`;

const MANIFEST_FILE = '.claude-skill-manifest.json';
const BASELINE_FILE = '.claude-skill-tsc-baseline.json';

function pruneEmptyDirs(startDir, stopDir) {
    let current = startDir;
    while (current.startsWith(stopDir)) {
        try {
            if (fs.readdirSync(current).length > 0) return;
            fs.rmdirSync(current); // the (now-empty) feature root itself is pruned too
        } catch {
            return;
        }
        if (current === stopDir) return;
        current = path.dirname(current);
    }
}

function main() {
    const argv = process.argv.slice(2);
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(HELP);
        return 0;
    }
    const repoIndex = argv.indexOf('--repo');
    const repo = repoIndex >= 0 ? path.resolve(argv[repoIndex + 1]) : process.cwd();
    const apply = argv.includes('--apply');

    const manifestPath = path.join(repo, MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) {
        console.error(`rollback.js: ${MANIFEST_FILE} not found in ${repo} — nothing to roll back.`);
        return 1;
    }
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
        console.error(`rollback.js: ${MANIFEST_FILE} is unreadable (${error.message}) — roll back by hand.`);
        return 1;
    }

    const created = manifest.created ?? [];
    const patched = manifest.patched ?? [];
    const featureRoot = path.join(repo, 'src', 'features', manifest.feature ?? '');
    const report = { mode: apply ? 'apply' : 'dry-run', feature: manifest.feature, deleted: [], restored: [], problems: [] };

    for (const relative of created) {
        const absolute = path.join(repo, relative);
        if (!fs.existsSync(absolute)) continue;
        if (apply) {
            fs.rmSync(absolute);
            pruneEmptyDirs(path.dirname(absolute), featureRoot);
        }
        report.deleted.push(relative);
    }

    if (patched.length) {
        const gitCheck = spawnSync('git', ['-C', repo, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
        if (gitCheck.status !== 0) {
            report.problems.push(`not a git repository — restore these by hand: ${patched.join(', ')}`);
        } else if (apply) {
            for (const relative of patched) {
                const result = spawnSync('git', ['-C', repo, 'checkout', '--', relative], { encoding: 'utf8' });
                if (result.status === 0) report.restored.push(relative);
                else report.problems.push(`git checkout failed for ${relative}: ${(result.stderr ?? '').trim()}`);
            }
        } else {
            report.restored.push(...patched);
        }
    }

    if (apply && !report.problems.length) {
        fs.rmSync(manifestPath);
        const baselinePath = path.join(repo, BASELINE_FILE);
        if (fs.existsSync(baselinePath)) fs.rmSync(baselinePath);
    }

    console.log(JSON.stringify(report, null, 2));
    if (!apply) console.log('\nDry run only — re-run with --apply to execute.');
    return report.problems.length ? 2 : 0;
}

if (require.main === module) {
    process.exit(main());
}
