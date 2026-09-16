const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./server');
const { saveDocument } = require('./store');

const AUTHORIZATION = { Authorization: 'Bearer fake-local-token' };
let server;
let baseUrl;

before(async () => {
    await new Promise((resolve) => {
        server = createApp().listen(0, '127.0.0.1', () => {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
});

after(async () => {
    await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
});

async function graphqlRequest(body, headers = AUTHORIZATION) {
    const response = await fetch(`${baseUrl}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });

    return { status: response.status, body: await response.json() };
}

test('requires the configured bearer token', async () => {
    const missing = await graphqlRequest({ query: '{ document(id: "missing") { id } }' }, {});
    const invalid = await graphqlRequest(
        { query: '{ document(id: "missing") { id } }' },
        { Authorization: 'Bearer wrong-token' }
    );

    assert.equal(missing.status, 200);
    assert.equal(missing.body.errors[0].extensions.code, 'unauthorized');
    assert.equal(invalid.body.errors[0].extensions.code, 'unauthorized');
});

test('executes literal arguments, aliases, and only selected fields', async () => {
    saveDocument({ id: 'graphql-literal', name: 'Contract', signatures: [] });

    const result = await graphqlRequest({
        query: '{ selected: document(id: "graphql-literal") { name } }',
    });

    assert.deepEqual(result.body, { data: { selected: { name: 'Contract' } } });
});

test('accepts arbitrary GraphQL variable names', async () => {
    saveDocument({ id: 'graphql-variable', name: 'Variable contract', signatures: [] });

    const result = await graphqlRequest({
        query: 'query Find($customId: ID!) { document(id: $customId) { id } }',
        variables: { customId: 'graphql-variable' },
    });

    assert.deepEqual(result.body, { data: { document: { id: 'graphql-variable' } } });
});

test('returns GraphQL path, location, data, and code for a missing document', async () => {
    const result = await graphqlRequest({ query: '{ document(id: "missing") { id } }' });
    const [error] = result.body.errors;

    assert.deepEqual(result.body.data, { document: null });
    assert.equal(error.message, 'Document not found');
    assert.deepEqual(error.path, ['document']);
    assert.equal(error.locations[0].line, 1);
    assert.equal(error.extensions.code, 'document_not_found');
});

test('maps multipart files and returns the documented validation envelope', async () => {
    const form = new FormData();
    form.append('operations', JSON.stringify({
        query: `mutation Create($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
            createDocument(document: $document, signers: $signers, file: $file) { id }
        }`,
        variables: {
            document: { name: 'Invalid phone' },
            signers: [{ phone: '11999999999' }],
            file: null,
        },
    }));
    form.append('map', JSON.stringify({ upload: ['variables.file'] }));
    form.append('upload', new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), 'contract.pdf');

    const response = await fetch(`${baseUrl}/graphql`, {
        method: 'POST',
        headers: AUTHORIZATION,
        body: form,
    });
    const body = await response.json();
    const [error] = body.errors;

    assert.deepEqual(body.data, { createDocument: null });
    assert.equal(error.message, 'validation');
    assert.deepEqual(error.path, ['createDocument']);
    assert.equal(error.extensions.category, 'validation');
    assert.deepEqual(error.extensions.validation, {
        'signers.0.phone': ['must_be_a_valid_phone_number'],
    });
});

test('returns a JSON error for malformed JSON', async () => {
    const response = await fetch(`${baseUrl}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTHORIZATION },
        body: '{',
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
        errors: [{ message: 'Malformed JSON request payload' }],
    });
});
