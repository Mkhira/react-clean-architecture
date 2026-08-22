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
const { makeTmpDir, makeFixtureRepo, baseSpec, writeSpec, runScript, read, write, exists, readManifest } = require('./helpers.js');

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

test('merger.ts with NO feature imports yet: anchors still planted after the last import', () => {
    const repo = makeFixtureRepo();
    write(repo, 'src/core/localization/merger.ts', `import { AppLanguage } from './i18n';

const featureTranslations = {
} as const;

export const featureTranslationsFor = (language: AppLanguage) => featureTranslations;
`);
    const specPath = writeSpec(makeTmpDir('s'), baseSpec());
    runScript('generate.js', [specPath, '--repo', repo]);
    const result = runScript('register-di.js', [specPath, '--repo', repo]);
    assert.equal(result.status, 0);
    const merger = read(repo, 'src/core/localization/merger.ts');
    assert.match(merger, /import orderTracking from '@features\/OrderTracking\/presentation\/translations';/);
    assert.match(merger, /^    orderTracking,$/m);
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

// ----------------------------------------- design-lane audit regressions ----

function getEndpoint(overrides = {}) {
    const spec = baseSpec();
    spec.endpoints[0] = {
        ...spec.endpoints[0],
        action: 'listOrders', method: 'GET', path: '/v1/orders',
        requestSample: null, requestFieldSources: {},
        hostType: 'app', baseUrl: null, headers: [],
        ...overrides,
    };
    return spec;
}

test('spec with empty endpoints array is refused with a design-only pointer', () => {
    const repo = makeFixtureRepo();
    const spec = baseSpec();
    spec.endpoints = [];
    const result = runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', repo]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /endpoints must be a non-empty array/);
});

test('figma URL without protocol still rejected in the design block', () => {
    const repo = makeFixtureRepo();
    const spec = getEndpoint();
    spec.design = { screens: [{ name: 'Home', link: 'figma.com/design/abc?node-id=1-2&token=SECRET' }] };
    const result = runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', repo]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not figma\.com URLs/);
});

test('remove: only THIS feature\'s exact query keys are deleted, prefix-sharing keys survive', () => {
    const repo = makeFixtureRepo();
    const spec = getEndpoint(); // feature OrderTracking, key ORDER_TRACKING_LIST_ORDERS
    spec.feature = 'Order';     // → key ORDER_LIST_ORDERS
    const specPath = writeSpec(makeTmpDir('s'), spec);
    runScript('generate.js', [specPath, '--repo', repo]);
    runScript('register-di.js', [specPath, '--repo', repo]);
    // hand-written app key sharing the ORDER_ prefix — must survive removal
    let keys = read(repo, 'src/data/services/keys.ts');
    keys = keys.replace("BANNERS: 'banners',", "BANNERS: 'banners',\n    ORDER_TRACKING_STATUS: 'order-tracking-status',");
    fs.writeFileSync(path.join(repo, 'src/data/services/keys.ts'), keys);
    fs.copyFileSync(specPath, path.join(repo, 'src/features/Order/feature-spec.json'));

    const result = runScript('remove-feature.js', ['Order', '--repo', repo, '--apply']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const after = read(repo, 'src/data/services/keys.ts');
    assert.ok(!after.includes('ORDER_LIST_ORDERS'), 'own key removed');
    assert.match(after, /ORDER_TRACKING_STATUS: 'order-tracking-status',/, 'prefix-sharing key must survive');
});

test('rename: queries.ts usage sites AND keys.ts declaration both move to the new key', () => {
    const repo = makeFixtureRepo();
    const spec = getEndpoint({ cache: '6-hours' });
    const specPath = writeSpec(makeTmpDir('s'), spec);
    runScript('generate.js', [specPath, '--repo', repo]);
    runScript('register-di.js', [specPath, '--repo', repo]);
    fs.copyFileSync(specPath, path.join(repo, 'src/features/OrderTracking/feature-spec.json'));

    const result = runScript('rename-feature.js', ['OrderTracking', 'ShipmentTrace', '--repo', repo, '--apply']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const keys = read(repo, 'src/data/services/keys.ts');
    assert.match(keys, /SHIPMENT_TRACE_LIST_ORDERS: 'shipment-trace-list-orders',/);
    assert.ok(!keys.includes('ORDER_TRACKING_LIST_ORDERS'));
    const queries = read(repo, 'src/features/ShipmentTrace/presentation/queries.ts');
    assert.match(queries, /QUERIES_KEYS\.SHIPMENT_TRACE_LIST_ORDERS\]/, 'usage site renamed');
    assert.ok(!queries.includes('ORDER_TRACKING_LIST_ORDERS'));
});

test('merger entry insert is anchored: a case-exact suffix entry (reorder) cannot mask order', () => {
    const repo = makeFixtureRepo();
    // existing entry "reorder," contains "order," as a substring
    let merger = read(repo, 'src/core/localization/merger.ts');
    merger = merger
        .replace("import account from '@features/account/presentation/translations';",
            "import account from '@features/account/presentation/translations';\nimport reorder from '@features/reorder/presentation/translations';")
        .replace('    account,', '    account,\n    reorder,');
    fs.writeFileSync(path.join(repo, 'src/core/localization/merger.ts'), merger);

    const spec = getEndpoint();
    spec.feature = 'Order';
    const specPath = writeSpec(makeTmpDir('s'), spec);
    runScript('generate.js', [specPath, '--repo', repo]);
    const result = runScript('register-di.js', [specPath, '--repo', repo]);
    assert.equal(result.status, 0, result.stderr);
    const after = read(repo, 'src/core/localization/merger.ts');
    assert.match(after, /^    order,$/m, 'order entry must be inserted despite reorder substring');
    assert.match(after, /^    reorder,$/m, 'reorder entry untouched');
});

test('append GET to a POST-only feature creates queries.ts with the hook + needsClaude note', () => {
    const repo = makeFixtureRepo();
    const createPath = writeSpec(makeTmpDir('s'), baseSpec()); // POST-only
    runScript('generate.js', [createPath, '--repo', repo]);
    assert.ok(!exists(repo, 'src/features/OrderTracking/presentation/queries.ts'));

    const appendSpec = getEndpoint({ cache: '8-hours' });
    appendSpec.mode = 'append';
    const result = runScript('generate.js', [writeSpec(makeTmpDir('s'), appendSpec), '--repo', repo]);
    const manifest = readManifest(repo);
    assert.ok(manifest.created.includes('src/features/OrderTracking/presentation/queries.ts'));
    const queries = read(repo, 'src/features/OrderTracking/presentation/queries.ts');
    assert.match(queries, /export const useListOrdersQuery/);
    assert.match(queries, /storeDuration: '8-hours'/);
    assert.match(queries, /\/\/ <create-feature:queries>/);
    assert.ok(manifest.needsClaude.some((n) => n.includes('use<Action>Query hook')));
});

test('append GET to a feature that already has queries.ts inserts the hook at the anchor', () => {
    const repo = makeFixtureRepo();
    const createPath = writeSpec(makeTmpDir('s'), getEndpoint());
    runScript('generate.js', [createPath, '--repo', repo]);

    const appendSpec = getEndpoint({ action: 'getOrderDetail', path: '/v1/orders/{id}', pathParams: [{ name: 'id', type: 'string' }] });
    appendSpec.mode = 'append';
    const result = runScript('generate.js', [writeSpec(makeTmpDir('s'), appendSpec), '--repo', repo]);
    const manifest = readManifest(repo);
    assert.ok(manifest.patched.includes('src/features/OrderTracking/presentation/queries.ts'));
    const queries = read(repo, 'src/features/OrderTracking/presentation/queries.ts');
    assert.match(queries, /export const useListOrdersQuery/, 'existing hook stays');
    assert.match(queries, /export const useGetOrderDetailQuery = \(input: GetOrderDetailInput/, 'new hook inserted');
    assert.match(queries, /import type \{ GetOrderDetailInput \} from '\.\.\/domain\/entities\/GetOrderDetailResult';/, 'input import added');
    // idempotent re-run
    const rerun = runScript('generate.js', [writeSpec(makeTmpDir('s'), appendSpec), '--repo', repo]);
    const queriesAfter = read(repo, 'src/features/OrderTracking/presentation/queries.ts');
    assert.equal((queriesAfter.match(/useGetOrderDetailQuery/g) || []).length, (queries.match(/useGetOrderDetailQuery/g) || []).length);
});

test('remove-feature handles a design-only resume spec (no endpoints) without crashing', () => {
    const repo = makeFixtureRepo();
    // design-only feature: presentation dir + hand-written resume record + manual merger entry
    write(repo, 'src/features/GlassFlow/presentation/screens/GlassFlowScreen.tsx', 'export default function GlassFlowScreen() { return null; }\n');
    write(repo, 'src/features/GlassFlow/feature-spec.json', JSON.stringify({
        feature: 'GlassFlow', skillVersion: '1.5.0',
        design: { fileKey: 'abc', screens: [{ name: 'entry', screenNodeId: '1:2', status: 'verified' }] },
    }, null, 2));
    let merger = read(repo, 'src/core/localization/merger.ts');
    merger = merger
        .replace("import account from '@features/account/presentation/translations';",
            "import account from '@features/account/presentation/translations';\nimport glassFlow from '@features/GlassFlow/presentation/translations';")
        .replace('    account,', '    account,\n    glassFlow,');
    fs.writeFileSync(path.join(repo, 'src/core/localization/merger.ts'), merger);

    const result = runScript('remove-feature.js', ['GlassFlow', '--repo', repo, '--apply']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(!exists(repo, 'src/features/GlassFlow'));
    const after = read(repo, 'src/core/localization/merger.ts');
    assert.ok(!after.includes('glassFlow'), 'merger entry + import removed');
    assert.match(after, /^    account,$/m, 'unrelated entry stays');
});
