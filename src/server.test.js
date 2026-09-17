const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { createApp } = require('./server');
const { getDocument, saveDocument } = require('./store');
const { createActivityLog } = require('./lib/activityLog');

const AUTHORIZATION = { Authorization: 'Bearer fake-local-token' };
let server;
let baseUrl;
let deliveredWebhooks;
let webhookResults;
let activityLog;

before(async () => {
    deliveredWebhooks = [];
    webhookResults = [];
    activityLog = createActivityLog();
    await new Promise((resolve) => {
        server = createApp({
            activityLog,
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

    return { status: response.status, headers: response.headers, body: await response.json() };
}

async function waitForSseActivity(reader, predicate) {
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();

        if (done) {
            throw new Error('SSE stream ended before the expected activity');
        }

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop();

        for (const frame of frames) {
            const lines = frame.split('\n');
            const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
            const data = lines.find((line) => line.startsWith('data: '))?.slice(6);

            if (event === 'activity' && data) {
                const entry = JSON.parse(data);

                if (predicate(entry)) {
                    return entry;
                }
            }
        }
    }
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

    const unauthorizedEntry = activityLog.list().find((entry) => (
        entry.type === 'http' && entry.path === '/graphql' && entry.request.headers.authorization
    ));
    assert.equal(unauthorizedEntry.request.headers.authorization, '[REDACTED]');
});

test('serves dashboard activity without login and does not record its own requests', async () => {
    const entriesBefore = activityLog.list().length;
    const response = await fetch(`${baseUrl}/dashboard/api/activity`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(Array.isArray(body.data));
    assert.equal(activityLog.list().length, entriesBefore);
});

test('serves the dashboard page and its assets without a login screen', async () => {
    const page = await fetch(`${baseUrl}/dashboard`);
    const html = await page.text();
    const [styles, model, script] = await Promise.all([
        fetch(`${baseUrl}/dashboard/assets/styles.css`),
        fetch(`${baseUrl}/dashboard/assets/dashboardModel.js`),
        fetch(`${baseUrl}/dashboard/assets/app.js`),
    ]);
    const scriptBody = await script.text();

    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(html, /Autentique Fake Monitor/);
    assert.match(html, /id="activity-list"/);
    assert.doesNotMatch(html, /dashboard-token|login-form|logout-button/);
    assert.equal((await fetch(`${baseUrl}/dashboard/`)).status, 200);
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get('content-type'), /text\/css/);
    assert.equal(model.status, 200);
    assert.match(model.headers.get('content-type'), /javascript/);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    assert.doesNotMatch(scriptBody, /Authorization|sessionStorage|DASHBOARD_TOKEN/);
});

test('streams new sanitized activity through the dashboard SSE endpoint without login', async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const stream = await fetch(`${baseUrl}/dashboard/api/stream`, {
        signal: controller.signal,
    });
    const reader = stream.body.getReader();

    try {
        assert.equal(stream.status, 200);
        assert.match(stream.headers.get('content-type'), /text\/event-stream/);

        const activityPromise = waitForSseActivity(reader, (entry) => entry.path === '/graphql');
        const request = await graphqlRequest({ query: '{ document(id: "stream-missing") { id } }' });
        const entry = await activityPromise;

        assert.equal(entry.request_id, request.headers.get('x-request-id'));
        assert.equal(entry.request.headers.authorization, '[REDACTED]');
        assert.equal(entry.status, 200);
    } finally {
        clearTimeout(timeout);
        await reader.cancel();
    }
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
        query: 'query Find($customId: UUID!) { document(id: $customId) { id } }',
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

    const pendingPage = await fetch(`${baseUrl}/sign/simulate-second`);
    const pendingHtml = await pendingPage.text();
    assert.match(pendingHtml, /final PDF will be available after every signer finishes/);
    assert.doesNotMatch(pendingHtml, /signed\.pdf/);

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

test('rejects a simulated signature when CPF is not exactly 11 digits', async () => {
    saveDocument({
        id: 'simulate-invalid-cpf',
        name: 'Invalid CPF',
        originalFile: await validPdfBuffer(),
        signed: false,
        signatures: [
            { public_id: 'invalid-cpf-signer', email: 'signer@example.test', action: 'SIGN' },
        ],
    });

    const response = await fetch(`${baseUrl}/simulate/invalid-cpf-signer/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: 'invalid' }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
        errors: [{ message: 'cpf must contain exactly 11 digits' }],
    });
});

test('accepts the documented UUID signDocument contract and emits its webhook', async () => {
    const documentId = '0fc9c4dc-9b47-4d43-a669-98f78490f6e4';
    saveDocument({
        id: documentId,
        name: 'API owner signature',
        originalFile: await validPdfBuffer(),
        signed: false,
        signatures: [{
            public_id: 'api-owner-signature',
            email: 'api-owner@example.test',
            action: 'SIGN',
            signed_at: null,
        }],
    });

    const result = await graphqlRequest({
        query: `mutation SignDocument($documentId: UUID!, $organizationId: Int) {
            signDocument(id: $documentId, organization_id: $organizationId)
        }`,
        variables: { documentId, organizationId: 123 },
    });

    assert.deepEqual(result.body, { data: { signDocument: true } });
    assert.equal(deliveredWebhooks.at(-1).event.type, 'signature.accepted');
    assert.equal(deliveredWebhooks.at(-1).event.data.document, documentId);
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

    const failedDelivery = activityLog.list().find((entry) => (
        entry.type === 'webhook' && entry.event_id === firstWebhook.event.id
    ));
    assert.equal(failedDelivery.response.delivered, false);
    assert.equal(failedDelivery.response.status, 500);

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

test('records sanitized and correlated HTTP and webhook activity', async () => {
    saveDocument({
        id: 'activity-document',
        name: 'Activity document',
        originalFile: await validPdfBuffer(),
        signed: false,
        signatures: [
            { public_id: 'activity-signer', email: 'private@example.test', action: 'SIGN' },
        ],
    });

    const response = await fetch(`${baseUrl}/simulate/activity-signer/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: '12345678901', email: 'private@example.test' }),
    });
    await response.json();

    const requestId = response.headers.get('x-request-id');
    const entries = activityLog.list().filter((entry) => entry.request_id === requestId);
    const httpEntry = entries.find((entry) => entry.type === 'http');
    const webhookEntry = entries.find((entry) => entry.type === 'webhook');

    assert.ok(requestId);
    assert.equal(httpEntry.path, '/simulate/activity-signer/sign');
    assert.equal(httpEntry.status, 200);
    assert.equal(httpEntry.request.body.cpf, '[REDACTED]');
    assert.equal(httpEntry.request.body.email, '[REDACTED]');
    assert.match(httpEntry.response.headers['content-type'], /application\/json/);
    assert.equal(httpEntry.response.body.signer_public_id, 'activity-signer');
    assert.equal(webhookEntry.event_type, 'signature.accepted');
    assert.equal(webhookEntry.response.delivered, true);
    assert.equal(webhookEntry.request.event.data.user.email, '[REDACTED]');
    assert.equal(webhookEntry.request.event.data.user.cpf, '[REDACTED]');
});
