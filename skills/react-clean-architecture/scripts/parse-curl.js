#!/usr/bin/env node
/**
 * parse-curl.js — tolerant curl/Postman-paste parser (Node stdlib only).
 *
 * Usage:
 *   node parse-curl.js <file>        # parse the paste stored in <file>
 *   node parse-curl.js -            # parse stdin
 *   cat paste.txt | node parse-curl.js
 *   node parse-curl.js --help
 *
 * Output (stdout): JSON
 *   { url, host, path, queryParams, method, headers, body, multipart }
 * Exit non-zero with a found/missing report when no URL can be located.
 *
 * Tolerated input shapes:
 *   - `curl` prefix optional (Postman exports may start with other text)
 *   - -H/--header, -d/--data/--data-raw/--data-binary/--body, -X/--request
 *   - -F/--form  (detected and reported as multipart: true — rejected by the skill in v1)
 *   - line continuations `\`, single/double quotes
 *   - "postman request POST 'https://…' --header …" style pastes
 */
'use strict';

const fs = require('fs');

const HELP = `parse-curl.js — parse a curl/Postman-style paste into structured JSON.

Usage:
  node parse-curl.js <file>     parse the paste stored in <file>
  node parse-curl.js -          parse stdin
  node parse-curl.js --help     show this help

Prints JSON: { url, host, path, queryParams, method, headers, body, multipart }.
Exits 1 with a found/missing report when no URL is present in the paste.`;

function readInput(argv) {
    const arg = argv[2];
    if (arg && arg !== '-') {
        return fs.readFileSync(arg, 'utf8');
    }
    return fs.readFileSync(0, 'utf8'); // stdin
}

/** Shell-ish tokenizer: quotes, backslash-escapes, `\` line continuations. */
function tokenize(text) {
    const src = text.replace(/\\\r?\n/g, ' '); // join continuations
    const tokens = [];
    let current = '';
    let quote = null; // "'" | '"' | null
    let has = false;

    for (let index = 0; index < src.length; index++) {
        const ch = src[index];
        if (quote === "'") {
            if (ch === "'") { quote = null; } else { current += ch; }
            continue;
        }
        if (quote === '"') {
            if (ch === '"') { quote = null; }
            else if (ch === '\\' && index + 1 < src.length && '"\\$`'.includes(src[index + 1])) {
                current += src[++index];
            } else { current += ch; }
            continue;
        }
        if (ch === "'" || ch === '"') { quote = ch; has = true; continue; }
        if (ch === '\\' && index + 1 < src.length) { current += src[++index]; has = true; continue; }
        if (/\s/.test(ch)) {
            if (has || current.length) { tokens.push(current); current = ''; has = false; }
            continue;
        }
        current += ch;
        has = true;
    }
    if (has || current.length) tokens.push(current);
    return tokens;
}

const HEADER_FLAGS = new Set(['-H', '--header']);
const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--body']);
const METHOD_FLAGS = new Set(['-X', '--request']);
const FORM_FLAGS = new Set(['-F', '--form', '--form-string']);
const URL_FLAGS = new Set(['--url']);
const IGNORED_WITH_VALUE = new Set(['-u', '--user', '-o', '--output', '--connect-timeout', '-m', '--max-time', '-b', '--cookie', '-A', '--user-agent', '--cacert', '--cert', '--key']);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

function looksLikeUrl(token) {
    return /^https?:\/\/\S+/i.test(token);
}

function parse(text) {
    const tokens = tokenize(text);
    let url = null;
    let method = null;
    let body = null;
    let multipart = false;
    const headers = [];

    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        const eq = token.indexOf('=');
        const flagName = eq > 0 && token.startsWith('--') ? token.slice(0, eq) : token;
        const inlineValue = eq > 0 && token.startsWith('--') ? token.slice(eq + 1) : null;
        const next = () => (inlineValue !== null ? inlineValue : tokens[++index]);

        if (HEADER_FLAGS.has(flagName)) {
            const raw = next();
            if (raw) {
                const colon = raw.indexOf(':');
                if (colon > 0) {
                    headers.push({ name: raw.slice(0, colon).trim(), value: raw.slice(colon + 1).trim() });
                }
            }
            continue;
        }
        if (DATA_FLAGS.has(flagName)) { body = next() ?? body; continue; }
        if (METHOD_FLAGS.has(flagName)) {
            const raw = next();
            if (raw) method = raw.toUpperCase();
            continue;
        }
        if (FORM_FLAGS.has(flagName)) { multipart = true; next(); continue; }
        if (URL_FLAGS.has(flagName)) {
            const raw = next();
            if (raw && looksLikeUrl(raw)) url = url || raw;
            continue;
        }
        if (IGNORED_WITH_VALUE.has(flagName)) { next(); continue; }
        if (token.startsWith('-')) continue; // unknown flag, no value assumed
        if (!method && HTTP_METHODS.has(token.toUpperCase()) && token === token.toUpperCase()) {
            method = token.toUpperCase(); // Postman style: "postman request POST 'url'"
            continue;
        }
        if (!url && looksLikeUrl(token)) { url = token; continue; }
        // anything else ("curl", "postman", "request", stray words) is ignored
    }

    if (headers.some((h) => /^content-type$/i.test(h.name) && /multipart\/form-data/i.test(h.value))) {
        multipart = true;
    }

    if (!url) {
        const found = [];
        if (method) found.push(`method ${method}`);
        if (headers.length) found.push(`${headers.length} header(s)`);
        if (body) found.push('a body');
        return { error: `No URL found in the paste. Found: ${found.length ? found.join(', ') : 'nothing recognizable'}. Missing: a full http(s):// URL.` };
    }

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return { error: `Found "${url}" but it is not a valid URL.` };
    }

    const queryParams = [];
    for (const [name, value] of parsed.searchParams.entries()) {
        queryParams.push({ name, value });
    }

    let parsedBody = null;
    if (body != null) {
        try { parsedBody = JSON.parse(body); } catch { parsedBody = body; }
    }

    return {
        url,
        host: parsed.origin,
        path: parsed.pathname,
        queryParams,
        method: method || (body != null ? 'POST' : 'GET'),
        headers,
        body: parsedBody,
        multipart,
    };
}

function main() {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        console.log(HELP);
        return 0;
    }
    let input;
    try {
        input = readInput(process.argv);
    } catch (error) {
        console.error(`parse-curl.js: cannot read input: ${error.message}`);
        return 1;
    }
    const result = parse(input);
    if (result.error) {
        console.error(`parse-curl.js: ${result.error}`);
        return 1;
    }
    console.log(JSON.stringify(result, null, 2));
    return 0;
}

if (require.main === module) {
    // NOT process.exit(): stdout writes to a PIPE are asynchronous and exiting
    // truncates what is still buffered (found 2026-09-01 in components.js, which
    // lost ~10KB off a 76KB --all through a captured pipe while a file redirect
    // looked perfect). Compact stdout hides it; verbatim failure output would not.
    process.exitCode = main();
}

module.exports = { parse, tokenize };
