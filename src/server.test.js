const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { createApp } = require('./server');
const { getDocument, saveDocument } = require('./store');

const AUTHORIZATION = { Authorization: 'Bearer fake-local-token' };
let server;
let baseUrl;
let deliveredWebhooks;
let webhookResults;

before(async () => {
    deliveredWebhooks = [];
    webhookResults = [];
    await new Promise((resolve) => {
        server = createApp({
            sendWebhook: async (webhook) => {
                deliveredWebhooks.push(webhook);

                return webhookResults.shift() || { delivered: true, status: 200 };
            },
        }).listen(0, '127.0.0.1', () => {
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

function createDocumentForm(file, signers = []) {
    const form = new FormData();
    form.append('operations', JSON.stringify({
        query: `mutation Create($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
            createDocument(document: $document, signers: $signers, file: $file) { id name }
        }`,
        variables: {
            document: { name: 'HTTP contract' },
            signers,
            file: null,
        },
    }));
    form.append('map', JSON.stringify({ upload: ['variables.file'] }));
    form.append('upload', file, 'contract.pdf');

    return form;
}

async function validPdfBlob() {
    const pdf = await PDFDocument.create();
    pdf.addPage();

    return new Blob([await pdf.save()], { type: 'application/pdf' });
}

async function validPdfBuffer() {
    const pdf = await PDFDocument.create();
    pdf.addPage();

    return Buffer.from(await pdf.save());
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

test('accepts and persists a valid PDF through multipart GraphQL', async () => {
    const response = await fetch(`${baseUrl}/graphql`, {
        method: 'POST',
        headers: AUTHORIZATION,
        body: createDocumentForm(await validPdfBlob()),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.errors, undefined);
    assert.equal(body.data.createDocument.name, 'HTTP contract');
    assert.ok(getDocument(body.data.createDocument.id));
});

test('rejects a fake PDF through multipart GraphQL', async () => {
    const fakePdf = new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' });
    const response = await fetch(`${baseUrl}/graphql`, {
        method: 'POST',
        headers: AUTHORIZATION,
        body: createDocumentForm(fakePdf),
    });
    const body = await response.json();

    assert.deepEqual(body.data, { createDocument: null });
    assert.deepEqual(body.errors[0].extensions.validation, {
        file: ['must_be_a_valid_file'],
    });
});

test('rejects a PDF larger than the configured upload limit', async () => {
    const oversizedPdf = new Blob([Buffer.alloc(2048)], { type: 'application/pdf' });
    const response = await fetch(`${baseUrl}/graphql`, {
        method: 'POST',
        headers: AUTHORIZATION,
        body: createDocumentForm(oversizedPdf),
    });
    const body = await response.json();

    assert.deepEqual(body.data, { createDocument: null });
    assert.deepEqual(body.errors[0].extensions.validation, {
        file: ['may_not_be_greater_than:1024'],
    });
});

test('signs only the public-id signer and emits its webhook once', async () => {
    const document = saveDocument({
        id: 'simulate-multiple',
        name: 'Multiple signers',
        originalFile: await validPdfBuffer(),
        signed: false,
        signatures: [
            { public_id: 'simulate-first', email: 'first@example.test', action: 'SIGN', signed_at: null },
            { public_id: 'simulate-second', email: 'second@example.test', action: 'SIGN', signed_at: null },
        ],
    });

    const signPage = await fetch(`${baseUrl}/sign/simulate-second`);
    assert.match(await signPage.text(), /\/simulate\/simulate-second\/sign/);

    const firstAttempt = await fetch(`${baseUrl}/simulate/simulate-second/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: '12345678901' }),
    });
    const firstBody = await firstAttempt.json();

    assert.equal(firstBody.signer_public_id, 'simulate-second');
    assert.equal(firstBody.document_finished, false);
    assert.equal(document.signatures[0].signed_at, null);
    assert.ok(document.signatures[1].signed_at);
    assert.equal(deliveredWebhooks.at(-1).event.data.public_id, 'simulate-second');

    const webhookCount = deliveredWebhooks.length;
    const secondAttempt = await fetch(`${baseUrl}/simulate/simulate-second/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: '12345678901' }),
    });
    const secondBody = await secondAttempt.json();

    assert.deepEqual(secondBody.webhook, { skipped: true, reason: 'already_signed' });
    assert.equal(deliveredWebhooks.length, webhookCount);
});

test('retries the same webhook after a receiver failure without signing again', async () => {
    const document = saveDocument({
        id: 'simulate-webhook-retry',
        name: 'Webhook retry',
        originalFile: await validPdfBuffer(),
        signed: false,
        signatures: [
            { public_id: 'retry-signer', email: 'retry@example.test', action: 'SIGN', signed_at: null },
        ],
    });
    webhookResults.push(
        { delivered: false, status: 500, body: 'receiver failed' },
        { delivered: true, status: 200, body: 'ok' },
    );

    const request = () => fetch(`${baseUrl}/simulate/retry-signer/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: '12345678901' }),
    });

    const firstResponse = await request();
    const firstBody = await firstResponse.json();
    const signedAt = document.signatures[0].signed_at;
    const firstWebhook = deliveredWebhooks.at(-1);

    assert.equal(firstBody.webhook.delivered, false);
    assert.equal(firstBody.webhook.status, 500);
    assert.ok(signedAt);

    const retryResponse = await request();
    const retryBody = await retryResponse.json();
    const retriedWebhook = deliveredWebhooks.at(-1);

    assert.equal(retryBody.webhook.delivered, true);
    assert.equal(document.signatures[0].signed_at, signedAt);
    assert.equal(retriedWebhook.event.id, firstWebhook.event.id);
    assert.equal(retriedWebhook.id, firstWebhook.id);

    const deliveredCount = deliveredWebhooks.length;
    const finalResponse = await request();

    assert.deepEqual((await finalResponse.json()).webhook, {
        skipped: true,
        reason: 'already_signed',
    });
    assert.equal(deliveredWebhooks.length, deliveredCount);
});
