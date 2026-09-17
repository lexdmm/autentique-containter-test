const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createActivityLog, sanitizeValue } = require('./activityLog');

test('sanitizeValue redacts secrets and personal data without changing the source', () => {
    const source = {
        headers: {
            authorization: 'Bearer secret',
            cookie: 'session=secret',
            'x-api-key': 'api-secret',
            'x-autentique-signature': 'signature',
        },
        variables: {
            cpf: '12345678901',
            email: 'qa@example.test',
            document_id: 'doc-1',
        },
        file: Buffer.from('PDF'),
        target: 'http://user:password@example.test/hook?token=secret',
        message: 'Contact qa@example.test with CPF 12345678901',
    };

    const sanitized = sanitizeValue(source);

    assert.deepEqual(sanitized, {
        headers: {
            authorization: '[REDACTED]',
            cookie: '[REDACTED]',
            'x-api-key': '[REDACTED]',
            'x-autentique-signature': '[REDACTED]',
        },
        variables: {
            cpf: '[REDACTED]',
            email: '[REDACTED]',
            document_id: 'doc-1',
        },
        file: '[binary omitted: 3 bytes]',
        target: 'http://example.test/hook',
        message: 'Contact [REDACTED_EMAIL] with CPF [REDACTED_CPF]',
    });
    assert.equal(source.variables.email, 'qa@example.test');
});

test('sanitizeValue truncates oversized text values', () => {
    const sanitized = sanitizeValue({ body: 'a'.repeat(25_000) });

    assert.ok(sanitized.body.length < 25_000);
    assert.match(sanitized.body, /\[truncated\]$/);
});

test('createActivityLog retains only the configured number of newest entries', () => {
    const activityLog = createActivityLog({ maxEntries: 2 });

    activityLog.add({ type: 'http', sequence: 1 });
    activityLog.add({ type: 'http', sequence: 2 });
    activityLog.add({ type: 'webhook', sequence: 3 });

    assert.deepEqual(activityLog.list().map((entry) => entry.sequence), [3, 2]);
    assert.ok(activityLog.list().every((entry) => entry.id && entry.recorded_at));
});

test('createActivityLog notifies active subscribers with the sanitized entry', () => {
    const activityLog = createActivityLog();
    const received = [];
    const unsubscribe = activityLog.subscribe((entry) => received.push(entry));

    activityLog.add({ type: 'http', token: 'secret', sequence: 1 });
    unsubscribe();
    activityLog.add({ type: 'http', sequence: 2 });

    assert.equal(received.length, 1);
    assert.equal(received[0].sequence, 1);
    assert.equal(received[0].token, '[REDACTED]');
});
