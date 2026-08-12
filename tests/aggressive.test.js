'use strict';
/**
 * Aggressive / hostile-input scenarios: malformed specs that must be REFUSED
 * (not turned into broken TypeScript), curl pastes from the wild, unicode and
 * degenerate JSON shapes, mis-ordered script runs, and rollback.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parse } = require('../scripts/parse-curl.js');
const { generateTypes } = require('../scripts/json-to-dto.js');
const { makeTmpDir, makeFixtureRepo, baseSpec, writeSpec, runScript, read, write, exists } = require('./helpers.js');

// ------------------------------------------------------ parse-curl (wild) ----

test('header values containing colons keep everything after the FIRST colon', () => {
    const parsed = parse(`curl 'https://a.test/x' -H 'Authorization: Basic dXNlcjpwYXNz:extra'`);
    assert.deepEqual(parsed.headers, [{ name: 'Authorization', value: 'Basic dXNlcjpwYXNz:extra' }]);
});

test('credentials embedded in the URL never leak into host', () => {
    const parsed = parse(`curl 'https://user:secretpw@partner.test:8443/api/v1/x?a=1'`);
    assert.equal(parsed.host, 'https://partner.test:8443');
    assert.ok(!parsed.host.includes('secretpw'));
    assert.equal(parsed.path, '/api/v1/x');
});

test('Windows-style paste: CRLF line endings + curl.exe prefix', () => {
    const parsed = parse("curl.exe 'https://a.test/x' \\\r\n -H 'X-K: v' \\\r\n -d '{\"a\":1}'\r\n");
    assert.equal(parsed.url, 'https://a.test/x');
    assert.deepEqual(parsed.headers, [{ name: 'X-K', value: 'v' }]);
    assert.deepEqual(parsed.body, { a: 1 });
});

test('duplicate headers are all kept, in order (user resolves in the header table)', () => {
    const parsed = parse(`curl 'https://a.test/x' -H 'Accept: a' -H 'Accept: b'`);
    assert.deepEqual(parsed.headers.map((h) => h.value), ['a', 'b']);
});

test('lowercase -X verb is normalized to uppercase', () => {
    assert.equal(parse(`curl -X post 'https://a.test/x'`).method, 'POST');
});

test('percent-encoded query values are decoded', () => {
    const parsed = parse(`curl 'https://a.test/x?q=hello%20world&lang=ar'`);
    assert.deepEqual(parsed.queryParams, [
        { name: 'q', value: 'hello world' },
        { name: 'lang', value: 'ar' },
    ]);
});

// --------------------------------------------------- json-to-dto (degenerate) ----

test('[null, {…}] arrays: the first NON-null item decides the element shape', () => {
    const { code } = generateTypes([null, { Id: 1 }], 'EventsDTO');
    assert.match(code, /Id: number;/);
    assert.match(code, /export type EventsDTO = EventsItemDTO\[\];/);
});

test('unicode (Arabic) keys are preserved via quoting', () => {
    const { code } = generateTypes({ 'اسم_المنتج': 'x' }, 'ArabicDTO');
    assert.match(code, /"اسم_المنتج": string;/);
});

test('4-level nesting produces a named sub-type per level', () => {
    const { code } = generateTypes({ A: { B: { C: { D: 1 } } } }, 'DeepDTO');
    assert.match(code, /export type DeepABCDTO/);
    assert.match(code, /D: number;/);
});

test('empty object sample still yields a valid (empty) type', () => {
    const { code } = generateTypes({}, 'EmptyDTO');
    assert.match(code, /export type EmptyDTO = \{/);
});

// ------------------------------------------- generate.js refuses bad specs ----

function expectRejected(mutate, messagePattern) {
    const spec = baseSpec();
    mutate(spec);
    const result = runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', makeTmpDir('r')]);
    assert.equal(result.status, 1, `expected rejection, got status ${result.status}`);
    assert.match(result.stderr, messagePattern);
}

test('feature name that normalizes to nothing is rejected', () => {
    expectRejected((spec) => { spec.feature = '###'; }, /does not normalize to a PascalCase identifier/);
});

test('duplicate actions are rejected (would emit two identical methods)', () => {
    expectRejected((spec) => { spec.endpoints.push(JSON.parse(JSON.stringify(spec.endpoints[0]))); }, /duplicate action "trackOrder"/);
});

test('unsupported HTTP method (PATCH) is rejected', () => {
    expectRejected((spec) => { spec.endpoints[0].method = 'PATCH'; }, /"PATCH" is not supported/);
});

test('path placeholder without a pathParams entry is rejected (would ship a literal {id})', () => {
    expectRejected((spec) => { spec.endpoints[0].path = '/v1/orders/{id}/x'; }, /placeholder \{id\} has no matching pathParams/);
});

test('pathParams entry missing from the path is rejected', () => {
    expectRejected((spec) => { spec.endpoints[0].pathParams = [{ name: 'ghost', type: 'string' }]; }, /"ghost" does not appear in the path/);
});

test('request field without provenance is rejected (would emit a non-compiling mapper)', () => {
    expectRejected((spec) => { spec.endpoints[0].requestSample.Mystery = 'x'; }, /"Mystery" has no requestFieldSources entry/);
});

test('provenance entry for a field NOT in the sample is rejected', () => {
    expectRejected((spec) => { spec.endpoints[0].requestFieldSources.Phantom = 'input'; }, /"Phantom" but the requestSample does not/);
});

test('statusEnum with no values is rejected', () => {
    expectRejected((spec) => { spec.endpoints[0].statusEnum = { field: 'status', values: [] }; }, /statusEnum needs at least one value/);
});

// -------------------------------------------------- mis-ordered script runs ----

test('register-di refuses to run before generate (no dangling DI entries)', () => {
    const repo = makeFixtureRepo();
    const result = runScript('register-di.js', [writeSpec(makeTmpDir('s'), baseSpec()), '--repo', repo]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /run generate\.js first/);
    assert.ok(!read(repo, 'src/core/di/tokens.ts').includes('OrderTracking'), 'tokens.ts must be untouched');
});

test('i18n.ts with NO feature imports yet: anchors still planted after the last import', () => {
    const repo = makeFixtureRepo();
    write(repo, 'src/core/localization/i18n.ts', `import i18n from 'i18next';
import en from './translations/en.json';
import ar from './translations/ar.json';

const featureTranslations = {
} as const;

export default i18n;
`);
    const specPath = writeSpec(makeTmpDir('s'), baseSpec());
    runScript('generate.js', [specPath, '--repo', repo]);
    const result = runScript('register-di.js', [specPath, '--repo', repo]);
    assert.equal(result.status, 0);
    const i18n = read(repo, 'src/core/localization/i18n.ts');
    assert.match(i18n, /import orderTrackingEn/);
    assert.match(i18n, /  orderTracking: \{ en: orderTrackingEn, ar: orderTrackingAr \},/);
});

test('unrecognizably-shaped ConfigService degrades to NEEDS_MANUAL, not corruption', () => {
    const repo = makeFixtureRepo();
    write(repo, 'src/core/config/ConfigService.ts', `export class ConfigService {\n    // completely different shape\n}\n`);
    const specPath = writeSpec(makeTmpDir('s'), baseSpec());
    runScript('generate.js', [specPath, '--repo', repo]);
    const result = runScript('register-di.js', [specPath, '--repo', repo]);
    const report = JSON.parse(result.stdout);
    assert.equal(result.status, 2);
    assert.ok(report.needsManual.some((note) => note.startsWith('ConfigService.ts')));
    // DI wiring must still have happened despite the config failure
    assert.match(read(repo, 'src/core/di/tokens.ts'), /OrderTrackingService: 'IOrderTrackingService',/);
});

// ------------------------------------------------------------- rollback.js ----

function gitFixture() {
    const repo = makeFixtureRepo();
    const git = (args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    git(['init', '-q']);
    git(['add', '-A']);
    git(['-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-q', '-m', 'baseline']);
    return { repo, git };
}

test('rollback dry run: reports the plan, touches nothing', () => {
    const { repo } = gitFixture();
    const specPath = writeSpec(makeTmpDir('s'), baseSpec());
    runScript('generate.js', [specPath, '--repo', repo]);
    runScript('register-di.js', [specPath, '--repo', repo]);

    const result = runScript('rollback.js', ['--repo', repo]);
    const report = JSON.parse(result.stdout.slice(0, result.stdout.lastIndexOf('}') + 1));
    assert.equal(result.status, 0);
    assert.equal(report.mode, 'dry-run');
    assert.ok(report.deleted.length >= 15);
    assert.ok(exists(repo, 'src/features/OrderTracking/data/services/OrderTrackingService.ts'), 'dry run must not delete');
    assert.ok(exists(repo, '.claude-skill-manifest.json'), 'dry run must keep the manifest');
});

test('rollback --apply: created files deleted, patched files restored, tree back to baseline', () => {
    const { repo, git } = gitFixture();
    const tokensBefore = read(repo, 'src/core/di/tokens.ts');
    const specPath = writeSpec(makeTmpDir('s'), baseSpec());
    runScript('generate.js', [specPath, '--repo', repo]);
    runScript('register-di.js', [specPath, '--repo', repo]);
    assert.notEqual(read(repo, 'src/core/di/tokens.ts'), tokensBefore, 'precondition: DI was patched');

    const result = runScript('rollback.js', ['--repo', repo, '--apply']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(!exists(repo, 'src/features/OrderTracking'), 'feature dir fully removed (incl. empty dirs)');
    assert.equal(read(repo, 'src/core/di/tokens.ts'), tokensBefore, 'patched file restored');
    assert.equal(read(repo, '.env.development').includes('ORDER_TRACKING'), false, 'env restored');
    assert.ok(!exists(repo, '.claude-skill-manifest.json'), 'manifest cleaned up');

    const status = git(['status', '--porcelain']).stdout.trim();
    assert.equal(status, '', `tree must be clean after rollback, got:\n${status}`);
});

test('rollback without a manifest exits with a clear error', () => {
    const result = runScript('rollback.js', ['--repo', makeTmpDir('empty')]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /nothing to roll back/);
});
