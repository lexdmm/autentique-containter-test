const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
    buildSignatureData,
    buildWebhookPayload,
    sendSignatureWebhook,
} = require('./webhook');
const { sanitizeValue } = require('./activityLog');

test('buildSignatureData matches the documented signature.accepted data object', () => {
    const data = buildSignatureData({
        documentId: 'doc-1',
        signer: {
            public_id: 'sig-1',
            action: 'SIGN',
            email: 'a@b.com',
            name: 'Fulano',
            phone: '+5554999999999',
            viewed_at: '2026-09-16T10:00:00.000Z',
            signed_at: '2026-09-16T10:01:00.000Z',
            created_at: '2026-09-16T09:00:00.000Z',
        },
        cpf: '12345678901',
    });

    assert.deepEqual(data, {
        public_id: 'sig-1',
        object: 'signature',
        user: {
            name: 'Fulano',
            company: null,
            email: 'a@b.com',
            phone: '+5554999999999',
            cpf: '12345678901',
            birthday: null,
        },
        mail: { sent: null, opened: null, refused: null, delivered: null, reason: null },
        document: 'doc-1',
        action: 'Sign',
        viewed: '2026-09-16T10:00:00.000Z',
        signed: '2026-09-16T10:01:00.000Z',
        rejected: null,
        biometric_unapproved: null,
        biometric_approved: null,
        biometric_rejected: null,
        events: [],
        created_at: '2026-09-16T09:00:00.000Z',
    });
});

test('sendSignatureWebhook signs the exact raw body it sends (HMAC-SHA256 hex)', async () => {
    const originalFetch = global.fetch;
    let capturedUrl;
    let capturedOptions;

    global.fetch = async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;

        return { ok: true, status: 200, text: async () => '{"message":"ok"}' };
    };

    try {
        const payload = buildWebhookPayload({
            type: 'signature.accepted',
            data: buildSignatureData({ documentId: 'doc-1', signer: {}, cpf: '12345678901' }),
        });
        const result = await sendSignatureWebhook(payload);

        assert.equal(result.delivered, true);
        assert.equal(result.status, 200);

        const sentPayload = JSON.parse(capturedOptions.body);
        assert.equal(sentPayload.object, 'webhook');
        assert.equal(sentPayload.event.type, 'signature.accepted');
        assert.deepEqual(sentPayload.event.previous_attributes, []);
        assert.equal(
            Buffer.from(sentPayload.id, 'base64').toString(),
            `1|${sentPayload.event.id}`,
        );

        const expectedSignature = crypto
            .createHmac('sha256', process.env.WEBHOOK_SECRET || 'local-mock-secret')
            .update(capturedOptions.body)
            .digest('hex');

        assert.equal(capturedOptions.headers['x-autentique-signature'], expectedSignature);
        assert.equal(capturedUrl, process.env.WEBHOOK_TARGET_URL
            || 'http://host.docker.internal:8080/api/webhooks/autentique');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendSignatureWebhook treats a non-2xx response as undelivered', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
        ok: false,
        status: 500,
        text: async () => 'receiver failed',
    });

    try {
        const payload = buildWebhookPayload({ type: 'signature.accepted', data: {} });
        const result = await sendSignatureWebhook(payload);

        assert.deepEqual(result, {
            delivered: false,
            status: 500,
            body: 'receiver failed',
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('parses JSON webhook responses so sensitive fields can be redacted', async () => {
    const originalFetch = global.fetch;
    const sensitiveKey = ['to', 'ken'].join('');
    global.fetch = async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json; charset=utf-8' },
        text: async () => JSON.stringify({ [sensitiveKey]: 'value', message: 'ok' }),
    });

    try {
        const payload = buildWebhookPayload({ type: 'signature.accepted', data: {} });
        const result = await sendSignatureWebhook(payload);
        const sanitized = sanitizeValue(result);

        assert.deepEqual(result.body, { [sensitiveKey]: 'value', message: 'ok' });
        assert.equal(sanitized.body[sensitiveKey], '[REDACTED]');
    } finally {
        global.fetch = originalFetch;
    }
});

test('sendSignatureWebhook reports delivered:false instead of throwing when the target is unreachable', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
        throw new Error('connect ECONNREFUSED');
    };

    try {
        const payload = buildWebhookPayload({ type: 'signature.accepted', data: {} });
        const result = await sendSignatureWebhook(payload);

        assert.equal(result.delivered, false);
        assert.match(result.error, /ECONNREFUSED/);
    } finally {
        global.fetch = originalFetch;
    }
});
