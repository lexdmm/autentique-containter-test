const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleCreateDocument } = require('./createDocument');

const FILE = { buffer: Buffer.from('%PDF-1.4 fake'), originalname: 'contract.pdf' };

test('rejects when no file is attached (must_be_a_file)', () => {
    const result = handleCreateDocument({ document: { name: 'X' }, signers: [] }, null);

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.errors[0].extensions.validation, { file: ['must_be_a_file'] });
});

test('rejects an invalid signer phone at the right signers.N.phone path', () => {
    const variables = {
        document: { name: 'X' },
        signers: [{ email: 'ok@example.com' }, { phone: '11999999999' }],
    };

    const result = handleCreateDocument(variables, FILE);

    assert.deepEqual(result.body.errors[0].extensions.validation, {
        'signers.1.phone': ['must_be_a_valid_phone_number'],
    });
});

test('accepts a valid E.164-ish phone', () => {
    const variables = { document: { name: 'X' }, signers: [{ phone: '+5511999999999' }] };

    const result = handleCreateDocument(variables, FILE);

    assert.equal(result.status, 200);
    assert.equal(result.body.errors, undefined);
});

test('a phone-only signer gets link: null, matching Autentique\'s own example', () => {
    const variables = { document: { name: 'X' }, signers: [{ phone: '+5511999999999' }] };

    const result = handleCreateDocument(variables, FILE);
    const [signature] = result.body.data.createDocument.signatures;

    assert.equal(signature.link, null);
});

test('an email signer gets a link.short_link pointing at the sign page', () => {
    const variables = { document: { name: 'X' }, signers: [{ email: 'driver@example.com' }] };

    const result = handleCreateDocument(variables, FILE);
    const [signature] = result.body.data.createDocument.signatures;

    assert.match(signature.link.short_link, /\/sign\/[0-9a-f-]{36}$/);
});

test('response shape matches the documented Document fields', () => {
    const variables = { document: { name: 'Contract', refusable: true, sortable: true }, signers: [] };

    const { body } = handleCreateDocument(variables, FILE);
    const document = body.data.createDocument;

    assert.deepEqual(Object.keys(document).sort(), [
        'created_at', 'id', 'name', 'refusable', 'signatures', 'sortable',
    ]);
    assert.equal(document.name, 'Contract');
    assert.equal(document.refusable, true);
    assert.equal(document.sortable, true);
});
