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

    const base = 'src/features/order-tracking';
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
    const service = read(repo, 'src/features/order-tracking/data/services/OrderTrackingService.ts');
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
    const endpoints = read(repo, 'src/features/order-tracking/data/endpoints/endpoints.ts');
    assert.match(endpoints, /GET_ORDER_EVENTS: \(orderId: string\) => `\/v1\/orders\/\$\{orderId\}\/events`,/);
    const service = read(repo, 'src/features/order-tracking/data/services/OrderTrackingService.ts');
    assert.match(service, /this\.httpClient\.get<GetOrderEventsResult>\(ORDER_TRACKING_ENDPOINTS\.GET_ORDER_EVENTS\(orderId\), \{ mapper: toGetOrderEventsResult, params: query \}\)/);
    assert.ok(!service.includes('configService'), 'app-only service must not depend on IConfigService');
    // array response → no RequestDTO anywhere
    const dto = read(repo, 'src/features/order-tracking/data/dtos/GetOrderEventsDTO.ts');
    assert.ok(!dto.includes('RequestDTO'));
    assert.match(read(repo, 'src/features/order-tracking/domain/entities/GetOrderEventsResult.ts'), /export type GetOrderEventsResult = GetOrderEventsItem\[\];/);
});

test('response "none": Result<void>, no ResponseDTO, no toDomain', () => {
    const spec = baseSpec();
    spec.endpoints[0].responseSample = null;
    spec.endpoints[0].dateFields = [];
    const { repo } = generateInto(spec);
    const useCase = read(repo, 'src/features/order-tracking/domain/use-cases/TrackOrderUseCase.ts');
    assert.match(useCase, /Result<void, OrderTrackingError>/);
    const dto = read(repo, 'src/features/order-tracking/data/dtos/TrackOrderDTO.ts');
    assert.ok(!dto.includes('ResponseDTO'));
    const mapper = read(repo, 'src/features/order-tracking/data/mappers/TrackOrderMapper.ts');
    assert.ok(!mapper.includes('toDomain'));
});

test('statusEnum: union type emitted, derivation left as an audited TODO', () => {
    const spec = baseSpec();
    spec.endpoints[0].statusEnum = { field: 'status', values: ['delivered', 'lost'] };
    const { repo } = generateInto(spec);
    // the union now derives from the shared domain/constants array (v1.14.0) —
    // the entity imports and re-exports it instead of retyping the literals
    assert.match(read(repo, 'src/features/order-tracking/domain/constants/orderTracking.ts'), /export const TRACK_ORDER_STATUS_VALUES = \['delivered', 'lost'\] as const;/);
    assert.match(read(repo, 'src/features/order-tracking/domain/entities/TrackOrderResult.ts'), /import type \{ TrackOrderStatus \} from '\.\.\/constants\/orderTracking';/);
    assert.match(read(repo, 'src/features/order-tracking/domain/entities/TrackOrderResult.ts'), /export type \{ TrackOrderStatus \};/);
    assert.match(read(repo, 'src/features/order-tracking/data/mappers/TrackOrderMapper.ts'), /TODO\(claude\): status derivation/);
});

test('device provenance: SERVICE gains getDeviceMetadata + DeviceMetadata DTO (v1.8.0: the service owns toDTO)', () => {
    const spec = baseSpec();
    spec.endpoints[0].requestSample.DeviceId = 'd1';
    spec.endpoints[0].requestFieldSources.DeviceId = 'device';
    const { repo } = generateInto(spec);
    const service = read(repo, 'src/features/order-tracking/data/services/OrderTrackingService.ts');
    assert.match(service, /getDeviceMetadata/);
    assert.match(service, /const payload = toTrackOrderRequestDTO\(input, device\);/);
    // the repository is a pure passthrough now — no device fetch, no DTO conversion
    const repository = read(repo, 'src/features/order-tracking/data/repositories/OrderTrackingRepository.ts');
    assert.ok(!repository.includes('getDeviceMetadata'), 'repository must not fetch device metadata');
    assert.ok(!repository.includes('RequestDTO('), 'repository must not convert to the transport DTO');
    assert.match(read(repo, 'src/features/order-tracking/data/dtos/TrackOrderDTO.ts'), /export type DeviceMetadata/);
    assert.match(read(repo, 'src/features/order-tracking/data/mappers/TrackOrderMapper.ts'), /DeviceId: device\.id,/);
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

    const service = read(repo, 'src/features/order-tracking/data/services/OrderTrackingService.ts');
    assert.match(service, /async cancelOrder\(/);
    // v1.8.0: the service receives the domain input and converts via the mapper
    assert.match(service, /import type \{ CancelOrderInput \} from '\.\.\/\.\.\/domain\/entities\/CancelOrderResult';/);
    assert.match(service, /import \{ toCancelOrderRequestDTO \} from '\.\.\/mappers\/CancelOrderMapper';/);
    assert.ok(!/\bCancelOrderRequestDTO\b/.test(service), 'RequestDTO must stay inside the mapper (the service only imports toCancelOrderRequestDTO)');
    const iface = read(repo, 'src/features/order-tracking/domain/IRepositories/IOrderTrackingRepository.ts');
    assert.match(iface, /cancelOrder\(input: CancelOrderInput\): Promise<void>;/);

    // idempotent: second append changes nothing
    const before = service;
    runScript('generate.js', [specPath, '--repo', repo]);
    const second = readManifest(repo);
    assert.equal(second.created.length, 0);
    assert.equal(second.patched.length, 0);
    assert.equal(read(repo, 'src/features/order-tracking/data/services/OrderTrackingService.ts'), before);
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

// ------------------------------------------------- 1.20.0 repo conventions ----

test('1.20.0: mappers are exported functions, never a mapper object', () => {
    const { repo } = generateInto(baseSpec());
    const mapper = read(repo, 'src/features/order-tracking/data/mappers/TrackOrderMapper.ts');
    assert.doesNotMatch(mapper, /export const TrackOrderMapper\s*=\s*\{/, 'no mapper object');
    assert.match(mapper, /export const toTrackOrderResult = \(dto: TrackOrderResponseDTO\): TrackOrderResult => \{/);
    assert.match(mapper, /export const toTrackOrderRequestDTO = \(input: TrackOrderInput\): TrackOrderRequestDTO => \(\{/);
    // every consumer imports the functions by name
    const service = read(repo, 'src/features/order-tracking/data/services/OrderTrackingService.ts');
    assert.match(service, /import \{ toTrackOrderResult, toTrackOrderRequestDTO \} from '\.\.\/mappers\/TrackOrderMapper';/);
    assert.match(service, /return toTrackOrderResult\(dto\);/, 'external host maps the parsed DTO through the function');
    const test = read(repo, 'src/features/order-tracking/test/TrackOrderMapper.test.ts');
    assert.match(test, /import \{ toTrackOrderResult, toTrackOrderRequestDTO \} from '\.\.\/data\/mappers\/TrackOrderMapper';/);
    assert.match(test, /toTrackOrderResult\(SAMPLE as never\)/);
    assert.match(test, /const dto = toTrackOrderRequestDTO\(input\);/);
    // the generated mapper body is a real block at top-level indentation
    assert.match(mapper, /=> \{\n    return \{/);
});

test('1.20.0: the errors file aliases INFRA_ERROR_CODES instead of deriving a local union', () => {
    const { repo } = generateInto(baseSpec());
    const errors = read(repo, 'src/features/order-tracking/domain/errors/OrderTrackingError.ts');
    assert.match(errors, /import type \{ AppError, INFRA_ERROR_CODES \} from '@shared\/types\/errors';/);
    assert.match(errors, /export type ORDER_TRACKING_ERROR_CODES = INFRA_ERROR_CODES;/);
    assert.match(errors, /export const ORDER_TRACKING_ERROR_CODE_VALUES: readonly ORDER_TRACKING_ERROR_CODES\[\] = \[/);
    assert.doesNotMatch(errors, /satisfies/);
    assert.match(errors, /export type OrderTrackingError = AppError;/);
});

test('1.20.0: optional query params render as optional everywhere the query is typed', () => {
    const spec = baseSpec();
    spec.endpoints[0].method = 'GET';
    spec.endpoints[0].requestSample = null;
    spec.endpoints[0].requestFieldSources = {};
    spec.endpoints[0].queryParams = [
        { name: 'page', type: 'number' },
        { name: 'status', type: 'string', optional: true },
    ];
    const { repo } = generateInto(spec);
    const service = read(repo, 'src/features/order-tracking/data/services/OrderTrackingService.ts');
    assert.match(service, /async trackOrder\(query: \{ page: number; status\?: string \}\)/);
    assert.match(read(repo, 'src/features/order-tracking/data/IServices/IOrderTrackingService.ts'), /query: \{ page: number; status\?: string \}/);
    assert.match(read(repo, 'src/features/order-tracking/domain/entities/TrackOrderResult.ts'), /    page: number;\n    status\?: string;/);
    // the flag is validated
    spec.endpoints[0].queryParams[1].optional = 'yes';
    const bad = runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', makeFixtureRepo()]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /optional must be true or false/);
});
