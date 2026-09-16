const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { handleSignDocument } = require('./signDocument');
const { saveDocument } = require('../store');

let originalFile;

before(async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    originalFile = Buffer.from(await pdf.save());
});

function saveSigningDocument(id, signatures) {
    return saveDocument({ id, originalFile, signed: false, signatures });
}

test('returns signature_not_found when the document does not exist', async () => {
    const result = await handleSignDocument({ documentId: 'missing-sign-document' });

    assert.equal(result.body.errors[0].extensions.code, 'signature_not_found');
});

test('returns signature_not_found when the API owner is not a signer', async () => {
    saveSigningDocument('owner-absent', [
        { public_id: 'other', email: 'other@example.test', action: 'SIGN', signed_at: null },
    ]);

    const result = await handleSignDocument({ documentId: 'owner-absent' });

    assert.equal(result.body.errors[0].extensions.code, 'signature_not_found');
});

test('signs only the signer associated with the API token owner', async () => {
    const document = saveSigningDocument('owner-present', [
        { public_id: 'owner', email: 'api-owner@example.test', action: 'SIGN', signed_at: null },
        { public_id: 'other-2', email: 'other@example.test', action: 'SIGN', signed_at: null },
    ]);

    const result = await handleSignDocument({ documentId: 'owner-present' });

    assert.equal(result.body.data.signDocument, true);
    assert.ok(document.signatures[0].signed_at);
    assert.equal(document.signatures[1].signed_at, null);
    assert.equal(document.signed, false);
});

test('returns document_signed when the API owner already signed', async () => {
    saveSigningDocument('owner-signed', [
        {
            public_id: 'owner-signed-signature',
            email: 'api-owner@example.test',
            action: 'SIGN',
            signed_at: new Date().toISOString(),
        },
    ]);

    const result = await handleSignDocument({ documentId: 'owner-signed' });

    assert.equal(result.body.errors[0].extensions.code, 'document_signed');
});
