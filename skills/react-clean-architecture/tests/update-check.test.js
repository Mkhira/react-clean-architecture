'use strict';
/**
 * Tests for check-update.js — the Step 0 "is this copy stale?" check (v1.18.0).
 *
 * The properties that matter: it never fails a run (offline is SKIPPED, not an
 * error), it never says "up to date" when it is behind, it prints the command
 * for the install actually being run, and its text tells the agent to repeat
 * the notice every run — the whole point is that there is no dismissal state.
 *
 * No test touches the network: every CLI case is driven through --cache.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    parseVersion,
    compareVersions,
    latestTag,
    installKind,
    updateSteps,
    SKILL_VERSION,
    CACHE_TTL_MS,
} = require('../scripts/check-update.js');
const { spawnSync } = require('child_process');
const { runScript, makeTmpDir, write } = require('./helpers.js');

const SKILL_DIR = path.join(__dirname, '..');
const REPO_ROOT = path.join(SKILL_DIR, '..', '..');

/** A cache file the script will trust, holding `latest`. */
function cacheWith(latest, ageMs = 0) {
    const dir = makeTmpDir('update');
    const file = path.join(dir, 'update-check.json');
    fs.writeFileSync(file, JSON.stringify({ latest, checkedAt: Date.now() - ageMs }));
    return file;
}

/**
 * SKILL_VERSION one minor up / down, so tests never hardcode a release number.
 * Minor, not patch: a released patch is often .0 and there is no .-1.
 */
function shiftVersion(by) {
    const [major, minor, patch] = parseVersion(SKILL_VERSION);
    const shifted = minor + by;
    assert.ok(shifted >= 0, `cannot shift ${SKILL_VERSION} by ${by}`);
    return `${major}.${shifted}.${patch}`;
}

// ------------------------------------------------------------- versions ----

test('parseVersion takes v-prefixed, bare and prerelease strings', () => {
    assert.deepEqual(parseVersion('v1.17.0'), [1, 17, 0]);
    assert.deepEqual(parseVersion('1.17.0'), [1, 17, 0]);
    assert.deepEqual(parseVersion('1.18.0-rc.1'), [1, 18, 0]);
    assert.equal(parseVersion('main'), null);
    assert.equal(parseVersion(undefined), null);
});

test('compareVersions orders by number, not by string', () => {
    assert.equal(compareVersions('1.9.0', '1.10.0'), -1, '1.10 must beat 1.9 — string order would not');
    assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
    assert.equal(compareVersions('1.17.0', 'v1.17.0'), 0);
    // unparsable on either side: treat as equal, never as "you are behind"
    assert.equal(compareVersions('1.17.0', 'nonsense'), 0);
});

test('latestTag picks the highest v-tag and ignores everything else', () => {
    const output = [
        'aaa\trefs/tags/v1.9.0',
        'bbb\trefs/tags/v1.17.0',
        'ccc\trefs/tags/v1.10.0',
        'ddd\trefs/tags/some-branch-tag',
        'eee\trefs/heads/main',
    ].join('\n');
    assert.equal(latestTag(output), '1.17.0');
    assert.equal(latestTag(''), null);
    assert.equal(latestTag(undefined), null);
});

// -------------------------------------------------------- install shape ----

test('installKind names the install from the paths alone', () => {
    const clone = makeTmpDir('clone');
    fs.mkdirSync(path.join(clone, '.git'), { recursive: true });
    const real = path.join(clone, 'skills', 'react-clean-architecture', 'scripts', 'check-update.js');

    // run straight out of the clone
    assert.equal(installKind(real, real), 'clone');
    // ~/.claude/skills/<skill> is a symlink INTO that clone (install.sh default)
    const linked = path.join('/Users/x/.claude/skills/react-clean-architecture/scripts/check-update.js');
    assert.equal(installKind(linked, real), 'symlink');
    // plugin cache path wins regardless of what the real files sit next to
    const plugin = '/Users/x/.claude/plugins/cache/react-clean-architecture/skills/rca/scripts/check-update.js';
    assert.equal(installKind(plugin, real), 'plugin');

    // copied files: no .git anywhere above them
    const copied = makeTmpDir('copied');
    const copiedFile = path.join(copied, 'skills', 'react-clean-architecture', 'scripts', 'check-update.js');
    assert.equal(installKind(copiedFile, copiedFile), 'copy');
});

test('each install kind gets a command that actually applies to it', () => {
    const real = path.join('/tmp/clone', 'skills', 'rca', 'scripts', 'check-update.js');
    assert.match(updateSteps('plugin', real).steps.join('\n'), /\/plugin marketplace update .*\n.*\/plugin update/);
    assert.match(updateSteps('symlink', real).steps[0], /^git -C \/tmp\/clone pull$/);
    assert.match(updateSteps('clone', real).steps[0], /^git -C \/tmp\/clone pull$/);
    assert.match(updateSteps('copy', real).steps.join('\n'), /npx skills@latest add/);
    // the plugin path is the one with an ordering trap — it must be spelled out
    assert.match(updateSteps('plugin', real).steps.join(' '), /marketplace refresh must come first/);
});

// ------------------------------------------------------------------ CLI ----

test('a newer release prints UPDATE AVAILABLE with both versions', () => {
    const next = shiftVersion(1);
    const { status, stdout } = runScript('check-update.js', ['--cache', cacheWith(next)]);
    assert.equal(status, 0, 'being behind is information, not a failed run');
    assert.match(stdout, new RegExp(`UPDATE AVAILABLE — react-clean-architecture ${SKILL_VERSION} → ${next}`));
    assert.match(stdout, /Update with:/);
    assert.match(stdout, /CHANGELOG\.md/);
});

test('the notice orders the agent to repeat it, and never to update on its own', () => {
    const { stdout } = runScript('check-update.js', ['--cache', cacheWith(shiftVersion(1))]);
    assert.match(stdout, /every run until the versions match/i);
    assert.match(stdout, /no dismissal/i);
    assert.match(stdout, /never update the skill on their behalf/i);
    assert.match(stdout, /never stop the run/i);
});

test('--strict is the only way to get a non-zero exit for being behind', () => {
    const cache = cacheWith(shiftVersion(1));
    assert.equal(runScript('check-update.js', ['--cache', cache]).status, 0);
    assert.equal(runScript('check-update.js', ['--cache', cache, '--strict']).status, 1);
});

test('matching versions are UP TO DATE and stay silent about commands', () => {
    const { status, stdout } = runScript('check-update.js', ['--cache', cacheWith(SKILL_VERSION), '--strict']);
    assert.equal(status, 0);
    assert.match(stdout, /UP TO DATE/);
    assert.doesNotMatch(stdout, /Update with:/);
});

test('a local version ahead of the last release is a dev checkout, not an update', () => {
    const { status, stdout } = runScript('check-update.js', ['--cache', cacheWith(shiftVersion(-1))]);
    assert.equal(status, 0);
    assert.match(stdout, /UP TO DATE/);
    assert.match(stdout, /development checkout/);
});

test('offline with no cache is SKIPPED — the run continues', () => {
    const empty = path.join(makeTmpDir('nocache'), 'update-check.json');
    const { status, stdout } = runScript('check-update.js', ['--no-network', '--cache', empty, '--strict']);
    assert.equal(status, 0, 'an unreachable GitHub must never fail a feature run');
    assert.match(stdout, /UPDATE CHECK SKIPPED/);
    assert.match(stdout, /run is unaffected/);
    assert.match(stdout, new RegExp(SKILL_VERSION));
});

test('a cache older than the TTL is not reused', () => {
    const stale = cacheWith(shiftVersion(1), CACHE_TTL_MS + 60000);
    const { stdout } = runScript('check-update.js', ['--no-network', '--cache', stale]);
    assert.match(stdout, /UPDATE CHECK SKIPPED/, 'the stale answer was served instead of being refetched');
});

test('a fresh check writes the cache back', () => {
    const file = path.join(makeTmpDir('write'), 'nested', 'update-check.json');
    runScript('check-update.js', ['--no-network', '--cache', file]); // offline: nothing to write
    assert.equal(fs.existsSync(file), false);

    const seeded = cacheWith(SKILL_VERSION);
    const cached = JSON.parse(fs.readFileSync(seeded, 'utf8'));
    assert.equal(cached.latest, SKILL_VERSION);
});

test('--help works and --cache without a path is a usage error', () => {
    assert.equal(runScript('check-update.js', ['--help']).status, 0);
    assert.equal(runScript('check-update.js', ['--cache']).status, 2);
});

test('no output states a token cost or caps what may be read', () => {
    // the user's standing directive — same guard the reader scripts carry
    const COST = /\d+\s*k?\s*tokens?\b|tokens? (?:each|per|budget|cost)|costs? .{0,20}tokens?/i;
    const CAP = /at most|no more than|budget|limit yourself|only read|sparingly|if strictly necessary/i;
    for (const argv of [['--help'], ['--cache', cacheWith(shiftVersion(1))], ['--cache', cacheWith(SKILL_VERSION)]]) {
        const { stdout } = runScript('check-update.js', argv);
        assert.doesNotMatch(stdout, COST);
        assert.doesNotMatch(stdout, CAP);
    }
});

// ------------------------------------------------------------ wiring ------

test('the released version is one number in three places', () => {
    /*
     * check-update.js compares the LOCAL SKILL_VERSION against the newest v-tag,
     * so a plugin manifest that drifts from SKILL_VERSION would tell users to
     * update to a version they already have — or hide one they need.
     */
    const plugin = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
    const marketplace = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
    assert.equal(plugin.version, SKILL_VERSION, 'plugin.json version drifted from SKILL_VERSION');
    assert.equal(marketplace.plugins[0].version, SKILL_VERSION, 'marketplace.json version drifted from SKILL_VERSION');
});

test('SKILL.md runs the check at item 0, before the baseline', () => {
    const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
    const check = skill.indexOf('scripts/check-update.js');
    const baseline = skill.indexOf('scripts/audit.js --baseline');
    assert.ok(check > 0, 'SKILL.md never runs check-update.js — the check would never fire');
    assert.ok(check < baseline, 'the update check must come before the tsc baseline');
    assert.match(skill, /repeat|every run/i);
});

test('a copied skill dir still works — no dependency on the surrounding repo', () => {
    /*
     * npx-skills and Cursor/Codex installs copy ONLY skills/react-clean-architecture,
     * leaving no .claude-plugin above it. The check must still report a version.
     */
    const copied = path.join(makeTmpDir('standalone'), 'react-clean-architecture');
    fs.cpSync(path.join(SKILL_DIR, 'scripts'), path.join(copied, 'scripts'), { recursive: true });
    write(copied, 'SKILL.md', '# copied\n');

    const result = spawnSync(
        'node',
        [path.join(copied, 'scripts', 'check-update.js'), '--cache', cacheWith(shiftVersion(1))],
        { encoding: 'utf8' }
    );
    assert.equal(result.status, 0);
    assert.match(result.stdout, /UPDATE AVAILABLE/);
    assert.match(result.stdout, /npx skills@latest add/, 'a copy must be told the copy command');
});
