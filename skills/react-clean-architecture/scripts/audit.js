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
const { featureModel, buildFilePlan, testsDirName, SKILL_VERSION } = require('./generate.js');
const { listComponents, listHeadings, diffComponentsDoc } = require('./check-components-md.js');

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
    const { files, perEndpoint } = buildFilePlan(spec, f, testsDirName(repo, f.feature));
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
        [path.join(base, 'data', 'IServices', `${f.serviceInterface}.ts`), '// <create-feature:signatures>'],
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
    // The app registers feature translations in merger.ts via the feature's
    // TS barrel (presentation/translations/index.ts).
    const merger = fs.readFileSync(path.join(repo, 'src', 'core', 'localization', 'merger.ts'), 'utf8');
    const problems = [];
    if (!merger.includes(`import ${f.featureCamel} from '@features/${f.feature}/presentation/translations'`)) {
        problems.push(`${f.featureCamel} barrel import missing`);
    }
    if (!new RegExp(`^\\s+${f.featureCamel},\\s*$`, 'm').test(merger)) {
        problems.push(`featureTranslations.${f.featureCamel} entry missing`);
    }
    if (problems.length) fail('i18n', problems.join('; '));
    else pass('i18n', `featureTranslations.${f.featureCamel} registered in merger.ts`);
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

/**
 * Baseline comparison ignores LINE/COLUMN numbers: inserting a line above a
 * pre-existing error shifts its position and would otherwise report it as
 * "new" (false positive observed live: a Routes.ts insertion shifted a
 * baseline error one line down). Errors are matched by file + TS code +
 * message as a MULTISET, so a genuinely duplicated error still surfaces.
 */
function normalizeTscError(line) {
    return line.replace(/\(\d+,\d+\)/, '');
}

/** Pure diff (exported for the skill's test suite): current errors not covered by the baseline multiset. */
function freshTscErrors(baseline, current) {
    const baselineCounts = new Map();
    for (const line of baseline) {
        const key = normalizeTscError(line);
        baselineCounts.set(key, (baselineCounts.get(key) ?? 0) + 1);
    }
    return current.filter((line) => {
        const key = normalizeTscError(line);
        const remaining = baselineCounts.get(key) ?? 0;
        if (remaining > 0) {
            baselineCounts.set(key, remaining - 1);
            return false;
        }
        return true;
    });
}

function checkTscDiff(repo) {
    const baselinePath = path.join(repo, BASELINE_FILE);
    let baseline = [];
    if (fs.existsSync(baselinePath)) {
        try {
            baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')).errors ?? [];
        } catch {
            warn('tsc-baseline', `${BASELINE_FILE} is unreadable — treating ALL current errors as new (re-run \`audit.js --baseline\`)`);
        }
    } else {
        warn('tsc-baseline', `${BASELINE_FILE} not found — treating ALL current errors as new (run \`audit.js --baseline\` before generating next time)`);
    }
    const current = tscErrors(repo);
    const fresh = freshTscErrors(baseline, current);
    if (fresh.length) fail('tsc-diff', `${fresh.length} NEW error(s):\n    ${fresh.slice(0, 20).join('\n    ')}${fresh.length > 20 ? `\n    …and ${fresh.length - 20} more` : ''}`);
    else pass('tsc-diff', `no new tsc errors (baseline ${baseline.length}, current ${current.length}; compared line-number-insensitively)`);
}

// ---- architecture boundaries (the clean-architecture dependency rule) ----

/** Bare (non-relative) import prefixes the domain layer may use. */
const DOMAIN_ALLOWED_BARE = ['@domain/', '@shared/'];

/** Every import/export-from specifier in a TS file (handles multi-line imports). */
function importSpecifiers(content) {
    const specs = [];
    for (const match of content.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?from\s*['"]([^'"]+)['"]/g)) specs.push(match[1]);
    for (const match of content.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) specs.push(match[1]);
    return specs;
}

function tsFilesUnder(dir) {
    if (!fs.existsSync(dir)) return [];
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...tsFilesUnder(full));
        else if (/\.tsx?$/.test(entry.name)) files.push(full);
    }
    return files;
}

/**
 * Dependency rule, hard-failing:
 *   - domain/ may import ONLY within domain/ plus @domain/* and @shared/* —
 *     never data/ (DTOs!), @core, react, expo, axios, react-query, navigation;
 *   - data/ may never import from presentation/.
 * This is what keeps transport DTOs (and every data-layer type) out of domain/ permanently.
 */
function archBoundaryProblems(repo, feature) {
    const base = path.join(repo, 'src', 'features', feature);
    const domainDir = path.join(base, 'domain');
    const problems = [];

    for (const file of tsFilesUnder(domainDir)) {
        for (const spec of importSpecifiers(fs.readFileSync(file, 'utf8'))) {
            const relFile = path.relative(repo, file);
            if (spec.startsWith('.')) {
                const resolved = path.resolve(path.dirname(file), spec);
                if (!(resolved + path.sep).startsWith(domainDir + path.sep) && resolved !== domainDir) {
                    problems.push(`${relFile} imports '${spec}' (outside domain/)`);
                }
            } else if (!DOMAIN_ALLOWED_BARE.some((prefix) => spec.startsWith(prefix))) {
                problems.push(`${relFile} imports '${spec}' (domain may only use ${DOMAIN_ALLOWED_BARE.join(', ')})`);
            }
        }
    }

    const presentationDir = path.join(base, 'presentation');
    for (const file of tsFilesUnder(path.join(base, 'data'))) {
        for (const spec of importSpecifiers(fs.readFileSync(file, 'utf8'))) {
            if (!spec.startsWith('.')) continue;
            const resolved = path.resolve(path.dirname(file), spec);
            if ((resolved + path.sep).startsWith(presentationDir + path.sep) || resolved === presentationDir) {
                problems.push(`${path.relative(repo, file)} imports '${spec}' (data must not import presentation)`);
            }
        }
    }

    return problems;
}

function checkArchBoundaries(repo, f) {
    const problems = archBoundaryProblems(repo, f.feature);
    if (problems.length) fail('arch-boundaries', problems.join('; '));
    else pass('arch-boundaries', 'domain imports only domain/@domain/@shared; data never imports presentation');
}

/**
 * COMPONENTS.md drift: a shared component with no dictionary entry starves the
 * reuse gate (live finding: the List organism was missing → "paginated list"
 * had no quick-lookup hit). WARN-level — the fix is writing the entry, which
 * never blocks the feature itself.
 */
function checkComponentsMd(repo) {
    const doc = path.join(__dirname, '..', 'COMPONENTS.md');
    const components = fs.existsSync(doc) ? listComponents(repo) : null;
    if (components === null) {
        pass('components-md', 'skipped (no COMPONENTS.md or no src/shared/components)');
        return;
    }
    const { drift, stale } = diffComponentsDoc(components, listHeadings(doc));
    if (drift.length || stale.length) {
        const parts = [
            ...drift.map((c) => `DRIFT ${c.name} (${c.where}) has no entry`),
            ...stale.map((h) => `STALE "### ${h.heading}" matches no component`),
        ];
        warn('components-md', `${parts.join('; ')} — update COMPONENTS.md (node <skill>/scripts/check-components-md.js for details)`);
    } else {
        pass('components-md', `all ${components.length} shared components have dictionary entries`);
    }
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
    // stamped so future template versions can detect what generated a feature
    clone.skillVersion = SKILL_VERSION;
    // design-only resume records carry no endpoints
    for (const endpoint of clone.endpoints ?? []) {
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

/**
 * Append runs carry ONLY the new endpoints — persisting them verbatim would
 * clobber the feature's full record (original endpoints + design block), which
 * remove/rename/migrate rely on. Merge into the existing persisted spec:
 * endpoints keyed by action (new wins), design kept unless the run brings one,
 * and the stored mode stays "create" (the persisted spec IS the full feature).
 */
function specForPersist(repo, spec, f) {
    const target = path.join(repo, 'src', 'features', f.feature, 'feature-spec.json');
    if (spec.mode !== 'append' || !fs.existsSync(target)) return spec;
    try {
        const existing = JSON.parse(fs.readFileSync(target, 'utf8'));
        const byAction = new Map((existing.endpoints ?? []).map((e) => [e.action, e]));
        for (const endpoint of spec.endpoints ?? []) byAction.set(endpoint.action, endpoint);
        return {
            ...existing,
            ...spec,
            mode: 'create',
            endpoints: [...byAction.values()],
            design: spec.design ?? existing.design,
        };
    } catch {
        return spec; // existing spec unreadable — persist what this run knows
    }
}

function persistSpec(repo, spec, f) {
    const target = path.join(repo, 'src', 'features', f.feature, 'feature-spec.json');
    fs.writeFileSync(target, JSON.stringify(sanitizedSpec(specForPersist(repo, spec, f)), null, 2) + '\n');
    const relative = path.relative(repo, target);

    // Record the persisted spec in the generation manifest so rollback.js
    // deletes it too — otherwise an aborted run leaves the feature dir behind
    // with only feature-spec.json inside.
    const manifestPath = path.join(repo, '.claude-skill-manifest.json');
    if (fs.existsSync(manifestPath)) {
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            manifest.created = [...new Set([...(manifest.created ?? []), relative])];
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        } catch {
            // unreadable manifest: leave it alone — rollback already warns on it
        }
    }
    return relative;
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
    checkArchBoundaries(repo, f);
    checkComponentsMd(repo);
    if (!argv.includes('--skip-tsc')) checkTscDiff(repo);
    if (!argv.includes('--skip-jest')) checkJest(repo, f);

    const failed = rows.filter((row) => row.status === 'FAIL');
    // passing checks collapse to one line (their names are the whole story);
    // WARN/FAIL rows keep the full detail — those are the actionable ones.
    const passed = rows.filter((row) => row.status === 'PASS');
    const flagged = rows.filter((row) => row.status !== 'PASS');
    console.log(`\nAUDIT — ${f.feature} (${spec.mode})`);
    if (passed.length) console.log(`  PASS: ${passed.map((row) => row.check).join(', ')}`);
    const width = flagged.length ? Math.max(...flagged.map((row) => row.check.length)) : 0;
    for (const row of flagged) {
        console.log(`  ${row.status.padEnd(4)} ${row.check.padEnd(width)}  ${row.detail}`);
    }

    // standing reminders
    const sessionFields = spec.endpoints.flatMap((endpoint) =>
        Object.entries(endpoint.requestFieldSources ?? {})
            .filter(([, source]) => source === 'session')
            .map(([field]) => `${endpoint.action}.${field}`)
    );
    if (sessionFields.length) reminders.push(`Session-sourced fields still passed as input (wire to auth session later): ${sessionFields.join(', ')}`);
    if (spec.mock === true) {
        reminders.push(`MOCK backend: the container serves ${f.feature}MockService — when the real API is live, swap the container.ts factory back to ${f.feature}Service (comment at the registration), delete the mock file, and restore requiresAuth if it was relaxed for mock testing.`);
    }
    // render-test infra is auto-installed (user decision 2026-08-19): the gap
    // means setup-test-infra.js hasn't run (or failed) — instruct, don't offer
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        if (!deps['@testing-library/react-native']) {
            reminders.push('Render-test infra missing: run `node <skill>/scripts/setup-test-infra.js` (installs @testing-library/react-native + jest.setup.js wiring automatically). If the install fails, ship logic-level tests and SAY SO in the final report.');
        }
    } catch {
        // unreadable package.json — jest/tsc checks will have complained already
    }
    reminders.push(`Navigation (backend-only runs): expose the screen with a route file under app/ (expo-router) rendering ${f.feature}Screen from presentation/screens/. Full/design-mode runs: the design lane registers navigation instead — see DESIGN.md §5.`);
    // reminders are end-of-run information — during failing fix-cycles only the
    // FAIL rows are actionable, so the standing reminders print on PASS runs only
    if (!failed.length) {
        console.log('\nReminders:');
        for (const reminder of reminders) console.log(`  - ${reminder}`);
    }

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

module.exports = { normalizeTscError, freshTscErrors, importSpecifiers, archBoundaryProblems };
