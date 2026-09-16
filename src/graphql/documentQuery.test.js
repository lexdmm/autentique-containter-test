const { test } = require('node:test');
const assert = require('node:assert/strict');
const { saveDocument } = require('../store');
const { handleDocumentQuery } = require('./documentQuery');

test('returns document_not_found for an unknown id', () => {
    const result = handleDocumentQuery({ documentId: 'missing' });

    assert.equal(result.body.errors[0].extensions.code, 'document_not_found');
});

test('files.signed is null before signing, populated after', () => {
    saveDocument({
        id: 'doc-query-1',
        name: 'X',
        signed: false,
        signatures: [{
            public_id: 'signature-query-1',
            name: 'Signer',
            email: 'signer@example.test',
            action: 'SIGN',
            viewed_at: null,
            signed_at: null,
        }],
    });

    const beforeSigning = handleDocumentQuery({ documentId: 'doc-query-1' });
    assert.equal(beforeSigning.body.data.document.files.signed, null);
    assert.equal(beforeSigning.body.data.document.signatures[0].signed, null);
    assert.equal(beforeSigning.body.data.document.signatures[0].public_id, 'signature-query-1');
    assert.equal(beforeSigning.body.data.document.signatures[0].email, 'signer@example.test');
    assert.deepEqual(beforeSigning.body.data.document.signatures[0].action, { name: 'SIGN' });
    assert.match(
        beforeSigning.body.data.document.signatures[0].link.short_link,
        /\/sign\/signature-query-1$/,
    );

    saveDocument({
        id: 'doc-query-1',
        name: 'X',
        signed: true,
        signatures: [{
            public_id: 'signature-query-1',
            name: 'Signer',
            email: 'signer@example.test',
            action: 'SIGN',
            viewed_at: null,
            signed_at: '2026-01-01T00:00:00.000Z',
        }],
    });

    const afterSigning = handleDocumentQuery({ documentId: 'doc-query-1' });
    assert.match(afterSigning.body.data.document.files.signed, /\/files\/doc-query-1\/signed\.pdf$/);
    assert.deepEqual(afterSigning.body.data.document.signatures[0].signed, {
        created_at: '2026-01-01T00:00:00.000Z',
    });
});
