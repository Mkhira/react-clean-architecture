#!/usr/bin/env node
/**
 * formref.js — on-demand reader for the form builder's API reference,
 * `src/shared/formBuilder/HOW_TO_USE.md` in the target repo.
 *
 *   node formref.js                              → index: title + Quick start
 *   node formref.js "Text input" Dropdown Date    → those sections, verbatim
 *   node formref.js --list / --all                → every name / the whole file
 *
 * FORMS.md holds the decision procedure (is this a form? which field type?);
 * this serves the exhaustive prop reference behind it, one section at a time.
 * Retrieval, not a budget — pull every section the form plausibly touches, and
 * pull more when unsure. Engine and rules: docref.js.
 *
 * Run from the target repo root, or pass --repo <path>.
 */
'use strict';

const path = require('path');
const docref = require('./docref.js');

const DOC_RELATIVE = path.join('src', 'shared', 'formBuilder', 'HOW_TO_USE.md');

function optionsFor(argv) {
    const repoIndex = argv.indexOf('--repo');
    const repo = repoIndex >= 0 ? path.resolve(argv[repoIndex + 1]) : process.cwd();
    return {
        script: '<skill>/scripts/formref.js',
        doc: path.join(repo, DOC_RELATIVE),
        label: 'the form builder HOW_TO_USE.md',
        examples: '"Text input" Dropdown "Built-in presets (complete list)"',
        missHint:
            'The builder may have gained it since the doc was written — check ' +
            'src/shared/formBuilder/types/FormFieldConfig.ts, then update HOW_TO_USE.md.',
    };
}

if (require.main === module) {
    // See components.js: process.exit() truncates buffered stdout on a pipe.
    const argv = process.argv.slice(2);
    const repoIndex = argv.indexOf('--repo');
    const forwarded = repoIndex >= 0 ? argv.filter((_, i) => i !== repoIndex && i !== repoIndex + 1) : argv;
    process.exitCode = docref.run(forwarded, optionsFor(argv));
}

module.exports = { DOC_RELATIVE, optionsFor };
