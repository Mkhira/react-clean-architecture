'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, tokenize } = require('../scripts/parse-curl.js');

test('tokenize: quotes, escapes, and line continuations', () => {
    assert.deepEqual(tokenize(`curl 'a b' "c d" e\\ f`), ['curl', 'a b', 'c d', 'e f']);
    assert.deepEqual(tokenize("curl \\\n  next"), ['curl', 'next']);
    assert.deepEqual(tokenize(`--data '{"a":"x y"}'`), ['--data', '{"a":"x y"}']);
});

test('full curl: url/host/path/query/method/headers/body all extracted', () => {
    const parsed = parse(`curl --location 'https://partner.example.test/api/v1/track?debug=1&limit=20' \\
--header 'Content-Type: application/json' \\
--header 'x-api-key: fixture-key' \\
--data '{"OrderNumber":"ORD-1"}'`);
    assert.equal(parsed.url, 'https://partner.example.test/api/v1/track?debug=1&limit=20');
    assert.equal(parsed.host, 'https://partner.example.test');
    assert.equal(parsed.path, '/api/v1/track');
    assert.deepEqual(parsed.queryParams, [
        { name: 'debug', value: '1' },
        { name: 'limit', value: '20' },
    ]);
    assert.equal(parsed.method, 'POST'); // body present → POST default
    assert.deepEqual(parsed.headers, [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'x-api-key', value: 'fixture-key' },
    ]);
    assert.deepEqual(parsed.body, { OrderNumber: 'ORD-1' });
    assert.equal(parsed.multipart, false);
});

test('loose detection: Postman-style paste without a curl prefix', () => {
    const parsed = parse(`postman request POST 'https://api.example.test/v1/items' --header 'Accept: application/json' --body '{"a":1}'`);
    assert.equal(parsed.url, 'https://api.example.test/v1/items');
    assert.equal(parsed.method, 'POST');
    assert.deepEqual(parsed.body, { a: 1 });
});

test('method: no body defaults to GET; -X overrides; --request works', () => {
    assert.equal(parse(`curl 'https://a.test/x'`).method, 'GET');
    assert.equal(parse(`curl -X DELETE 'https://a.test/x'`).method, 'DELETE');
    assert.equal(parse(`curl --request PUT 'https://a.test/x' -d '{}'`).method, 'PUT');
});

test('--flag=value inline form is accepted', () => {
    const parsed = parse(`curl --url=https://a.test/x --header='X-Key: k1'`);
    assert.equal(parsed.url, 'https://a.test/x');
    assert.deepEqual(parsed.headers, [{ name: 'X-Key', value: 'k1' }]);
});

test('multipart detected via -F and via Content-Type header', () => {
    assert.equal(parse(`curl 'https://a.test/upload' -F 'file=@x.png'`).multipart, true);
    assert.equal(parse(`curl 'https://a.test/upload' -H 'Content-Type: multipart/form-data' -d 'x'`).multipart, true);
    assert.equal(parse(`curl 'https://a.test/x' -d '{}'`).multipart, false);
});

test('non-JSON body is kept as a raw string', () => {
    assert.equal(parse(`curl 'https://a.test/x' --data 'a=1&b=2'`).body, 'a=1&b=2');
});

test('flags with values (like -u) do not eat the URL', () => {
    const parsed = parse(`curl -u user:pass 'https://a.test/x'`);
    assert.equal(parsed.url, 'https://a.test/x');
});

test('missing URL: error names what was found and what is missing', () => {
    const parsed = parse(`--header 'X-Key: abc' -d '{"a":1}'`);
    assert.ok(parsed.error);
    assert.match(parsed.error, /No URL found/);
    assert.match(parsed.error, /1 header\(s\)/);
    assert.match(parsed.error, /a body/);
});
