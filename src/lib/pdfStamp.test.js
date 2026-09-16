const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { buildSignedPdf } = require('./pdfStamp');

async function blankPdf() {
    const doc = await PDFDocument.create();
    doc.addPage();

    return Buffer.from(await doc.save());
}

test('appends exactly one audit page to the original PDF', async () => {
    const original = await blankPdf();

    const signedBytes = await buildSignedPdf(original, {
        documentId: 'doc-1',
        signers: [{ name: 'Fulano', action: 'SIGN', signed_at: '2026-01-01T00:00:00.000Z' }],
    });

    const originalDoc = await PDFDocument.load(original);
    const signedDoc = await PDFDocument.load(signedBytes);

    assert.equal(signedDoc.getPageCount(), originalDoc.getPageCount() + 1);
});

// This is the exact crash this file existed to fix: a caller passing bytes
// that aren't a real PDF used to bring down the whole Node process instead of
// failing just this one request. It still rejects here - the server.js route
// that calls this is what turns the rejection into a 500 instead of a crash.
test('rejects (does not crash the process) when given bytes that are not a real PDF', async () => {
    await assert.rejects(() => buildSignedPdf(Buffer.from('not a pdf'), { documentId: 'x', signers: [] }));
});
