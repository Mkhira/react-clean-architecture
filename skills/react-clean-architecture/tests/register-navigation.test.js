'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeTmpDir, makeNavFixtureRepo, baseSpec, writeSpec, runScript, read, write, exists, readManifest } = require('./helpers.js');

/** baseSpec + a design block, the way Screen collection records it. */
function navSpec(cardOverrides = {}) {
    const spec = baseSpec();
    spec.design = {
        fileKey: 'abc123',
        screens: [{ name: 'entry', screenNodeId: '1:2', status: 'pending' }],
        serviceCard: {
            cost: 'free',
            fees: 0,
            serviceTypes: ['tax'],
            userTypes: 'all',
            processingTimeMinutes: 5,
            requiresAuth: false,
            ...cardOverrides,
        },
    };
    return spec;
}

/** Fixture repo + the generated starter screen (full mode: generate.js made it). */
function repoWithStarter() {
    const repo = makeNavFixtureRepo();
    write(repo, 'src/features/order-tracking/presentation/screens/OrderTrackingScreen.tsx',
        'export default function OrderTrackingScreen() { return null; }\n');
    return repo;
}

function runNav(repo, spec) {
    const specPath = writeSpec(makeTmpDir('spec'), spec);
    return { specPath, result: runScript('register-navigation.js', [specPath, '--repo', repo]) };
}

test('happy path: every DESIGN.md §5 registration lands in one run', () => {
    const repo = repoWithStarter();
    const { result } = runNav(repo, navSpec());
    const summary = JSON.parse(result.stdout);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(summary.status, 'REGISTERED');
    assert.equal(summary.serviceId, 'order-tracking');
    assert.equal(summary.pageKey, 'orderTracking');

    const contract = read(repo, 'src/core/navigation/routes/RouteContract.ts');
    assert.match(contract, /orderTracking: RouteDefinition<undefined>;/);
    assert.match(contract, /toHref: \(\) => '\/service-flow\/order-tracking',/);
    assert.match(contract, /'serviceFlow\.orderTracking': routeDefinitionStacks\.serviceFlow\.orderTracking,/);
    // entries use the file's 2-space indent, inside the serviceFlow blocks
    assert.match(contract, /^    orderTracking: RouteDefinition<undefined>;$/m);

    assert.match(read(repo, 'src/core/navigation/routes/Routes.ts'),
        /orderTracking: \(\): AppRoute => \(\{ key: 'serviceFlow\.orderTracking' \}\),/);

    const routeFile = read(repo, 'app/service-flow/order-tracking.tsx');
    assert.match(routeFile, /import OrderTrackingScreen from '@features\/order-tracking\/presentation\/screens\/OrderTrackingScreen';/);
    assert.match(routeFile, /<OrderTrackingScreen \/>/);

    const pages = read(repo, 'src/presentation/service-flow/screens/pages/index.ts');
    assert.match(pages, /registerServiceFlowPage\(\['orderTracking', 'order-tracking'\], \{/);
    assert.match(pages, /titleKey: 'services\.orderTracking\.title',/);

    const services = read(repo, 'src/presentation/services/models/servicesData.ts');
    assert.match(services, /id: 'order-tracking',/);
    assert.match(services, /screen: Routes\.serviceFlow\.orderTracking\(\),/);
    assert.match(services, /userTypes: ALL_USER_TYPES,/);
    assert.match(services, /serviceTypes: \['tax'\] as ServiceTypeKey\[\],/);
    assert.ok(!services.includes('requiresAuth: true'));

    const deeplink = read(repo, 'src/core/deepLinking/DeepLinkingService.ts');
    assert.match(deeplink, /'order-tracking': \(\) => Routes\.serviceFlow\.orderTracking\(\),/);
    assert.match(deeplink, /^\s{4}orderTracking: \(\) => Routes\.serviceFlow\.orderTracking\(\),$/m);

    for (const lang of ['en', 'ar']) {
        const data = JSON.parse(read(repo, `src/core/localization/translations/${lang}.json`));
        assert.match(data.services.orderTracking.title, /TODO\(claude\)/);
        assert.equal(data.services.serviceIntegratedTariff.title, 't', 'existing keys untouched');
    }
    assert.ok(summary.needsClaude.some((line) => line.includes('en.json + ar.json')));

    const featureRoutes = read(repo, 'src/features/order-tracking/presentation/routes.ts');
    assert.match(featureRoutes, /export const ORDER_TRACKING_SERVICE_ID = 'order-tracking';/);
    assert.match(featureRoutes, /export const ORDER_TRACKING_PAGE_KEY = 'orderTracking';/);

    // full mode: the starter screen existed — no placeholder, no needsClaude for it
    assert.ok(!summary.needsClaude.some((line) => line.includes('placeholder')));
});

test('idempotent rerun: nothing duplicated, nothing re-created', () => {
    const repo = repoWithStarter();
    const { specPath } = runNav(repo, navSpec());
    const rerun = JSON.parse(runScript('register-navigation.js', [specPath, '--repo', repo]).stdout);
    assert.equal(rerun.inserted, 0);
    assert.equal(rerun.planted, 0);
    assert.deepEqual(rerun.created, []);
    assert.ok(rerun.skippedExisting > 0);

    for (const [file, probe] of [
        ['src/core/navigation/routes/RouteContract.ts', /orderTracking: RouteDefinition<undefined>;/g],
        ['src/core/navigation/routes/Routes.ts', /key: 'serviceFlow\.orderTracking'/g],
        ['src/presentation/services/models/servicesData.ts', /id: 'order-tracking',/g],
        ['src/core/deepLinking/DeepLinkingService.ts', /'order-tracking': \(\) =>/g],
    ]) {
        assert.equal((read(repo, file).match(probe) || []).length, 1, `${file} has exactly one entry`);
    }
});

test('design-only: manifest created, placeholder flow host generated and flagged', () => {
    const repo = makeNavFixtureRepo(); // no starter screen, no manifest
    const { result } = runNav(repo, navSpec());
    const summary = JSON.parse(result.stdout);
    assert.equal(result.status, 0, result.stdout + result.stderr);

    const placeholder = read(repo, 'src/features/order-tracking/presentation/screens/OrderTrackingScreen.tsx');
    assert.match(placeholder, /TODO\(claude\): replace with the Figma build/);
    assert.ok(summary.needsClaude.some((line) => line.includes('placeholder flow host')));

    const manifest = readManifest(repo);
    assert.equal(manifest.mode, 'design');
    assert.ok(manifest.created.includes('app/service-flow/order-tracking.tsx'));
    assert.ok(manifest.created.includes('src/features/order-tracking/presentation/screens/OrderTrackingScreen.tsx'));
    assert.ok(manifest.created.includes('src/features/order-tracking/presentation/routes.ts'));
    assert.ok(manifest.patched.includes('src/core/navigation/routes/RouteContract.ts'));
    assert.ok(manifest.patched.includes('src/core/deepLinking/DeepLinkingService.ts'));
});

test('full mode: navigation edits merge into the existing generate.js manifest', () => {
    const repo = repoWithStarter();
    fs.writeFileSync(path.join(repo, '.claude-skill-manifest.json'), JSON.stringify({
        feature: 'OrderTracking', mode: 'create',
        created: ['src/features/order-tracking/data/dtos/TrackOrderDTO.ts'],
        patched: ['src/core/di/tokens.ts'],
    }, null, 2));
    runNav(repo, navSpec());
    const manifest = readManifest(repo);
    assert.equal(manifest.mode, 'create', 'existing manifest is merged, not replaced');
    assert.ok(manifest.created.includes('src/features/order-tracking/data/dtos/TrackOrderDTO.ts'));
    assert.ok(manifest.created.includes('app/service-flow/order-tracking.tsx'));
    assert.ok(manifest.patched.includes('src/core/di/tokens.ts'));
    assert.ok(manifest.patched.includes('src/core/navigation/routes/Routes.ts'));
});

test('edited service card: paid/fees/subset user types/requiresAuth all honored', () => {
    const repo = repoWithStarter();
    runNav(repo, navSpec({
        cost: 'paid', fees: 50, serviceTypes: ['customs', 'zakat'],
        userTypes: ['business', 'citizen'], processingTimeMinutes: 30, requiresAuth: true,
    }));
    const services = read(repo, 'src/presentation/services/models/servicesData.ts');
    assert.match(services, /cost: 'paid',/);
    assert.match(services, /fees: 50,/);
    assert.match(services, /serviceTypes: \['customs', 'zakat'\] as ServiceTypeKey\[\],/);
    assert.match(services, /userTypes: \['business', 'citizen'\] as ServiceUserType\[\],/);
    assert.match(services, /processingTimeMinutes: 30,/);
    assert.match(services, /requiresAuth: true,/);
});

test('a full user-type array is normalized to ALL_USER_TYPES', () => {
    const repo = repoWithStarter();
    runNav(repo, navSpec({ userTypes: ['retired', 'citizen', 'resident', 'business'] }));
    assert.match(read(repo, 'src/presentation/services/models/servicesData.ts'), /userTypes: ALL_USER_TYPES,/);
});

test('mangled SERVICES_DATA → needsManual + exit 2, other registrations still land', () => {
    const repo = repoWithStarter();
    write(repo, 'src/presentation/services/models/servicesData.ts', 'export const SOMETHING_ELSE = [];\n');
    const { result } = runNav(repo, navSpec());
    const summary = JSON.parse(result.stdout);
    assert.equal(result.status, 2);
    assert.equal(summary.status, 'NEEDS_MANUAL');
    assert.ok(summary.needsManual.some((line) => line.includes('SERVICES_DATA')));
    assert.match(read(repo, 'src/core/navigation/routes/RouteContract.ts'), /orderTracking: RouteDefinition<undefined>;/);
});

test('pre-existing translation values are never overwritten', () => {
    const repo = repoWithStarter();
    const file = path.join(repo, 'src/core/localization/translations/ar.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.services.orderTracking = { title: 'تتبع الطلب', description: 'وصف' };
    fs.writeFileSync(file, JSON.stringify(data, null, 4) + '\n');
    const { result } = runNav(repo, navSpec());
    const summary = JSON.parse(result.stdout);
    assert.equal(JSON.parse(read(repo, 'src/core/localization/translations/ar.json')).services.orderTracking.title, 'تتبع الطلب');
    assert.ok(summary.skippedExisting >= 1);
    // en.json had no entry — placeholders still added there
    assert.match(JSON.parse(read(repo, 'src/core/localization/translations/en.json')).services.orderTracking.title, /TODO\(claude\)/);
});

test('spec without a design block is rejected before touching anything', () => {
    const repo = repoWithStarter();
    const { result } = runNav(repo, baseSpec());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no design block/);
    assert.ok(!exists(repo, 'app/service-flow/order-tracking.tsx'));
});

test('existing route file and feature routes.ts are never overwritten', () => {
    const repo = repoWithStarter();
    write(repo, 'app/service-flow/order-tracking.tsx', '// hand-written route\n');
    write(repo, 'src/features/order-tracking/presentation/routes.ts', '// hand-written routes\n');
    const { result } = runNav(repo, navSpec());
    const summary = JSON.parse(result.stdout);
    assert.equal(read(repo, 'app/service-flow/order-tracking.tsx'), '// hand-written route\n');
    assert.equal(read(repo, 'src/features/order-tracking/presentation/routes.ts'), '// hand-written routes\n');
    assert.ok(summary.skippedExisting >= 2);
    assert.deepEqual(summary.created, []);
});
