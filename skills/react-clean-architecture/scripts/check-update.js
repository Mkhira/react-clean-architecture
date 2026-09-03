#!/usr/bin/env node
/**
 * check-update.js — is the installed skill the latest release?
 *
 * Run at Step 0 of every skill run. It compares the local SKILL_VERSION against
 * the newest `v*` tag on the GitHub repo and, when the local copy is behind,
 * prints the exact update command for THIS install (plugin / symlinked clone /
 * copy). The skill has no dismissal state on purpose: the notice repeats on
 * every run until the versions match, because a stale copy silently runs old
 * generators against a repo the newer version knows more about.
 *
 * Never fatal. No network, no git, a private/renamed repo, a firewall → SKIPPED
 * and the run continues unaffected.
 *
 *   node check-update.js              → check (uses a short-lived cache)
 *   node check-update.js --force      → ignore the cache, ask GitHub now
 *   node check-update.js --no-network → cache only; SKIPPED when there is none
 *   node check-update.js --strict     → exit 1 when an update exists
 *
 * Exit 0 = checked (up to date, behind, or skipped) · 1 = --strict and behind ·
 * 2 = bad usage.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { SKILL_VERSION } = require('./generate.js');

const REPO = 'https://github.com/Mkhira/react-clean-architecture';
const CHANGELOG = `${REPO}/blob/main/CHANGELOG.md`;
const UPDATE_DOCS = `${REPO}#update`;
/**
 * Three names, deliberately distinct:
 *   SKILL_NAME       the skill directory + the GitHub repo (npx skills, cache dir)
 *   PLUGIN_NAME      the Claude Code plugin — appears as /<plugin>:<skill>
 *   MARKETPLACE_NAME the marketplace users `add`ed (kept = the repo name, so an
 *                    already-added marketplace keeps working across the rename)
 */
const SKILL_NAME = 'react-clean-architecture';
const PLUGIN_NAME = 'react-clean-plugin';
const MARKETPLACE_NAME = 'react-clean-architecture';
/** How long a GitHub answer is reused. The NOTICE still prints every run. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const HELP = `check-update.js — is this skill copy the latest release?

Usage:
  node check-update.js [--force] [--no-network] [--strict] [--cache <path>]
      --force        ignore the cached answer and ask GitHub now
      --no-network   use the cached answer only; SKIPPED when there is none
      --strict       exit 1 when an update is available (default: always 0)
      --cache <path> override the cache file (testing / sandboxes)
  node check-update.js --help

Prints UPDATE AVAILABLE / UP TO DATE / UPDATE CHECK SKIPPED as the first word.
Being behind is information, not a failure — the run continues either way.`;

// ------------------------------------------------------------- versions ----

/** [major, minor, patch] from `v1.17.0`, `1.17.0`, `1.18.0-rc.1`. null if unparsable. */
function parseVersion(value) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? '').trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** -1 / 0 / 1, comparing release numbers only (a prerelease suffix is ignored). */
function compareVersions(a, b) {
    const left = parseVersion(a);
    const right = parseVersion(b);
    if (!left || !right) return 0;
    for (let i = 0; i < 3; i += 1) {
        if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
    }
    return 0;
}

/** Highest `refs/tags/vX.Y.Z` in `git ls-remote` output. Ignores prereleases. */
function latestTag(lsRemoteOutput) {
    let best = null;
    for (const line of String(lsRemoteOutput || '').split('\n')) {
        const match = /refs\/tags\/(v\d+\.\d+\.\d+)\s*$/.exec(line.trim());
        if (!match) continue;
        const tag = match[1];
        if (best === null || compareVersions(tag, best) > 0) best = tag;
    }
    return best ? best.replace(/^v/, '') : null;
}

// -------------------------------------------------------- install shape ----

/** `<skill>/scripts/check-update.js` → `<skill>`. */
function skillDirOf(file) {
    return path.dirname(path.dirname(file));
}

/** `<clone>/skills/<skill>` → `<clone>`, where a .git would live. */
function cloneRootOf(file) {
    return path.resolve(skillDirOf(file), '..', '..');
}

/**
 * Which install produced the copy being run — decided from paths, never from
 * the network. `invoked` is the path Claude called (symlinks intact, from
 * argv[1]); `real` is where the files actually live (Node resolves __filename).
 */
function installKind(invoked, real) {
    const invokedSkill = skillDirOf(invoked);
    const realSkill = skillDirOf(real);
    const segments = invokedSkill.split(path.sep);
    if (segments.includes('plugins') || segments.includes('marketplaces')) return 'plugin';
    const isClone = fs.existsSync(path.join(cloneRootOf(real), '.git'));
    if (invokedSkill !== realSkill) return isClone ? 'symlink' : 'copy';
    return isClone ? 'clone' : 'copy';
}

function updateSteps(kind, real) {
    const cloneRoot = cloneRootOf(real);
    switch (kind) {
        case 'plugin':
            return {
                label: 'Claude Code plugin',
                steps: [
                    `/plugin marketplace update ${MARKETPLACE_NAME}`,
                    `/plugin update ${PLUGIN_NAME}`,
                    '(the marketplace refresh must come first — it is what carries the new version;',
                    ' restart Claude Code afterwards so the new files load)',
                ],
            };
        case 'symlink':
            return {
                label: `symlinked clone at ${cloneRoot}`,
                steps: [`git -C ${cloneRoot} pull`, '(the symlink means that is the whole update — nothing to re-copy)'],
            };
        case 'clone':
            return {
                label: `git clone at ${cloneRoot}`,
                steps: [`git -C ${cloneRoot} pull`],
            };
        default:
            return {
                label: 'copied files (npx skills, install.sh --copy, Cursor/Codex, or a manual copy)',
                steps: [
                    `npx skills@latest add Mkhira/${SKILL_NAME}`,
                    `— or: git pull in your clone, then re-run ./install.sh <target> exactly as you did originally`,
                ],
            };
    }
}

// ------------------------------------------------------------- the check ----

/** Plugin installs get Claude Code's per-plugin data dir; everything else ~/.cache. */
function defaultCachePath(env = process.env) {
    // Only trust the plugin data dir when it is OURS — inside a hook, Claude Code
    // 2.1.259 was observed handing skill hooks another plugin's CLAUDE_PLUGIN_DATA.
    if (env.CLAUDE_PLUGIN_DATA && env.CLAUDE_PLUGIN_DATA.includes(PLUGIN_NAME)) return path.join(env.CLAUDE_PLUGIN_DATA, 'update-check.json');
    return path.join(os.homedir(), '.cache', SKILL_NAME, 'update-check.json');
}

function readCache(file, now) {
    try {
        const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (typeof cached.latest !== 'string') return null;
        if (!Number.isFinite(cached.checkedAt) || now - cached.checkedAt > CACHE_TTL_MS) return null;
        return cached.latest;
    } catch {
        return null;
    }
}

function writeCache(file, latest, now) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ latest, checkedAt: now, repo: REPO }, null, 2));
    } catch {
        // A read-only home is not a reason to fail a feature run.
    }
}

/** The newest published tag, or null when GitHub could not be reached. */
function fetchLatest() {
    const result = spawnSync('git', ['ls-remote', '--tags', '--refs', REPO, 'v*'], {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
    });
    if (result.status !== 0) return null;
    return latestTag(result.stdout);
}

function main(argv) {
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(HELP);
        return 0;
    }
    const cacheIndex = argv.indexOf('--cache');
    if (cacheIndex >= 0 && !argv[cacheIndex + 1]) {
        console.error('check-update.js: --cache needs a path');
        return 2;
    }
    const cacheFile = cacheIndex >= 0 ? path.resolve(argv[cacheIndex + 1]) : defaultCachePath();
    const force = argv.includes('--force');
    const offline = argv.includes('--no-network');
    const strict = argv.includes('--strict');

    const now = Date.now();
    let latest = force ? null : readCache(cacheFile, now);
    if (latest === null && !offline) {
        latest = fetchLatest();
        if (latest !== null) writeCache(cacheFile, latest, now);
    }

    if (latest === null) {
        console.log(
            `UPDATE CHECK SKIPPED — could not reach ${REPO} (offline, or git is unavailable).\n` +
                `Installed version: ${SKILL_VERSION}. The run is unaffected; continue with Step 0.`
        );
        return 0;
    }

    const order = compareVersions(SKILL_VERSION, latest);
    if (order > 0) {
        console.log(
            `UP TO DATE — react-clean-architecture ${SKILL_VERSION}, ahead of the latest release (${latest}).\n` +
                'This is a development checkout; nothing to update.'
        );
        return 0;
    }
    if (order === 0) {
        console.log(`UP TO DATE — react-clean-architecture ${SKILL_VERSION} is the latest release.`);
        return 0;
    }

    const real = fs.realpathSync(__filename);
    const invoked = path.resolve(process.argv[1] || real);
    const { label, steps } = updateSteps(installKind(invoked, real), real);
    console.log(
        [
            `UPDATE AVAILABLE — react-clean-architecture ${SKILL_VERSION} → ${latest}`,
            `This install: ${label}`,
            'Update with:',
            ...steps.map((step) => `  ${step}`),
            `What changed: ${CHANGELOG}`,
            `Other install paths: ${UPDATE_DOCS}`,
            '',
            'TELL THE USER THIS NOW, before the first question, in your own words — version,',
            'command, and that the run continues either way. It is a notice, not a blocker:',
            'never stop the run for it, and never update the skill on their behalf.',
            'There is no dismissal — say it again on every run until the versions match.',
        ].join('\n')
    );
    return strict ? 1 : 0;
}

if (require.main === module) {
    // NOT process.exit(): stdout writes to a PIPE are asynchronous and exiting
    // truncates whatever is still buffered.
    process.exitCode = main(process.argv.slice(2));
}

module.exports = { parseVersion, compareVersions, latestTag, installKind, updateSteps, skillDirOf, cloneRootOf, defaultCachePath, main, SKILL_VERSION, CACHE_TTL_MS, SKILL_NAME, PLUGIN_NAME, MARKETPLACE_NAME };
