'use strict';
/**
 * Regression tests for the v1.6.0 improvements (2026-08-19 live-run findings):
 *  - mock backend lane (spec.mock): MockService generation + DI registration
 *  - cache "always-fresh" → staleTime: 0 in the query hook
 *  - audit's tsc baseline diff ignores line/column shifts (multiset compare)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateSpec } = require('../scripts/generate.js');
const { normalizeTscError, freshTscErrors } = require('../scripts/audit.js');
const { makeTmpDir, makeFixtureRepo, baseSpec, writeSpec, runScript, read, exists, readManifest } = require('./helpers.js');

/** An app-host GET endpoint (the shape the cache question applies to). */
function getEndpoint(overrides = {}) {
    return {
        action: 'getOrders',
        method: 'GET',
        path: '/v1/orders',
        pathParams: [],
        queryParams: [{ name: 'page', type: 'number' }],
        hostType: 'app',
        baseUrl: null,
        headers: [],
        requestSample: null,
        requestFieldSources: {},
        responseSample: { Items: [{ OrderNumber: 'ORD-1', Status: 'OPEN' }], TotalCount: 1 },
        typeOverrides: {},
        dateFields: [],
        statusEnum: null,
        userStory: null,
        rules: [],
        cache: null,
        ...overrides,
    };
}

function generateInto(spec) {
    const repo = makeFixtureRepo();
    const specPath = writeSpec(makeTmpDir('spec'), spec);
    const result = runScript('generate.js', [specPath, '--repo', repo]);
    return { repo, specPath, result, manifest: exists(repo, '.claude-skill-manifest.json') ? readManifest(repo) : {} };
}

// ------------------------------------------------------------- mock lane ----

test('mock: true generates <Feature>MockService next to the real service', () => {
    const spec = baseSpec({ mock: true });
    spec.endpoints.push(getEndpoint());
    const { repo, result } = generateInto(spec);
    assert.equal(result.status, 0);

    const base = 'src/features/OrderTracking/data/services';
    assert.ok(exists(repo, `${base}/OrderTrackingService.ts`), 'real service still generated for the later swap');
    assert.ok(exists(repo, `${base}/OrderTrackingMockService.ts`), 'mock service generated');

    const mock = read(repo, `${base}/OrderTrackingMockService.ts`);
    assert.match(mock, /implements IOrderTrackingService/);
    assert.match(mock, /const TRACK_ORDER_SAMPLE: TrackOrderResponseDTO =/, 'sample typed as the DTO');
    assert.match(mock, /TrackOrderMapper\.toDomain\(TRACK_ORDER_SAMPLE\)/, 'sample flows through the REAL mapper');
    assert.match(mock, /const GET_ORDERS_SAMPLE: GetOrdersResponseDTO =/);
    assert.match(mock, /async getOrders\(_query:/, 'unused params underscore-prefixed');
    assert.match(mock, /\/\/ <create-feature:methods>/, 'append anchor present');
    assert.match(mock, /TODO\(claude\): enrich the sample catalog/);
    assert.match(mock, /swap the\n \* TOKENS\.OrderTrackingService registration back to OrderTrackingService/);
});

test('mock: true — manifest tells Claude to enrich the mock catalog', () => {
    const { manifest } = generateInto(baseSpec({ mock: true }));
    assert.ok(
        manifest.needsClaude.some((entry) => entry.includes('OrderTrackingMockService.ts') && entry.includes('enrich')),
        `needsClaude should mention the mock: ${JSON.stringify(manifest.needsClaude)}`
    );
});

test('mock omitted / false: no MockService is generated', () => {
    const { repo } = generateInto(baseSpec());
    assert.ok(!exists(repo, 'src/features/OrderTracking/data/services/OrderTrackingMockService.ts'));
});

test('validateSpec rejects a non-boolean mock', () => {
    const problems = validateSpec(baseSpec({ mock: 'yes' }));
    assert.ok(problems.some((p) => p.includes('mock must be a boolean')), problems.join('; '));
    assert.equal(validateSpec(baseSpec({ mock: true })).length, 0);
});

test('register-di with mock: container registers the MockService with a swap comment', () => {
    const spec = baseSpec({ mock: true });
    const { repo, specPath, result } = generateInto(spec);
    assert.equal(result.status, 0);
    const di = runScript('register-di.js', [specPath, '--repo', repo]);
    assert.equal(di.status, 0, di.stderr);

    const container = read(repo, 'src/core/di/container.ts');
    assert.match(container, /import \{ OrderTrackingMockService \} from '@features\/OrderTracking\/data\/services\/OrderTrackingMockService';/);
    assert.match(container, /useFactory: \(\) => new OrderTrackingMockService\(\)/);
    assert.match(container, /MOCK backend \(spec\.mock\)/, 'swap comment present');
    assert.doesNotMatch(container, /import \{ OrderTrackingService \}/, 'real service NOT imported (would be a dead import)');
    // repository + use case registrations are unchanged by the mock lane
    assert.match(container, /new OrderTrackingRepository\(/);
    assert.match(container, /new TrackOrderUseCase\(/);
});

test('mock append: a new endpoint gets a self-contained mock method at the anchor', () => {
    const createSpec = baseSpec({ mock: true });
    const { repo } = generateInto(createSpec);

    const appendSpec = baseSpec({ mock: true, mode: 'append' });
    appendSpec.endpoints = [getEndpoint()];
    const specPath = writeSpec(makeTmpDir('spec'), appendSpec);
    const result = runScript('generate.js', [specPath, '--repo', repo]);
    // the external→mixed-host ctor note is expected (pre-existing behavior);
    // the MOCK insert itself must need no manual work
    const manual = JSON.parse(result.stdout).needsManual;
    assert.ok(!manual.some((entry) => entry.includes('MockService')), JSON.stringify(manual));

    const mock = read(repo, 'src/features/OrderTracking/data/services/OrderTrackingMockService.ts');
    assert.match(mock, /async getOrders\(_query:/);
    // append inserts inside the class body, so the sample must be a LOCAL const
    assert.match(mock, /const sample: GetOrdersResponseDTO =/);
    assert.match(mock, /GetOrdersMapper\.toDomain\(sample\)/);
    assert.doesNotMatch(mock, /const GET_ORDERS_SAMPLE/, 'no module-scope const injected into the class body');
});

// ------------------------------------------------------- cache semantics ----

test('cache "always-fresh" emits staleTime: 0 (and no storeDuration) in the query hook', () => {
    const spec = baseSpec();
    spec.endpoints = [getEndpoint({ cache: 'always-fresh' })];
    const { repo, result } = generateInto(spec);
    assert.equal(result.status, 0, result.stderr);
    const queries = read(repo, 'src/features/OrderTracking/presentation/queries.ts');
    assert.match(queries, /staleTime: 0/);
    assert.doesNotMatch(queries, /storeDuration/);
});

test('cache duration still emits storeDuration; null emits neither', () => {
    const spec = baseSpec();
    spec.endpoints = [getEndpoint({ cache: '6-hours' })];
    const { repo } = generateInto(spec);
    const queries = read(repo, 'src/features/OrderTracking/presentation/queries.ts');
    assert.match(queries, /storeDuration: '6-hours'/);
    assert.doesNotMatch(queries, /staleTime/);

    const plain = baseSpec();
    plain.endpoints = [getEndpoint()];
    const { repo: repo2 } = generateInto(plain);
    const queries2 = read(repo2, 'src/features/OrderTracking/presentation/queries.ts');
    assert.doesNotMatch(queries2, /storeDuration|staleTime/);
});

test('validateSpec accepts always-fresh and still rejects unknown cache values', () => {
    const ok = baseSpec();
    ok.endpoints = [getEndpoint({ cache: 'always-fresh' })];
    assert.equal(validateSpec(ok).length, 0);

    const bad = baseSpec();
    bad.endpoints = [getEndpoint({ cache: 'forever' })];
    assert.ok(validateSpec(bad).some((p) => p.includes('not a valid storeDuration')));
});

// -------------------------------------------- tsc diff line-insensitivity ----

test('freshTscErrors ignores line/column shifts of baseline errors', () => {
    const baseline = ["src/core/navigation/routes/Routes.ts(84,40): error TS2339: Property 'contactWithFahes' does not exist."];
    const current = ["src/core/navigation/routes/Routes.ts(85,40): error TS2339: Property 'contactWithFahes' does not exist."];
    assert.deepEqual(freshTscErrors(baseline, current), [], 'a line-shifted baseline error is NOT new');
});

test('freshTscErrors still reports genuinely new and duplicated errors', () => {
    const err = (line) => `src/a.ts(${line},1): error TS1111: boom.`;
    // same error appearing TWICE while baseline had it once → one of them is new
    assert.deepEqual(freshTscErrors([err(1)], [err(1), err(9)]), [err(9)]);
    // different message is new regardless of position
    const other = 'src/b.ts(1,1): error TS2222: other.';
    assert.deepEqual(freshTscErrors([err(1)], [other]), [other]);
});

test('normalizeTscError strips only the position, keeping file + code + message', () => {
    assert.equal(
        normalizeTscError("src/x.ts(12,34): error TS2551: Property 'y' does not exist."),
        "src/x.ts: error TS2551: Property 'y' does not exist."
    );
});
