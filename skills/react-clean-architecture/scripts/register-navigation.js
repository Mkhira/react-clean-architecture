#!/usr/bin/env node
/**
 * register-navigation.js — wire a feature's screen into the app's navigation
 * (DESIGN.md §5, scripted): RouteContract.ts (type + toHref + flat map),
 * Routes.ts builder, the dedicated app/service-flow/<id>.tsx route file, the
 * service-flow page registry, SERVICES_DATA (from the spec's design.serviceCard),
 * translations placeholders (services.<camel>.title/description in en/ar.json),
 * DeepLinkingService aliases, and the feature's presentation/routes.ts.
 * Node stdlib only.
 *
 * Usage:
 *   node register-navigation.js <feature-spec.json> [--repo <path>]
 *   node register-navigation.js --help
 *
 * The spec must carry a `design` block (Screen collection ran). First run
 * plants permanent `// <design-lane:...>` anchors (one-time, owner-approved
 * edit — same policy as register-di.js). Idempotent: entries already present
 * are skipped; created files are never overwritten. NOT scripted (stays with
 * Claude): real translation values (placeholders are TODO(claude)), optional
 * SERVICES_DATA tags, Home shortcuts, and design-only merger.ts wiring.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { camel, kebab, pascal, snakeUpper } = require('./generate.js');

const HELP = `register-navigation.js — register a feature's screen in navigation (DESIGN.md §5).

Usage:
  node register-navigation.js <feature-spec.json> [--repo <path>]
  node register-navigation.js --help

--repo defaults to the current working directory (run from the target repo root).
Requires the spec's design block (run Screen collection first). Idempotent.
Prints a JSON report with a needsManual section for anything requiring a hand
edit and a needsClaude section for the translation placeholders to fill.`;

const SERVICE_TYPE_KEYS = ['tax', 'zakat', 'realEstate', 'customs'];
const USER_TYPE_KEYS = ['citizen', 'resident', 'business', 'retired'];
const CARD_DEFAULTS = {
    cost: 'free',
    fees: 0,
    serviceTypes: ['tax'],
    userTypes: 'all',
    processingTimeMinutes: 5,
    requiresAuth: false,
};

const report = { planted: [], created: [], inserted: [], skippedExisting: [], needsClaude: [], needsManual: [] };
const touchedFiles = new Set();
const createdFiles = new Set();

function read(file) {
    return fs.readFileSync(file, 'utf8');
}

function write(file, content) {
    const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (previous === content) return;
    fs.writeFileSync(file, content);
    touchedFiles.add(file);
}

/**
 * Re-applies every `\uXXXX` escape the original JSON text used to the
 * re-serialized output. `JSON.stringify` emits non-ASCII literally, which is
 * right for Arabic copy but turned the app's `"currency": "\u20C1"` (the
 * riyal sign, a combining character that renders as a broken box in editors)
 * into a literal glyph — the same string at runtime, a spurious diff and an
 * unreadable line in review. The set of escapes is taken from the file
 * itself, so a repo that writes everything literally is left alone.
 */
function preserveUnicodeEscapes(original, output) {
    const escaped = new Set();
    for (const match of original.matchAll(/\\u([0-9a-fA-F]{4})/g)) {
        // an escaped backslash followed by "uXXXX" is not an escape
        const backslashes = /\\+$/.exec(original.slice(0, match.index));
        if (backslashes && backslashes[0].length % 2 === 1) continue;
        escaped.add(match[1].toUpperCase());
    }
    if (escaped.size === 0) return output;
    return output.replace(/[^\x00-\x7F]/g, (char) => {
        const hex = char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
        return escaped.has(hex) ? `\\u${hex}` : char;
    });
}

function createFile(repo, relative, content) {
    const file = path.join(repo, relative);
    if (fs.existsSync(file)) {
        report.skippedExisting.push(`${relative}: already exists (never overwritten)`);
        return false;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    createdFiles.add(relative);
    report.created.push(relative);
    return true;
}

/**
 * End line of the block opened on `startIndex` — counts {} and [] together,
 * so it works for object literals and the SERVICES_DATA array alike.
 */
function findBlockEnd(lines, startIndex) {
    let depth = 0;
    for (let index = startIndex; index < lines.length; index++) {
        for (const ch of lines[index]) {
            if (ch === '{' || ch === '[') depth++;
            else if (ch === '}' || ch === ']') depth--;
        }
        if (index > startIndex && depth <= 0) return index;
        if (index === startIndex && depth <= 0) return -1; // block closes on its own line — not a block
    }
    return -1;
}

/** Leading whitespace of the first non-empty line strictly inside the block. */
function entryIndent(lines, startIndex, endIndex, fallback) {
    for (let index = startIndex + 1; index < endIndex; index++) {
        const match = lines[index].match(/^(\s*)\S/);
        if (match) return match[1];
    }
    return fallback;
}

/**
 * Plant `anchor` (once) as the last line inside the block whose opening line
 * matches `startRe` (the `occurrence`-th match). Returns updated content or
 * null when the block cannot be found (caller reports needsManual).
 */
function plantInBlock(content, startRe, anchor, label, occurrence = 1) {
    if (content.includes(anchor)) return content;
    const lines = content.split('\n');
    let seen = 0;
    let start = -1;
    for (let index = 0; index < lines.length; index++) {
        if (startRe.test(lines[index])) {
            seen++;
            if (seen === occurrence) { start = index; break; }
        }
    }
    if (start === -1) return null;
    const end = findBlockEnd(lines, start);
    if (end === -1) return null;
    const indent = entryIndent(lines, start, end, '    ');
    lines.splice(end, 0, `${indent}${anchor}`);
    report.planted.push(`${label}: ${anchor}`);
    return lines.join('\n');
}

/** Plant `anchor` on the line after the LAST line matching `afterRe`. */
function plantAfterLast(content, afterRe, anchor, label) {
    if (content.includes(anchor)) return content;
    const lines = content.split('\n');
    let last = -1;
    for (let index = 0; index < lines.length; index++) {
        if (afterRe.test(lines[index])) last = index;
    }
    if (last === -1) return null;
    const indent = (lines[last].match(/^(\s*)/) || ['', ''])[1];
    lines.splice(last + 1, 0, `${indent}${anchor}`);
    report.planted.push(`${label}: ${anchor}`);
    return lines.join('\n');
}

/** Insert multi-line `text` before the anchor line, idempotent via `probeRe`. */
function insertBlock(content, anchor, text, probeRe, label, summary) {
    if (probeRe.test(content)) {
        report.skippedExisting.push(`${label}: ${summary}`);
        return content;
    }
    const lines = content.split('\n');
    const index = lines.findIndex((line) => line.includes(anchor));
    if (index === -1) {
        report.needsManual.push(`${label}: anchor "${anchor}" missing — insert by hand: ${summary}`);
        return content;
    }
    lines.splice(index, 0, ...text.split('\n'));
    report.inserted.push(`${label}: ${summary}`);
    return lines.join('\n');
}

/**
 * Indent unit of a file: the leading whitespace of its first indented CODE
 * line — comment continuations (` * …`, `//`, `/**`) are skipped, or a JSDoc
 * block would report a bogus 1-space unit.
 */
function indentUnit(content) {
    const match = content.match(/^( +)(?![*/])\S/m);
    return match ? match[1] : '    ';
}

// ------------------------------------------------------- service card model ----

function cardModel(spec, n) {
    const card = { ...CARD_DEFAULTS, ...(spec.design.serviceCard || {}) };
    const serviceTypes = (Array.isArray(card.serviceTypes) ? card.serviceTypes : [card.serviceTypes])
        .filter(Boolean);
    for (const type of serviceTypes) {
        if (!SERVICE_TYPE_KEYS.includes(type)) {
            report.needsManual.push(`servicesData.ts: serviceCard.serviceTypes has unknown key "${type}" (allowed: ${SERVICE_TYPE_KEYS.join(', ')}) — fix the entry by hand`);
        }
    }
    let userTypes = card.userTypes;
    if (Array.isArray(userTypes)) {
        for (const type of userTypes) {
            if (!USER_TYPE_KEYS.includes(type)) {
                report.needsManual.push(`servicesData.ts: serviceCard.userTypes has unknown key "${type}" (allowed: ${USER_TYPE_KEYS.join(', ')}) — fix the entry by hand`);
            }
        }
        // the full set is spelled ALL_USER_TYPES in the file
        if ([...USER_TYPE_KEYS].every((t) => userTypes.includes(t))) userTypes = 'all';
    }
    return { ...card, serviceTypes: serviceTypes.length ? serviceTypes : ['tax'], userTypes };
}

// ------------------------------------------------------------- file editors ----

function updateRouteContract(repo, n) {
    const file = path.join(repo, 'src', 'core', 'navigation', 'routes', 'RouteContract.ts');
    if (!fs.existsSync(file)) {
        report.needsManual.push('RouteContract.ts: file not found — do the 3 route-contract edits by hand (DESIGN.md §5.1)');
        return;
    }
    let content = read(file);
    const label = 'RouteContract.ts';
    const startRe = /^\s*serviceFlow: \{/;

    // 1st serviceFlow block = the RouteDefinitionStacks type, 2nd = the implementation
    let planted = plantInBlock(content, startRe, '// <design-lane:serviceflow-types>', label, 1);
    if (planted === null) {
        report.needsManual.push(`${label}: could not find the serviceFlow TYPE block — add "${n.pageKey}: RouteDefinition<undefined>;" by hand`);
    } else content = planted;
    planted = plantInBlock(content, startRe, '// <design-lane:serviceflow-hrefs>', label, 2);
    if (planted === null) {
        report.needsManual.push(`${label}: could not find the serviceFlow toHref block — add the ${n.pageKey} toHref by hand`);
    } else content = planted;
    planted = plantAfterLast(content, /^\s*'serviceFlow\./, '// <design-lane:serviceflow-flat>', label);
    if (planted === null) {
        report.needsManual.push(`${label}: could not find the flat routeDefinitions serviceFlow entries — add 'serviceFlow.${n.pageKey}' by hand`);
    } else content = planted;

    const lines = content.split('\n');
    const typeAnchorLine = lines.find((line) => line.includes('// <design-lane:serviceflow-types>')) || '    ';
    const indent = (typeAnchorLine.match(/^(\s*)/) || ['', '    '])[1];
    const unit = indentUnit(content);

    content = insertBlock(
        content, '// <design-lane:serviceflow-types>',
        `${indent}${n.pageKey}: RouteDefinition<undefined>;`,
        new RegExp(`^\\s*${n.pageKey}: RouteDefinition<`, 'm'), label, `type ${n.pageKey}`
    );
    content = insertBlock(
        content, '// <design-lane:serviceflow-hrefs>',
        `${indent}${n.pageKey}: {\n${indent}${unit}toHref: () => '/service-flow/${n.serviceId}',\n${indent}},`,
        new RegExp(`'/service-flow/${n.serviceId}'`), label, `toHref ${n.pageKey}`
    );
    content = insertBlock(
        content, '// <design-lane:serviceflow-flat>',
        `${unit}'serviceFlow.${n.pageKey}': routeDefinitionStacks.serviceFlow.${n.pageKey},`,
        new RegExp(`'serviceFlow\\.${n.pageKey}':`), label, `flat serviceFlow.${n.pageKey}`
    );
    write(file, content);
}

function updateRoutes(repo, n) {
    const file = path.join(repo, 'src', 'core', 'navigation', 'routes', 'Routes.ts');
    if (!fs.existsSync(file)) {
        report.needsManual.push('Routes.ts: file not found — add the Routes.serviceFlow builder by hand (DESIGN.md §5.2)');
        return;
    }
    let content = read(file);
    const label = 'Routes.ts';
    const planted = plantInBlock(content, /^\s*serviceFlow: \{/, '// <design-lane:serviceflow-builders>', label, 1);
    if (planted === null) {
        report.needsManual.push(`${label}: could not find the serviceFlow block — add the ${n.pageKey}() builder by hand`);
        return;
    }
    content = planted;
    const anchorLine = content.split('\n').find((line) => line.includes('// <design-lane:serviceflow-builders>'));
    const indent = (anchorLine.match(/^(\s*)/) || ['', '    '])[1];
    content = insertBlock(
        content, '// <design-lane:serviceflow-builders>',
        `${indent}${n.pageKey}: (): AppRoute => ({ key: 'serviceFlow.${n.pageKey}' }),`,
        new RegExp(`key: 'serviceFlow\\.${n.pageKey}'`), label, `builder ${n.pageKey}()`
    );
    write(file, content);
}

function ensureStarterScreen(repo, n) {
    const relative = `src/features/${n.featureDir}/presentation/screens/${n.feature}Screen.tsx`;
    if (fs.existsSync(path.join(repo, relative))) return;
    // design-only lane, screens not built yet — registration must still compile
    createFile(repo, relative, `import React from 'react';
import { View } from 'react-native';

/** Placeholder flow host — TODO(claude): replace with the Figma build (DESIGN.md §2). */
export default function ${n.feature}Screen() {
    return <View />;
}
`);
    report.needsClaude.push(`${relative}: placeholder flow host — replace with the real screen build`);
}

function createRouteFile(repo, n) {
    createFile(repo, `app/service-flow/${n.serviceId}.tsx`, `import React from 'react';
import ${n.feature}Screen from '@features/${n.featureDir}/presentation/screens/${n.feature}Screen';

export default function ${n.feature}Route() {
    return <${n.feature}Screen />;
}
`);
}

function updatePageRegistry(repo, n) {
    const file = path.join(repo, 'src', 'presentation', 'service-flow', 'screens', 'pages', 'index.ts');
    if (!fs.existsSync(file)) {
        report.needsManual.push('pages/index.ts: service-flow page registry not found — register the page by hand (DESIGN.md §5.4)');
        return;
    }
    let content = read(file);
    const label = 'pages/index.ts';

    let planted = plantAfterLast(content, /^import\b/, '// <design-lane:page-imports>', label);
    if (planted === null) {
        report.needsManual.push(`${label}: no import lines found — add the ${n.feature}Screen import by hand`);
    } else content = planted;
    planted = plantInBlock(content, /^const serviceFlowPages\b.*= \{/, '// <design-lane:page-registry>', label, 1);
    if (planted === null) {
        report.needsManual.push(`${label}: could not find the serviceFlowPages map — register the page by hand`);
    } else content = planted;

    const unit = indentUnit(content);
    content = insertBlock(
        content, '// <design-lane:page-imports>',
        `import ${n.feature}Screen from '@features/${n.featureDir}/presentation/screens/${n.feature}Screen';`,
        new RegExp(`^import ${n.feature}Screen\\b`, 'm'), label, `import ${n.feature}Screen`
    );
    content = insertBlock(
        content, '// <design-lane:page-registry>',
        `${unit}...registerServiceFlowPage(['${n.pageKey}', '${n.serviceId}'], {
${unit}${unit}component: ${n.feature}Screen,
${unit}${unit}serviceId: '${n.serviceId}',
${unit}${unit}titleKey: 'services.${n.featureCamel}.title',
${unit}${unit}descriptionKey: 'services.${n.featureCamel}.description',
${unit}}),`,
        new RegExp(`registerServiceFlowPage\\(\\['${n.pageKey}', '${n.serviceId}'\\]`), label, `page ${n.pageKey}`
    );
    write(file, content);
}

function updateServicesData(repo, n, card) {
    const file = path.join(repo, 'src', 'presentation', 'services', 'models', 'servicesData.ts');
    if (!fs.existsSync(file)) {
        report.needsManual.push('servicesData.ts: file not found — add the SERVICES_DATA entry by hand (DESIGN.md §5.5)');
        return;
    }
    let content = read(file);
    const label = 'servicesData.ts';
    const planted = plantInBlock(content, /^export const SERVICES_DATA = \[/, '// <design-lane:services-data>', label, 1);
    if (planted === null) {
        report.needsManual.push(`${label}: could not find SERVICES_DATA — add the ${n.serviceId} entry by hand`);
        return;
    }
    content = planted;

    const unit = indentUnit(content);
    const now = new Date();
    const userTypes = card.userTypes === 'all'
        ? 'ALL_USER_TYPES'
        : `[${card.userTypes.map((t) => `'${t}'`).join(', ')}] as ServiceUserType[]`;
    const entryLines = [
        `${unit}{`,
        `${unit}${unit}id: '${n.serviceId}',`,
        `${unit}${unit}title: 'services.${n.featureCamel}.title',`,
        `${unit}${unit}description: 'services.${n.featureCamel}.description',`,
        `${unit}${unit}screen: Routes.serviceFlow.${n.pageKey}(),`,
        `${unit}${unit}cost: '${card.cost}',`,
        `${unit}${unit}serviceTypes: [${card.serviceTypes.map((t) => `'${t}'`).join(', ')}] as ServiceTypeKey[],`,
        `${unit}${unit}userTypes: ${userTypes},`,
        `${unit}${unit}addedAt: Date.UTC(${now.getUTCFullYear()}, ${now.getUTCMonth()}, ${now.getUTCDate()}),`,
        `${unit}${unit}processingTimeMinutes: ${card.processingTimeMinutes},`,
        `${unit}${unit}fees: ${card.fees},`,
    ];
    if (card.requiresAuth) entryLines.push(`${unit}${unit}requiresAuth: true,`);
    entryLines.push(`${unit}},`);
    content = insertBlock(
        content, '// <design-lane:services-data>', entryLines.join('\n'),
        new RegExp(`id: '${n.serviceId}',`), label, `service card ${n.serviceId}`
    );
    write(file, content);
}

function updateDeepLinking(repo, n) {
    const file = path.join(repo, 'src', 'core', 'deepLinking', 'DeepLinkingService.ts');
    if (!fs.existsSync(file)) {
        report.needsManual.push('DeepLinkingService.ts: file not found — add both dedicatedServiceFlowRoutes aliases by hand (DESIGN.md §5.7)');
        return;
    }
    let content = read(file);
    const label = 'DeepLinkingService.ts';
    const planted = plantInBlock(content, /^const dedicatedServiceFlowRoutes\b.*= \{/, '// <design-lane:deeplink-aliases>', label, 1);
    if (planted === null) {
        report.needsManual.push(`${label}: could not find dedicatedServiceFlowRoutes — add the ${n.serviceId} aliases by hand`);
        return;
    }
    content = planted;
    const unit = indentUnit(content);
    content = insertBlock(
        content, '// <design-lane:deeplink-aliases>',
        `${unit}'${n.serviceId}': () => Routes.serviceFlow.${n.pageKey}(),\n${unit}${n.pageKey}: () => Routes.serviceFlow.${n.pageKey}(),`,
        new RegExp(`'${n.serviceId}': \\(\\) => Routes\\.serviceFlow\\.${n.pageKey}\\(\\)`), label, `aliases ${n.serviceId} + ${n.pageKey}`
    );
    write(file, content);
}

function updateTranslations(repo, n) {
    for (const lang of ['en', 'ar']) {
        const relative = `src/core/localization/translations/${lang}.json`;
        const file = path.join(repo, relative);
        const label = `${lang}.json`;
        if (!fs.existsSync(file)) {
            report.needsManual.push(`${label}: ${relative} not found — add services.${n.featureCamel}.title/description by hand`);
            continue;
        }
        let data;
        try {
            data = JSON.parse(read(file));
        } catch (error) {
            report.needsManual.push(`${label}: unparseable JSON (${error.message}) — add services.${n.featureCamel} by hand`);
            continue;
        }
        if (!data.services || typeof data.services !== 'object') {
            report.needsManual.push(`${label}: no top-level "services" object — add services.${n.featureCamel} by hand`);
            continue;
        }
        // `services.<camel>` is the ONE copy of the service's title/description —
        // the page registry points at it too. A second object under
        // serviceFlow.pages.<camel> is a duplicate reviewers reject; flag it so
        // whoever hand-added it deletes it instead of drifting the two apart.
        if (data.serviceFlow?.pages?.[n.featureCamel]) {
            report.needsManual.push(
                `${label}: serviceFlow.pages.${n.featureCamel} duplicates services.${n.featureCamel} — ` +
                `delete the serviceFlow.pages copy and keep the page registry pointing at services.${n.featureCamel}.*`
            );
        }
        if (data.services[n.featureCamel]) {
            report.skippedExisting.push(`${label}: services.${n.featureCamel}`);
            continue;
        }
        data.services[n.featureCamel] = {
            title: `TODO(claude): ${n.feature} service card title`,
            description: `TODO(claude): ${n.feature} service card description`,
        };
        const original = read(file);
        const indent = (original.match(/^( +)"/m) || [null, '    '])[1];
        const serialized = JSON.stringify(data, null, indent) + (original.endsWith('\n') ? '\n' : '');
        write(file, preserveUnicodeEscapes(original, serialized));
        report.inserted.push(`${label}: services.${n.featureCamel} (placeholders)`);
    }
    report.needsClaude.push(`translations: fill services.${n.featureCamel}.title/description in en.json + ar.json (Arabic from Figma/story; flag for Corporate Communication)`);
}

function createFeatureRoutes(repo, n) {
    createFile(repo, `src/features/${n.featureDir}/presentation/routes.ts`, `import { Routes } from '@core/navigation/routes/Routes';
import type { AppRoute } from '@core/navigation/routes/RouteContract';

/** SERVICES_DATA id + deep-link alias (\`zatca://service-flow/${n.serviceId}\`). */
export const ${n.snake}_SERVICE_ID = '${n.serviceId}';
/** Page-registry key (camelCase alias in the service-flow page registry). */
export const ${n.snake}_PAGE_KEY = '${n.pageKey}';

export const ${n.pageKey}Route = (): AppRoute => Routes.serviceFlow.${n.pageKey}();
`);
}

// ------------------------------------------------------------------- main ----

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
        console.error('register-navigation.js: missing <feature-spec.json>. See --help.');
        return 1;
    }

    let spec;
    try {
        spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    } catch (error) {
        console.error(`register-navigation.js: cannot parse ${specPath}: ${error.message}`);
        return 1;
    }
    if (!spec.feature || !/^[A-Z][A-Za-z0-9]*$/.test(spec.feature)) {
        console.error('register-navigation.js: spec.feature must be a PascalCase feature name.');
        return 1;
    }
    if (!spec.design || typeof spec.design !== 'object') {
        console.error('register-navigation.js: the spec has no design block — run Screen collection (SKILL.md Step 2c) first.');
        return 1;
    }

    const n = {
        feature: pascal(spec.feature),
        // kebab-case on disk (repo convention); identifiers stay PascalCase
        featureDir: kebab(spec.feature),
        featureCamel: camel(spec.feature),
        pageKey: camel(spec.feature),
        serviceId: kebab(spec.feature),
        snake: snakeUpper(spec.feature),
    };
    if (!spec.design.serviceCard) {
        report.needsManual.push('design.serviceCard missing — SERVICES_DATA entry uses the Step 2c defaults; confirm them with the user');
    }
    const card = cardModel(spec, n);

    updateRouteContract(repo, n);
    updateRoutes(repo, n);
    ensureStarterScreen(repo, n);
    createRouteFile(repo, n);
    updatePageRegistry(repo, n);
    updateServicesData(repo, n, card);
    updateDeepLinking(repo, n);
    updateTranslations(repo, n);
    createFeatureRoutes(repo, n);

    // manifest: rollback.js deletes `created` and git-restores `patched`.
    // Design-only runs have no manifest yet (generate.js never ran) — create it.
    const manifestPath = path.join(repo, '.claude-skill-manifest.json');
    let manifest = { feature: n.feature, mode: 'design', created: [], patched: [] };
    if (fs.existsSync(manifestPath)) {
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch {
            report.needsManual.push('.claude-skill-manifest.json is unreadable — rollback will not cover the navigation edits; restore them by hand if aborting');
            manifest = null;
        }
    }
    const patched = [...touchedFiles].map((file) => path.relative(repo, file));
    if (manifest) {
        manifest.created = [...new Set([...(manifest.created ?? []), ...createdFiles])];
        manifest.patched = [...new Set([...(manifest.patched ?? []), ...patched])];
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }

    console.log(JSON.stringify({
        status: report.needsManual.length ? 'NEEDS_MANUAL' : 'REGISTERED',
        serviceId: n.serviceId,
        pageKey: n.pageKey,
        planted: report.planted.length,
        created: report.created,
        inserted: report.inserted.length,
        skippedExisting: report.skippedExisting.length,
        patched: patched.length,
        needsClaude: report.needsClaude,
        needsManual: report.needsManual,
    }, null, 2));
    return report.needsManual.length ? 2 : 0;
}

if (require.main === module) {
    // NOT process.exit(): stdout writes to a PIPE are asynchronous and exiting
    // truncates what is still buffered (found 2026-09-01 in components.js, which
    // lost ~10KB off a 76KB --all through a captured pipe while a file redirect
    // looked perfect). Compact stdout hides it; verbatim failure output would not.
    process.exitCode = main();
}
