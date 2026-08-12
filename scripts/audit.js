#!/usr/bin/env node
/**
 * audit.js — verify a generated feature: structure, anchors, DI/i18n wiring,
 * env keys, secret hygiene, duplicate endpoint paths, leftover TODOs, tsc
 * baseline diff, and the feature's jest suites. Node stdlib only.
 *
 * Usage:
 *   node audit.js --baseline [--repo <path>]
 *       Run BEFORE generation: snapshots `npx tsc --noEmit` errors to
 *       <repo>/.claude-skill-tsc-baseline.json so the post-generation audit
 *       only fails on NEW errors.
 *
 *   node audit.js <feature-spec.json> [--repo <path>] [--persist-spec] [--skip-tsc] [--skip-jest]
 *       Full audit. --persist-spec writes the SANITIZED spec into the feature
 *       dir on PASS (secret header values and env devValues are replaced with
 *       "<env:KEY>" references — the spec lands in a git repo).
 *
 *   node audit.js --help
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { featureModel, buildFilePlan } = require('./generate.js');

const HELP = `audit.js — audit a generated feature (structure, DI, env, tsc diff, jest).

Usage:
  node audit.js --baseline [--repo <path>]                 snapshot tsc errors BEFORE generation
  node audit.js <feature-spec.json> [--repo <path>]        full audit (run AFTER register-di.js)
      [--persist-spec]   write sanitized feature-spec.json into the feature dir on PASS
      [--skip-tsc]       skip the typecheck diff
      [--skip-jest]      skip running the feature's jest suites
  node audit.js --help

Exit code 0 = PASS (warnings allowed), 1 = FAIL.`;

const BASELINE_FILE = '.claude-skill-tsc-baseline.json';
const ENV_FILES_REAL = ['.env', '.env.development'];
const ENV_FILES_PLACEHOLDER = ['.env.example', '.env.staging', '.env.preprod', '.env.production'];

const rows = []; // { check, status: 'PASS'|'FAIL'|'WARN', detail }
const reminders = [];

const pass = (check, detail = '') => rows.push({ check, status: 'PASS', detail });
const fail = (check, detail = '') => rows.push({ check, status: 'FAIL', detail });
const warn = (check, detail = '') => rows.push({ check, status: 'WARN', detail });

function run(command, args, cwd) {
    return spawnSync(command, args, { cwd, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 });
}

function tscErrors(repo) {
    const result = run('npx', ['tsc', '--noEmit', '--pretty', 'false'], repo);
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    return output.split('\n').filter((line) => /error TS\d+/.test(line)).map((line) => line.trim());
}

// ------------------------------------------------------------------ checks ----

function checkStructure(repo, spec, f) {
    const { files, perEndpoint } = buildFilePlan(spec, f);
    const expected = spec.mode === 'append' ? [...perEndpoint.keys()] : [...files.keys(), ...perEndpoint.keys()];
    const missing = expected.filter((relative) => !fs.existsSync(path.join(repo, relative)));
    if (missing.length) fail('structure', `missing: ${missing.join(', ')}`);
    else pass('structure', `${expected.length} expected files present`);
}

function checkAnchors(repo, f) {
    const base = path.join(repo, 'src', 'features', f.feature);
    const anchored = [
        [path.join(base, 'data', 'endpoints', 'endpoints.ts'), '// <create-feature:endpoints>'],
        [path.join(base, 'data', 'services', `${f.serviceClass}.ts`), '// <create-feature:methods>'],
        [path.join(base, 'data', 'repositories', `${f.repositoryClass}.ts`), '// <create-feature:methods>'],
        [path.join(base, 'domain', 'IServices', `${f.serviceInterface}.ts`), '// <create-feature:signatures>'],
        [path.join(base, 'domain', 'IRepositories', `${f.repositoryInterface}.ts`), '// <create-feature:signatures>'],
    ];
    const missing = anchored
        .filter(([file, anchor]) => fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(anchor))
        .map(([file, anchor]) => `${path.relative(repo, file)} (${anchor})`);
    if (missing.length) warn('anchors', `missing (append mode will need manual edits): ${missing.join(', ')}`);
    else pass('anchors', 'all append anchors present');
}

function checkDI(repo, f) {
    const tokens = fs.readFileSync(path.join(repo, 'src', 'core', 'di', 'tokens.ts'), 'utf8');
    const container = fs.readFileSync(path.join(repo, 'src', 'core', 'di', 'container.ts'), 'utf8');
    const problems = [];

    for (const key of [`${f.feature}Service`, `${f.feature}Repository`, ...f.endpoints.map((e) => e.useCase)]) {
        if (!new RegExp(`^\\s{4}${key}: '`, 'm').test(tokens)) problems.push(`TOKENS.${key} missing in tokens.ts`);
        if (!tokens.includes(`[TOKENS.${key}]:`)) problems.push(`TokenRegistry entry for ${key} missing`);
        if (!container.includes(`container.register(TOKENS.${key}`)) problems.push(`container registration for ${key} missing`);
    }
    if (!tokens.includes(`${f.serviceInterface}`)) problems.push(`${f.serviceInterface} not imported in tokens.ts`);
    if (problems.length) fail('di-wiring', problems.join('; '));
    else pass('di-wiring', 'tokens + registry + registrations present');
}

function checkI18n(repo, f) {
    const i18n = fs.readFileSync(path.join(repo, 'src', 'core', 'localization', 'i18n.ts'), 'utf8');
    const problems = [];
    if (!i18n.includes(`${f.featureCamel}En`)) problems.push(`${f.featureCamel}En import missing`);
    if (!new RegExp(`^\\s+${f.featureCamel}: \\{ en: `, 'm').test(i18n)) problems.push(`featureTranslations.${f.featureCamel} entry missing`);
    if (problems.length) fail('i18n', problems.join('; '));
    else pass('i18n', `featureTranslations.${f.featureCamel} registered`);
}

function collectEnvKeys(spec) {
    const keys = new Map(); // envKey → realValue
    for (const endpoint of spec.endpoints) {
        if (endpoint.hostType === 'external' && endpoint.baseUrl?.envKey) {
            keys.set(endpoint.baseUrl.envKey, endpoint.baseUrl.devValue ?? '');
        }
        for (const header of endpoint.headers ?? []) {
            if (header.source === 'env' && header.envKey) keys.set(header.envKey, header.value ?? '');
        }
    }
    return keys;
}

function checkEnv(repo, spec) {
    const keys = collectEnvKeys(spec);
    if (!keys.size) {
        pass('env-files', 'no env-backed keys for this feature');
        return;
    }
    const problems = [];
    const placeholderPending = [];
    for (const fileName of [...ENV_FILES_REAL, ...ENV_FILES_PLACEHOLDER]) {
        const file = path.join(repo, fileName);
        if (!fs.existsSync(file)) { problems.push(`${fileName} missing`); continue; }
        const content = fs.readFileSync(file, 'utf8');
        for (const [envKey] of keys) {
            const match = content.match(new RegExp(`^${envKey}=(.*)$`, 'm'));
            if (!match) { problems.push(`${envKey} absent from ${fileName}`); continue; }
            const value = match[1].trim();
            if (ENV_FILES_REAL.includes(fileName) && !value) problems.push(`${envKey} empty in ${fileName} (needs the real dev value)`);
            if (fileName === '.env.example' && value) problems.push(`${envKey} has a REAL-looking value in .env.example — committed file, placeholders only`);
            if (ENV_FILES_PLACEHOLDER.includes(fileName) && fileName !== '.env.example' && !value) placeholderPending.push(`${fileName}:${envKey}`);
        }
    }
    if (problems.length) fail('env-files', problems.join('; '));
    else pass('env-files', `all ${keys.size} key(s) present across the 6 env files`);
    if (placeholderPending.length) reminders.push(`Env values still to fill before release: ${placeholderPending.join(', ')}`);
}

function checkSecretHygiene(repo, spec, f) {
    // no env-sourced header VALUE may appear as a literal inside the generated feature
    const base = path.join(repo, 'src', 'features', f.feature);
    const secrets = [];
    for (const endpoint of spec.endpoints) {
        for (const header of endpoint.headers ?? []) {
            if (header.source === 'env' && header.value && header.value.length >= 6) secrets.push(header.value);
        }
    }
    if (!secrets.length) { pass('secret-hygiene', 'no env-sourced header values to check'); return; }
    const offenders = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.(ts|tsx|json)$/.test(entry.name)) {
                const content = fs.readFileSync(full, 'utf8');
                for (const secret of secrets) {
                    if (content.includes(secret)) offenders.push(`${path.relative(repo, full)} contains a raw secret value`);
                }
            }
        }
    };
    if (fs.existsSync(base)) walk(base);
    if (offenders.length) fail('secret-hygiene', [...new Set(offenders)].join('; '));
    else pass('secret-hygiene', 'no raw secret values in generated code');
}

function checkDuplicatePaths(repo, spec, f) {
    const featuresDir = path.join(repo, 'src', 'features');
    const duplicates = [];
    const paths = spec.endpoints.map((endpoint) => endpoint.path).filter(Boolean);
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (full.includes(`${path.sep}${f.feature}${path.sep}`) || full.endsWith(`${path.sep}${f.feature}`)) continue;
                walk(full);
            } else if (/\.tsx?$/.test(entry.name)) {
                const content = fs.readFileSync(full, 'utf8');
                for (const endpointPath of paths) {
                    if (content.includes(`'${endpointPath}'`) || content.includes(`"${endpointPath}"`)) {
                        duplicates.push(`${endpointPath} also in ${path.relative(repo, full)}`);
                    }
                }
            }
        }
    };
    if (fs.existsSync(featuresDir)) walk(featuresDir);
    if (duplicates.length) warn('duplicate-paths', [...new Set(duplicates)].join('; '));
    else pass('duplicate-paths', 'no endpoint path duplicated in other features');
}

function checkTodos(repo, f) {
    const base = path.join(repo, 'src', 'features', f.feature);
    const statusTodos = [];
    const otherTodos = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.tsx?$/.test(entry.name)) {
                const content = fs.readFileSync(full, 'utf8');
                if (/TODO\(claude\): status derivation/.test(content)) statusTodos.push(path.relative(repo, full));
                else if (/TODO\(claude\)/.test(content)) otherTodos.push(path.relative(repo, full));
            }
        }
    };
    if (fs.existsSync(base)) walk(base);
    if (statusTodos.length) fail('status-derivation', `unfilled status TODO in: ${statusTodos.join(', ')} — Claude must hand-write the derivation`);
    else pass('status-derivation', 'no unfilled status-derivation TODOs');
    if (otherTodos.length) warn('todos', `TODO(claude) still present in: ${otherTodos.join(', ')}`);
}

function checkReuseFirst(repo, f) {
    // warn when a generated file re-declares a helper that already exists in src/shared/utils
    const utilsDir = path.join(repo, 'src', 'shared', 'utils');
    const sharedNames = new Set();
    const collect = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) collect(full);
            else if (/\.tsx?$/.test(entry.name)) {
                const content = fs.readFileSync(full, 'utf8');
                for (const match of content.matchAll(/export\s+(?:const|function)\s+(\w+)/g)) sharedNames.add(match[1]);
            }
        }
    };
    if (fs.existsSync(utilsDir)) collect(utilsDir);
    sharedNames.delete('cleanString'); // mapper-local by repo convention

    const base = path.join(repo, 'src', 'features', f.feature);
    const offenders = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.tsx?$/.test(entry.name)) {
                const content = fs.readFileSync(full, 'utf8');
                for (const match of content.matchAll(/(?:^|\n)(?:export\s+)?(?:const|function)\s+(\w+)/g)) {
                    if (sharedNames.has(match[1])) offenders.push(`${path.relative(repo, full)} re-declares shared util "${match[1]}"`);
                }
            }
        }
    };
    if (fs.existsSync(base)) walk(base);
    if (offenders.length) warn('reuse-first', [...new Set(offenders)].join('; '));
    else pass('reuse-first', 'no shared-util re-implementations detected');
}

function checkTscDiff(repo) {
    const baselinePath = path.join(repo, BASELINE_FILE);
    let baseline = [];
    if (fs.existsSync(baselinePath)) {
        baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')).errors ?? [];
    } else {
        warn('tsc-baseline', `${BASELINE_FILE} not found — treating ALL current errors as new (run \`audit.js --baseline\` before generating next time)`);
    }
    const current = tscErrors(repo);
    const baselineSet = new Set(baseline);
    const fresh = current.filter((line) => !baselineSet.has(line));
    if (fresh.length) fail('tsc-diff', `${fresh.length} NEW error(s):\n    ${fresh.slice(0, 20).join('\n    ')}${fresh.length > 20 ? `\n    …and ${fresh.length - 20} more` : ''}`);
    else pass('tsc-diff', `no new tsc errors (baseline ${baseline.length}, current ${current.length})`);
}

function checkJest(repo, f) {
    const result = run('npx', ['jest', `src/features/${f.feature}`, '--watchAll=false', '--passWithNoTests'], repo);
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const summary = output.split('\n').filter((line) => /^(Tests|Test Suites):/.test(line.trim())).join('; ');
    if (result.status !== 0) fail('jest', summary || output.split('\n').slice(-15).join('\n'));
    else if (/Tests:\s+0 total/.test(output) || !/Tests:/.test(output)) warn('jest', `no tests ran for src/features/${f.feature}`);
    else pass('jest', summary || 'suites green');
}

// -------------------------------------------------------------- persist ----

function sanitizedSpec(spec) {
    const clone = JSON.parse(JSON.stringify(spec));
    for (const endpoint of clone.endpoints) {
        if (endpoint.baseUrl?.envKey && endpoint.baseUrl.devValue) {
            endpoint.baseUrl.devValue = `<env:${endpoint.baseUrl.envKey}>`;
        }
        for (const header of endpoint.headers ?? []) {
            if (header.source === 'env') header.value = `<env:${header.envKey}>`;
            if (header.source === 'session') header.value = '<session>';
        }
    }
    return clone;
}

function persistSpec(repo, spec, f) {
    const target = path.join(repo, 'src', 'features', f.feature, 'feature-spec.json');
    fs.writeFileSync(target, JSON.stringify(sanitizedSpec(spec), null, 2) + '\n');
    return path.relative(repo, target);
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

    if (argv.includes('--baseline')) {
        const errors = tscErrors(repo);
        fs.writeFileSync(path.join(repo, BASELINE_FILE), JSON.stringify({ errors }, null, 2) + '\n');
        console.log(`baseline: ${errors.length} existing tsc error(s) recorded in ${BASELINE_FILE}`);
        return 0;
    }

    const specPath = argv.find((a, i) => !a.startsWith('--') && !(repoIndex >= 0 && i === repoIndex + 1));
    if (!specPath) {
        console.error('audit.js: missing <feature-spec.json>. See --help.');
        return 1;
    }
    let spec;
    try {
        spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    } catch (error) {
        console.error(`audit.js: cannot parse ${specPath}: ${error.message}`);
        return 1;
    }
    const f = featureModel(spec);

    checkStructure(repo, spec, f);
    checkAnchors(repo, f);
    checkDI(repo, f);
    checkI18n(repo, f);
    checkEnv(repo, spec);
    checkSecretHygiene(repo, spec, f);
    checkDuplicatePaths(repo, spec, f);
    checkTodos(repo, f);
    checkReuseFirst(repo, f);
    if (!argv.includes('--skip-tsc')) checkTscDiff(repo);
    if (!argv.includes('--skip-jest')) checkJest(repo, f);

    const failed = rows.filter((row) => row.status === 'FAIL');
    const width = Math.max(...rows.map((row) => row.check.length));
    console.log(`\nAUDIT — ${f.feature} (${spec.mode})`);
    for (const row of rows) {
        console.log(`  ${row.status.padEnd(4)} ${row.check.padEnd(width)}  ${row.detail}`);
    }

    // standing reminders
    const sessionFields = spec.endpoints.flatMap((endpoint) =>
        Object.entries(endpoint.requestFieldSources ?? {})
            .filter(([, source]) => source === 'session')
            .map(([field]) => `${endpoint.action}.${field}`)
    );
    if (sessionFields.length) reminders.push(`Session-sourced fields still passed as input (wire to auth session later): ${sessionFields.join(', ')}`);
    reminders.push(`Navigation is manual: to expose the screen, add a route file under app/ (expo-router) that renders ${f.featureCamel}Screen.`);
    console.log('\nReminders:');
    for (const reminder of reminders) console.log(`  - ${reminder}`);

    if (!failed.length && argv.includes('--persist-spec')) {
        const where = persistSpec(repo, spec, f);
        console.log(`\nSanitized spec persisted: ${where}`);
    } else if (failed.length && argv.includes('--persist-spec')) {
        console.log('\nSpec NOT persisted (audit failed).');
    }

    console.log(`\nRESULT: ${failed.length ? 'FAIL' : 'PASS'} (${failed.length} failing, ${rows.filter((r) => r.status === 'WARN').length} warnings)`);
    return failed.length ? 1 : 0;
}

if (require.main === module) {
    process.exit(main());
}
