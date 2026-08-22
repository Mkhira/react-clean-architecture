'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { featureModel } = require('../scripts/generate.js');
const { makeTmpDir, makeFixtureRepo, baseSpec, writeSpec, runScript, read, exists, write, readManifest } = require('./helpers.js');

// ---------------------------------------------------------------- naming ----

test('featureModel derives every name convention from the spec', () => {
    const f = featureModel(baseSpec());
    assert.equal(f.feature, 'OrderTracking');
    assert.equal(f.featureCamel, 'orderTracking');
    assert.equal(f.FEATURE_SNAKE, 'ORDER_TRACKING');
    assert.equal(f.serviceClass, 'OrderTrackingService');
    assert.equal(f.serviceInterface, 'IOrderTrackingService');
    assert.equal(f.repositoryClass, 'OrderTrackingRepository');
    assert.equal(f.errorType, 'OrderTrackingError');
    assert.equal(f.errorCodeValues, 'ORDER_TRACKING_ERROR_CODE_VALUES');
    const e = f.endpoints[0];
    assert.equal(e.ActionPascal, 'TrackOrder');
    assert.equal(e.endpointKey, 'TRACK_ORDER');
    assert.equal(e.useCase, 'TrackOrderUseCase');
    assert.equal(e.requestDTO, 'TrackOrderRequestDTO');
    assert.equal(e.entity, 'TrackOrderResult');
});

test('featureModel: input fields come from provenance (input/session) + path/query params', () => {
    const spec = baseSpec();
    spec.endpoints[0].requestFieldSources = { OrderNumber: 'input', CustomerId: 'session', At: 'timestamp' };
    spec.endpoints[0].requestSample = { OrderNumber: 'x', CustomerId: 7, At: 'now' };
    const e = featureModel(spec).endpoints[0];
    const names = e.inputFields.map((field) => field.name);
    assert.deepEqual(names, ['orderNumber', 'customerId']); // timestamp excluded
    assert.equal(e.inputFields[1].type, 'number');
    assert.equal(e.inputFields[1].session, true);
});

// ---------------------------------------------------------- create mode ----

function generateInto(spec) {
    const repo = makeFixtureRepo();
    const specPath = writeSpec(makeTmpDir('spec'), spec);
    const result = runScript('generate.js', [specPath, '--repo', repo]);
    return { repo, specPath, result, manifest: readManifest(repo) };
}

test('create mode: full tree, anchors, and manifest; never overwrites on re-run', () => {
    const { repo, specPath, result, manifest } = generateInto(baseSpec());
    assert.equal(result.status, 0);
    assert.ok(manifest.created.length >= 15);
    assert.equal(manifest.skipped.length, 0);

    const base = 'src/features/OrderTracking';
    for (const file of [
        `${base}/data/endpoints/endpoints.ts`,
        `${base}/data/services/OrderTrackingService.ts`,
        `${base}/domain/use-cases/TrackOrderUseCase.ts`,
        `${base}/test/TrackOrderMapper.test.ts`,
        `${base}/presentation/controller.ts`,
        `${base}/presentation/screens/OrderTrackingScreen.tsx`,
        `${base}/presentation/translations/ar.ts`,
        `${base}/presentation/translations/index.ts`,
        `${base}/presentation/components/.gitkeep`,
    ]) {
        assert.ok(exists(repo, file), `missing ${file}`);
    }
    assert.match(read(repo, `${base}/data/endpoints/endpoints.ts`), /\/\/ <create-feature:endpoints>/);
    assert.match(read(repo, `${base}/data/services/OrderTrackingService.ts`), /\/\/ <create-feature:methods>/);

    // second run: everything already exists → skipped, nothing clobbered
    const before = read(repo, `${base}/data/services/OrderTrackingService.ts`);
    runScript('generate.js', [specPath, '--repo', repo]);
    const rerun = readManifest(repo);
    assert.equal(rerun.created.length, 0);
    assert.equal(rerun.skipped.length, manifest.created.length);
    assert.equal(read(repo, `${base}/data/services/OrderTrackingService.ts`), before);
});

test('external service: shared transport helpers, session header excluded, secrets never inlined', () => {
    const { repo } = generateInto(baseSpec());
    const service = read(repo, 'src/features/OrderTracking/data/services/OrderTrackingService.ts');
    assert.match(service, /private async requestExternal\(/);
    assert.match(service, /private async parseExternalJson</);
    assert.match(service, /AbortController/);
    assert.match(service, /"x-api-key": orderTrackingApiKey,/); // env header → config field
    assert.ok(!service.includes('Authorization'), 'session header must be omitted');
    assert.ok(!service.includes('fixture-api-key-123'), 'secret value must never be inlined');
    assert.ok(!service.includes('httpClient'), 'external-only service must not depend on IHttpClient');
});

test('app GET with query + path params: axios params config and function endpoint entry', () => {
    const spec = baseSpec();
    spec.endpoints[0] = {
        ...spec.endpoints[0],
        action: 'getOrderEvents',
        method: 'GET',
        path: '/v1/orders/{orderId}/events',
        pathParams: [{ name: 'orderId', type: 'string' }],
        queryParams: [{ name: 'from', type: 'string' }],
        hostType: 'app',
        baseUrl: null,
        headers: [],
        requestSample: null,
        requestFieldSources: {},
        responseSample: [{ EventId: 1, At: '2025-01-01T00:00:00Z' }],
        dateFields: ['At'],
    };
    const { repo } = generateInto(spec);
    const endpoints = read(repo, 'src/features/OrderTracking/data/endpoints/endpoints.ts');
    assert.match(endpoints, /GET_ORDER_EVENTS: \(orderId: string\) => `\/v1\/orders\/\$\{orderId\}\/events`,/);
    const service = read(repo, 'src/features/OrderTracking/data/services/OrderTrackingService.ts');
    assert.match(service, /this\.httpClient\.get<GetOrderEventsResult>\(ORDER_TRACKING_ENDPOINTS\.GET_ORDER_EVENTS\(orderId\), \{ mapper: GetOrderEventsMapper\.toDomain, params: query \}\)/);
    assert.ok(!service.includes('configService'), 'app-only service must not depend on IConfigService');
    // array response → no RequestDTO anywhere
    const dto = read(repo, 'src/features/OrderTracking/data/dtos/GetOrderEventsDTO.ts');
    assert.ok(!dto.includes('RequestDTO'));
    assert.match(read(repo, 'src/features/OrderTracking/domain/entities/GetOrderEventsResult.ts'), /export type GetOrderEventsResult = GetOrderEventsItem\[\];/);
});

test('response "none": Result<void>, no ResponseDTO, no toDomain', () => {
    const spec = baseSpec();
    spec.endpoints[0].responseSample = null;
    spec.endpoints[0].dateFields = [];
    const { repo } = generateInto(spec);
    const useCase = read(repo, 'src/features/OrderTracking/domain/use-cases/TrackOrderUseCase.ts');
    assert.match(useCase, /Result<void, OrderTrackingError>/);
    const dto = read(repo, 'src/features/OrderTracking/data/dtos/TrackOrderDTO.ts');
    assert.ok(!dto.includes('ResponseDTO'));
    const mapper = read(repo, 'src/features/OrderTracking/data/mappers/TrackOrderMapper.ts');
    assert.ok(!mapper.includes('toDomain'));
});

test('statusEnum: union type emitted, derivation left as an audited TODO', () => {
    const spec = baseSpec();
    spec.endpoints[0].statusEnum = { field: 'status', values: ['delivered', 'lost'] };
    const { repo } = generateInto(spec);
    assert.match(read(repo, 'src/features/OrderTracking/domain/entities/TrackOrderResult.ts'), /export type TrackOrderStatus = 'delivered' \| 'lost';/);
    assert.match(read(repo, 'src/features/OrderTracking/data/mappers/TrackOrderMapper.ts'), /TODO\(claude\): status derivation/);
});

test('device provenance: SERVICE gains getDeviceMetadata + DeviceMetadata DTO (v1.8.0: the service owns toDTO)', () => {
    const spec = baseSpec();
    spec.endpoints[0].requestSample.DeviceId = 'd1';
    spec.endpoints[0].requestFieldSources.DeviceId = 'device';
    const { repo } = generateInto(spec);
    const service = read(repo, 'src/features/OrderTracking/data/services/OrderTrackingService.ts');
    assert.match(service, /getDeviceMetadata/);
    assert.match(service, /const payload = TrackOrderMapper\.toDTO\(input, device\);/);
    // the repository is a pure passthrough now — no device fetch, no DTO conversion
    const repository = read(repo, 'src/features/OrderTracking/data/repositories/OrderTrackingRepository.ts');
    assert.ok(!repository.includes('getDeviceMetadata'), 'repository must not fetch device metadata');
    assert.ok(!repository.includes('toDTO'), 'repository must not convert to the transport DTO');
    assert.match(read(repo, 'src/features/OrderTracking/data/dtos/TrackOrderDTO.ts'), /export type DeviceMetadata/);
    assert.match(read(repo, 'src/features/OrderTracking/data/mappers/TrackOrderMapper.ts'), /DeviceId: device\.id,/);
});

test('spec validation: missing required fields exits non-zero with a message', () => {
    const specPath = writeSpec(makeTmpDir('spec'), { feature: 'X', mode: 'create' });
    const result = runScript('generate.js', [specPath, '--repo', makeTmpDir('empty')]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing "endpoints"/);
});

// ---------------------------------------------------------- append mode ----

test('append mode: inserts at anchors with imports, idempotent on re-run', () => {
    const { repo } = generateInto(baseSpec());
    const appendSpec = baseSpec({ mode: 'append' });
    appendSpec.endpoints = [{
        ...baseSpec().endpoints[0],
        action: 'cancelOrder',
        path: '/v1/orders/cancel',
        responseSample: null,
        dateFields: [],
        statusEnum: null,
    }];
    const specPath = writeSpec(makeTmpDir('spec'), appendSpec);

    runScript('generate.js', [specPath, '--repo', repo]);
    const first = readManifest(repo);
    assert.ok(first.created.some((file) => file.endsWith('CancelOrderUseCase.ts')));
    assert.ok(first.patched.some((file) => file.endsWith('endpoints.ts')));
    assert.equal(first.needsManual.length, 0);

    const service = read(repo, 'src/features/OrderTracking/data/services/OrderTrackingService.ts');
    assert.match(service, /async cancelOrder\(/);
    // v1.8.0: the service receives the domain input and converts via the mapper
    assert.match(service, /import type \{ CancelOrderInput \} from '\.\.\/\.\.\/domain\/entities\/CancelOrderResult';/);
    assert.match(service, /import \{ CancelOrderMapper \} from '\.\.\/mappers\/CancelOrderMapper';/);
    assert.ok(!service.includes('CancelOrderRequestDTO'), 'RequestDTO must stay inside the mapper');
    const iface = read(repo, 'src/features/OrderTracking/domain/IRepositories/IOrderTrackingRepository.ts');
    assert.match(iface, /cancelOrder\(input: CancelOrderInput\): Promise<void>;/);

    // idempotent: second append changes nothing
    const before = service;
    runScript('generate.js', [specPath, '--repo', repo]);
    const second = readManifest(repo);
    assert.equal(second.created.length, 0);
    assert.equal(second.patched.length, 0);
    assert.equal(read(repo, 'src/features/OrderTracking/data/services/OrderTrackingService.ts'), before);
});

test('append to a pre-skill feature: NO files created, NEEDS_MANUAL fallback', () => {
    const repo = makeFixtureRepo();
    const appendSpec = baseSpec({ feature: 'legacy', mode: 'append' });
    const specPath = writeSpec(makeTmpDir('spec'), appendSpec);
    const result = runScript('generate.js', [specPath, '--repo', repo]);
    const manifest = readManifest(repo);
    assert.equal(result.status, 2);
    assert.equal(manifest.created.length, 0);
    assert.match(manifest.needsManual[0], /not a skill-generated feature/);
});

test('append that adds a FIRST external endpoint to an app-only service reports the ctor + helper gaps', () => {
    const appOnly = baseSpec();
    appOnly.endpoints[0] = {
        ...appOnly.endpoints[0],
        hostType: 'app',
        baseUrl: null,
        headers: [],
    };
    const { repo } = generateInto(appOnly);

    const appendSpec = baseSpec({ mode: 'append' });
    appendSpec.endpoints = [{ ...baseSpec().endpoints[0], action: 'syncOrder', path: '/v1/orders/sync' }];
    const specPath = writeSpec(makeTmpDir('spec'), appendSpec);
    runScript('generate.js', [specPath, '--repo', repo]);
    const manifest = readManifest(repo);
    assert.ok(manifest.needsManual.some((note) => note.includes('ctor lacks configService')));
    assert.ok(manifest.needsManual.some((note) => note.includes('requestExternal')));
});
