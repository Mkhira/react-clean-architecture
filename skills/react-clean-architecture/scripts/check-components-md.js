#!/usr/bin/env node
/**
 * check-components-md.js — detect drift between the live shared-components
 * directory and the skill's COMPONENTS.md snapshot (live finding 2026-08-19:
 * the List organism existed in the repo with full JSDoc, but COMPONENTS.md had
 * no entry — the reuse gate nearly routed "paginated list" to a hand-built
 * FlatList).
 *
 * Detection only — it never generates prose. What it reports:
 *   DRIFT: a component exists in the repo but has no `### <Name>` section
 *          → write the missing COMPONENTS.md entry (props, gotchas, usage)
 *   STALE: a `### <Name>` section matches no repo component
 *          → the component was removed/renamed; fix or drop the section
 *
 * Scanned: subdirectories of src/shared/components/ui/{atoms,molecules,organisms}
 * plus root-level src/shared/components/*.tsx files (e.g. PriceTag.tsx).
 * A heading covers a component when any of its name tokens — the parts around
 * "/" plus parenthetical aliases like "(BaseButton)" — equals the component
 * name case-insensitively.
 *
 * Usage:
 *   node check-components-md.js [--repo <path>] [--doc <path>] [--strict]
 *   node check-components-md.js --help
 *       --doc defaults to the skill's own COMPONENTS.md
 *       --strict: exit 1 on any DRIFT/STALE (default always exits 0 — the
 *                 audit surfaces this as a WARN, not a FAIL)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const HELP = `check-components-md.js — COMPONENTS.md drift detector (detection only).

Usage:
  node check-components-md.js [--repo <path>] [--doc <path>] [--strict]
      --repo <path>   the app repo to scan (default: cwd)
      --doc <path>    the dictionary to check (default: the skill's COMPONENTS.md)
      --strict        exit 1 on any DRIFT/STALE (default: always 0 — the audit
                      surfaces this as a WARN, not a FAIL)
  node check-components-md.js --help

DRIFT = repo component with no \`### <Name>\` entry · STALE = entry matching no
component. Exit 2 = the doc or src/shared/components could not be read.`;

const BUCKETS = ['atoms', 'molecules', 'organisms'];

/** Repo components: [{ name, where }] — where is 'atoms' | ... | 'root'. */
function listComponents(repo) {
    const base = path.join(repo, 'src', 'shared', 'components');
    if (!fs.existsSync(base)) return null;
    const components = [];
    for (const bucket of BUCKETS) {
        const dir = path.join(base, 'ui', bucket);
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                components.push({ name: entry.name, where: bucket });
            }
        }
    }
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (entry.isFile() && /^[A-Z].*\.tsx$/.test(entry.name)) {
            components.push({ name: entry.name.replace(/\.tsx$/, ''), where: 'root' });
        }
    }
    return components;
}

/**
 * Headings: [{ heading, tokens }] from `### <names> — <kind>` lines.
 * Tokens: "Button (BaseButton) / IconButton" → button, basebutton, iconbutton.
 */
function listHeadings(docPath) {
    const content = fs.readFileSync(docPath, 'utf8');
    const headings = [];
    for (const match of content.matchAll(/^### (.+?) — .*$/gm)) {
        const namePart = match[1];
        const tokens = new Set();
        for (const paren of namePart.matchAll(/\(([^)]+)\)/g)) {
            for (const word of paren[1].split(/[\s/]+/)) {
                if (/^[A-Z]/.test(word)) tokens.add(word.toLowerCase());
            }
        }
        for (const piece of namePart.replace(/\([^)]*\)/g, '').split('/')) {
            const cleaned = piece.trim();
            if (cleaned) tokens.add(cleaned.toLowerCase());
        }
        headings.push({ heading: match[1], tokens });
    }
    return headings;
}

function diffComponentsDoc(components, headings) {
    const allTokens = new Set(headings.flatMap((h) => [...h.tokens]));
    const drift = components.filter((c) => !allTokens.has(c.name.toLowerCase()));
    const componentNames = new Set(components.map((c) => c.name.toLowerCase()));
    const stale = headings.filter((h) => ![...h.tokens].some((t) => componentNames.has(t)));
    return { drift, stale };
}

function main() {
    const argv = process.argv.slice(2);
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(HELP);
        return 0;
    }
    const repoIndex = argv.indexOf('--repo');
    const docIndex = argv.indexOf('--doc');
    const repo = repoIndex >= 0 ? path.resolve(argv[repoIndex + 1]) : process.cwd();
    const doc = docIndex >= 0 ? path.resolve(argv[docIndex + 1]) : path.join(__dirname, '..', 'COMPONENTS.md');

    if (!fs.existsSync(doc)) {
        console.error(`check-components-md.js: no COMPONENTS.md at ${doc}`);
        return 2;
    }
    const components = listComponents(repo);
    if (components === null) {
        console.error(`check-components-md.js: ${repo} has no src/shared/components — wrong --repo?`);
        return 2;
    }

    const { drift, stale } = diffComponentsDoc(components, listHeadings(doc));

    for (const c of drift) {
        console.log(`DRIFT: ${c.name} (${c.where}) exists in the repo but has no COMPONENTS.md entry — write it (props, gotchas, usage + a quick-lookup row)`);
    }
    for (const h of stale) {
        console.log(`STALE: "### ${h.heading}" matches no repo component — removed/renamed? fix or drop the section`);
    }
    console.log(`components-md: ${components.length} components, ${drift.length} drift, ${stale.length} stale`);
    return argv.includes('--strict') && (drift.length || stale.length) ? 1 : 0;
}

if (require.main === module) {
    process.exit(main());
}

module.exports = { listComponents, listHeadings, diffComponentsDoc };
