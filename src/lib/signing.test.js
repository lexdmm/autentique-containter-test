const fs = require('fs');
const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { markSignerSigned } = require('./signing');

let originalFile;

before(async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    originalFile = Buffer.from(await pdf.save());
});

function documentWithTwoSigners(id) {
    return {
        id,
        originalFile,
        signed: false,
        signatures: [
            { public_id: `${id}-1`, email: 'first@example.test', action: 'SIGN', signed_at: null },
            { public_id: `${id}-2`, email: 'second@example.test', action: 'SIGN', signed_at: null },
        ],
    };
}

test('signs one signer at a time and finishes only after all signatures', async () => {
    const document = documentWithTwoSigners('sequential');

    const first = await markSignerSigned(document, document.signatures[0]);

    assert.equal(first.changed, true);
    assert.equal(first.completed, false);
    assert.ok(document.signatures[0].signed_at);
    assert.equal(document.signatures[1].signed_at, null);
    assert.equal(document.signed, false);
    assert.equal(document.signedFile, undefined);

    const second = await markSignerSigned(document, document.signatures[1]);

    assert.equal(second.completed, true);
    assert.equal(document.signed, true);
    assert.ok(Buffer.isBuffer(document.signedFile));
});

test('serializes concurrent attempts and changes a signer only once', async () => {
    const document = documentWithTwoSigners('concurrent');
    const signer = document.signatures[0];
    const results = await Promise.all([
        markSignerSigned(document, signer),
        markSignerSigned(document, signer),
    ]);

    assert.deepEqual(results.map((result) => result.changed).sort(), [false, true]);
    assert.ok(signer.signed_at);
    assert.equal(document.signatures[1].signed_at, null);
});

test('does not change state when writing the completed PDF fails', async () => {
    const document = documentWithTwoSigners('write-failure');
    document.signatures[0].signed_at = new Date().toISOString();
    const originalWriteFileSync = fs.writeFileSync;
    fs.writeFileSync = () => {
        throw new Error('disk unavailable');
    };

    try {
        await assert.rejects(
            () => markSignerSigned(document, document.signatures[1]),
            /disk unavailable/
        );
    } finally {
        fs.writeFileSync = originalWriteFileSync;
    }

    assert.equal(document.signatures[1].signed_at, null);
    assert.equal(document.signed, false);
    assert.equal(document.signedFile, undefined);
});
