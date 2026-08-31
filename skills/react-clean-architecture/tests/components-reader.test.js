'use strict';
/**
 * Tests for components.js — the on-demand COMPONENTS.md reader (v1.16.0).
 *
 * The whole point of the script is that the reuse gate reads the sections it
 * needs instead of the whole dictionary. So the properties that
 * matter are: the index is small, an entry comes back BYTE-IDENTICAL to the
 * file (it is retrieval, not summarisation), and a name with no entry produces
 * a loud MISS rather than silence — silence is what gets a duplicate hand-built.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readIndex, readEntries, findEntries } = require('../scripts/components.js');
const { readSections, bodyStartLine } = require('../scripts/docref.js');
const { runScript, makeTmpDir, write } = require('./helpers.js');

const DOC = path.join(__dirname, '..', 'COMPONENTS.md');
const CONTENT = fs.readFileSync(DOC, 'utf8');

// ------------------------------------------------------------- parsing ----

test('readIndex stops at the first bucket heading', () => {
    const index = readIndex(CONTENT);
    assert.match(index, /Quick lookup/);
    assert.match(index, /FORMS COME FIRST/);
    assert.doesNotMatch(index, /^## Atoms$/m);
    assert.doesNotMatch(index, /^### /m);
});

test('readEntries finds every ### entry and no bucket headings leak into bodies', () => {
    const entries = readEntries(CONTENT);
    const headingCount = (CONTENT.match(/^### /gm) || []).length;
    assert.equal(entries.length, headingCount);
    for (const entry of entries) {
        assert.match(entry.body, /^### /);
        assert.doesNotMatch(entry.body, /^## /m);
    }
});

test('entry bodies are byte-identical slices of the file', () => {
    for (const entry of readEntries(CONTENT)) {
        assert.ok(CONTENT.includes(entry.body), `${entry.heading} was not a verbatim slice`);
    }
});

test('tokens cover aliases and slash-separated names, like the drift checker', () => {
    const entries = readEntries(CONTENT);
    const button = entries.find((e) => e.heading.startsWith('Button (BaseButton)'));
    assert.ok(button, 'expected the Button (BaseButton) entry');
    assert.ok(button.tokens.has('button'));
    assert.ok(button.tokens.has('basebutton'));
});

test('findEntries matches case-insensitively and falls back to substrings', () => {
    const entries = readEntries(CONTENT);
    assert.equal(findEntries(entries, 'list').length > 0, true);
    assert.equal(findEntries(entries, 'LIST').length > 0, true);
    assert.equal(findEntries(entries, 'Sparkline').length, 0);
});

// --------------------------------------------------------------- CLI ------

test('no argument prints the index and points at the per-entry command', () => {
    const { status, stdout } = runScript('components.js', []);
    assert.equal(status, 0);
    assert.match(stdout, /Quick lookup/);
    assert.match(stdout, /components\.js Card List PageHeader/);
    // the index must NOT drag the 64 entries along — that is the whole point
    assert.doesNotMatch(stdout, /^### /m);
});

test('the index stays far cheaper than the whole file', () => {
    const { stdout } = runScript('components.js', []);
    assert.ok(
        stdout.length < CONTENT.length / 5,
        `index is ${stdout.length}c against a ${CONTENT.length}c file — the saving is gone`
    );
});

test('named entries come back complete and verbatim', () => {
    const { status, stdout } = runScript('components.js', ['Card', 'List']);
    assert.equal(status, 0);
    assert.match(stdout, /^### Card — molecule$/m);
    assert.match(stdout, /^### List — organism$/m);
    const listEntry = readEntries(CONTENT).find((e) => e.heading.startsWith('List —'));
    assert.ok(stdout.includes(listEntry.body), 'List entry was not served verbatim');
});

test('a repeated name is printed once', () => {
    const { stdout } = runScript('components.js', ['Card', 'card', 'CARD']);
    assert.equal((stdout.match(/^### Card — molecule$/gm) || []).length, 1);
});

test('an unknown name MISSes loudly and names the drift command', () => {
    const { status, stdout } = runScript('components.js', ['Sparkline']);
    assert.equal(status, 0, 'a MISS is information, not a failure');
    assert.match(stdout, /MISS: no section of COMPONENTS\.md matches "Sparkline"/);
    assert.match(stdout, /does NOT mean the thing does not exist/);
    assert.match(stdout, /check-components-md\.js/);
});

test('a MISS alongside a hit still prints the hit', () => {
    const { stdout } = runScript('components.js', ['Card', 'Sparkline']);
    assert.match(stdout, /^### Card — molecule$/m);
    assert.match(stdout, /MISS: .*Sparkline/);
});

test('--list names every entry, --all is the escape hatch', () => {
    const { stdout: list } = runScript('components.js', ['--list']);
    const entries = readEntries(CONTENT);
    assert.match(list, new RegExp(`${entries.length} sections`));
    assert.match(list, /^Molecules › Card — molecule$/m);

    const { stdout: all } = runScript('components.js', ['--all']);
    assert.equal(all.trimEnd(), CONTENT.trimEnd());
});

test('--doc reads a different dictionary; a missing one exits 2', () => {
    const dir = makeTmpDir('doc');
    write(dir, 'D.md', '# T\n\nintro\n\n## Atoms\n\n### Widget — atom\n\nbody line\n');
    const { status, stdout } = runScript('components.js', ['--doc', path.join(dir, 'D.md'), 'Widget']);
    assert.equal(status, 0);
    assert.match(stdout, /### Widget — atom/);
    assert.match(stdout, /body line/);

    const missing = runScript('components.js', ['--doc', path.join(dir, 'nope.md')]);
    assert.equal(missing.status, 2);
});

// ------------------------------------------------- form-owned entries ------

test('the nine builder-rendered components keep headings but use the short shape', () => {
    const entries = readEntries(CONTENT);
    const formOwned = [
        'TextInput',
        'DropdownInput',
        'Dropdown',
        'DropdownItem',
        'OptionGroup',
        'Checkbox',
        'Radio',
        'DatePicker',
        'FileUpload',
    ];
    for (const name of formOwned) {
        const entry = entries.find((e) => e.tokens.has(name.toLowerCase()));
        assert.ok(entry, `${name} lost its entry — the drift checker would report STALE`);
        assert.match(entry.body, /\*\*In a form:\*\*/, `${name} is missing its "In a form" line`);
        assert.ok(
            entry.body.length < 1300,
            `${name} was re-expanded to ${entry.body.length}c — the builder owns its props`
        );
    }
});

test('form-owned entries keep the facts that survive the builder', () => {
    const entries = readEntries(CONTENT);
    const get = (n) => entries.find((e) => e.tokens.has(n)).body;
    // the variant list IS the field config's `variant` values
    assert.match(get('textinput'), /'phone-number'/);
    // the builder passes these straight through (added 2026-08-31)
    assert.match(get('optiongroup'), /titleSpacing/);
    assert.match(get('optiongroup'), /itemSpacing/);
    // the date field stores the formatted string, not a Date
    assert.match(get('datepicker'), /DEFAULT_DATE_FORMAT/);
    // traps that still bite through the builder
    assert.match(get('dropdown'), /Returns `null` when not visible/);
    assert.match(get('fileupload'), /presentational/);
});

// ------------------------------------------- generic engine (docref.js) ----

/*
 * docref.js backs both readers. COMPONENTS.md is `## bucket` → `### component`;
 * HOW_TO_USE.md mixes `## group` → `### section` with standalone `##` sections.
 * The engine has to keep the first working exactly as before while handling the
 * second — including not filing a standalone `##` under the group above it.
 */

const HOW_TO_USE = `# Doc

intro line

## Quick start

start body

## Field configuration reference

### Text input

text body

### Dropdown

dropdown body

## Conditional visibility

standalone body

## Validation

### Required

required body
`;

test('the index stops at the first ## that has ### children', () => {
    const index = readIndex(HOW_TO_USE);
    assert.match(index, /Quick start/);
    assert.match(index, /start body/);
    assert.doesNotMatch(index, /Field configuration reference/);
});

test('a ## with ### children is a group label, not a section', () => {
    const sections = readSections(HOW_TO_USE);
    const names = sections.map((s) => s.heading);
    assert.deepEqual(names, [
        'Text input',
        'Dropdown',
        'Conditional visibility',
        'Required',
    ]);
});

test('a standalone ## is a top-level section, not part of the group above it', () => {
    const sections = readSections(HOW_TO_USE);
    const standalone = sections.find((s) => s.heading === 'Conditional visibility');
    assert.equal(standalone.group, null);
    assert.equal(sections.find((s) => s.heading === 'Text input').group, 'Field configuration reference');
    assert.equal(sections.find((s) => s.heading === 'Required').group, 'Validation');
});

test('multi-word section names match, and bodies stay verbatim', () => {
    const sections = readSections(HOW_TO_USE);
    const [hit] = findEntries(sections, 'Text input');
    assert.equal(hit.heading, 'Text input');
    assert.ok(HOW_TO_USE.includes(hit.body));
    assert.match(hit.body, /text body/);
});

test('a document with no headings is all index and no sections', () => {
    assert.equal(bodyStartLine('just prose\n'), null);
    assert.equal(readSections('just prose\n').length, 0);
    assert.equal(readIndex('just prose\n'), 'just prose');
});

test('formref.js resolves HOW_TO_USE.md under --repo and MISSes loudly', () => {
    const repo = makeTmpDir('formrepo');
    write(repo, 'src/shared/formBuilder/HOW_TO_USE.md', HOW_TO_USE);

    const hit = runScript('formref.js', ['--repo', repo, 'Dropdown']);
    assert.equal(hit.status, 0);
    assert.match(hit.stdout, /### Dropdown/);
    assert.match(hit.stdout, /dropdown body/);

    const miss = runScript('formref.js', ['--repo', repo, 'Sparkline']);
    assert.match(miss.stdout, /MISS: .*Sparkline/);
    assert.match(miss.stdout, /FormFieldConfig\.ts/);

    const nowhere = runScript('formref.js', ['--repo', makeTmpDir('empty')]);
    assert.equal(nowhere.status, 2);
});

test('no reader instruction states a token budget', () => {
    /*
     * The user's standing directive: structural savings yes, read caps never.
     * "theme tokens only" is a design-token phrase and must NOT trip this — what
     * is banned is a token COST attached to reading (a number, or cap language),
     * because that biases the agent toward reading less than it needs.
     */
    const COST = /\d+\s*k?\s*tokens?\b|tokens? (?:each|per|budget|cost)|costs? .{0,20}tokens?/i;
    const CAP = /at most|no more than|budget|limit yourself|only read|sparingly|if strictly necessary/i;
    for (const script of ['components.js', 'formref.js']) {
        for (const argv of [[], ['--help'], ['--list']]) {
            const { stdout } = runScript(script, argv);
            assert.doesNotMatch(stdout, COST, `${script} ${argv.join(' ')} states a token cost`);
            assert.doesNotMatch(stdout, CAP, `${script} ${argv.join(' ')} caps what may be read`);
        }
    }
});
