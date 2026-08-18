#!/usr/bin/env node
/**
 * remove-feature.js — fully remove a skill-generated feature: the feature
 * directory, its DI entries (tokens.ts + container.ts), its i18n registration,
 * its AppConfig/ConfigService fields, and its keys in all six .env files.
 * Node stdlib only.
 *
 * Usage:
 *   node remove-feature.js <FeatureName> [--repo <path>]            dry run: print the plan
 *   node remove-feature.js <FeatureName> [--repo <path>] --apply    actually remove
 *   node remove-feature.js --help
 *
 * Requires the feature's persisted `feature-spec.json` (written by
 * `audit.js --persist-spec`) — it is the authoritative list of use-case
 * tokens, env keys, and config fields. Pre-skill features (no persisted spec)
 * are refused: remove those by hand.
 *
 * Anchors are LEFT IN PLACE (they are permanent infrastructure). Run
 * `npx tsc --noEmit` afterwards — anything else in the app that imported the
 * feature (e.g. an expo-router route file under app/) will surface there.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { featureModel, pascal, queryKeyName } = require('./generate.js');

const HELP = `remove-feature.js — remove a skill-generated feature everywhere it was wired.

Usage:
  node remove-feature.js <FeatureName> [--repo <path>]           dry run (default)
  node remove-feature.js <FeatureName> [--repo <path>] --apply   delete + unwire

Needs src/features/<FeatureName>/feature-spec.json (persisted by audit.js).
Removes: the feature dir, TOKENS/TokenRegistry/container entries, the i18n
featureTranslations entry, AppConfig/ConfigService fields, and env keys in all
six .env files. Route files under app/ are reported, never deleted.`;

const ENV_FILES = ['.env', '.env.development', '.env.example', '.env.staging', '.env.preprod', '.env.production'];

const report = { mode: 'dry-run', feature: null, removedFiles: [], editedFiles: [], removedLines: [], problems: [], reminders: [] };

function planLineRemovals(content, shouldRemove, label) {
    const lines = content.split('\n');
    const kept = [];
    let removed = 0;
    for (const line of lines) {
        if (shouldRemove(line)) {
            report.removedLines.push(`${label}: ${line.trim().slice(0, 90)}`);
            removed += 1;
            continue;
        }
        kept.push(line);
    }
    return { content: kept.join('\n'), removed };
}

/** Remove `container.register(TOKENS.<key>, { … });` blocks plus the feature banner comment. */
function removeRegistrationBlocks(content, keys, feature) {
    const lines = content.split('\n');
    const kept = [];
    let index = 0;
    let removedBlocks = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (line.trim() === `// -- ${feature} feature --`) {
            report.removedLines.push(`container.ts: ${line.trim()}`);
            index += 1;
            continue;
        }
        const isBlockStart = keys.some((key) => line.includes(`container.register(TOKENS.${key},`));
        if (isBlockStart) {
            const start = index;
            while (index < lines.length && lines[index].trim() !== '});') index += 1;
            index += 1; // consume the closing `});`
            report.removedLines.push(`container.ts: ${lines[start].trim()} … (${index - start} lines)`);
            removedBlocks += 1;
            continue;
        }
        kept.push(line);
        index += 1;
    }
    return { content: kept.join('\n'), removedBlocks };
}

function applyEdit(repo, relative, nextContent, apply) {
    const absolute = path.join(repo, relative);
    const current = fs.readFileSync(absolute, 'utf8');
    if (current === nextContent) return;
    if (apply) fs.writeFileSync(absolute, nextContent);
    report.editedFiles.push(relative);
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
    const featureArg = argv.find((a, i) => !a.startsWith('--') && !(repoIndex >= 0 && i === repoIndex + 1));
    if (!featureArg) {
        console.error('remove-feature.js: missing <FeatureName>. See --help.');
        return 1;
    }

    const feature = pascal(featureArg);
    report.mode = apply ? 'apply' : 'dry-run';
    report.feature = feature;
    const featureDir = path.join(repo, 'src', 'features', feature);
    const specPath = path.join(featureDir, 'feature-spec.json');

    if (!fs.existsSync(featureDir)) {
        console.error(`remove-feature.js: src/features/${feature} does not exist.`);
        return 1;
    }
    if (!fs.existsSync(specPath)) {
        console.error(`remove-feature.js: ${path.relative(repo, specPath)} not found — this looks like a pre-skill feature; remove it by hand (the persisted spec is the authoritative unwiring manifest).`);
        return 1;
    }

    let spec;
    try {
        spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    } catch (error) {
        console.error(`remove-feature.js: persisted spec unreadable (${error.message}) — remove by hand.`);
        return 1;
    }
    const f = featureModel(spec);
    const tokenKeys = [`${f.feature}Service`, `${f.feature}Repository`, ...f.endpoints.map((e) => e.useCase)];

    // 1. feature directory
    const collectFiles = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) collectFiles(full);
            else report.removedFiles.push(path.relative(repo, full));
        }
    };
    collectFiles(featureDir);
    if (apply) fs.rmSync(featureDir, { recursive: true });

    // 2. tokens.ts — imports, TOKENS entries, TokenRegistry entries
    const tokensPath = 'src/core/di/tokens.ts';
    let tokens = fs.readFileSync(path.join(repo, tokensPath), 'utf8');
    let plan = planLineRemovals(tokens, (line) => {
        if (line.includes(`@features/${feature}/`)) {
            if (!/^import /.test(line)) {
                report.problems.push(`${tokensPath}: "${line.trim().slice(0, 60)}" references the feature but is not a single-line import — unwire that import by hand`);
                return false;
            }
            return true;
        }
        return tokenKeys.some((key) => new RegExp(`^\\s{4}${key}: '`).test(line) || line.includes(`[TOKENS.${key}]:`));
    }, 'tokens.ts');
    applyEdit(repo, tokensPath, plan.content, apply);

    // 3. container.ts — imports + registration blocks
    const containerPath = 'src/core/di/container.ts';
    let container = fs.readFileSync(path.join(repo, containerPath), 'utf8');
    plan = planLineRemovals(container, (line) => line.includes(`@features/${feature}/`) && /^import /.test(line), 'container.ts');
    const blocks = removeRegistrationBlocks(plan.content, tokenKeys, feature);
    applyEdit(repo, containerPath, blocks.content, apply);

    // 4. merger.ts — barrel import + featureTranslations entry
    const i18nPath = 'src/core/localization/merger.ts';
    let i18n = fs.readFileSync(path.join(repo, i18nPath), 'utf8');
    plan = planLineRemovals(i18n, (line) =>
        line.includes(`@features/${feature}/presentation/translations`) ||
        new RegExp(`^\\s+${f.featureCamel},\\s*$`).test(line), 'merger.ts');
    applyEdit(repo, i18nPath, plan.content, apply);

    // 4b. keys.ts — react-query keys added by register-di.js. Only the EXACT
    // keys derived from this feature's spec: a wildcard on the snake prefix
    // would also delete keys of features/app code sharing the prefix
    // (e.g. removing "Order" must never touch ORDER_TRACKING_*).
    const keysPath = 'src/data/services/keys.ts';
    if (fs.existsSync(path.join(repo, keysPath))) {
        const exactKeys = f.endpoints
            .filter((e) => e.method === 'GET')
            .map((e) => queryKeyName(f, e));
        if (exactKeys.length) {
            const keys = fs.readFileSync(path.join(repo, keysPath), 'utf8');
            plan = planLineRemovals(keys, (line) =>
                exactKeys.some((key) => new RegExp(`^\\s+${key}: '`).test(line)), 'keys.ts');
            applyEdit(repo, keysPath, plan.content, apply);
        }
    }

    // 5. config fields + env keys (from the persisted spec)
    const configFields = [];
    const envKeys = [];
    for (const endpoint of spec.endpoints ?? []) {
        if (endpoint.hostType === 'external' && endpoint.baseUrl?.envKey) {
            configFields.push(endpoint.baseUrl.configField);
            envKeys.push(endpoint.baseUrl.envKey);
        }
        for (const header of endpoint.headers ?? []) {
            if (header.source === 'env' && header.envKey) {
                configFields.push(header.configField);
                envKeys.push(header.envKey);
            }
        }
    }
    for (const configFile of ['src/core/config/IConfigService.ts', 'src/core/config/ConfigService.ts']) {
        const content = fs.readFileSync(path.join(repo, configFile), 'utf8');
        plan = planLineRemovals(content, (line) => configFields.some((field) => new RegExp(`^\\s+${field}: `).test(line)), path.basename(configFile));
        applyEdit(repo, configFile, plan.content, apply);
    }
    for (const envFile of ENV_FILES) {
        if (!fs.existsSync(path.join(repo, envFile))) continue;
        const content = fs.readFileSync(path.join(repo, envFile), 'utf8');
        plan = planLineRemovals(content, (line) =>
            envKeys.some((key) => line.startsWith(`${key}=`)) ||
            line.trim() === `# ${feature} (added by react-clean-architecture skill)`, envFile);
        applyEdit(repo, envFile, plan.content, apply);
    }

    // 6. things the skill never touches, but the user must know about
    const appDir = path.join(repo, 'app');
    if (fs.existsSync(appDir)) {
        const routeHits = [];
        const scan = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) scan(full);
                else if (/\.tsx?$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes(`@features/${feature}/`)) {
                    routeHits.push(path.relative(repo, full));
                }
            }
        };
        scan(appDir);
        if (routeHits.length) report.reminders.push(`Route files under app/ still import the feature — delete them by hand: ${routeHits.join(', ')}`);
    }
    report.reminders.push('Run `npx tsc --noEmit` to surface any remaining references to the removed feature.');

    console.log(JSON.stringify(report, null, 2));
    if (!apply) console.log('\nDry run only — re-run with --apply to execute.');
    return report.problems.length ? 2 : 0;
}

if (require.main === module) {
    process.exit(main());
}
