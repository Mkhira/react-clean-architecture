#!/usr/bin/env node
/**
 * docref.js — section reader for the skill's long reference documents.
 *
 * Reference docs (COMPONENTS.md, the form builder's HOW_TO_USE.md) are indexes
 * of independent sections: a screen needs the four sections it touches, not the
 * sixty it doesn't. Reading one whole to answer one question costs more than the
 * screen being built, so this serves the same text section by section.
 *
 * This is RETRIEVAL, never summarisation and never a budget:
 *   - a section comes back byte-identical to the file
 *   - `--all` prints the entire document, any time
 *   - nothing is off-limits, and there is no cap on how much you may pull
 * Pull every section the work plausibly touches, and pull more whenever you are
 * unsure — a section you skipped is a trap you walk into. A name with no match
 * prints a MISS, never silence: "no output" must not be read as "nothing exists".
 *
 * Document shape it expects: an intro, then `##` groups whose `###` subsections
 * are the entries. A `##` section with no `###` children is an entry itself. The
 * index is everything before the first `##` that has `###` children — for
 * COMPONENTS.md that is the intro + quick-lookup table; for HOW_TO_USE.md the
 * title + Quick start.
 *
 * CLIs that wrap this: components.js (COMPONENTS.md), formref.js (the repo's
 * src/shared/formBuilder/HOW_TO_USE.md).
 */
'use strict';

const fs = require('fs');

/** All `##`/`###` headings as [{ level, text, line }]. */
function headings(content) {
    const out = [];
    content.split('\n').forEach((line, index) => {
        const match = /^(#{2,3}) (.+)$/.exec(line);
        if (match) out.push({ level: match[1].length, text: match[2].trim(), line: index });
    });
    return out;
}

/**
 * Line where the reference body starts: the first `##` that has `###` children.
 * A flat document (only `##`) falls back to its first `##`; a document with no
 * headings at all has no body, so the whole file is the index.
 */
function bodyStartLine(content) {
    const found = headings(content);
    for (let i = 0; i < found.length; i += 1) {
        if (found[i].level !== 2) continue;
        for (let j = i + 1; j < found.length && found[j].level !== 2; j += 1) {
            if (found[j].level === 3) return found[i].line;
        }
    }
    return found.length ? found[0].line : null;
}

/** Everything before the reference body: intro, quick-lookup, gate notes. */
function readIndex(content) {
    const start = bodyStartLine(content);
    const lines = content.split('\n');
    return (start === null ? lines : lines.slice(0, start)).join('\n').trimEnd();
}

/**
 * Name tokens for a heading, matching check-components-md.js so both agree:
 * "Button (BaseButton) / IconButton — atom" → button, basebutton, iconbutton.
 * A heading with no " — " kind suffix (HOW_TO_USE.md style) keeps its full text.
 */
function headingTokens(text) {
    const namePart = text.split(' — ')[0];
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
    return tokens;
}

/**
 * Retrievable sections as [{ heading, group, tokens, body }].
 * A `##` with `###` children is a group label, not a section; its children are.
 * A `##` without `###` children is a section in its own right.
 */
function readSections(content) {
    const start = bodyStartLine(content);
    if (start === null) return [];
    const lines = content.split('\n');
    const found = headings(content).filter((h) => h.line >= start);

    const isGroup = (index) => {
        if (found[index].level !== 2) return false;
        for (let j = index + 1; j < found.length && found[j].level !== 2; j += 1) {
            if (found[j].level === 3) return true;
        }
        return false;
    };

    const sections = [];
    let group = null;
    for (let i = 0; i < found.length; i += 1) {
        if (found[i].level === 2) {
            // Any `##` ends the previous group: a childless one is a top-level
            // section, not a straggler of the group above it (HOW_TO_USE.md's
            // "Conditional visibility" is not part of "Field configuration
            // reference", and mislabelling it sends the reader to the wrong place).
            group = isGroup(i) ? found[i].text : null;
            if (group !== null) continue;
        }
        const end = i + 1 < found.length ? found[i + 1].line : lines.length;
        sections.push({
            heading: found[i].text,
            group,
            tokens: headingTokens(found[i].text),
            body: lines.slice(found[i].line, end).join('\n').trimEnd(),
        });
    }
    return sections;
}

/** Exact token match, else any section whose token overlaps the name. */
function findSections(sections, name) {
    const needle = name.toLowerCase().trim();
    const exact = sections.filter((s) => s.tokens.has(needle));
    if (exact.length) return exact;
    return sections.filter((s) =>
        [...s.tokens].some((token) => token.includes(needle) || needle.includes(token))
    );
}

/**
 * Shared CLI. `options` supplies the wrapper's identity: { script, doc, label,
 * examples, missHint }.
 */
function run(argv, options) {
    const { script, label, examples, missHint = '' } = options;
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(help(options));
        return 0;
    }
    const docIndex = argv.indexOf('--doc');
    const doc = docIndex >= 0 ? argv[docIndex + 1] : options.doc;
    if (!doc || !fs.existsSync(doc)) {
        console.error(`${script}: no ${label} at ${doc}`);
        return 2;
    }
    const content = fs.readFileSync(doc, 'utf8');
    const names = argv.filter((arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--doc');

    if (argv.includes('--all')) {
        console.log(content.trimEnd());
        return 0;
    }

    const sections = readSections(content);

    if (argv.includes('--list')) {
        for (const section of sections) {
            console.log(section.group ? `${section.group} › ${section.heading}` : section.heading);
        }
        console.log(`\n${sections.length} sections — \`node ${script} <Name>...\` for any of them.`);
        return 0;
    }

    if (!names.length) {
        console.log(readIndex(content));
        console.log(
            `\n---\n${sections.length} sections are NOT printed above. Pull the ones this work ` +
                `touches — all of them if that is what it takes:\n    node ${script} ${examples}\n` +
                `Pulling a section you end up not needing costs you nothing. Skipping one you ` +
                `needed is a trap you walk into. \`--list\` shows every name, \`--all\` prints ` +
                `the whole document.`
        );
        return 0;
    }

    const misses = [];
    const printed = new Set();
    for (const name of names) {
        const found = findSections(sections, name);
        if (!found.length) {
            misses.push(name);
            continue;
        }
        for (const section of found) {
            if (printed.has(section.heading)) continue;
            printed.add(section.heading);
            console.log(section.body);
            console.log();
        }
    }
    for (const name of misses) {
        console.log(`MISS: no section of ${label} matches "${name}".`);
        console.log('  This does NOT mean the thing does not exist — the document may be behind the code.');
        if (missHint) console.log(`  ${missHint}`);
        console.log(`  Browse every section name: node ${script} --list`);
    }
    return 0;
}

function help(options) {
    const { script, label, examples, doc } = options;
    return `${script} — section reader for ${label}.

Usage:
  node ${script}                        the index (intro + lookup tables)
  node ${script} <Name> [<Name>...]     print those sections verbatim
  node ${script} --list                 every section name, one per line
  node ${script} --all                  the whole document
  node ${script} --doc <path>           read a different document
  node ${script} --help

  e.g. node ${script} ${examples}

Default document: ${doc}

Read the index first, then pull every section the work plausibly touches — there
is no cap, and pulling extra costs you nothing. Sections come back byte-identical
to the file. A MISS is information, not failure (exit 0); exit 2 = unreadable doc.`;
}

module.exports = { headings, bodyStartLine, readIndex, headingTokens, readSections, findSections, run, help };
