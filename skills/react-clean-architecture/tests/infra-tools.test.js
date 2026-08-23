'use strict';
/**
 * Tests for the v1.7.0 infra tools:
 *  - setup-test-infra.js (auto-install render-test infra; user decision 2026-08-19)
 *  - check-components-md.js (COMPONENTS.md drift detector)
 * The actual package-manager install is NOT exercised (network) — those paths
 * are covered up to the spawn boundary via detectPackageManager.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { detectPackageManager, jestConfigLocation, STARTER_SETUP, PACKAGE } = require('../scripts/setup-test-infra.js');
const { listComponents, listHeadings, diffComponentsDoc } = require('../scripts/check-components-md.js');
const { makeTmpDir, runScript, write, read, exists } = require('./helpers.js');

// ------------------------------------------------------ setup-test-infra ----

function makePkgRepo(pkg) {
    const repo = makeTmpDir('pkg');
    write(repo, 'package.json', JSON.stringify(pkg, null, 2) + '\n');
    return repo;
}

test('detectPackageManager: lockfile decides; npm is the fallback', () => {
    const repo = makeTmpDir('pm');
    write(repo, 'package.json', '{}');
    assert.equal(detectPackageManager(repo).cmd, 'npm');
    write(repo, 'yarn.lock', '');
    assert.equal(detectPackageManager(repo).cmd, 'yarn');
    fs.rmSync(path.join(repo, 'yarn.lock'));
    write(repo, 'pnpm-lock.yaml', '');
    assert.equal(detectPackageManager(repo).cmd, 'pnpm');
});

test('--check reports gaps and exits 1; ready repo exits 0', () => {
    const missing = makePkgRepo({ jest: { preset: 'jest-expo' } });
    const gap = runScript('setup-test-infra.js', ['--repo', missing, '--check']);
    assert.equal(gap.status, 1);
    const gapReport = JSON.parse(gap.stdout);
    assert.equal(gapReport.library, 'missing');
    assert.equal(gapReport.ready, false);

    const ready = makePkgRepo({
        devDependencies: { [PACKAGE]: '^14.0.0' },
        jest: { preset: 'jest-expo', setupFilesAfterEnv: ['<rootDir>/jest.setup.js'] },
    });
    write(ready, 'jest.setup.js', STARTER_SETUP);
    const ok = runScript('setup-test-infra.js', ['--repo', ready, '--check']);
    assert.equal(ok.status, 0);
    assert.equal(JSON.parse(ok.stdout).ready, true);
});

test('creates jest.setup.js and wires package.json jest block (no install needed when lib present)', () => {
    const repo = makePkgRepo({
        devDependencies: { [PACKAGE]: '^14.0.0' },
        jest: { preset: 'jest-expo' },
    });
    const result = runScript('setup-test-infra.js', ['--repo', repo]);
    assert.equal(result.status, 0, result.stderr);

    assert.ok(exists(repo, 'jest.setup.js'));
    assert.match(read(repo, 'jest.setup.js'), /react-native-reanimated\/mock/);
    const pkg = JSON.parse(read(repo, 'package.json'));
    assert.deepEqual(pkg.jest.setupFilesAfterEnv, ['<rootDir>/jest.setup.js']);
    assert.equal(pkg.jest.preset, 'jest-expo', 'existing jest config preserved');
});

test('idempotent: second run changes nothing and never duplicates the wiring', () => {
    const repo = makePkgRepo({ devDependencies: { [PACKAGE]: '^14.0.0' }, jest: {} });
    runScript('setup-test-infra.js', ['--repo', repo]);
    write(repo, 'jest.setup.js', '// user-customized — must survive\n');
    const second = runScript('setup-test-infra.js', ['--repo', repo]);
    assert.equal(second.status, 0);
    assert.equal(read(repo, 'jest.setup.js'), '// user-customized — must survive\n', 'existing setup file never overwritten');
    assert.deepEqual(JSON.parse(read(repo, 'package.json')).jest.setupFilesAfterEnv, ['<rootDir>/jest.setup.js']);
});

test('standalone jest.config.js is never rewritten — reported as needsManual', () => {
    const repo = makePkgRepo({ devDependencies: { [PACKAGE]: '^14.0.0' } });
    write(repo, 'jest.config.js', 'module.exports = { preset: "jest-expo" };\n');
    const result = runScript('setup-test-infra.js', ['--repo', repo]);
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.ok(report.needsManual.some((entry) => entry.includes('jest.config.js')), JSON.stringify(report));
    assert.doesNotMatch(read(repo, 'jest.config.js'), /setupFilesAfterEnv/, 'JS config untouched');
    assert.equal(jestConfigLocation(repo, JSON.parse(read(repo, 'package.json'))), 'jest.config.js');
});

// --------------------------------------------------- check-components-md ----

function makeComponentsRepo() {
    const repo = makeTmpDir('cmp');
    write(repo, 'src/shared/components/ui/atoms/Tag/index.tsx', 'export {};');
    write(repo, 'src/shared/components/ui/atoms/BaseButton/index.tsx', 'export {};');
    write(repo, 'src/shared/components/ui/organisms/List/index.ts', 'export {};');
    write(repo, 'src/shared/components/PriceTag.tsx', 'export {};');
    return repo;
}

const DOC_COVERING_ALL = `# dict
### Tag — atom
body
### Button (BaseButton) — atom
body
### List — organism
body
### PriceTag — (root-level component)
body
`;

test('drift: a repo component with no heading is reported (the live List case)', () => {
    const repo = makeComponentsRepo();
    const doc = path.join(makeTmpDir('doc'), 'COMPONENTS.md');
    fs.writeFileSync(doc, DOC_COVERING_ALL.replace(/### List — organism\nbody\n/, ''));
    const result = runScript('check-components-md.js', ['--repo', repo, '--doc', doc]);
    assert.equal(result.status, 0, 'default is non-strict');
    assert.match(result.stdout, /DRIFT: List \(organisms\)/);
    assert.doesNotMatch(result.stdout, /DRIFT: BaseButton/, 'parenthetical alias covers the dir');
    assert.doesNotMatch(result.stdout, /DRIFT: PriceTag/, 'root-level .tsx components scanned');

    const strict = runScript('check-components-md.js', ['--repo', repo, '--doc', doc, '--strict']);
    assert.equal(strict.status, 1);
});

test('stale: a heading matching no component is reported; clean doc reports zero', () => {
    const repo = makeComponentsRepo();
    const doc = path.join(makeTmpDir('doc'), 'COMPONENTS.md');
    fs.writeFileSync(doc, DOC_COVERING_ALL + '### GhostWidget — molecule\nbody\n');
    const result = runScript('check-components-md.js', ['--repo', repo, '--doc', doc]);
    assert.match(result.stdout, /STALE: "### GhostWidget"/);

    fs.writeFileSync(doc, DOC_COVERING_ALL);
    const clean = runScript('check-components-md.js', ['--repo', repo, '--doc', doc]);
    assert.match(clean.stdout, /4 components, 0 drift, 0 stale/);
});

test('listHeadings tokenizes slash lists and PascalCase parenthetical aliases', () => {
    const doc = path.join(makeTmpDir('doc'), 'COMPONENTS.md');
    fs.writeFileSync(doc, '### Button (BaseButton) — atom\n### Accordion (organism barrel) / AccordionList — organism\n');
    const [button, accordion] = listHeadings(doc);
    assert.deepEqual([...button.tokens].sort(), ['basebutton', 'button']);
    // "organism barrel" is lowercase prose, not a PascalCase alias — no junk tokens
    assert.deepEqual([...accordion.tokens].sort(), ['accordion', 'accordionlist']);

    const { drift, stale } = diffComponentsDoc(
        [{ name: 'BaseButton', where: 'atoms' }, { name: 'AccordionList', where: 'organisms' }],
        [button, accordion]
    );
    assert.equal(drift.length, 0);
    assert.equal(stale.length, 0);
});

test('listComponents returns null when the repo has no shared components tree', () => {
    assert.equal(listComponents(makeTmpDir('empty')), null);
});

// -------------------------------------------------------------- --help ------
// v1.14.1: both scripts used to ignore --help and run their real work against
// the cwd instead — which is the skill's own scripts/ dir when someone is just
// asking for usage. Usage must print and NOTHING must be touched.

test('setup-test-infra.js --help prints usage instead of inspecting a repo', () => {
    const repo = makeTmpDir('help-infra'); // no package.json → exit 2 without --help
    for (const flag of ['--help', '-h']) {
        const result = runScript('setup-test-infra.js', ['--repo', repo, flag]);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Usage:\s+node setup-test-infra\.js/);
        assert.equal(result.stderr, '');
    }
    assert.equal(exists(repo, 'jest.setup.js'), false);
});

test('check-components-md.js --help prints usage instead of scanning a repo', () => {
    const repo = makeTmpDir('help-doc'); // no src/shared/components → exit 2 without --help
    for (const flag of ['--help', '-h']) {
        const result = runScript('check-components-md.js', ['--repo', repo, flag]);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Usage:\s+node check-components-md\.js/);
        assert.equal(result.stderr, '');
    }
});
