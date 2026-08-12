#!/usr/bin/env node
/**
 * json-to-dto.js — infer TypeScript type declarations from a sample JSON payload.
 * Node stdlib only. Also required by generate.js as a library.
 *
 * Usage:
 *   node json-to-dto.js <sample.json> --name VerifyTaxStampResponseDTO [--overrides <overrides.json>]
 *   node json-to-dto.js --help
 *
 * Rules:
 *   - null            → override for its dot-path, else `unknown` (reported)
 *   - []              → override, else `unknown[]` (reported)
 *   - arrays          → element type from first item, merged across items
 *   - nested objects  → named sub-types `<TypeName minus DTO><KeyPascal>DTO`
 *   - numbers → number; ISO-8601-looking strings stay `string` (dates are the MAPPER's job)
 *   - top-level array supported (emits `export type X = Item[]` + Item sub-type)
 *
 * Overrides map (dot-paths from the sample root, "" = root):
 *   { "pack": "nullable", "pack.CustomsAuthority": "string|null", "tags": "string[]" }
 *   - "nullable"          → `<inferred> | null`
 *   - "date" / "date|null" → `string` / `string | null` (formatting happens in the mapper)
 *   - anything else       → used verbatim as the TS type text
 */
'use strict';

const fs = require('fs');

const HELP = `json-to-dto.js — infer TS type declarations from sample JSON.

Usage:
  node json-to-dto.js <sample.json> --name <TypeName> [--overrides <overrides.json>]
  node json-to-dto.js --help

Prints the type declarations to stdout; warnings (unknown fields needing an
override) go to stderr and are also returned as JSON after "// warnings:".`;

const pascal = (value) =>
    String(value)
        .replace(/[^a-zA-Z0-9]+(.)/g, (_, ch) => ch.toUpperCase())
        .replace(/^(.)/, (_, ch) => ch.toUpperCase());

function overrideToType(override, inferred) {
    if (override === 'nullable') return `${inferred ?? 'unknown'} | null`;
    if (override === 'date') return 'string';
    if (override === 'date|null') return 'string | null';
    return override.replace(/\|/g, ' | ').replace(/\s+/g, ' ').replace(/ \| /g, ' | ');
}

/**
 * @returns {{ code: string, warnings: string[] }}
 * code = all `export type` declarations, root type LAST (matches repo DTO style
 * of small leaf types first).
 */
function generateTypes(sample, typeName, overrides = {}) {
    const warnings = [];
    const subtypes = []; // { name, fields: [{ key, type }] }
    const baseName = typeName.replace(/DTO$/, '');

    const subtypeName = (path) => `${baseName}${path.map(pascal).join('')}DTO`;

    function inferValue(value, path, keyForNaming) {
        const dotPath = path.join('.');
        const override = overrides[dotPath];

        if (value === null || value === undefined) {
            if (override) return overrideToType(override, null);
            warnings.push(`"${dotPath || '(root)'}" is null in the sample — using \`unknown\`; add a typeOverride to fix.`);
            return 'unknown';
        }
        if (Array.isArray(value)) {
            if (value.length === 0) {
                if (override) return overrideToType(override, null);
                warnings.push(`"${dotPath || '(root)'}" is an empty array — using \`unknown[]\`; add a typeOverride to fix.`);
                return 'unknown[]';
            }
            const elementType = inferArrayElement(value, path, keyForNaming);
            const result = `${elementType}[]`;
            return override ? overrideToType(override, result) : result;
        }
        if (typeof value === 'object') {
            const name = path.length === 0 ? typeName : subtypeName(path);
            emitObjectType(value, name, path);
            return override ? overrideToType(override, name) : name;
        }
        const primitive = typeof value; // string | number | boolean
        return override ? overrideToType(override, primitive) : primitive;
    }

    /** Merge element shapes across items so optional fields are caught. */
    function inferArrayElement(items, path, keyForNaming) {
        const first = items[0];
        if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
            const merged = {};
            const seenIn = {};
            for (const item of items) {
                if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
                for (const [key, val] of Object.entries(item)) {
                    if (!(key in merged) || merged[key] === null) merged[key] = val;
                    seenIn[key] = (seenIn[key] ?? 0) + 1;
                }
            }
            const objectItems = items.filter((i) => i !== null && typeof i === 'object' && !Array.isArray(i)).length;
            const name = path.length === 0 ? `${baseName}ItemDTO` : `${subtypeName(path)}`.replace(/DTO$/, 'ItemDTO');
            emitObjectType(merged, name, path, (key) => (seenIn[key] ?? 0) < objectItems);
            return name;
        }
        return inferValue(first, path, keyForNaming);
    }

    function emitObjectType(objectValue, name, path, isOptional = () => false) {
        if (subtypes.some((t) => t.name === name)) return;
        const placeholder = { name, fields: [] };
        subtypes.push(placeholder); // reserve position; children append after
        placeholder.fields = Object.entries(objectValue).map(([key, val]) => ({
            key,
            optional: isOptional(key),
            type: inferValue(val, [...path, key], key),
        }));
    }

    let rootDecl;
    if (Array.isArray(sample)) {
        const elementType = inferArrayElement(sample, [], null);
        rootDecl = `export type ${typeName} = ${elementType}[];`;
    } else if (sample !== null && typeof sample === 'object') {
        inferValue(sample, [], null);
        rootDecl = null; // emitted as a subtype named typeName
    } else {
        rootDecl = `export type ${typeName} = ${typeof sample};`;
    }

    const declarations = [];
    // leaf types first, root last — matches the existing TaxStampDTO.ts layout
    const ordered = [...subtypes].sort((a, b) => (a.name === typeName ? 1 : b.name === typeName ? -1 : 0));
    for (const subtype of ordered) {
        const lines = subtype.fields.map(
            (field) => `    ${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field.key) ? field.key : JSON.stringify(field.key)}${field.optional ? '?' : ''}: ${field.type};`
        );
        declarations.push(`export type ${subtype.name} = {\n${lines.join('\n')}\n};`);
    }
    if (rootDecl) declarations.push(rootDecl);

    return { code: declarations.join('\n\n'), warnings };
}

function main() {
    const argv = process.argv.slice(2);
    if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
        console.log(HELP);
        return argv.length ? 0 : 1;
    }
    const nameIndex = argv.indexOf('--name');
    const overridesIndex = argv.indexOf('--overrides');
    const isFlagValue = (i) =>
        (nameIndex >= 0 && i === nameIndex + 1) || (overridesIndex >= 0 && i === overridesIndex + 1);
    const file = argv.find((a, i) => !a.startsWith('--') && !isFlagValue(i));
    const typeName = nameIndex >= 0 ? argv[nameIndex + 1] : null;
    if (!file || !typeName) {
        console.error('json-to-dto.js: need <sample.json> and --name <TypeName>. See --help.');
        return 1;
    }
    let sample;
    try {
        sample = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        console.error(`json-to-dto.js: cannot parse ${file}: ${error.message}`);
        return 1;
    }
    let overrides = {};
    if (overridesIndex >= 0) {
        try {
            overrides = JSON.parse(fs.readFileSync(argv[overridesIndex + 1], 'utf8'));
        } catch (error) {
            console.error(`json-to-dto.js: cannot parse overrides: ${error.message}`);
            return 1;
        }
    }
    const { code, warnings } = generateTypes(sample, typeName, overrides);
    console.log(code);
    for (const warning of warnings) console.error(`warning: ${warning}`);
    return 0;
}

if (require.main === module) {
    process.exit(main());
}

module.exports = { generateTypes };
