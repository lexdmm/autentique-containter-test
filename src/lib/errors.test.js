const { test } = require('node:test');
const assert = require('node:assert/strict');
const { simulatedError } = require('./errors');

function fakeRequest(headerValue) {
    return { get: (name) => (name === 'x-simulate-error' ? headerValue : undefined) };
}

test('simulatedError returns null when no header is set', () => {
    assert.equal(simulatedError(fakeRequest(undefined)), null);
});

test('simulatedError returns null for an unknown key', () => {
    assert.equal(simulatedError(fakeRequest('not_a_real_error')), null);
});

test('simulatedError returns the documented shape for invalid_phone', () => {
    const result = simulatedError(fakeRequest('invalid_phone'));

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.errors[0].extensions.validation, {
        'signers.0.phone': ['must_be_a_valid_phone_number'],
    });
});

test('simulatedError returns HTTP 429 for rate_limit', () => {
    const result = simulatedError(fakeRequest('rate_limit'));

    assert.equal(result.status, 429);
    assert.equal(result.body.message, 'Too Many Attempts');
});

test('simulatedError covers every documented key without throwing', () => {
    for (const key of ['unauthorized', 'must_be_a_file', 'document_not_found', 'signature_not_found']) {
        const result = simulatedError(fakeRequest(key));
        assert.ok(result.status);
        assert.ok(result.body.errors[0].message);
    }
});
