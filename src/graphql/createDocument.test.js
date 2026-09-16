const fs = require('fs');
const path = require('path');
const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { handleCreateDocument } = require('./createDocument');
const { getDocument } = require('../store');

let FILE;

before(async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    FILE = {
        buffer: Buffer.from(await pdf.save()),
        mimetype: 'application/pdf',
        originalname: 'contract.pdf',
    };
});

test('rejects when no file is attached (must_be_a_file)', async () => {
    const result = await handleCreateDocument({ document: { name: 'X' }, signers: [] }, null);

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.errors[0].extensions.validation, { file: ['must_be_a_file'] });
});

test('rejects an invalid signer phone at the right signers.N.phone path', async () => {
    const variables = {
        document: { name: 'X' },
        signers: [{ email: 'ok@example.com' }, { phone: '11999999999' }],
    };

    const result = await handleCreateDocument(variables, FILE);

    assert.deepEqual(result.body.errors[0].extensions.validation, {
        'signers.1.phone': ['must_be_a_valid_phone_number'],
    });
});

test('accepts a valid E.164-ish phone', async () => {
    const variables = { document: { name: 'X' }, signers: [{ phone: '+5511999999999' }] };

    const result = await handleCreateDocument(variables, FILE);

    assert.equal(result.status, 200);
    assert.equal(result.body.errors, undefined);
});

test('a phone-only signer gets link: null, matching Autentique\'s own example', async () => {
    const variables = { document: { name: 'X' }, signers: [{ phone: '+5511999999999' }] };

    const result = await handleCreateDocument(variables, FILE);
    const [signature] = result.body.data.createDocument.signatures;

    assert.equal(signature.link, null);
});

test('an email signer gets a link.short_link pointing at the sign page', async () => {
    const variables = { document: { name: 'X' }, signers: [{ email: 'driver@example.com' }] };

    const result = await handleCreateDocument(variables, FILE);
    const [signature] = result.body.data.createDocument.signatures;

    assert.match(signature.link.short_link, /\/sign\/[0-9a-f-]{36}$/);
    assert.match(signature.created_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('response shape matches the documented Document fields', async () => {
    const variables = { document: { name: 'Contract', refusable: true, sortable: true }, signers: [] };

    const { body } = await handleCreateDocument(variables, FILE);
    const document = body.data.createDocument;

    assert.deepEqual(Object.keys(document).sort(), [
        'created_at', 'id', 'name', 'refusable', 'signatures', 'sortable',
    ]);
    assert.equal(document.name, 'Contract');
    assert.equal(document.refusable, true);
    assert.equal(document.sortable, true);
});

test('rejects bytes that are not a real PDF', async () => {
    const invalidFile = {
        buffer: Buffer.from('%PDF-1.4 fake'),
        mimetype: 'application/pdf',
        originalname: 'contract.pdf',
    };

    const result = await handleCreateDocument(
        { document: { name: 'Invalid' }, signers: [] },
        invalidFile
    );

    assert.deepEqual(result.body.errors[0].extensions.validation, {
        file: ['must_be_a_valid_file'],
    });
});

test('rejects a valid PDF with a mismatched MIME type or extension', async () => {
    for (const invalidMetadata of [
        { mimetype: 'text/plain', originalname: 'contract.pdf' },
        { mimetype: 'application/pdf', originalname: 'contract.txt' },
    ]) {
        const result = await handleCreateDocument(
            { document: { name: 'Invalid metadata' }, signers: [] },
            { ...FILE, ...invalidMetadata }
        );

        assert.deepEqual(result.body.errors[0].extensions.validation, {
            file: ['must_be_a_valid_file'],
        });
    }
});

test('does not retain a document when writing its original file fails', async () => {
    const originalWriteFileSync = fs.writeFileSync;
    let attemptedPath;

    fs.writeFileSync = (filePath) => {
        attemptedPath = filePath;
        throw new Error('disk unavailable');
    };

    try {
        await assert.rejects(
            () => handleCreateDocument({ document: { name: 'Failure' }, signers: [] }, FILE),
            /disk unavailable/
        );
    } finally {
        fs.writeFileSync = originalWriteFileSync;
    }

    const documentId = path.basename(attemptedPath).match(/^original-([0-9a-f-]{36})\.pdf/)[1];
    assert.equal(getDocument(documentId), undefined);
});
