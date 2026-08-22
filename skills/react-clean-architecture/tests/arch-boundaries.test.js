'use strict';
// v1.8.0: architecture dependency rule — domain stays pure (no data/, no @core,
// no framework imports), data never imports presentation, and every generated
// feature passes archBoundaryProblems out of the box.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { archBoundaryProblems, importSpecifiers } = require('../scripts/audit.js');
const { makeTmpDir, makeFixtureRepo, baseSpec, writeSpec, runScript, read } = require('./helpers.js');

function generateInto(spec) {
    const repo = makeFixtureRepo();
    const specPath = writeSpec(makeTmpDir('spec'), spec);
    const result = runScript('generate.js', [specPath, '--repo', repo]);
    return { repo, specPath, result };
}

function writeFeatureFile(repo, relative, content) {
    const full = path.join(repo, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
}

// ------------------------------------------------------ importSpecifiers ----

test('importSpecifiers: named, type-only, multi-line, side-effect, and export-from imports', () => {
    const content = [
        `import { A } from '@shared/types/Result';`,
        `import type {`,
        `    B,`,
        `} from '../../data/dtos/BDTO';`,
        `import 'react-native-gesture-handler';`,
        `export { C } from './C';`,
    ].join('\n');
    assert.deepEqual(importSpecifiers(content), [
        '@shared/types/Result',
        '../../data/dtos/BDTO',
        './C',
        'react-native-gesture-handler',
    ]);
});

// -------------------------------------------------- violations are caught ----

test('domain importing a data DTO is flagged (the original P0 violation)', () => {
    const repo = makeFixtureRepo();
    writeFeatureFile(repo, 'src/features/Dirty/domain/repositories/IDirtyRepository.ts',
        `import type { XRequestDTO } from '../../data/dtos/XDTO';\nexport interface IDirtyService { x(p: XRequestDTO): Promise<void>; }\n`);
    const problems = archBoundaryProblems(repo, 'Dirty');
    assert.equal(problems.length, 1);
    assert.match(problems[0], /IDirtyRepository\.ts imports '\.\.\/\.\.\/data\/dtos\/XDTO' \(outside domain\/\)/);
});

test('domain importing frameworks or @core is flagged; @domain/@shared are allowed', () => {
    const repo = makeFixtureRepo();
    writeFeatureFile(repo, 'src/features/Dirty/domain/use-cases/XUseCase.ts', [
        `import { useEffect } from 'react';`,
        `import axios from 'axios';`,
        `import { useQuery } from '@tanstack/react-query';`,
        `import type { IHttpClient } from '@core/http/IHttpClient';`,
        `import { IUseCase } from '@domain/shared/IUseCase';`,
        `import { Result } from '@shared/types/Result';`,
        `import type { X } from '../entities/X';`,
    ].join('\n') + '\n');
    const flagged = archBoundaryProblems(repo, 'Dirty');
    assert.equal(flagged.length, 4);
    for (const spec of ['react', 'axios', '@tanstack/react-query', '@core/http/IHttpClient']) {
        assert.ok(flagged.some((p) => p.includes(`'${spec}'`)), `expected '${spec}' to be flagged`);
    }
});

test('data importing presentation is flagged; data importing domain is fine', () => {
    const repo = makeFixtureRepo();
    writeFeatureFile(repo, 'src/features/Dirty/data/services/DirtyService.ts', [
        `import { helper } from '../../presentation/utils/helper';`,
        `import type { X } from '../../domain/entities/X';`,
        `import type { IHttpClient } from '@core/http/IHttpClient';`,
    ].join('\n') + '\n');
    const problems = archBoundaryProblems(repo, 'Dirty');
    assert.equal(problems.length, 1);
    assert.match(problems[0], /DirtyService\.ts imports '\.\.\/\.\.\/presentation\/utils\/helper' \(data must not import presentation\)/);
});

test('feature without a domain dir (design-only) reports no problems', () => {
    const repo = makeFixtureRepo();
    assert.deepEqual(archBoundaryProblems(repo, 'Ghost'), []);
});

// ------------------------------------ generated output passes the check ----

test('a generated POST feature (body + device + status) has ZERO boundary problems', () => {
    const spec = baseSpec();
    spec.endpoints[0].requestSample.DeviceId = 'd1';
    spec.endpoints[0].requestFieldSources.DeviceId = 'device';
    const { repo, result } = generateInto(spec);
    assert.equal(result.status, 0);
    assert.deepEqual(archBoundaryProblems(repo, 'OrderTracking'), []);
    // and the domain service interface takes the domain input, not the DTO
    const iface = read(repo, 'src/features/OrderTracking/data/services/IOrderTrackingService.ts');
    assert.match(iface, /input: TrackOrderInput/);
    assert.ok(!iface.includes('RequestDTO'), 'domain interface must not mention the transport DTO');
});

test('audit reports arch-boundaries as a check row', () => {
    const spec = baseSpec();
    const { repo, specPath } = generateInto(spec);
    runScript('register-di.js', [specPath, '--repo', repo]);
    const result = runScript('audit.js', [specPath, '--repo', repo, '--skip-tsc', '--skip-jest']);
    assert.match(result.stdout, /PASS:.*\barch-boundaries\b/);
});

// --------------------------------------------- error taxonomy (v1.8.0 #3) ----

test('generated use case classifies 401/403 as AUTH_ERROR and ECONNABORTED as TIMEOUT', () => {
    const { repo } = generateInto(baseSpec());
    const useCase = read(repo, 'src/features/OrderTracking/domain/use-cases/TrackOrderUseCase.ts');
    assert.match(useCase, /httpStatus === 401 \|\| httpStatus === 403/);
    assert.match(useCase, /createOrderTrackingError\('AUTH_ERROR'/);
    assert.match(useCase, /'ECONNABORTED' \|\| transport\?\.code === 'ETIMEDOUT'/);
    assert.match(useCase, /createOrderTrackingError\('TIMEOUT'/);
    // the envelope-description NETWORK_ERROR fallback survives as the last resort
    assert.match(useCase, /description \|\| 'trackOrder failed'/);

    const errors = read(repo, 'src/features/OrderTracking/domain/errors/OrderTrackingError.ts');
    assert.match(errors, /'AUTH_ERROR',\n    'TIMEOUT',/);

    const useCaseTest = read(repo, 'src/features/OrderTracking/test/TrackOrderUseCase.test.ts');
    assert.match(useCaseTest, /classifies a 401 rejection as AUTH_ERROR/);
    assert.match(useCaseTest, /classifies an aborted request as TIMEOUT/);
});
