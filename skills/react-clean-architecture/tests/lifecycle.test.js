'use strict';
/**
 * Lifecycle scripts (remove / rename / migrate) + regression tests for the
 * deep-review findings in the core generator templates.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeTmpDir, makeFixtureRepo, baseSpec, writeSpec, runScript, read, exists } = require('./helpers.js');

/** generate + register + persist the sanitized spec (the lifecycle scripts' prerequisite). */
function fullFixture(spec = baseSpec()) {
    const repo = makeFixtureRepo();
    const specPath = writeSpec(makeTmpDir('spec'), spec);
    runScript('generate.js', [specPath, '--repo', repo]);
    runScript('register-di.js', [specPath, '--repo', repo]);
    const audit = runScript('audit.js', [specPath, '--repo', repo, '--skip-tsc', '--skip-jest', '--persist-spec']);
    assert.equal(audit.status, 0, `fixture audit must pass:\n${audit.stdout}`);
    return { repo, specPath };
}

// ---------------------------------------------------- deep-review regressions ----

test('CORE: POST with path AND query params — service/repo/interface signatures all line up', () => {
    const spec = baseSpec();
    spec.endpoints[0].path = '/v1/orders/{orderId}/track';
    spec.endpoints[0].pathParams = [{ name: 'orderId', type: 'string' }];
    spec.endpoints[0].queryParams = [{ name: 'notify', type: 'string' }];
    const repo = makeFixtureRepo();
    runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', repo]);

    const service = read(repo, 'src/features/OrderTracking/data/services/OrderTrackingService.ts');
    // external endpoint: url expression must receive the declared path param;
    // v1.8.0: the service takes the DOMAIN input and builds the payload itself
    assert.match(service, /async trackOrder\(orderId: string, input: TrackOrderInput, query: \{ notify: string \}\)/);
    assert.match(service, /const payload = TrackOrderMapper\.toDTO\(input\);/);
    assert.match(service, /ORDER_TRACKING_ENDPOINTS\.TRACK_ORDER\(orderId\)/);

    const repository = read(repo, 'src/features/OrderTracking/data/repositories/OrderTrackingRepository.ts');
    assert.match(repository, /this\.apiService\.trackOrder\(input\.orderId, input, \{ notify: input\.notify \}\)/);

    const iface = read(repo, 'src/features/OrderTracking/domain/IServices/IOrderTrackingService.ts');
    assert.match(iface, /trackOrder\(orderId: string, input: TrackOrderInput, query: \{ notify: string \}\): Promise<TrackOrderResult>;/);
    assert.ok(!iface.includes('data/dtos'), 'domain interface must not import from data/');
});

test('CORE: app-host POST with query params passes axios params config', () => {
    const spec = baseSpec();
    spec.endpoints[0].hostType = 'app';
    spec.endpoints[0].baseUrl = null;
    spec.endpoints[0].headers = [];
    spec.endpoints[0].queryParams = [{ name: 'notify', type: 'string' }];
    const repo = makeFixtureRepo();
    runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', repo]);
    const service = read(repo, 'src/features/OrderTracking/data/services/OrderTrackingService.ts');
    assert.match(service, /this\.httpClient\.post<TrackOrderResult>\(ORDER_TRACKING_ENDPOINTS\.TRACK_ORDER, payload, \{ mapper: TrackOrderMapper\.toDomain, params: query \}\)/);
});

test('CORE: NON-nullable nested objects map directly — no contradictory ": null" fallback', () => {
    const spec = baseSpec();
    spec.endpoints[0].responseSample = { Meta: { Region: 'SA' }, Ok: true };
    spec.endpoints[0].dateFields = [];
    const repo = makeFixtureRepo();
    runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', repo]);
    const mapper = read(repo, 'src/features/OrderTracking/data/mappers/TrackOrderMapper.ts');
    assert.match(mapper, /meta: toTrackOrderMeta\(dto\.Meta\),/);
    assert.ok(!mapper.includes('dto.Meta != null'), 'no null-fallback for a non-nullable nested object');
    const entity = read(repo, 'src/features/OrderTracking/domain/entities/TrackOrderResult.ts');
    assert.match(entity, /meta: TrackOrderMeta;/);
});

test('CORE: nullable nested objects (override) keep the guarded mapping', () => {
    const spec = baseSpec();
    spec.endpoints[0].responseSample = { Meta: { Region: 'SA' } };
    spec.endpoints[0].typeOverrides = { Meta: 'nullable' };
    spec.endpoints[0].dateFields = [];
    const repo = makeFixtureRepo();
    runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', repo]);
    const mapper = read(repo, 'src/features/OrderTracking/data/mappers/TrackOrderMapper.ts');
    assert.match(mapper, /meta: dto\.Meta \? toTrackOrderMeta\(dto\.Meta\) : null,/);
});

test('CORE: GET with a request body is rejected; colliding input names are rejected', () => {
    let spec = baseSpec();
    spec.endpoints[0].method = 'GET';
    let result = runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', makeTmpDir('r')]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GET endpoints must not carry a request body/);

    spec = baseSpec();
    spec.endpoints[0].path = '/v1/orders/{orderNumber}';
    spec.endpoints[0].pathParams = [{ name: 'orderNumber', type: 'string' }]; // collides with body field OrderNumber
    result = runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', makeTmpDir('r')]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /"orderNumber" appears more than once/);
});

// -------------------------------------------------------- remove-feature.js ----

test('remove: dry run touches nothing; --apply unwires everything but keeps the anchors', () => {
    const { repo } = fullFixture();

    const dry = runScript('remove-feature.js', ['OrderTracking', '--repo', repo]);
    assert.equal(dry.status, 0);
    assert.ok(exists(repo, 'src/features/OrderTracking/feature-spec.json'), 'dry run must not delete');
    assert.match(read(repo, 'src/core/di/tokens.ts'), /OrderTrackingService/);

    const applied = runScript('remove-feature.js', ['OrderTracking', '--repo', repo, '--apply']);
    assert.equal(applied.status, 0, applied.stdout + applied.stderr);
    assert.ok(!exists(repo, 'src/features/OrderTracking'), 'feature dir removed');

    for (const file of ['src/core/di/tokens.ts', 'src/core/di/container.ts', 'src/core/localization/merger.ts',
        'src/data/services/keys.ts',
        'src/core/config/IConfigService.ts', 'src/core/config/ConfigService.ts',
        '.env', '.env.development', '.env.example', '.env.staging', '.env.preprod', '.env.production']) {
        const content = read(repo, file);
        assert.ok(!/OrderTracking|ORDER_TRACKING|orderTracking/.test(content), `${file} still mentions the feature`);
    }
    // permanent infrastructure stays
    assert.match(read(repo, 'src/core/di/tokens.ts'), /\/\/ <create-feature:tokens>/);
    assert.match(read(repo, 'src/core/di/container.ts'), /\/\/ <create-feature:registrations>/);
    assert.match(read(repo, 'src/core/localization/merger.ts'), /\/\/ <create-feature:i18n-features>/);
    // unrelated tokens untouched
    assert.match(read(repo, 'src/core/di/tokens.ts'), /ExistingUseCase: 'ExistingUseCase',/);
});

test('remove: refuses pre-skill features (no persisted spec)', () => {
    const repo = makeFixtureRepo();
    const result = runScript('remove-feature.js', ['legacy', '--repo', repo]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pre-skill feature/);
});

// -------------------------------------------------------- rename-feature.js ----

test('rename: --apply renames dir/files/identifiers/env keys; action-scoped names stay', () => {
    const { repo } = fullFixture();

    const result = runScript('rename-feature.js', ['OrderTracking', 'ShipmentTrace', '--repo', repo, '--apply']);
    assert.equal(result.status, 0, result.stdout + result.stderr);

    assert.ok(!exists(repo, 'src/features/OrderTracking'));
    assert.ok(exists(repo, 'src/features/ShipmentTrace/data/services/ShipmentTraceService.ts'));
    assert.ok(exists(repo, 'src/features/ShipmentTrace/presentation/controller.ts'));

    const tokens = read(repo, 'src/core/di/tokens.ts');
    assert.match(tokens, /ShipmentTraceService: 'IShipmentTraceService',/);
    assert.ok(!tokens.includes('OrderTrackingService'));
    // use-case tokens are ACTION-scoped: unchanged by a feature rename
    assert.match(tokens, /TrackOrderUseCase: 'TrackOrderUseCase',/);

    const service = read(repo, 'src/features/ShipmentTrace/data/services/ShipmentTraceService.ts');
    assert.match(service, /class ShipmentTraceService implements IShipmentTraceService/);
    assert.match(service, /SHIPMENT_TRACE_ENDPOINTS/);
    assert.match(service, /shipmentTraceApiKey/);

    for (const file of ['.env', '.env.development']) {
        assert.match(read(repo, file), /EXPO_PUBLIC_SHIPMENT_TRACE_API_KEY=/);
        assert.ok(!read(repo, file).includes('ORDER_TRACKING'));
    }
    assert.match(read(repo, 'src/core/config/ConfigService.ts'), /shipmentTraceBaseUrl: process\.env\.EXPO_PUBLIC_SHIPMENT_TRACE_BASE_URL/);
    assert.match(read(repo, 'src/core/localization/merger.ts'), /import shipmentTrace from '@features\/ShipmentTrace\/presentation\/translations';/);
    assert.match(read(repo, 'src/core/localization/merger.ts'), /^    shipmentTrace,$/m);

    const persisted = read(repo, 'src/features/ShipmentTrace/feature-spec.json');
    assert.match(persisted, /"feature": "ShipmentTrace"/);
    assert.match(persisted, /EXPO_PUBLIC_SHIPMENT_TRACE_BASE_URL/);
});

test('rename: refuses when the target name already exists in TOKENS', () => {
    const { repo } = fullFixture();
    const result = runScript('rename-feature.js', ['OrderTracking', 'Clash', '--repo', repo]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already has a Clash/);
});

// -------------------------------------------------------- migrate-feature.js ----

test('migrate: regenerates machine-owned files, merges hand-added error codes, preserves hand-written files', () => {
    const { repo } = fullFixture();
    const featureDir = path.join(repo, 'src/features/OrderTracking');

    // simulate a feature generated by OLD templates:
    // 1. old-format errors file with a hand-added code
    fs.writeFileSync(path.join(featureDir, 'domain/errors/OrderTrackingError.ts'), `import type { AppError } from '@shared/types/errors';

export type ORDER_TRACKING_ERROR_CODES =
    | 'NETWORK_ERROR'
    | 'HTTP_ERROR'
    | 'PARSE_ERROR'
    | 'VALIDATION_ERROR'
    | 'ORDER_EXPIRED';

export type OrderTrackingError = Omit<AppError, 'code'> & {
    code: ORDER_TRACKING_ERROR_CODES;
};

export const createOrderTrackingError = (
    code: ORDER_TRACKING_ERROR_CODES,
    message: string,
    originalError?: unknown
): OrderTrackingError => ({ code, message, originalError });

export const isOrderTrackingError = (error: unknown): error is OrderTrackingError =>
    typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
`);
    // 2. old-style service (per-method transport, no shared helpers)
    const servicePath = path.join(featureDir, 'data/services/OrderTrackingService.ts');
    fs.writeFileSync(servicePath, fs.readFileSync(servicePath, 'utf8').replace('private async requestExternal', 'private async oldTransport'));
    // 3. hand-written use case content that must survive
    const useCasePath = path.join(featureDir, 'domain/usecases/TrackOrderUseCase.ts');
    const handWritten = fs.readFileSync(useCasePath, 'utf8').replace('// TODO(claude): implement business rules:', '// HAND WRITTEN RULES');
    fs.writeFileSync(useCasePath, handWritten);
    // 4. un-stamped persisted spec (pre-1.1.0)
    const specPath = path.join(featureDir, 'feature-spec.json');
    const persisted = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    delete persisted.skillVersion;
    fs.writeFileSync(specPath, JSON.stringify(persisted, null, 2));

    const dry = runScript('migrate-feature.js', ['OrderTracking', '--repo', repo]);
    const dryReport = JSON.parse(dry.stdout.slice(0, dry.stdout.lastIndexOf('}') + 1));
    assert.equal(dry.status, 0);
    assert.match(dryReport.fromVersion, /1\.0\.0/);
    assert.ok(dryReport.updated.some((file) => file.endsWith('OrderTrackingError.ts')));
    assert.ok(dryReport.updated.some((file) => file.endsWith('OrderTrackingService.ts')));
    assert.ok(dryReport.preserved.some((file) => file.endsWith('TrackOrderUseCase.ts')));
    assert.match(fs.readFileSync(servicePath, 'utf8'), /oldTransport/, 'dry run must not write');

    const applied = runScript('migrate-feature.js', ['OrderTracking', '--repo', repo, '--apply']);
    assert.equal(applied.status, 0, applied.stdout + applied.stderr);

    const errors = read(repo, 'src/features/OrderTracking/domain/errors/OrderTrackingError.ts');
    assert.match(errors, /ORDER_TRACKING_ERROR_CODE_VALUES = \[/, 'new single-source format');
    assert.match(errors, /'ORDER_EXPIRED',/, 'hand-added code merged');
    assert.match(errors, /\.includes\(/, 'new membership guard');

    assert.match(read(repo, 'src/features/OrderTracking/data/services/OrderTrackingService.ts'), /private async requestExternal/);
    assert.match(read(repo, 'src/features/OrderTracking/domain/usecases/TrackOrderUseCase.ts'), /HAND WRITTEN RULES/, 'hand-written use case preserved');
    const { SKILL_VERSION } = require('../scripts/generate.js');
    assert.ok(read(repo, 'src/features/OrderTracking/feature-spec.json').includes(`"skillVersion": "${SKILL_VERSION}"`));
});

test('migrate: refuses features without a persisted spec', () => {
    const repo = makeFixtureRepo();
    const result = runScript('migrate-feature.js', ['legacy', '--repo', repo]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /persisted spec/);
});
