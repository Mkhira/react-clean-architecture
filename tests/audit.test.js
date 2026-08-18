'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeTmpDir, makeFixtureRepo, baseSpec, writeSpec, runScript, read, write, exists } = require('./helpers.js');

const AUDIT_FLAGS = ['--skip-tsc', '--skip-jest']; // tsc/jest need a real toolchain; covered by the repo-copy e2e eval

/** Full pipeline on the fixture repo: generate → register → (optionally break something) → audit. */
function auditedFixture({ mutate } = {}) {
    const repo = makeFixtureRepo();
    const spec = baseSpec();
    const specPath = writeSpec(makeTmpDir('spec'), spec);
    runScript('generate.js', [specPath, '--repo', repo]);
    runScript('register-di.js', [specPath, '--repo', repo]);
    if (mutate) mutate(repo);
    const result = runScript('audit.js', [specPath, '--repo', repo, ...AUDIT_FLAGS]);
    return { repo, spec, specPath, result };
}

test('happy path: a generated+registered feature passes every static check', () => {
    const { result } = auditedFixture();
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /PASS structure/);
    assert.match(result.stdout, /PASS di-wiring/);
    assert.match(result.stdout, /PASS i18n/);
    assert.match(result.stdout, /PASS env-files/);
    assert.match(result.stdout, /PASS secret-hygiene/);
    assert.match(result.stdout, /RESULT: PASS/);
    // rules exist but weren't hand-filled in this fixture → surfaced as a warning, not silence
    assert.match(result.stdout, /WARN todos/);
});

test('structure: a deleted generated file fails the audit and is named', () => {
    const { result } = auditedFixture({
        mutate: (repo) => fs.rmSync(path.join(repo, 'src/features/OrderTracking/data/mappers/TrackOrderMapper.ts')),
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL structure\s+missing: .*TrackOrderMapper\.ts/);
});

test('di-wiring: a missing container registration fails the audit', () => {
    const { result } = auditedFixture({
        mutate: (repo) => {
            const file = path.join(repo, 'src/core/di/container.ts');
            const content = fs.readFileSync(file, 'utf8');
            fs.writeFileSync(file, content.replace(/    container\.register\(TOKENS\.TrackOrderUseCase[\s\S]*?\}\);\n/, ''));
        },
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL di-wiring.*TrackOrderUseCase/);
});

test('env-files: a real-looking value in .env.example fails; a missing key fails', () => {
    const realValueInExample = auditedFixture({
        mutate: (repo) => {
            const file = path.join(repo, '.env.example');
            fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(
                'EXPO_PUBLIC_ORDER_TRACKING_API_KEY=',
                'EXPO_PUBLIC_ORDER_TRACKING_API_KEY=leaked-value'
            ));
        },
    });
    assert.equal(realValueInExample.result.status, 1);
    assert.match(realValueInExample.result.stdout, /REAL-looking value in \.env\.example/);

    const missingKey = auditedFixture({
        mutate: (repo) => {
            const file = path.join(repo, '.env.staging');
            fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^EXPO_PUBLIC_ORDER_TRACKING_API_KEY=$/m, ''));
        },
    });
    assert.equal(missingKey.result.status, 1);
    assert.match(missingKey.result.stdout, /EXPO_PUBLIC_ORDER_TRACKING_API_KEY absent from \.env\.staging/);
});

test('secret-hygiene: a raw secret pasted into generated code fails the audit', () => {
    const { result } = auditedFixture({
        mutate: (repo) => write(repo, 'src/features/OrderTracking/presentation/utils/debug.ts',
            "export const KEY = 'fixture-api-key-123';\n"),
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL secret-hygiene.*debug\.ts/);
});

test('duplicate-paths: a path shared with another feature is a WARN, not a FAIL', () => {
    const repo = makeFixtureRepo();
    const spec = baseSpec();
    spec.endpoints[0].path = '/v2/scancode/savedetails'; // exists in the fixture "legacy" feature
    const specPath = writeSpec(makeTmpDir('spec'), spec);
    runScript('generate.js', [specPath, '--repo', repo]);
    runScript('register-di.js', [specPath, '--repo', repo]);
    const result = runScript('audit.js', [specPath, '--repo', repo, ...AUDIT_FLAGS]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /WARN duplicate-paths.*legacy/);
});

test('status-derivation: an unfilled status TODO blocks the audit until hand-written', () => {
    const repo = makeFixtureRepo();
    const spec = baseSpec();
    spec.endpoints[0].statusEnum = { field: 'status', values: ['ok', 'failed'] };
    const specPath = writeSpec(makeTmpDir('spec'), spec);
    runScript('generate.js', [specPath, '--repo', repo]);
    runScript('register-di.js', [specPath, '--repo', repo]);

    const blocked = runScript('audit.js', [specPath, '--repo', repo, ...AUDIT_FLAGS]);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /FAIL status-derivation/);

    // simulate the Claude hand-fill step, exactly as SKILL.md prescribes
    const mapperPath = path.join(repo, 'src/features/OrderTracking/data/mappers/TrackOrderMapper.ts');
    const mapper = fs.readFileSync(mapperPath, 'utf8');
    fs.writeFileSync(mapperPath, mapper.replace(
        /\s*\/\/ TODO\(claude\): status derivation[^\n]*\n(\s*)status: 'ok',/,
        "\n$1status: dto.OrderStatus === 'IN_TRANSIT' ? 'ok' : 'failed',"
    ));
    const unblocked = runScript('audit.js', [specPath, '--repo', repo, ...AUDIT_FLAGS]);
    assert.match(unblocked.stdout, /PASS status-derivation/);
});

test('reuse-first: re-implementing a shared util is flagged; mapper-local cleanString is exempt', () => {
    const { result, repo, specPath } = auditedFixture({
        mutate: (repo) => write(repo, 'src/features/OrderTracking/presentation/utils/dates.ts',
            'export const formatDateTimeDateMonthYear = (value: string) => value;\n'),
    });
    assert.equal(result.status, 0, 'reuse-first is a WARN, not a FAIL');
    assert.match(result.stdout, /WARN reuse-first.*formatDateTimeDateMonthYear/);
    // cleanString lives in the generated mapper and must NOT be flagged
    assert.ok(!/reuse-first.*cleanString/.test(result.stdout));
});

test('--persist-spec: written only on PASS, and sanitized (no secrets, env references instead)', () => {
    // failing audit → no spec persisted
    const failing = auditedFixture({
        mutate: (repo) => fs.rmSync(path.join(repo, 'src/features/OrderTracking/domain/errors/OrderTrackingError.ts')),
    });
    const failResult = runScript('audit.js', [failing.specPath, '--repo', failing.repo, ...AUDIT_FLAGS, '--persist-spec']);
    assert.equal(failResult.status, 1);
    assert.ok(!exists(failing.repo, 'src/features/OrderTracking/feature-spec.json'));
    assert.match(failResult.stdout, /Spec NOT persisted/);

    // passing audit → sanitized spec persisted
    const passing = auditedFixture();
    const passResult = runScript('audit.js', [passing.specPath, '--repo', passing.repo, ...AUDIT_FLAGS, '--persist-spec']);
    assert.equal(passResult.status, 0);
    const persisted = read(passing.repo, 'src/features/OrderTracking/feature-spec.json');
    assert.ok(!persisted.includes('fixture-api-key-123'), 'secret header value must be stripped');
    assert.ok(!persisted.includes('https://partner.example.test/api'), 'devValue must be stripped');
    assert.match(persisted, /<env:EXPO_PUBLIC_ORDER_TRACKING_API_KEY>/);
    assert.match(persisted, /<env:EXPO_PUBLIC_ORDER_TRACKING_BASE_URL>/);

    // the persisted spec joins the manifest's created list so rollback removes
    // it too (otherwise an aborted run leaves the feature dir behind)
    const manifest = JSON.parse(read(passing.repo, '.claude-skill-manifest.json'));
    assert.ok(manifest.created.includes('src/features/OrderTracking/feature-spec.json'));
    assert.match(persisted, /"value": "<session>"/);
    // provenance and structure survive sanitization (append mode depends on them)
    assert.match(persisted, /"OrderNumber": "input"/);
});

test('audit reminders: session fields and expo-router navigation are always surfaced', () => {
    const spec = baseSpec();
    spec.endpoints[0].requestFieldSources.CustomerId = 'session';
    spec.endpoints[0].requestSample.CustomerId = 7;
    const repo = makeFixtureRepo();
    const specPath = writeSpec(makeTmpDir('spec'), spec);
    runScript('generate.js', [specPath, '--repo', repo]);
    runScript('register-di.js', [specPath, '--repo', repo]);
    const result = runScript('audit.js', [specPath, '--repo', repo, ...AUDIT_FLAGS]);
    assert.match(result.stdout, /Session-sourced fields.*trackOrder\.CustomerId/);
    assert.match(result.stdout, /route file under app\//);
});

test('append + --persist-spec MERGES into the existing persisted spec (endpoints + design kept)', () => {
    const { repo, specPath, spec } = auditedFixture();
    // first persist: the create spec, enriched with a design block
    const createSpec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    createSpec.design = { fileKey: 'abc123', screens: [{ name: 'entry', screenNodeId: '1:2', status: 'verified' }] };
    const createPath = path.join(makeTmpDir('s'), 'create.json');
    fs.writeFileSync(createPath, JSON.stringify(createSpec, null, 2));
    let result = runScript('audit.js', [createPath, '--repo', repo, ...AUDIT_FLAGS, '--persist-spec']);
    assert.equal(result.status, 0, result.stdout);

    // append run: ONE new endpoint only — must not clobber the record
    const appendSpec = JSON.parse(JSON.stringify(createSpec));
    appendSpec.mode = 'append';
    delete appendSpec.design;
    appendSpec.endpoints = [{
        ...createSpec.endpoints[0],
        action: 'cancelOrder',
    }];
    const appendPath = path.join(makeTmpDir('s'), 'append.json');
    fs.writeFileSync(appendPath, JSON.stringify(appendSpec, null, 2));
    runScript('generate.js', [appendPath, '--repo', repo]);
    runScript('register-di.js', [appendPath, '--repo', repo]);
    result = runScript('audit.js', [appendPath, '--repo', repo, ...AUDIT_FLAGS, '--persist-spec']);
    assert.equal(result.status, 0, result.stdout);

    const persisted = JSON.parse(read(repo, 'src/features/OrderTracking/feature-spec.json'));
    assert.equal(persisted.mode, 'create', 'persisted spec stays the full feature record');
    assert.deepEqual(persisted.endpoints.map((e) => e.action).sort(), ['cancelOrder', 'trackOrder']);
    assert.equal(persisted.design.fileKey, 'abc123', 'design block survives the append persist');
});
