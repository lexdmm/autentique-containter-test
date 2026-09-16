const { test } = require('node:test');
const assert = require('node:assert/strict');
const { saveDocument, getDocument, findBySignerPublicId } = require('./store');

test('saveDocument then getDocument round-trips by id', () => {
    const document = { id: 'doc-1', signatures: [] };
    saveDocument(document);

    assert.equal(getDocument('doc-1'), document);
});

test('getDocument returns undefined for an unknown id', () => {
    assert.equal(getDocument('does-not-exist'), undefined);
});

test('findBySignerPublicId finds the document owning that signer', () => {
    const document = { id: 'doc-2', signatures: [{ public_id: 'sig-2' }] };
    saveDocument(document);

    assert.equal(findBySignerPublicId('sig-2'), document);
    assert.equal(findBySignerPublicId('no-such-signer'), undefined);
});
