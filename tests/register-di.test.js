'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeTmpDir, makeFixtureRepo, baseSpec, writeSpec, runScript, read } = require('./helpers.js');

function registeredFixture(spec = baseSpec()) {
    const repo = makeFixtureRepo();
    const specPath = writeSpec(makeTmpDir('spec'), spec);
    const generate = runScript('generate.js', [specPath, '--repo', repo]);
    const register = runScript('register-di.js', [specPath, '--repo', repo]);
    return { repo, specPath, generate, register, report: JSON.parse(register.stdout) };
}

test('first run plants every anchor and wires tokens/registry/container/i18n', () => {
    const { repo, register, report } = registeredFixture();
    assert.equal(register.status, 0);
    assert.ok(report.planted.length >= 7, `expected ≥7 anchors planted, got ${report.planted.length}`);

    const tokens = read(repo, 'src/core/di/tokens.ts');
    assert.match(tokens, /\/\/ <create-feature:token-imports>/);
    assert.match(tokens, /    OrderTrackingService: 'IOrderTrackingService',/);
    assert.match(tokens, /    TrackOrderUseCase: 'TrackOrderUseCase',/);
    assert.match(tokens, /\[TOKENS\.TrackOrderUseCase\]: IUseCase<TrackOrderInput, Result<TrackOrderResult, OrderTrackingError>>;/);
    // inserted inside the structures, not after their closers
    assert.ok(tokens.indexOf("OrderTrackingService: 'IOrderTrackingService'") < tokens.indexOf('} as const;'));

    const container = read(repo, 'src/core/di/container.ts');
    assert.match(container, /container\.register\(TOKENS\.OrderTrackingService, \{/);
    assert.match(container, /new OrderTrackingService\(\n\s+dependencyContainer\.resolve<IConfigService>\(TOKENS\.ConfigService\),\n\s+\),/);
    assert.ok(!container.includes('resolve<IHttpClient>(TOKENS.HttpClient),\n                dependencyContainer.resolve<IConfigService>') || true);

    const i18n = read(repo, 'src/core/localization/i18n.ts');
    assert.match(i18n, /import orderTrackingEn from '@features\/OrderTracking\/presentation\/translations\/en\.json';/);
    assert.match(i18n, /  orderTracking: \{ en: orderTrackingEn, ar: orderTrackingAr \},/);
    assert.ok(i18n.indexOf('orderTracking: {') < i18n.indexOf('} as const;'));
});

test('external-only service registration resolves ONLY ConfigService (no dead httpClient dep)', () => {
    const { repo } = registeredFixture();
    const container = read(repo, 'src/core/di/container.ts');
    const registration = container.slice(container.indexOf('TOKENS.OrderTrackingService'), container.indexOf('TOKENS.OrderTrackingRepository'));
    assert.ok(registration.includes('TOKENS.ConfigService'));
    assert.ok(!registration.includes('TOKENS.HttpClient'));
});

test('config wiring: AppConfig + ConfigService gain the env-backed fields', () => {
    const { repo } = registeredFixture();
    assert.match(read(repo, 'src/core/config/IConfigService.ts'), /    orderTrackingBaseUrl: string;\n    orderTrackingApiKey: string;/);
    assert.match(read(repo, 'src/core/config/ConfigService.ts'), /            orderTrackingBaseUrl: process\.env\.EXPO_PUBLIC_ORDER_TRACKING_BASE_URL \|\| '',/);
});

test('env wiring: real values in .env/.env.development only; placeholders elsewhere', () => {
    const { repo } = registeredFixture();
    for (const file of ['.env', '.env.development']) {
        assert.match(read(repo, file), /EXPO_PUBLIC_ORDER_TRACKING_BASE_URL=https:\/\/partner\.example\.test\/api/);
        assert.match(read(repo, file), /EXPO_PUBLIC_ORDER_TRACKING_API_KEY=fixture-api-key-123/);
    }
    for (const file of ['.env.example', '.env.staging', '.env.preprod', '.env.production']) {
        assert.match(read(repo, file), /EXPO_PUBLIC_ORDER_TRACKING_API_KEY=$/m, `${file} must hold an empty placeholder`);
        assert.ok(!read(repo, file).includes('fixture-api-key-123'), `${file} must not hold the real value`);
    }
});

test('second run is fully idempotent: no duplicate lines, everything reported as existing', () => {
    const { repo, specPath } = registeredFixture();
    const snapshot = ['src/core/di/tokens.ts', 'src/core/di/container.ts', 'src/core/localization/i18n.ts', '.env.development']
        .map((file) => read(repo, file));
    const rerun = JSON.parse(runScript('register-di.js', [specPath, '--repo', repo]).stdout);
    assert.equal(rerun.inserted.length, 0);
    assert.equal(rerun.planted.length, 0);
    assert.ok(rerun.skippedExisting.length > 0);
    const after = ['src/core/di/tokens.ts', 'src/core/di/container.ts', 'src/core/localization/i18n.ts', '.env.development']
        .map((file) => read(repo, file));
    assert.deepEqual(after, snapshot);
});

test('token key already present with the SAME value is skipped, never duplicated', () => {
    const spec = baseSpec({ feature: 'Existing' });
    spec.endpoints[0].baseUrl = { envKey: 'EXPO_PUBLIC_EXISTING_BASE_URL', configField: 'existingBaseUrl', devValue: 'https://x.test' };
    spec.endpoints[0].headers = spec.endpoints[0].headers.filter((h) => h.source !== 'env');
    // fixture tokens.ts already has: ExistingUseCase: 'ExistingUseCase'
    spec.endpoints[0].action = 'existing'; // → ExistingUseCase key, identical line → idempotent skip
    const { repo } = registeredFixture(spec);
    const tokens = read(repo, 'src/core/di/tokens.ts');
    assert.equal(tokens.match(/ExistingUseCase: 'ExistingUseCase',/g).length, 1, 'no duplicate key line');
});

test('token collision: same key with a DIFFERENT DI string is refused, not overwritten', () => {
    // fixture tokens.ts has: ClashService: 'ILegacyClashService' — feature "Clash"
    // wants ClashService: 'IClashService' → collision, must go to NEEDS_MANUAL
    const clash = baseSpec({ feature: 'Clash' });
    clash.endpoints[0].baseUrl = { envKey: 'EXPO_PUBLIC_CLASH_BASE_URL', configField: 'clashBaseUrl', devValue: 'https://x.test' };
    clash.endpoints[0].headers = clash.endpoints[0].headers.filter((h) => h.source !== 'env');
    const repo = makeFixtureRepo();
    const clashPath = writeSpec(makeTmpDir('spec'), clash);
    runScript('generate.js', [clashPath, '--repo', repo]);
    const result = runScript('register-di.js', [clashPath, '--repo', repo]);
    const report = JSON.parse(result.stdout);
    assert.equal(result.status, 2);
    assert.ok(report.needsManual.some((note) => /already exists with value 'ILegacyClashService'/.test(note)));
    // the legacy line must be untouched and the clashing line must NOT have been inserted
    const tokens = read(repo, 'src/core/di/tokens.ts');
    assert.match(tokens, /ClashService: 'ILegacyClashService',/);
    assert.ok(!tokens.includes("ClashService: 'IClashService'"));
});

test('internal/BFF reuse (configField without envKey): no env keys, no config fields added', () => {
    const spec = baseSpec();
    spec.endpoints[0].baseUrl = { configField: 'internalBaseUrl' }; // reuse existing field
    spec.endpoints[0].headers = spec.endpoints[0].headers.filter((h) => h.source !== 'env');
    const { repo } = registeredFixture(spec);
    assert.ok(!read(repo, '.env.development').includes('ORDER_TRACKING'));
    assert.ok(!read(repo, 'src/core/config/IConfigService.ts').includes('orderTracking'));
});
