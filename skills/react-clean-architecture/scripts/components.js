#!/usr/bin/env node
/**
 * components.js — on-demand reader for the skill's COMPONENTS.md.
 *
 *   node components.js                  → the index: FORMS-first note + the
 *                                         "I need X → use Y" table
 *   node components.js Card List        → those entries, verbatim and complete
 *   node components.js --list / --all   → every name / the whole file
 *
 * Retrieval, not a budget: pull every component the screen plausibly touches,
 * and pull more when unsure. A component you did not look up is a shared
 * component you hand-build a duplicate of. Engine and rules: docref.js.
 */
'use strict';

const path = require('path');
const docref = require('./docref.js');

const OPTIONS = {
    script: '<skill>/scripts/components.js',
    doc: path.join(__dirname, '..', 'COMPONENTS.md'),
    label: 'COMPONENTS.md',
    examples: 'Card List PageHeader BottomSheetModal',
    missHint:
        'Check the live directory (ls src/shared/components/ui/{atoms,molecules,organisms}) and ' +
        'run: node <skill>/scripts/check-components-md.js --repo <repo>   (DRIFT = write the entry)',
};

if (require.main === module) {
    // NOT process.exit(): stdout writes to a PIPE are asynchronous and exiting
    // truncates what is still buffered (found 2026-09-01 — `--all` lost ~10KB of
    // 76KB through a captured pipe while a file redirect looked perfect).
    process.exitCode = docref.run(process.argv.slice(2), OPTIONS);
}

module.exports = {
    OPTIONS,
    readIndex: docref.readIndex,
    readEntries: docref.readSections,
    readSections: docref.readSections,
    findEntries: docref.findSections,
    findSections: docref.findSections,
};
