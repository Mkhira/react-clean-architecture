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

    const service = read(repo, 'src/features/order-tracking/data/services/OrderTrackingService.ts');
    // external endpoint: url expression must receive the declared path param;
    // v1.8.0: the service takes the DOMAIN input and builds the payload itself
    assert.match(service, /async trackOrder\(orderId: string, input: TrackOrderInput, query: \{ notify: string \}\)/);
    assert.match(service, /const payload = TrackOrderMapper\.toDTO\(input\);/);
    assert.match(service, /ORDER_TRACKING_ENDPOINTS\.TRACK_ORDER\(orderId\)/);

    const repository = read(repo, 'src/features/order-tracking/data/repositories/OrderTrackingRepository.ts');
    assert.match(repository, /this\.apiService\.trackOrder\(input\.orderId, input, \{ notify: input\.notify \}\)/);

    const iface = read(repo, 'src/features/order-tracking/data/IServices/IOrderTrackingService.ts');
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
    const service = read(repo, 'src/features/order-tracking/data/services/OrderTrackingService.ts');
    assert.match(service, /this\.httpClient\.post<TrackOrderResult>\(ORDER_TRACKING_ENDPOINTS\.TRACK_ORDER, payload, \{ mapper: TrackOrderMapper\.toDomain, params: query \}\)/);
});

test('CORE: NON-nullable nested objects map directly — no contradictory ": null" fallback', () => {
    const spec = baseSpec();
    spec.endpoints[0].responseSample = { Meta: { Region: 'SA' }, Ok: true };
    spec.endpoints[0].dateFields = [];
    const repo = makeFixtureRepo();
    runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', repo]);
    const mapper = read(repo, 'src/features/order-tracking/data/mappers/TrackOrderMapper.ts');
    assert.match(mapper, /meta: toTrackOrderMeta\(dto\.Meta\),/);
    assert.ok(!mapper.includes('dto.Meta != null'), 'no null-fallback for a non-nullable nested object');
    const entity = read(repo, 'src/features/order-tracking/domain/entities/TrackOrderResult.ts');
    assert.match(entity, /meta: TrackOrderMeta;/);
});

test('CORE: nullable nested objects (override) keep the guarded mapping', () => {
    const spec = baseSpec();
    spec.endpoints[0].responseSample = { Meta: { Region: 'SA' } };
    spec.endpoints[0].typeOverrides = { Meta: 'nullable' };
    spec.endpoints[0].dateFields = [];
    const repo = makeFixtureRepo();
    runScript('generate.js', [writeSpec(makeTmpDir('s'), spec), '--repo', repo]);
    const mapper = read(repo, 'src/features/order-tracking/data/mappers/TrackOrderMapper.ts');
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
    assert.ok(exists(repo, 'src/features/order-tracking/feature-spec.json'), 'dry run must not delete');
    assert.match(read(repo, 'src/core/di/tokens.ts'), /OrderTrackingService/);

    const applied = runScript('remove-feature.js', ['OrderTracking', '--repo', repo, '--apply']);
    assert.equal(applied.status, 0, applied.stdout + applied.stderr);
    assert.ok(!exists(repo, 'src/features/order-tracking'), 'feature dir removed');

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

    assert.ok(!exists(repo, 'src/features/order-tracking'));
    assert.ok(exists(repo, 'src/features/shipment-trace/data/services/ShipmentTraceService.ts'));
    assert.ok(exists(repo, 'src/features/shipment-trace/presentation/controller.ts'));

    const tokens = read(repo, 'src/core/di/tokens.ts');
    assert.match(tokens, /ShipmentTraceService: 'IShipmentTraceService',/);
    assert.ok(!tokens.includes('OrderTrackingService'));
    // use-case tokens are ACTION-scoped: unchanged by a feature rename
    assert.match(tokens, /TrackOrderUseCase: 'TrackOrderUseCase',/);

    const service = read(repo, 'src/features/shipment-trace/data/services/ShipmentTraceService.ts');
    assert.match(service, /class ShipmentTraceService implements IShipmentTraceService/);
    assert.match(service, /SHIPMENT_TRACE_ENDPOINTS/);
    assert.match(service, /shipmentTraceApiKey/);

    for (const file of ['.env', '.env.development']) {
        assert.match(read(repo, file), /EXPO_PUBLIC_SHIPMENT_TRACE_API_KEY=/);
        assert.ok(!read(repo, file).includes('ORDER_TRACKING'));
    }
    assert.match(read(repo, 'src/core/config/ConfigService.ts'), /shipmentTraceBaseUrl: process\.env\.EXPO_PUBLIC_SHIPMENT_TRACE_BASE_URL/);
    assert.match(read(repo, 'src/core/localization/merger.ts'), /import shipmentTrace from '@features\/shipment-trace\/presentation\/translations';/);
    assert.match(read(repo, 'src/core/localization/merger.ts'), /^    shipmentTrace,$/m);

    const persisted = read(repo, 'src/features/shipment-trace/feature-spec.json');
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
    const featureDir = path.join(repo, 'src/features/order-tracking');

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
    const useCasePath = path.join(featureDir, 'domain/use-cases/TrackOrderUseCase.ts');
    const handWritten = fs.readFileSync(useCasePath, 'utf8').replace('// TODO(claude): implement business rules:', '// HAND WRITTEN RULES');
    fs.writeFileSync(useCasePath, handWritten);
    // 4. un-stamped persisted spec (pre-1.1.0)
    const specPath = path.join(featureDir, 'feature-spec.json');
    const persisted = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    delete persisted.skillVersion;
    fs.writeFileSync(specPath, JSON.stringify(persisted, null, 2));

    const dry = runScript('migrate-feature.js', ['OrderTracking', '--repo', repo]);
    const dryReport = JSON.parse(dry.stdout.slice(0, dry.stdout.lastIndexOf('}') + 1));
    // exit 2: the dry run already reports the non-AppError code it must drop
    assert.equal(dry.status, 2);
    assert.match(dryReport.fromVersion, /1\.0\.0/);
    assert.ok(dryReport.updated.some((file) => file.endsWith('OrderTrackingError.ts')));
    assert.ok(dryReport.updated.some((file) => file.endsWith('OrderTrackingService.ts')));
    assert.ok(dryReport.preserved.some((file) => file.endsWith('TrackOrderUseCase.ts')));
    assert.match(fs.readFileSync(servicePath, 'utf8'), /oldTransport/, 'dry run must not write');

    const applied = runScript('migrate-feature.js', ['OrderTracking', '--repo', repo, '--apply']);

    const errors = read(repo, 'src/features/order-tracking/domain/errors/OrderTrackingError.ts');
    assert.match(errors, /ORDER_TRACKING_ERROR_CODE_VALUES = \[/, 'new single-source format');
    assert.match(errors, /\.includes\(/, 'new membership guard');
    // v1.14.0: a feature error IS an AppError, so a hand-added code outside
    // AppError's union cannot be carried over — it is dropped and reported
    // (exit 2) instead of emitting a file that fails tsc.
    assert.doesNotMatch(errors, /'ORDER_EXPIRED'/, 'non-AppError code must not be merged');
    assert.equal(applied.status, 2, 'dropped code is reported as a problem');
    assert.match(applied.stdout, /ORDER_EXPIRED.*DROPPED/s);

    assert.match(read(repo, 'src/features/order-tracking/data/services/OrderTrackingService.ts'), /private async requestExternal/);
    assert.match(read(repo, 'src/features/order-tracking/domain/use-cases/TrackOrderUseCase.ts'), /HAND WRITTEN RULES/, 'hand-written use case preserved');
    // the spec is NOT re-stamped while a problem stands: the dropped code still
    // needs an owner decision, so the migration is deliberately re-runnable
    const { SKILL_VERSION } = require('../scripts/generate.js');
    assert.ok(!read(repo, 'src/features/order-tracking/feature-spec.json').includes(`"skillVersion": "${SKILL_VERSION}"`));

    // once the code is gone from the old file, the migration completes and stamps
    fs.writeFileSync(path.join(featureDir, 'domain/errors/OrderTrackingError.ts'),
        read(repo, 'src/features/order-tracking/domain/errors/OrderTrackingError.ts').replace('AUTH_ERROR', 'AUTH_ERROR'));
    const clean = runScript('migrate-feature.js', ['OrderTracking', '--repo', repo, '--apply']);
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.ok(read(repo, 'src/features/order-tracking/feature-spec.json').includes(`"skillVersion": "${SKILL_VERSION}"`));
});

test('migrate: old layouts are relocated (usecases + 1.11.x data/services interface + domain/repositories) with imports rewritten', () => {
    const { repo } = fullFixture();
    const featureDir = path.join(repo, 'src', 'features', 'order-tracking');

    // simulate a feature stuck on the old layouts: pre-1.11 `usecases` plus the
    // short-lived 1.11.x interface locations, with matching old import paths
    const moveBack = (fromRel, toRel) => {
        fs.mkdirSync(path.join(featureDir, toRel), { recursive: true });
        for (const name of fs.readdirSync(path.join(featureDir, fromRel))) {
            fs.renameSync(path.join(featureDir, fromRel, name), path.join(featureDir, toRel, name));
        }
        fs.rmdirSync(path.join(featureDir, fromRel));
    };
    moveBack('domain/use-cases', 'domain/usecases');
    moveBack('domain/IRepositories', 'domain/repositories');
    fs.renameSync(
        path.join(featureDir, 'data/IServices/IOrderTrackingService.ts'),
        path.join(featureDir, 'data/services/IOrderTrackingService.ts')
    );
    fs.rmdirSync(path.join(featureDir, 'data/IServices'));
    const oldify = (relative, edits) => {
        const file = path.join(featureDir, relative);
        let content = fs.readFileSync(file, 'utf8');
        for (const [from, to] of edits) content = content.replace(from, to);
        fs.writeFileSync(file, content);
    };
    // (the interface's '../../domain/entities/' imports are the same at both
    // data/services and data/IServices depth — no oldify needed there)
    oldify('data/services/OrderTrackingService.ts', [["'../IServices/IOrderTrackingService'", "'./IOrderTrackingService'"]]);
    oldify('data/repositories/OrderTrackingRepository.ts', [
        ["'../../domain/IRepositories/", "'../../domain/repositories/"],
        ["'../IServices/IOrderTrackingService'", "'../services/IOrderTrackingService'"],
    ]);
    oldify('domain/usecases/TrackOrderUseCase.ts', [["'../IRepositories/", "'../repositories/"]]);
    const testsDir = fs.readdirSync(featureDir).includes('test') ? 'test' : '__tests__';
    oldify(`${testsDir}/TrackOrderUseCase.test.ts`, [
        ["'../domain/use-cases/", "'../domain/usecases/"],
        ["'../domain/IRepositories/", "'../domain/repositories/"],
    ]);
    // hand-written marker that must survive the relocation
    oldify('domain/usecases/TrackOrderUseCase.ts', [['// TODO(claude): implement business rules:', '// HAND WRITTEN RULES']]);

    const dry = runScript('migrate-feature.js', ['OrderTracking', '--repo', repo]);
    const dryReport = JSON.parse(dry.stdout.slice(0, dry.stdout.lastIndexOf('}') + 1));
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    assert.ok(dryReport.relocated.some((line) => line.includes('IServices')), 'dry run plans the relocation');
    assert.ok(exists(repo, 'src/features/order-tracking/domain/usecases/TrackOrderUseCase.ts'), 'dry run must not move files');
    assert.ok(exists(repo, 'src/features/order-tracking/data/services/IOrderTrackingService.ts'), 'dry run must not move files');

    const applied = runScript('migrate-feature.js', ['OrderTracking', '--repo', repo, '--apply']);
    assert.equal(applied.status, 0, applied.stdout + applied.stderr);

    assert.ok(exists(repo, 'src/features/order-tracking/data/IServices/IOrderTrackingService.ts'));
    assert.ok(exists(repo, 'src/features/order-tracking/domain/IRepositories/IOrderTrackingRepository.ts'));
    assert.ok(exists(repo, 'src/features/order-tracking/domain/use-cases/TrackOrderUseCase.ts'));
    assert.ok(!exists(repo, 'src/features/order-tracking/data/services/IOrderTrackingService.ts'), 'interface left data/services');
    assert.ok(exists(repo, 'src/features/order-tracking/data/services/OrderTrackingService.ts'), 'service impl stays in data/services');
    assert.ok(!exists(repo, 'src/features/order-tracking/domain/repositories'), 'old dirs removed');
    assert.ok(!exists(repo, 'src/features/order-tracking/domain/usecases'), 'old dirs removed');

    const useCase = read(repo, 'src/features/order-tracking/domain/use-cases/TrackOrderUseCase.ts');
    assert.match(useCase, /HAND WRITTEN RULES/, 'hand-written content moved, not regenerated');
    assert.match(useCase, /'\.\.\/IRepositories\/IOrderTrackingRepository'/, 'old import path rewritten');
    const testFile = read(repo, `src/features/order-tracking/${testsDir}/TrackOrderUseCase.test.ts`);
    assert.match(testFile, /'\.\.\/domain\/use-cases\/TrackOrderUseCase'/);
    assert.match(testFile, /'\.\.\/domain\/IRepositories\/IOrderTrackingRepository'/);
});

test('migrate: refuses features without a persisted spec', () => {
    const repo = makeFixtureRepo();
    const result = runScript('migrate-feature.js', ['legacy', '--repo', repo]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /persisted spec/);
});

test('migrate: never regenerates the hand-enriched mock service', () => {
    const { repo } = fullFixture(baseSpec({ mock: true }));
    const mock = path.join(repo, 'src/features/order-tracking/data/services/OrderTrackingMockService.ts');
    assert.ok(fs.existsSync(mock), 'fixture should have generated a mock service');
    fs.appendFileSync(mock, '\n// hand-enriched catalog marker\n');
    const result = runScript('migrate-feature.js', ['OrderTracking', '--repo', repo, '--apply']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout.slice(0, result.stdout.lastIndexOf('}') + 1));
    assert.ok(report.preserved.some((p) => p.endsWith('OrderTrackingMockService.ts')), 'mock service must be preserved');
    assert.match(fs.readFileSync(mock, 'utf8'), /hand-enriched catalog marker/);
});

test('migrate: refuses to write when the service has drifted from the persisted spec', () => {
    /*
     * Live 2026-09-03: application-status's spec still listed an endpoint the
     * team had replaced by hand; --apply would have regenerated the service
     * from the stale spec and thrown the hand change away.
     */
    const { repo } = fullFixture();
    const service = path.join(repo, 'src/features/order-tracking/data/services/OrderTrackingService.ts');
    const before = fs.readFileSync(service, 'utf8').replace(/\n}\s*$/, '\n    async cancelOrder(): Promise<void> {}\n}\n');
    fs.writeFileSync(service, before);
    const result = runScript('migrate-feature.js', ['OrderTracking', '--repo', repo, '--apply']);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stdout, /spec drift/);
    assert.match(result.stdout, /service has cancelOrder not in the spec/);
    assert.match(result.stdout, /Refused/);
    assert.equal(fs.readFileSync(service, 'utf8'), before, 'nothing may be written under drift');
});

test('migrate: refuses a design-only record instead of crashing on its empty endpoint list', () => {
    /*
     * Design-only runs persist { feature, skillVersion, design } — no endpoints, no
     * generated files. 1.19.0 and earlier crashed inside buildFilePlan on them
     * (TypeError in controllerFile) — live on TaxStampValidation, 2026-09-03.
     */
    const repo = makeFixtureRepo();
    fs.mkdirSync(path.join(repo, 'src/features/tax-stamp'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src/features/tax-stamp/feature-spec.json'), JSON.stringify({
        feature: 'TaxStamp', skillVersion: '1.5.0', design: { screens: [{ name: 'Main', status: 'verified' }] },
    }));
    const result = runScript('migrate-feature.js', ['TaxStamp', '--repo', repo]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /design-only record/);
    assert.doesNotMatch(result.stderr, /TypeError/);
});
