#!/usr/bin/env node
/**
 * register-di.js — wire a generated feature into the app: tsyringe DI
 * (tokens.ts + container.ts), i18n (merger.ts featureTranslations), react-query
 * keys (data/services/keys.ts), AppConfig / ConfigService fields, and the SIX
 * .env files. Node stdlib only.
 *
 * Usage:
 *   node register-di.js <feature-spec.json> [--repo <path>]
 *   node register-di.js --help
 *
 * First run ever: plants permanent anchor comments (a one-time, owner-approved
 * edit). Every run: inserts at anchors, idempotent (skips lines already
 * present). Env values: REAL values go only to `.env` + `.env.development`;
 * `.env.example`, `.env.staging`, `.env.preprod`, `.env.production` get empty
 * placeholders (all committed to git — never put real values there).
 *
 * Prints a JSON report; a NEEDS_MANUAL section lists anything Claude must edit
 * by hand (missing anchors, ctor changes, token collisions).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { featureModel, queryKeyName, queryKeyValue, resolveFeatureDir } = require('./generate.js');

const HELP = `register-di.js — register a generated feature in DI, i18n, config, and env files.

Usage:
  node register-di.js <feature-spec.json> [--repo <path>]
  node register-di.js --help

--repo defaults to the current working directory (run from the target repo root).
Idempotent: lines already present are skipped. Prints a JSON report with a
NEEDS_MANUAL section for anything that requires a hand edit.`;

const REAL_VALUE_ENV_FILES = ['.env', '.env.development'];
const PLACEHOLDER_ENV_FILES = ['.env.example', '.env.staging', '.env.preprod', '.env.production'];

const report = { planted: [], inserted: [], skippedExisting: [], envAppended: [], patched: [], needsManual: [] };

/** Every file actually modified — merged into the generate.js manifest so rollback.js can restore them. */
const touchedFiles = new Set();

function read(file) {
    return fs.readFileSync(file, 'utf8');
}

function write(file, content) {
    const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (previous === content) return; // no-op runs leave no trace
    fs.writeFileSync(file, content);
    touchedFiles.add(file);
}

/** Insert `text` before the first line containing `anchor`. Returns null if missing. */
function insertBeforeAnchor(content, anchor, text) {
    const lines = content.split('\n');
    const index = lines.findIndex((line) => line.includes(anchor));
    if (index === -1) return null;
    lines.splice(index, 0, ...text.split('\n'));
    return lines.join('\n');
}

/** Insert `text` after the first line containing `anchor`. Returns null if missing. */
function insertAfterAnchor(content, anchor, text) {
    const lines = content.split('\n');
    const index = lines.findIndex((line) => line.includes(anchor));
    if (index === -1) return null;
    lines.splice(index + 1, 0, ...text.split('\n'));
    return lines.join('\n');
}

/** Index of the last import-ish line (`import …` or a multi-line `} from '…';`). */
function lastImportLineIndex(lines, filterRe = null) {
    let last = -1;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const isImport = /^import\b/.test(line) || /^\} from '.*';/.test(line) || /^} from '.*';/.test(line);
        if (isImport && (!filterRe || filterRe.test(line))) last = index;
    }
    return last;
}

function plantAnchorAfterLine(file, content, anchor, lineIndex, label) {
    if (content.includes(anchor)) return content;
    const lines = content.split('\n');
    if (lineIndex < 0) {
        report.needsManual.push(`${label}: could not find where to plant "${anchor}" — plant it by hand`);
        return content;
    }
    lines.splice(lineIndex + 1, 0, anchor);
    report.planted.push(`${label}: ${anchor}`);
    return lines.join('\n');
}

function plantAnchorBeforeMatch(file, content, anchor, matchRe, label, indent = '') {
    if (content.includes(anchor)) return content;
    const lines = content.split('\n');
    const index = lines.findIndex((line) => matchRe.test(line));
    if (index === -1) {
        report.needsManual.push(`${label}: could not find where to plant "${anchor}" (looked for ${matchRe}) — plant it by hand`);
        return content;
    }
    // indent to match the entries above the closing line, not the closing line itself
    lines.splice(index, 0, `${indent}${anchor.trim()}`);
    report.planted.push(`${label}: ${anchor.trim()}`);
    return lines.join('\n');
}

/** Idempotently insert each line before the anchor; report skips + collisions. */
function insertLines(content, anchor, insertions, label, collisionProbe = null) {
    for (const line of insertions) {
        if (content.includes(line.trim())) {
            report.skippedExisting.push(`${label}: ${line.trim().slice(0, 80)}`);
            continue;
        }
        if (collisionProbe) {
            const collision = collisionProbe(content, line);
            if (collision) {
                report.needsManual.push(`${label}: ${collision}`);
                continue;
            }
        }
        const updated = insertBeforeAnchor(content, anchor, line);
        if (updated === null) {
            report.needsManual.push(`${label}: anchor "${anchor}" missing — insert by hand: ${line.trim()}`);
            continue;
        }
        content = updated;
        report.inserted.push(`${label}: ${line.trim().slice(0, 80)}`);
    }
    return content;
}

// -------------------------------------------------------------- tokens.ts ----

function tokenKeyCollision(content, insertLine) {
    const match = insertLine.match(/^\s*(\w+): '([^']+)',/);
    if (!match) return null;
    const [, key, value] = match;
    const existing = content.match(new RegExp(`^\\s{4}${key}: '([^']+)',`, 'm'));
    if (existing && existing[1] !== value) {
        return `TOKENS key "${key}" already exists with value '${existing[1]}' — pick an alternative action/feature verb and regenerate`;
    }
    // same DI string registered under a different key is a collision too
    const valueRe = new RegExp(`^\\s{4}(\\w+): '${value}',`, 'm');
    const valueHit = content.match(valueRe);
    if (valueHit && valueHit[1] !== key) {
        return `DI token string '${value}' is already used by TOKENS.${valueHit[1]} — pick an alternative name`;
    }
    return null;
}

function useCaseRegistryType(f, e) {
    const resultType = `Result<${e.hasResponse ? e.entity : 'void'}, ${f.errorType}>`;
    return e.inputFields.length ? `IUseCase<${e.input}, ${resultType}>` : `IUseCaseNoParams<${resultType}>`;
}

function updateTokens(repo, f) {
    const file = path.join(repo, 'src', 'core', 'di', 'tokens.ts');
    let content = read(file);
    const label = 'tokens.ts';

    content = plantAnchorAfterLine(file, content, '// <create-feature:token-imports>', lastImportLineIndex(content.split('\n')), label);
    content = plantAnchorBeforeMatch(file, content, '// <create-feature:tokens>', /^\} as const;/, label, '    ');
    // TokenRegistry's closing brace is the last lone `}` in the file
    if (!content.includes('// <create-feature:registry>')) {
        const lines = content.split('\n');
        let lastBrace = -1;
        for (let index = 0; index < lines.length; index++) {
            if (/^\}\s*$/.test(lines[index])) lastBrace = index;
        }
        if (lastBrace === -1) {
            report.needsManual.push(`${label}: could not find TokenRegistry closing brace — plant // <create-feature:registry> by hand`);
        } else {
            lines.splice(lastBrace, 0, '    // <create-feature:registry>');
            report.planted.push(`${label}: // <create-feature:registry>`);
            content = lines.join('\n');
        }
    }

    const imports = [
        `import type { ${f.serviceInterface} } from '@features/${f.featureDir}/data/services/${f.serviceInterface}';`,
        `import type { ${f.repositoryInterface} } from '@features/${f.featureDir}/domain/repositories/${f.repositoryInterface}';`,
        `import type { ${f.errorType} } from '@features/${f.featureDir}/domain/errors/${f.errorType}';`,
    ];
    for (const e of f.endpoints) {
        const names = [e.hasResponse ? e.entity : null, e.inputFields.length ? e.input : null].filter(Boolean);
        if (names.length) {
            imports.push(`import type { ${names.join(', ')} } from '@features/${f.featureDir}/domain/entities/${e.entity}';`);
        }
    }
    content = insertLines(content, '// <create-feature:token-imports>', imports, label);

    const tokenEntries = [
        `    ${f.feature}Service: '${f.serviceInterface}',`,
        `    ${f.feature}Repository: '${f.repositoryInterface}',`,
        ...f.endpoints.map((e) => `    ${e.useCase}: '${e.useCase}',`),
    ];
    content = insertLines(content, '// <create-feature:tokens>', tokenEntries, label, tokenKeyCollision);

    const registryEntries = [
        `    [TOKENS.${f.feature}Service]: ${f.serviceInterface};`,
        `    [TOKENS.${f.feature}Repository]: ${f.repositoryInterface};`,
        ...f.endpoints.map((e) => `    [TOKENS.${e.useCase}]: ${useCaseRegistryType(f, e)};`),
    ];
    content = insertLines(content, '// <create-feature:registry>', registryEntries, label);

    write(file, content);
}

// ------------------------------------------------------------ container.ts ----

function registrationBlock(f) {
    const serviceArgs = [];
    if (f.hasApp) serviceArgs.push('dependencyContainer.resolve<IHttpClient>(TOKENS.HttpClient)');
    if (f.hasExternal) serviceArgs.push('dependencyContainer.resolve<IConfigService>(TOKENS.ConfigService)');
    // device provenance: the service's getDeviceMetadata() helper needs the
    // app's device-context service (same arg order as the generated ctor)
    if (f.usesDevice) serviceArgs.push('dependencyContainer.resolve(TOKENS.TaxpayerAuthDeviceContextService)');

    // mock lane (spec.mock): the MOCK service is what the container serves —
    // the swap back to the real service is a one-line factory change here
    const serviceBlock = f.mock
        ? `    // -- ${f.feature} feature --
    // MOCK backend (spec.mock) — once the real API exists, swap the factory to
    // new ${f.serviceClass}(${serviceArgs.length ? serviceArgs.join(', ') : ''}),
    // import ${f.serviceClass} instead of ${f.mockServiceClass}, and delete the mock file.
    container.register(TOKENS.${f.feature}Service, {
        useFactory: () => new ${f.mockServiceClass}(),
    });`
        : `    // -- ${f.feature} feature --
    container.register(TOKENS.${f.feature}Service, {
        useFactory: (dependencyContainer) =>
            new ${f.serviceClass}(
                ${serviceArgs.join(',\n                ')},
            ),
    });`;

    const blocks = [
        serviceBlock,
        `    container.register(TOKENS.${f.feature}Repository, {
        useFactory: (dependencyContainer) =>
            new ${f.repositoryClass}(
                dependencyContainer.resolve(TOKENS.${f.feature}Service),
            ),
    });`,
        // use cases take an ILogger (they log failures before returning Result.err),
        // so they register through container.ts's withLogger helper — same shape the
        // integrated-tariff use cases use
        ...f.endpoints.map(
            (e) => `    container.register(TOKENS.${e.useCase}, {
        useFactory: withLogger(
            '${e.useCase}',
            (dependencyContainer, logger) =>
                new ${e.useCase}(
                    dependencyContainer.resolve(TOKENS.${f.feature}Repository),
                    logger
                )
        ),
    });`
        ),
    ];
    return blocks;
}

function updateContainer(repo, f) {
    const file = path.join(repo, 'src', 'core', 'di', 'container.ts');
    let content = read(file);
    const label = 'container.ts';

    content = plantAnchorAfterLine(file, content, '// <create-feature:imports>', lastImportLineIndex(content.split('\n')), label);
    if (!content.includes('// <create-feature:registrations>')) {
        const lines = content.split('\n');
        let lastBrace = -1;
        for (let index = 0; index < lines.length; index++) {
            if (/^\}\s*$/.test(lines[index])) lastBrace = index;
        }
        if (lastBrace === -1) {
            report.needsManual.push(`${label}: could not find configureDependencies closing brace — plant // <create-feature:registrations> by hand`);
        } else {
            lines.splice(lastBrace, 0, '    // <create-feature:registrations>');
            report.planted.push(`${label}: // <create-feature:registrations>`);
            content = lines.join('\n');
        }
    }

    const imports = [
        // mock lane: import ONLY the mock (the real class stays on disk but
        // unreferenced — importing both would leave a dead import after tsc)
        f.mock
            ? `import { ${f.mockServiceClass} } from '@features/${f.featureDir}/data/services/${f.mockServiceClass}';`
            : `import { ${f.serviceClass} } from '@features/${f.featureDir}/data/services/${f.serviceClass}';`,
        `import { ${f.repositoryClass} } from '@features/${f.featureDir}/data/repositories/${f.repositoryClass}';`,
        ...f.endpoints.map((e) => `import { ${e.useCase} } from '@features/${f.featureDir}/domain/use-cases/${e.useCase}';`),
    ];
    content = insertLines(content, '// <create-feature:imports>', imports, label);

    // registration blocks are multi-line — idempotency via the register(...) head line
    for (const block of registrationBlock(f)) {
        const probe = block.split('\n').find((line) => line.includes('container.register('));
        if (probe && content.includes(probe.trim())) {
            report.skippedExisting.push(`${label}: ${probe.trim()}`);
            continue;
        }
        const updated = insertBeforeAnchor(content, '// <create-feature:registrations>', block);
        if (updated === null) {
            report.needsManual.push(`${label}: anchor "// <create-feature:registrations>" missing — add the ${f.feature} registrations by hand`);
            break;
        }
        content = updated;
        report.inserted.push(`${label}: ${probe ? probe.trim() : 'registration block'}`);
    }

    write(file, content);
}

// -------------------------------------------------------------- merger.ts ----

function updateI18n(repo, f) {
    // The app registers feature translations in merger.ts (featureTranslations),
    // importing each feature's TS barrel (presentation/translations/index.ts).
    const file = path.join(repo, 'src', 'core', 'localization', 'merger.ts');
    if (!fs.existsSync(file)) {
        report.needsManual.push(`merger.ts: src/core/localization/merger.ts not found — register the ${f.feature} translations by hand (barrel import + featureTranslations entry)`);
        return;
    }
    let content = read(file);
    const label = 'merger.ts';

    const lines = content.split('\n');
    // last feature-translation barrel import
    let lastTranslationImport = -1;
    for (let index = 0; index < lines.length; index++) {
        if (/^import .+ from '@features\/.*translations';/.test(lines[index])) lastTranslationImport = index;
    }
    content = plantAnchorAfterLine(
        file,
        content,
        '// <create-feature:i18n-imports>',
        lastTranslationImport >= 0 ? lastTranslationImport : lastImportLineIndex(lines),
        label
    );
    content = plantAnchorBeforeMatch(file, content, '// <create-feature:i18n-features>', /^\} as const;/, label, '    ');

    const imports = [
        `import ${f.featureCamel} from '@features/${f.featureDir}/presentation/translations';`,
    ];
    content = insertLines(content, '// <create-feature:i18n-imports>', imports, label);

    // featureTranslations uses the file's 4-space indent. The shorthand entry
    // is checked with an ANCHORED regex, not substring-includes: `    order,`
    // is a substring of an existing `    reorder,`, which would silently skip
    // the insert while the import above still lands (half-edited file).
    const entryLine = `    ${f.featureCamel},`;
    if (new RegExp(`^\\s{4}${f.featureCamel},\\s*$`, 'm').test(content)) {
        report.skippedExisting.push(`${label}: ${entryLine.trim()}`);
    } else {
        const updated = insertBeforeAnchor(content, '// <create-feature:i18n-features>', entryLine);
        if (updated === null) {
            report.needsManual.push(`${label}: anchor "// <create-feature:i18n-features>" missing — insert by hand: ${entryLine.trim()}`);
        } else {
            content = updated;
            report.inserted.push(`${label}: ${entryLine.trim()}`);
        }
    }

    write(file, content);
}

// ------------------------------------------------- query keys (keys.ts) ----

function updateQueryKeys(repo, f) {
    // Central react-query key registry consumed by presentation/queries.ts.
    // Only GET endpoints get keys (mutations don't cache).
    const entries = f.endpoints
        .filter((e) => e.method === 'GET')
        .map((e) => `    ${queryKeyName(f, e)}: '${queryKeyValue(f, e)}',`);
    if (!entries.length) return;

    const file = path.join(repo, 'src', 'data', 'services', 'keys.ts');
    if (!fs.existsSync(file)) {
        report.needsManual.push(`keys.ts: src/data/services/keys.ts not found — add the ${f.feature} query keys by hand`);
        return;
    }
    let content = read(file);
    const label = 'keys.ts';

    content = plantAnchorBeforeMatch(file, content, '// <create-feature:query-keys>', /^\} as const;/, label, '    ');
    content = insertLines(content, '// <create-feature:query-keys>', entries, label);

    write(file, content);
}

// ------------------------------------------------------------ config + env ----

function collectEnvWiring(spec) {
    // every env-backed config field across endpoints (deduped by configField)
    const fields = new Map(); // configField → { envKey, realValue }
    for (const endpoint of spec.endpoints) {
        if (endpoint.hostType === 'external' && endpoint.baseUrl?.envKey) {
            fields.set(endpoint.baseUrl.configField, {
                envKey: endpoint.baseUrl.envKey,
                realValue: endpoint.baseUrl.devValue ?? '',
            });
        }
        for (const header of endpoint.headers ?? []) {
            if (header.source === 'env' && header.envKey) {
                fields.set(header.configField, { envKey: header.envKey, realValue: header.value ?? '' });
            }
        }
    }
    return fields;
}

function updateConfig(repo, f, envFields) {
    if (!envFields.size) return;
    const interfaceFile = path.join(repo, 'src', 'core', 'config', 'IConfigService.ts');
    const serviceFile = path.join(repo, 'src', 'core', 'config', 'ConfigService.ts');

    let interfaceContent = read(interfaceFile);
    if (!interfaceContent.includes('// <create-feature:app-config>')) {
        const lines = interfaceContent.split('\n');
        const start = lines.findIndex((line) => /export interface AppConfig\s*\{/.test(line));
        let close = -1;
        for (let index = start + 1; index < lines.length; index++) {
            if (/^\}\s*$/.test(lines[index])) { close = index; break; }
        }
        if (start === -1 || close === -1) {
            report.needsManual.push(`IConfigService.ts: could not find AppConfig — add the fields by hand: ${[...envFields.keys()].join(', ')}`);
        } else {
            lines.splice(close, 0, '    // <create-feature:app-config>');
            report.planted.push('IConfigService.ts: // <create-feature:app-config>');
            interfaceContent = lines.join('\n');
        }
    }
    interfaceContent = insertLines(
        interfaceContent,
        '// <create-feature:app-config>',
        [...envFields.keys()].map((field) => `    ${field}: string;`),
        'IConfigService.ts',
        (content, line) => {
            const field = line.trim().split(':')[0];
            return new RegExp(`^\\s+${field}\\??:`, 'm').test(content)
                ? `AppConfig already has a field named "${field}" — rename the configField in the spec and regenerate`
                : null;
        }
    );
    write(interfaceFile, interfaceContent);

    let serviceContent = read(serviceFile);
    if (!serviceContent.includes('// <create-feature:config-fields>')) {
        const lines = serviceContent.split('\n');
        const start = lines.findIndex((line) => /this\.config = \{/.test(line));
        let close = -1;
        for (let index = start + 1; index < lines.length; index++) {
            if (/^\s{8}\};/.test(lines[index])) { close = index; break; }
        }
        if (start === -1 || close === -1) {
            report.needsManual.push(`ConfigService.ts: could not find "this.config = {" — add the fields by hand: ${[...envFields.keys()].join(', ')}`);
        } else {
            lines.splice(close, 0, '            // <create-feature:config-fields>');
            report.planted.push('ConfigService.ts: // <create-feature:config-fields>');
            serviceContent = lines.join('\n');
        }
    }
    serviceContent = insertLines(
        serviceContent,
        '// <create-feature:config-fields>',
        [...envFields.entries()].map(
            ([field, { envKey }]) => `            ${field}: process.env.${envKey} || '',`
        ),
        'ConfigService.ts'
    );
    write(serviceFile, serviceContent);
}

function updateEnvFiles(repo, f, envFields) {
    if (!envFields.size) return;
    const appendKeys = (fileName, useRealValue) => {
        const file = path.join(repo, fileName);
        if (!fs.existsSync(file)) {
            report.needsManual.push(`${fileName}: file missing — create it and add: ${[...envFields.values()].map((v) => v.envKey).join(', ')}`);
            return;
        }
        let content = read(file);
        let appended = false;
        for (const { envKey, realValue } of envFields.values()) {
            if (new RegExp(`^${envKey}=`, 'm').test(content)) {
                report.skippedExisting.push(`${fileName}: ${envKey}`);
                continue;
            }
            if (!appended) {
                if (!content.endsWith('\n') && content.length) content += '\n';
                content += `\n# ${f.feature} (added by react-clean-architecture skill)\n`;
                appended = true;
            }
            content += `${envKey}=${useRealValue ? realValue : ''}\n`;
            report.envAppended.push(`${fileName}: ${envKey}${useRealValue ? '' : ' (placeholder — fill before release)'}`);
        }
        if (appended) write(file, content);
    };

    for (const fileName of REAL_VALUE_ENV_FILES) appendKeys(fileName, true);
    for (const fileName of PLACEHOLDER_ENV_FILES) appendKeys(fileName, false);
}

// ------------------------------------------------------------------ main ----

function main() {
    const argv = process.argv.slice(2);
    if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
        console.log(HELP);
        return argv.length ? 0 : 1;
    }
    const repoIndex = argv.indexOf('--repo');
    const repo = repoIndex >= 0 ? path.resolve(argv[repoIndex + 1]) : process.cwd();
    const specPath = argv.find((a, i) => !a.startsWith('--') && !(repoIndex >= 0 && i === repoIndex + 1));
    if (!specPath) {
        console.error('register-di.js: missing <feature-spec.json>. See --help.');
        return 1;
    }

    let spec;
    try {
        spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    } catch (error) {
        console.error(`register-di.js: cannot parse ${specPath}: ${error.message}`);
        return 1;
    }

    const f = featureModel(spec);
    f.featureDir = resolveFeatureDir(repo, spec.feature);

    // never register DI entries pointing at files that don't exist yet
    const generatedServiceFile = path.join(repo, 'src', 'features', f.featureDir, 'data', 'services', `${f.serviceClass}.ts`);
    if (!fs.existsSync(generatedServiceFile)) {
        console.error(`register-di.js: ${path.relative(repo, generatedServiceFile)} not found — run generate.js first.`);
        return 1;
    }

    const envFields = collectEnvWiring(spec);

    updateTokens(repo, f);
    updateContainer(repo, f);
    updateI18n(repo, f);
    updateQueryKeys(repo, f);
    updateConfig(repo, f, envFields);
    updateEnvFiles(repo, f, envFields);

    // record what we modified in the generation manifest — rollback.js restores
    // `patched` files with `git checkout --`, and DI/i18n/config/env edits must
    // be part of that map, not just generate.js's anchor patches
    report.patched = [...touchedFiles].map((file) => path.relative(repo, file));
    const manifestPath = path.join(repo, '.claude-skill-manifest.json');
    if (report.patched.length && fs.existsSync(manifestPath)) {
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            manifest.patched = [...new Set([...(manifest.patched ?? []), ...report.patched])];
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        } catch {
            report.needsManual.push('.claude-skill-manifest.json is unreadable — rollback will not cover the DI/i18n/config/env edits; restore them by hand if aborting');
        }
    }

    // compact machine-readable stdout: counts for the mechanical lists (audit.js
    // verifies the wiring authoritatively; `patched` is merged into the manifest
    // on disk), full text only for the actionable needsManual entries.
    console.log(JSON.stringify({
        status: report.needsManual.length ? 'NEEDS_MANUAL' : 'REGISTERED',
        planted: report.planted.length,
        inserted: report.inserted.length,
        skippedExisting: report.skippedExisting.length,
        envAppended: report.envAppended.length,
        patched: report.patched.length,
        needsManual: report.needsManual,
    }, null, 2));
    return report.needsManual.length ? 2 : 0;
}

if (require.main === module) {
    process.exit(main());
}
