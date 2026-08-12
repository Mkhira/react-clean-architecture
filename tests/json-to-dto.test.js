'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateTypes } = require('../scripts/json-to-dto.js');

test('primitives map to string/number/boolean', () => {
    const { code, warnings } = generateTypes({ Name: 'x', Count: 3, Active: true }, 'SampleDTO');
    assert.match(code, /Name: string;/);
    assert.match(code, /Count: number;/);
    assert.match(code, /Active: boolean;/);
    assert.equal(warnings.length, 0);
});

test('nested object becomes a named sub-type declared before the root', () => {
    const { code } = generateTypes({ Pack: { Origin: 'SA' } }, 'ScanResponseDTO');
    assert.match(code, /export type ScanResponsePackDTO = \{\n\s+Origin: string;\n\};/);
    assert.match(code, /Pack: ScanResponsePackDTO;/);
    assert.ok(code.indexOf('ScanResponsePackDTO =') < code.indexOf('export type ScanResponseDTO'));
});

test('null and empty-array fields fall back to unknown with a warning each', () => {
    const { code, warnings } = generateTypes({ A: null, B: [] }, 'TestDTO');
    assert.match(code, /A: unknown;/);
    assert.match(code, /B: unknown\[\];/);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /typeOverride/);
});

test('typeOverrides: nullable, explicit unions, date handling, arrays', () => {
    const { code, warnings } = generateTypes(
        { Pack: { When: null }, Tags: [], Note: null },
        'OrderDTO',
        { Pack: 'nullable', 'Pack.When': 'date|null', Tags: 'string[]', Note: 'string|null' }
    );
    assert.match(code, /Pack: OrderPackDTO \| null;/);
    assert.match(code, /When: string \| null;/); // date stays string in the DTO
    assert.match(code, /Tags: string\[\];/);
    assert.match(code, /Note: string \| null;/);
    assert.equal(warnings.length, 0);
});

test('array items are merged across the array — fields missing from some items become optional', () => {
    const { code } = generateTypes(
        [{ Id: 1, Note: 'x' }, { Id: 2 }, { Id: 3, Extra: true }],
        'HistoryResponseDTO'
    );
    assert.match(code, /Id: number;/);
    assert.match(code, /Note\?: string;/);
    assert.match(code, /Extra\?: boolean;/);
    assert.match(code, /export type HistoryResponseDTO = HistoryResponseItemDTO\[\];/);
});

test('top-level array of primitives', () => {
    const { code } = generateTypes(['a', 'b'], 'CodesDTO');
    assert.match(code, /export type CodesDTO = string\[\];/);
});

test('ISO-date-looking strings stay string — formatting is the mapper\'s job', () => {
    const { code } = generateTypes({ At: '2025-02-13T11:11:40.0110000Z' }, 'EventDTO');
    assert.match(code, /At: string;/);
});

test('non-identifier keys are quoted', () => {
    const { code } = generateTypes({ 'x-rate-limit': 10 }, 'MetaDTO');
    assert.match(code, /"x-rate-limit": number;/);
});

test('root primitive sample produces a type alias', () => {
    const { code } = generateTypes(42, 'CountDTO');
    assert.match(code, /export type CountDTO = number;/);
});
