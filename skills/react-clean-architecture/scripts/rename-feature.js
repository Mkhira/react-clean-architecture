#!/usr/bin/env node
/**
 * rename-feature.js — rename a skill-generated feature everywhere: directory,
 * file names, class/interface/error identifiers, TOKENS keys/values, i18n
 * namespace, config fields, env keys, and the persisted spec. Node stdlib only.
 *
 * Usage:
 *   node rename-feature.js <OldName> <NewName> [--repo <path>]            dry run
 *   node rename-feature.js <OldName> <NewName> [--repo <path>] --apply    execute
 *   node rename-feature.js --help
 *
 * Safety model: replacements target the exact DERIVED IDENTIFIERS the skill
 * generates (<F>Service, I<F>Repository, <SNAKE>_ENDPOINTS, env keys, config
 * fields, `t('<camel>.` keys, `@features/<F>/` paths, …) — never the bare
 * feature word — so a feature named "Order" cannot corrupt an unrelated
 * "OrderTracking". Requires the persisted feature-spec.json. Use-case and
 * entity names are ACTION-scoped and are intentionally left unchanged.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { featureModel, pascal, camel, snakeUpper, kebab, resolveFeatureDir } = require('./generate.js');

const HELP = `rename-feature.js — rename a skill-generated feature across code, DI, i18n, config, env.

Usage:
  node rename-feature.js <OldName> <NewName> [--repo <path>]           dry run (default)
  node rename-feature.js <OldName> <NewName> [--repo <path>] --apply   execute

Needs src/features/<OldName>/feature-spec.json. Only the skill's derived
identifiers are replaced (never the bare feature word). Review \`git diff\`
afterwards, then run audit.js against the updated persisted spec.`;

const ENV_FILES = ['.env', '.env.development', '.env.example', '.env.staging', '.env.preprod', '.env.production'];

function nameForms(feature, dir) {
    return { pascal: pascal(feature), camel: camel(feature), snake: snakeUpper(feature), dir: dir ?? kebab(feature) };
}

/** [search, replace] pairs — every search string is a full derived identifier. */
function replacementPairs(oldForms, newForms, spec) {
    const pairs = [
        // import paths use the on-disk (kebab) dir, identifiers use PascalCase
        [`@features/${oldForms.dir}/`, `@features/${newForms.dir}/`],
        [`${oldForms.pascal}Service`, `${newForms.pascal}Service`],       // also covers I<F>Service
        [`${oldForms.pascal}Repository`, `${newForms.pascal}Repository`], // also covers I<F>Repository
        [`${oldForms.pascal}Error`, `${newForms.pascal}Error`],           // also covers create/is<F>Error + <F>Error type
        [`${oldForms.pascal}Screen`, `${newForms.pascal}Screen`],
        [`${oldForms.pascal}FormValues`, `${newForms.pascal}FormValues`],
        [`${oldForms.snake}_ENDPOINTS`, `${newForms.snake}_ENDPOINTS`],
        [`${oldForms.snake}_ERROR_CODE`, `${newForms.snake}_ERROR_CODE`], // covers _CODES and _CODE_VALUES
        [`createLogger('${oldForms.pascal}')`, `createLogger('${newForms.pascal}')`],
        // container.ts feature banner — remove-feature matches it by the
        // CURRENT name, so a rename must move it or removal leaves it orphaned
        [`// -- ${oldForms.pascal} feature --`, `// -- ${newForms.pascal} feature --`],
        [`${oldForms.camel}Screen`, `${newForms.camel}Screen`],
        [`${oldForms.camel}Controller`, `${newForms.camel}Controller`],
        [`${oldForms.camel}En`, `${newForms.camel}En`],
        [`${oldForms.camel}Ar`, `${newForms.camel}Ar`],
        [`${oldForms.camel}: { en:`, `${newForms.camel}: { en:`],
        // merger.ts barrel style: import + shorthand featureTranslations entry
        [`import ${oldForms.camel} from '@features/`, `import ${newForms.camel} from '@features/`],
        [`\n    ${oldForms.camel},`, `\n    ${newForms.camel},`],
        [`'${oldForms.camel}.`, `'${newForms.camel}.`],                   // t('<camel>.title')
        [`"feature": "${spec.feature}"`, `"feature": "${newForms.pascal}"`],
    ];
    // react-query keys: full key + full kebab value per GET endpoint, so a
    // feature named with this one's prefix can never be corrupted. Three
    // shapes: the keys.ts declaration (`KEY: '`), and the queries.ts usage
    // sites (`QUERIES_KEYS.KEY,` and `QUERIES_KEYS.KEY]`).
    for (const endpoint of spec.endpoints ?? []) {
        if (endpoint.method === 'GET') {
            const actionSnake = snakeUpper(endpoint.action);
            const actionKebab = kebab(pascal(endpoint.action));
            pairs.push([`${oldForms.snake}_${actionSnake}:`, `${newForms.snake}_${actionSnake}:`]);
            pairs.push([`QUERIES_KEYS.${oldForms.snake}_${actionSnake},`, `QUERIES_KEYS.${newForms.snake}_${actionSnake},`]);
            pairs.push([`QUERIES_KEYS.${oldForms.snake}_${actionSnake}]`, `QUERIES_KEYS.${newForms.snake}_${actionSnake}]`]);
            pairs.push([
                `'${kebab(oldForms.pascal)}-${actionKebab}'`,
                `'${kebab(newForms.pascal)}-${actionKebab}'`,
            ]);
        }
    }
    for (const endpoint of spec.endpoints ?? []) {
        const wire = [endpoint.baseUrl, ...(endpoint.headers ?? [])].filter(Boolean);
        for (const entry of wire) {
            if (entry.envKey?.includes(oldForms.snake)) {
                pairs.push([entry.envKey, entry.envKey.replace(oldForms.snake, newForms.snake)]);
            }
            if (entry.configField?.startsWith(oldForms.camel)) {
                pairs.push([entry.configField, newForms.camel + entry.configField.slice(oldForms.camel.length)]);
            }
        }
    }
    // longest-first so overlapping searches (e.g. camelEn vs camel:) cannot interleave
    return pairs.sort((a, b) => b[0].length - a[0].length);
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
    const positional = argv.filter((a, i) => !a.startsWith('--') && !(repoIndex >= 0 && i === repoIndex + 1));
    if (positional.length !== 2) {
        console.error('rename-feature.js: need <OldName> <NewName>. See --help.');
        return 1;
    }

    const oldForms = nameForms(positional[0], resolveFeatureDir(repo, positional[0]));
    const newForms = nameForms(positional[1]);
    if (!/^[A-Z][A-Za-z0-9]*$/.test(newForms.pascal)) {
        console.error(`rename-feature.js: "${positional[1]}" does not normalize to a PascalCase identifier.`);
        return 1;
    }

    // directories are kebab-case (legacy PascalCase ones still resolve)
    const oldDirName = oldForms.dir;
    const newDirName = newForms.dir;
    const oldDir = path.join(repo, 'src', 'features', oldDirName);
    const newDir = path.join(repo, 'src', 'features', newDirName);
    const specPath = path.join(oldDir, 'feature-spec.json');
    if (!fs.existsSync(oldDir)) {
        console.error(`rename-feature.js: src/features/${oldDirName} does not exist.`);
        return 1;
    }
    if (!fs.existsSync(specPath)) {
        console.error(`rename-feature.js: ${path.relative(repo, specPath)} not found — pre-skill features must be renamed by hand.`);
        return 1;
    }
    if (fs.existsSync(newDir)) {
        console.error(`rename-feature.js: src/features/${newForms.pascal} already exists.`);
        return 1;
    }
    const tokensContent = fs.readFileSync(path.join(repo, 'src/core/di/tokens.ts'), 'utf8');
    if (tokensContent.includes(`${newForms.pascal}Service:`)) {
        console.error(`rename-feature.js: TOKENS already has a ${newForms.pascal}Service entry — pick another name.`);
        return 1;
    }

    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const pairs = replacementPairs(oldForms, newForms, spec);
    const report = { mode: apply ? 'apply' : 'dry-run', from: oldForms.pascal, to: newForms.pascal, editedFiles: [], renamedFiles: [], reminders: [] };

    const targets = [];
    const collect = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) collect(full);
            else targets.push(full);
        }
    };
    collect(oldDir);
    for (const relative of ['src/core/di/tokens.ts', 'src/core/di/container.ts', 'src/core/localization/merger.ts',
        'src/data/services/keys.ts',
        'src/core/config/IConfigService.ts', 'src/core/config/ConfigService.ts', ...ENV_FILES]) {
        const absolute = path.join(repo, relative);
        if (fs.existsSync(absolute)) targets.push(absolute);
    }

    for (const file of targets) {
        if (/\.(png|jpg|jpeg|gif|pdf)$/i.test(file)) continue;
        const content = fs.readFileSync(file, 'utf8');
        let next = content;
        for (const [search, replace] of pairs) next = next.split(search).join(replace);
        if (next !== content) {
            if (apply) fs.writeFileSync(file, next);
            report.editedFiles.push(path.relative(repo, file));
        }
    }

    // rename files whose basename embeds the feature name, then the dir itself
    const renames = [];
    const collectRenames = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { collectRenames(full); continue; }
            const renamed = entry.name
                .split(oldForms.pascal).join(newForms.pascal)
                .split(oldForms.camel).join(newForms.camel);
            if (renamed !== entry.name) renames.push([full, path.join(dir, renamed)]);
        }
    };
    collectRenames(oldDir);
    for (const [from, to] of renames) {
        if (apply) fs.renameSync(from, to);
        report.renamedFiles.push(`${path.relative(repo, from)} → ${path.basename(to)}`);
    }
    if (apply) fs.renameSync(oldDir, newDir);
    report.renamedFiles.push(`src/features/${oldForms.pascal}/ → src/features/${newForms.pascal}/`);

    report.reminders.push(
        `Review \`git diff\`, update the human-facing title in presentation/translations/*.ts if needed, ` +
        `fix any app/ route files importing @features/${oldForms.pascal}/, then run audit.js against src/features/${newForms.pascal}/feature-spec.json.`
    );
    console.log(JSON.stringify(report, null, 2));
    if (!apply) console.log('\nDry run only — re-run with --apply to execute.');
    return 0;
}

if (require.main === module) {
    process.exit(main());
}
