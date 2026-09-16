const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildSignatureData, sendSignatureWebhook } = require('./webhook');

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

        return { status: 200, text: async () => '{"message":"ok"}' };
    };

    try {
        const result = await sendSignatureWebhook({
            type: 'signature.accepted',
            data: buildSignatureData({ documentId: 'doc-1', signer: {}, cpf: '12345678901' }),
        });

        assert.equal(result.delivered, true);
        assert.equal(result.status, 200);

        const payload = JSON.parse(capturedOptions.body);
        assert.equal(payload.object, 'webhook');
        assert.equal(payload.event.type, 'signature.accepted');
        assert.deepEqual(payload.event.previous_attributes, []);
        assert.equal(
            Buffer.from(payload.id, 'base64').toString(),
            `1|${payload.event.id}`,
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

test('sendSignatureWebhook reports delivered:false instead of throwing when the target is unreachable', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
        throw new Error('connect ECONNREFUSED');
    };

    try {
        const result = await sendSignatureWebhook({ type: 'signature.accepted', data: {} });

        assert.equal(result.delivered, false);
        assert.match(result.error, /ECONNREFUSED/);
    } finally {
        global.fetch = originalFetch;
    }
});
