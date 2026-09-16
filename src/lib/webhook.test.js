const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildSignatureData, sendSignatureWebhook } = require('./webhook');

test('buildSignatureData matches the documented Signature resource fields', () => {
    const data = buildSignatureData({
        documentId: 'doc-1',
        signer: { public_id: 'sig-1', action: 'SIGN', email: 'a@b.com', name: 'Fulano' },
        cpf: '12345678901',
    });

    assert.equal(data.object, 'signature');
    assert.equal(data.document, 'doc-1');
    assert.equal(data.public_id, 'sig-1');
    assert.deepEqual(data.action, { name: 'SIGN' });
    assert.equal(typeof data.signed, 'string');
    assert.equal(data.viewed, null);
    assert.equal(data.rejected, null);
    assert.deepEqual(data.user, { cpf: '12345678901', email: 'a@b.com', name: 'Fulano', birthday: null });
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
