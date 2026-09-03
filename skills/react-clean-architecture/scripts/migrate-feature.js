#!/usr/bin/env node
/**
 * migrate-feature.js — upgrade a previously generated feature to the CURRENT
 * template version, using its persisted feature-spec.json. Node stdlib only.
 *
 * Usage:
 *   node migrate-feature.js <FeatureName> [--repo <path>]                     dry run
 *   node migrate-feature.js <FeatureName> [--repo <path>] --apply             execute
 *   node migrate-feature.js <FeatureName> [--repo <path>] --include-types …   also regenerate dtos + entities
 *   node migrate-feature.js --help
 *
 * Strategy — regenerate only what the machine owns, preserve what hands wrote:
 *
 *   RELOCATED FIRST (older layouts → current, content moved as-is, old import
 *   paths rewritten in preserved files):
 *     domain/usecases/* → domain/use-cases/*  (pre-1.11.0)
 *     domain/IServices/* → data/IServices/*  (pre-1.11.0 and the one-day 1.12.0)
 *     data/services/I<F>Service.ts → data/IServices/*  (the 1.11.x layout)
 *     domain/repositories/* → domain/IRepositories/*  (the 1.11.x layout)
 *
 *   REGENERATED (machine-owned; transport + contracts):
 *     data/endpoints/endpoints.ts · data/services/<F>Service.ts ·
 *     data/repositories/<F>Repository.ts · data/IServices/* ·
 *     domain/IRepositories/* · domain/errors/<F>Error.ts
 *     (hand-added error CODES are extracted from the existing file and merged
 *      into the new one — a 1.0.0 union or a 1.1.0+ values array both parse)
 *
 *   PRESERVED (hand-written or hand-tuned; never touched):
 *     domain/use-cases/* (business rules) · data/mappers/* (status derivation) ·
 *     __tests__/* (rule tests) · presentation/** (screens/translations) ·
 *     data/dtos/* and domain/entities/* (types may carry hand-fixed overrides —
 *     pass --include-types to regenerate them too)
 *
 * After --apply the persisted spec is re-stamped with the current skillVersion.
 * Always finish with `audit.js <persisted-spec> --repo <repo>`.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { featureModel, buildFilePlan, testsDirName, pascal, SKILL_VERSION, resolveFeatureDir } = require('./generate.js');

const HELP = `migrate-feature.js — regenerate a feature's machine-owned files with the current templates.

Usage:
  node migrate-feature.js <FeatureName> [--repo <path>]                    dry run (default)
  node migrate-feature.js <FeatureName> [--repo <path>] --apply            write the upgrades
  node migrate-feature.js <FeatureName> ... --include-types                also regenerate dtos + entities

Needs src/features/<FeatureName>/feature-spec.json. Hand-written files
(use cases, mappers, tests, presentation, translations) are never touched;
hand-added error codes are merged into the regenerated errors file.
Finish with audit.js to re-verify the feature.`;

// Codes any older template may have emitted by default — never "hand-added".
const DEFAULT_ERROR_CODES = new Set(['NETWORK_ERROR', 'HTTP_ERROR', 'PARSE_ERROR', 'VALIDATION_ERROR', 'AUTH_ERROR', 'TIMEOUT']);
// Since v1.14.0 a feature error IS an AppError, so only these codes can be
// carried over. A hand-added code outside this set cannot compile against
// AppError — it is dropped and reported, so the owner decides whether it
// belongs in AppError itself (src/shared/types/errors.ts) or maps onto one of
// these. Silently keeping it would emit a file that fails tsc.
const APP_ERROR_CODES_FALLBACK = ['NETWORK_ERROR', 'AUTH_ERROR', 'TIMEOUT', 'VALIDATION_ERROR'];

/**
 * AppError's code union, read from the repo so this stays correct when the
 * owner adds a code to src/shared/types/errors.ts (the sanctioned way to
 * introduce one). Falls back to the known four if the file can't be parsed.
 */
function appErrorCodes(repo) {
    try {
        const source = fs.readFileSync(path.join(repo, 'src', 'shared', 'types', 'errors.ts'), 'utf8');
        const match = source.match(/export type INFRA_ERROR_CODES\s*=([^;]+);/);
        const codes = match ? [...match[1].matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]) : [];
        return new Set(codes.length ? codes : APP_ERROR_CODES_FALLBACK);
    } catch {
        return new Set(APP_ERROR_CODES_FALLBACK);
    }
}

/** Which planned files the migration owns. Paths are repo-relative. */
/**
 * `name → normalized parameter list` for every 4-space-indented `async` method
 * (the service template's shape; `private async` helpers are excluded). Parens
 * are scanned balanced so `Record<string, () => void>` does not cut a list short;
 * whitespace and prettier's trailing commas are normalized away so a wrapped
 * signature equals its single-line template.
 */
function methodSignatures(content) {
    const sigs = new Map();
    const pattern = /^ {4}async\s+([A-Za-z0-9_]+)\s*\(/gm;
    let match;
    while ((match = pattern.exec(content)) !== null) {
        let depth = 1;
        let i = match.index + match[0].length;
        const start = i;
        while (i < content.length && depth > 0) {
            if (content[i] === '(') depth++;
            else if (content[i] === ')') depth--;
            i++;
        }
        const params = content.slice(start, i - 1)
            .replace(/\s+/g, ' ')
            .replace(/\s*([,:(){}<>;|])\s*/g, '$1')
            .replace(/,([})])/g, '$1')
            .replace(/;}/g, '}')
            .replace(/,$/, '')
            .trim();
        sigs.set(match[1], params);
    }
    return sigs;
}

function isMachineOwned(relative, f, includeTypes) {
    const inFeature = (sub) => relative.includes(`${path.sep}${f.featureDir}${path.sep}${sub}`);
    // The mock service's sample catalog is hand-enriched after generation
    // (SKILL.md Step 5.3) — regenerating it would throw that work away.
    if (relative.endsWith(`${path.sep}${f.mockServiceClass}.ts`)) return false;
    if (inFeature(path.join('data', 'endpoints') + path.sep)) return true;
    if (inFeature(path.join('data', 'services') + path.sep)) return true;
    if (inFeature(path.join('data', 'repositories') + path.sep)) return true;
    if (inFeature(path.join('data', 'IServices') + path.sep)) return true;
    if (inFeature(path.join('domain', 'IRepositories') + path.sep)) return true;
    if (inFeature(path.join('domain', 'errors') + path.sep)) return true;
    if (includeTypes && inFeature(path.join('data', 'dtos') + path.sep)) return true;
    if (includeTypes && inFeature(path.join('domain', 'entities') + path.sep)) return true;
    return false;
}

/**
 * Older layouts → current. Files move as-is (hand-written content preserved);
 * afterwards every .ts file still holding an old-layout import path is
 * rewritten. Entries: [fromDir, toDir, optional exact-filename filter] — the
 * filter lets the 1.11.x interface file leave data/services/ without dragging
 * the service impl/mock along (which is also why the rewrites are scoped to
 * the exact interface names: a feature called "IntegratedTariff" has an impl
 * that a loose /^I\w+Service/ pattern would swallow).
 */
const relocationsFor = (f) => [
    // pre-1.11.0
    [path.join('domain', 'usecases'), path.join('domain', 'use-cases')],
    // pre-1.11.0 AND the one-day 1.12.0 both kept the service contract here
    [path.join('domain', 'IServices'), path.join('data', 'IServices')],
    // the 1.11.x layout
    [path.join('data', 'services'), path.join('data', 'IServices'), `${f.serviceInterface}.ts`],
    [path.join('domain', 'repositories'), path.join('domain', 'IRepositories')],
];
const importRewritesFor = (f) => [
    // pre-1.11.0 use-case dir
    [/\/usecases\//g, '/use-cases/'],
    // old service-interface locations → data/IServices. Relative specifiers:
    // every consumer (service impl, mock, repository impl) sits one dir deep
    // under data/, so the new relative path is always '../IServices/'.
    [new RegExp(`'\\.\\./\\.\\./domain/IServices/(${f.serviceInterface})'`, 'g'), "'../IServices/$1'"],
    [new RegExp(`from '\\./(${f.serviceInterface})'`, 'g'), "from '../IServices/$1'"],
    [new RegExp(`'\\.\\./services/(${f.serviceInterface})'`, 'g'), "'../IServices/$1'"],
    // alias imports (DI-style) from either old location
    [new RegExp(`domain/IServices/(${f.serviceInterface})\\b`, 'g'), 'data/IServices/$1'],
    [new RegExp(`data/services/(${f.serviceInterface})\\b`, 'g'), 'data/IServices/$1'],
    // 1.11.x repository-interface locations → domain/IRepositories
    // (lowercase 'repositories' only — never matches /IRepositories/)
    [new RegExp(`/repositories/(${f.repositoryInterface})\\b`, 'g'), '/IRepositories/$1'],
];

function tsFilesUnder(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
        .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
}

function relocateOldLayout(repo, f, apply, report) {
    const base = path.join(repo, 'src', 'features', f.featureDir);
    // repo-relative paths a dry run WOULD create — the plan loop must not
    // report them as missing when --apply hasn't moved them yet
    const pendingTargets = new Set();
    for (const [from, to, onlyName] of relocationsFor(f)) {
        const fromDir = path.join(base, from);
        if (!fs.existsSync(fromDir)) continue;
        const toDir = path.join(base, to);
        for (const name of fs.readdirSync(fromDir)) {
            if (onlyName && name !== onlyName) continue;
            const target = path.join(toDir, name);
            if (fs.existsSync(target)) {
                report.problems.push(`${path.join(to, name)}: exists in BOTH old and new layout — resolve by hand before migrating`);
                continue;
            }
            if (apply) {
                fs.mkdirSync(toDir, { recursive: true });
                fs.renameSync(path.join(fromDir, name), target);
            } else {
                pendingTargets.add(path.relative(repo, target));
            }
            report.relocated.push(`${path.join(from, name)} -> ${path.join(to, name)}`);
        }
        if (apply && fs.existsSync(fromDir) && !fs.readdirSync(fromDir).length) fs.rmdirSync(fromDir);
    }
    if (!report.relocated.length) return pendingTargets;
    if (!apply) {
        report.rewrittenImports.push('(dry run — old-layout import paths rewritten on --apply)');
        return pendingTargets;
    }
    const rewrites = importRewritesFor(f);
    for (const file of tsFilesUnder(base)) {
        const content = fs.readFileSync(file, 'utf8');
        let next = content;
        for (const [pattern, replacement] of rewrites) next = next.replace(pattern, replacement);
        if (next !== content) {
            fs.writeFileSync(file, next);
            report.rewrittenImports.push(path.relative(repo, file));
        }
    }
    return pendingTargets;
}

/** Every 'SCREAMING_SNAKE' code quoted in the existing errors file (union OR array form). */
function extractErrorCodes(content) {
    return [...content.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((match) => match[1]);
}

/** Inject hand-added codes into the regenerated <FEATURE>_ERROR_CODE_VALUES array. */
function mergeErrorCodes(newContent, extraCodes) {
    if (!extraCodes.length) return newContent;
    const insertion = extraCodes.map((code) => `    '${code}',`).join('\n');
    return newContent.replace(/\n\] as const;/, `\n${insertion}\n] as const;`);
}

function main() {
    const argv = process.argv.slice(2);
    if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
        console.log(HELP);
        return argv.length ? 0 : 1;
    }
    const repoIndex = argv.indexOf('--repo');
    const repo = repoIndex >= 0 ? path.resolve(argv[repoIndex + 1]) : process.cwd();
    const apply = argv.includes('--apply');
    const includeTypes = argv.includes('--include-types');
    const featureArg = argv.find((a, i) => !a.startsWith('--') && !(repoIndex >= 0 && i === repoIndex + 1));
    if (!featureArg) {
        console.error('migrate-feature.js: missing <FeatureName>. See --help.');
        return 1;
    }

    const feature = pascal(featureArg);
    // dirs are kebab-case since v1.14.0; legacy PascalCase dirs still resolve
    const featureDirName = resolveFeatureDir(repo, featureArg);
    const specPath = path.join(repo, 'src', 'features', featureDirName, 'feature-spec.json');
    if (!fs.existsSync(specPath)) {
        console.error(`migrate-feature.js: ${path.relative(repo, specPath)} not found — only features with a persisted spec can migrate (pre-skill features are out of scope).`);
        return 1;
    }
    let spec;
    try {
        spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    } catch (error) {
        console.error(`migrate-feature.js: persisted spec unreadable: ${error.message}`);
        return 1;
    }

    // A design-only record ({feature, skillVersion, design}) has no machine-owned
    // files: generate.js never ran for it, so there is nothing to regenerate and
    // buildFilePlan would crash on the empty endpoint list (found 2026-09-03 on
    // TaxStampValidation and IndividualSignup).
    if (!Array.isArray(spec.endpoints) || !spec.endpoints.length) {
        console.error(
            `migrate-feature.js: ${path.relative(repo, specPath)} is a design-only record (no endpoints) — ` +
            'nothing machine-owned to migrate; its screens are hand-written and stay as they are.'
        );
        return 1;
    }

    // Persisted specs written by hand or by an old intake can carry shapes the
    // current templates cannot render (live 2026-09-03: establishment-signup had
    // queryParams: ['country', 'language'] — SPEC_FORMAT.md says {name, type}[] —
    // and the regenerated service read `query: { undefined: string }`). Refuse
    // before planning; the fix is a one-line edit of feature-spec.json.
    const shapeProblems = [];
    for (const endpoint of spec.endpoints) {
        for (const key of ['queryParams', 'pathParams']) {
            for (const param of endpoint[key] ?? []) {
                if (!param || typeof param !== 'object' || typeof param.name !== 'string') {
                    shapeProblems.push(`${endpoint.action}.${key} entry ${JSON.stringify(param)} must be a { "name", "type" } object`);
                }
            }
        }
    }
    if (shapeProblems.length) {
        console.error(
            `migrate-feature.js: ${path.relative(repo, specPath)} does not match SPEC_FORMAT.md — ` +
            shapeProblems.join('; ') + '. Fix the spec, then migrate.'
        );
        return 1;
    }

    const fromVersion = spec.skillVersion ?? '1.0.0 (pre-stamping)';
    const f = featureModel(spec);
    f.featureDir = featureDirName;
    const { files, perEndpoint } = buildFilePlan(spec, f, testsDirName(repo, f.featureDir));
    const planned = new Map([...files, ...perEndpoint]);

    const report = {
        mode: apply ? 'apply' : 'dry-run',
        feature,
        fromVersion,
        toVersion: SKILL_VERSION,
        relocated: [],
        rewrittenImports: [],
        updated: [],
        unchanged: [],
        preserved: [],
        mergedErrorCodes: [],
        problems: [],
    };

    // Spec drift: the persisted spec must still describe the service on disk.
    // Regenerating machine-owned files from a spec the team has since moved
    // away from (live on application-status, 2026-09-03: the spec named
    // getApplicationStatusFilterOptions, the code had getApplicationStatusByNumber)
    // would silently overwrite hand changes — refuse, and never write.
    const servicePath = path.join(repo, 'src', 'features', f.featureDir, 'data', 'services', `${f.serviceClass}.ts`);
    if (fs.existsSync(servicePath)) {
        const methods = [...fs.readFileSync(servicePath, 'utf8').matchAll(/^ {4}async\s+([A-Za-z0-9_]+)\s*\(/gm)].map((m) => m[1]);
        const actions = f.endpoints.map((e) => e.action);
        const onlyInCode = methods.filter((m) => !actions.includes(m));
        const onlyInSpec = actions.filter((a) => !methods.includes(a));
        if (onlyInCode.length || onlyInSpec.length) {
            report.problems.push(
                `spec drift: ${path.relative(repo, servicePath)} no longer matches ${path.relative(repo, specPath)} — ` +
                `${onlyInCode.length ? `service has ${onlyInCode.join(', ')} not in the spec` : ''}` +
                `${onlyInCode.length && onlyInSpec.length ? '; ' : ''}` +
                `${onlyInSpec.length ? `spec has ${onlyInSpec.join(', ')} not in the service` : ''}. ` +
                'Nothing was written. Bring the spec back in line first (an append run for the new endpoints, or edit feature-spec.json to match the code), then migrate.'
            );
        }
        // Same method names, different parameters: the team changed a signature
        // by hand (and therefore its callers — use cases, mock, tests, which
        // migration never touches). Regenerating the service alone would break
        // every caller (live 2026-09-03: getIssuingCities() in code, the spec
        // still carried two query params → 9 new tsc errors).
        const plannedService = planned.get(path.relative(repo, servicePath));
        if (plannedService) {
            const existingSigs = methodSignatures(fs.readFileSync(servicePath, 'utf8'));
            const plannedSigs = methodSignatures(plannedService);
            for (const [name, plannedParams] of plannedSigs) {
                if (!existingSigs.has(name) || existingSigs.get(name) === plannedParams) continue;
                report.problems.push(
                    `signature drift: ${name}(${existingSigs.get(name)}) in ${path.relative(repo, servicePath)} but the spec now generates ${name}(${plannedParams}) — ` +
                    'its callers (use case, mock, tests) were changed by hand and migration never touches them. Nothing was written. ' +
                    'Re-align the spec (queryParams / pathParams / requestSample) to the code, then migrate.'
                );
            }
        }
    }
    const write = apply && !report.problems.length;
    if (apply && !write) report.mode = 'refused (dry-run report below)';

    const pendingRelocation = relocateOldLayout(repo, f, write, report);

    for (const [relative, plannedContent] of planned) {
        const absolute = path.join(repo, relative);
        if (!isMachineOwned(relative, f, includeTypes)) {
            report.preserved.push(relative);
            continue;
        }
        let nextContent = plannedContent;
        const existing = fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null;

        if (relative.includes(`${path.sep}errors${path.sep}`) && existing) {
            const handAdded = [...new Set(extractErrorCodes(existing))].filter((code) => !DEFAULT_ERROR_CODES.has(code));
            const allowed = appErrorCodes(repo);
            const extraCodes = handAdded.filter((code) => allowed.has(code));
            const dropped = handAdded.filter((code) => !allowed.has(code));
            if (dropped.length) {
                report.problems.push(
                    `${relative}: hand-added error code(s) ${dropped.join(', ')} are not AppError codes and were DROPPED — ` +
                    `map each onto ${[...allowed].join(' / ')} at its throw sites, or add it to AppError in src/shared/types/errors.ts and re-run`
                );
            }
            nextContent = mergeErrorCodes(nextContent, extraCodes);
            report.mergedErrorCodes.push(...extraCodes);
        }

        if (existing === nextContent) {
            report.unchanged.push(relative);
            continue;
        }
        if (existing === null) {
            if (pendingRelocation.has(relative)) {
                report.updated.push(`${relative} (after relocation)`);
                continue;
            }
            report.problems.push(`${relative}: expected file missing — run generate.js in append/create mode instead of migrating`);
            continue;
        }
        if (write) {
            fs.writeFileSync(absolute, nextContent);
        }
        report.updated.push(relative);
    }

    if (write && !report.problems.length) {
        spec.skillVersion = SKILL_VERSION;
        fs.writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');
    }

    console.log(JSON.stringify(report, null, 2));
    console.log(write
        ? `\nMigrated to ${SKILL_VERSION}. Review \`git diff\`, then run audit.js against ${path.relative(repo, specPath)}.`
        : apply
            ? '\nRefused — see problems; nothing was written.'
            : '\nDry run only — re-run with --apply to execute.');
    return report.problems.length ? 2 : 0;
}

if (require.main === module) {
    // NOT process.exit(): stdout writes to a PIPE are asynchronous and exiting
    // truncates what is still buffered (found 2026-09-01 in components.js, which
    // lost ~10KB off a 76KB --all through a captured pipe while a file redirect
    // looked perfect). Compact stdout hides it; verbatim failure output would not.
    process.exitCode = main();
}
