'use strict';
/**
 * Hostile agent-tester scenarios: inputs and sequences a real (or careless)
 * agent could produce — degraded app repos, garbage samples, name collisions
 * across features, and full lifecycle chains. Every case here started as a
 * live probe against the scripts; the failures it found are fixed and pinned.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeTmpDir, makeFixtureRepo, baseSpec, writeSpec, runScript, read, exists } = require('./helpers.js');

function getSpec(overrides = {}) {
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

// ------------------------------------------------ degraded app repositories ----

test('merger.ts missing: register-di degrades to NEEDS_MANUAL, never a raw crash', () => {
    const repo = makeFixtureRepo();
    fs.rmSync(path.join(repo, 'src/core/localization/merger.ts'));
    const specPath = writeSpec(makeTmpDir('s'), baseSpec());
    runScript('generate.js', [specPath, '--repo', repo]);
    const result = runScript('register-di.js', [specPath, '--repo', repo]);
    assert.notEqual(result.status, 1, 'must not die with an unhandled exception');
    const report = JSON.parse(result.stdout);
    assert.ok(report.needsManual.some((n) => n.includes('merger.ts')), 'merger gap reported as manual work');
    // DI wiring must still have happened despite the missing merger
    assert.match(read(repo, 'src/core/di/tokens.ts'), /OrderTrackingService: 'IOrderTrackingService',/);
});

test('keys.ts missing: register-di degrades to NEEDS_MANUAL for the query keys', () => {
    const repo = makeFixtureRepo();
    fs.rmSync(path.join(repo, 'src/data/services/keys.ts'));
    const specPath = writeSpec(makeTmpDir('s'), getSpec());
    runScript('generate.js', [specPath, '--repo', repo]);
    const result = runScript('register-di.js', [specPath, '--repo', repo]);
    const report = JSON.parse(result.stdout);
    assert.ok(report.needsManual.some((n) => n.includes('keys.ts')));
});

// ------------------------------------------------------- garbage spec inputs ----

test('primitive responseSample is rejected (would emit ResponseDTO = string + garbage entity)', () => {
    const result = runScript('generate.js', [writeSpec(makeTmpDir('s'), getSpec({ responseSample: 'just a string' })), '--repo', makeFixtureRepo()]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /responseSample must be a JSON object or array/);
});

test('path containing a query string is rejected (query belongs in queryParams)', () => {
    const result = runScript('generate.js', [writeSpec(makeTmpDir('s'), getSpec({ path: '/v1/orders?active=1' })), '--repo', makeFixtureRepo()]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /path contains a query string/);
});

test('design block as an ARRAY is rejected, not silently ignored', () => {
    const spec = getSpec();
    spec.design = [{ name: 'Home' }];
    const result = runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', makeFixtureRepo()]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /design must be an object/);
});

test('actions differing only by case collapse to one camel name and are rejected', () => {
    const spec = getSpec();
    spec.endpoints.push({ ...spec.endpoints[0], action: 'ListOrders' });
    const result = runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', makeFixtureRepo()]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /duplicate action "listOrders"/);
});

test('non-Latin feature name is rejected with a clear message, not mangled', () => {
    const spec = getSpec();
    spec.feature = 'تتبعالشحنات';
    const result = runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', makeFixtureRepo()]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not normalize to a PascalCase identifier/);
});

test('numeric cache value is rejected (only the storeDuration strings are valid)', () => {
    const result = runScript('generate.js', [writeSpec(makeTmpDir('s'), getSpec({ cache: 6 })), '--repo', makeFixtureRepo()]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a valid storeDuration/);
});

// ------------------------------------------- cross-feature coexistence safety ----

test('two features with substring camel names coexist and unwire independently', () => {
    const repo = makeFixtureRepo();
    const orderSpec = getSpec();
    orderSpec.feature = 'Order';
    const orderPath = writeSpec(makeTmpDir('s'), orderSpec);
    runScript('generate.js', [orderPath, '--repo', repo]);
    runScript('register-di.js', [orderPath, '--repo', repo]);

    const trackingSpec = getSpec({ action: 'listShipments', path: '/v1/ship' });
    trackingSpec.feature = 'OrderTracking';
    const trackingPath = writeSpec(makeTmpDir('s'), trackingSpec);
    runScript('generate.js', [trackingPath, '--repo', repo]);
    runScript('register-di.js', [trackingPath, '--repo', repo]);

    // both registered side by side
    const merger = read(repo, 'src/core/localization/merger.ts');
    assert.match(merger, /^    order,$/m);
    assert.match(merger, /^    orderTracking,$/m);

    // removing the SHORT one must not touch the LONG one anywhere
    fs.copyFileSync(orderPath, path.join(repo, 'src/features/Order/feature-spec.json'));
    const result = runScript('remove-feature.js', ['Order', '--repo', repo, '--apply']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const mergerAfter = read(repo, 'src/core/localization/merger.ts');
    assert.ok(!/^    order,$/m.test(mergerAfter));
    assert.match(mergerAfter, /^    orderTracking,$/m, 'substring sibling survives in merger');
    const keysAfter = read(repo, 'src/data/services/keys.ts');
    assert.ok(!keysAfter.includes('ORDER_LIST_ORDERS'));
    assert.match(keysAfter, /ORDER_TRACKING_LIST_SHIPMENTS/, 'substring sibling survives in keys');
    assert.match(read(repo, 'src/core/di/tokens.ts'), /OrderTrackingService/, 'sibling DI survives');
});

// -------------------------------------------------- lifecycle chain end-state ----

test('append re-running the SAME action is a full no-op (all files skipped, nothing duplicated)', () => {
    const repo = makeFixtureRepo();
    const createPath = writeSpec(makeTmpDir('s'), getSpec());
    runScript('generate.js', [createPath, '--repo', repo]);
    const appendSpec = getSpec();
    appendSpec.mode = 'append';
    const result = runScript('generate.js', [writeSpec(makeTmpDir('s'), appendSpec), '--repo', repo]);
    const manifest = JSON.parse(result.stdout);
    assert.equal(manifest.created.length, 0);
    assert.equal(manifest.needsManual.length, 0);
    const service = read(repo, 'src/features/OrderTracking/data/services/OrderTrackingService.ts');
    assert.equal((service.match(/async listOrders\(/g) || []).length, 1, 'no duplicated method');
});

test('create → register → rename → remove chain leaves the repo fully clean', () => {
    const repo = makeFixtureRepo();
    const spec = getSpec({ cache: '6-hours' });
    const specPath = writeSpec(makeTmpDir('s'), spec);
    runScript('generate.js', [specPath, '--repo', repo]);
    runScript('register-di.js', [specPath, '--repo', repo]);
    fs.copyFileSync(specPath, path.join(repo, 'src/features/OrderTracking/feature-spec.json'));

    let result = runScript('rename-feature.js', ['OrderTracking', 'ShipmentTrace', '--repo', repo, '--apply']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    result = runScript('remove-feature.js', ['ShipmentTrace', '--repo', repo, '--apply']);
    assert.equal(result.status, 0, result.stdout + result.stderr);

    assert.ok(!exists(repo, 'src/features/OrderTracking'));
    assert.ok(!exists(repo, 'src/features/ShipmentTrace'));
    for (const file of ['src/core/di/tokens.ts', 'src/core/di/container.ts', 'src/core/localization/merger.ts', 'src/data/services/keys.ts']) {
        const content = read(repo, file);
        assert.ok(!/OrderTracking|ORDER_TRACKING|orderTracking|ShipmentTrace|SHIPMENT_TRACE|shipmentTrace/.test(content), `${file} still mentions the feature after the chain`);
    }
    // permanent anchors survive the whole chain
    assert.match(read(repo, 'src/core/localization/merger.ts'), /\/\/ <create-feature:i18n-features>/);
    assert.match(read(repo, 'src/data/services/keys.ts'), /\/\/ <create-feature:query-keys>/);
});

// --------------------------------------------- generated hook shape (mixed IO) ----

test('GET with BOTH path and query params: one merged input type feeds the hook', () => {
    const repo = makeFixtureRepo();
    const spec = getSpec({
        path: '/v1/orders/{id}',
        pathParams: [{ name: 'id', type: 'string' }],
        queryParams: [{ name: 'includeHistory', type: 'boolean' }],
        cache: '24-hours',
    });
    const result = runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', repo]);
    assert.equal(result.status, 0, result.stderr);
    const queries = read(repo, 'src/features/OrderTracking/presentation/queries.ts');
    assert.match(queries, /useListOrdersQuery = \(input: ListOrdersInput, options\?: \{ enabled\?: boolean \}\)/);
    assert.match(queries, /enabled: options\?\.enabled \?\? true, storeDuration: '24-hours'/);
    const entity = read(repo, 'src/features/OrderTracking/domain/entities/ListOrdersResult.ts');
    assert.match(entity, /id: string;/);
    assert.match(entity, /includeHistory: boolean;/);
});

test('case-variant feature name is refused instead of polluting the existing dir (macOS FS)', () => {
    const repo = makeFixtureRepo();
    runScript('generate.js', [writeSpec(makeTmpDir('s'), getSpec()), '--repo', repo]); // OrderTracking
    const variant = getSpec();
    variant.feature = 'ORDERTracking';
    const result = runScript('generate.js', [writeSpec(makeTmpDir('s'), variant), '--repo', repo]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /collides case-insensitively/);
    // exact-name re-run stays a legal idempotent no-op
    const rerun = runScript('generate.js', [writeSpec(makeTmpDir('s'), getSpec()), '--repo', repo]);
    assert.equal(rerun.status, 0);
    assert.equal(JSON.parse(rerun.stdout).created.length, 0);
});
