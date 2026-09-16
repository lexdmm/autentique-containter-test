const crypto = require('crypto');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'local-mock-secret';
const PX_TORRE_CORE_WEBHOOK_URL = process.env.PX_TORRE_CORE_WEBHOOK_URL
    || 'http://host.docker.internal:8000/api/webhooks/documents/signature';

/**
 * Builds Autentique's documented webhook envelope and signs the exact bytes
 * being sent with HMAC-SHA256 (x-autentique-signature), matching what
 * px-torre-core's AutentiqueWebhookMiddleware recomputes over the raw body.
 */
async function sendSignatureWebhook({ type, data }) {
    const payload = {
        id: crypto.randomUUID(),
        object: 'webhook',
        name: 'local-mock',
        format: 'json',
        url: PX_TORRE_CORE_WEBHOOK_URL,
        event: {
            id: crypto.randomUUID(),
            object: 'event',
            organization: 1,
            type,
            data,
            previous_attributes: {},
            created_at: new Date().toISOString(),
        },
    };

    const body = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

    try {
        const response = await fetch(PX_TORRE_CORE_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-autentique-signature': signature,
            },
            body,
            signal: AbortSignal.timeout(5000),
        });

        return { delivered: true, status: response.status, body: await response.text() };
    } catch (error) {
        return { delivered: false, error: error.message, target: PX_TORRE_CORE_WEBHOOK_URL };
    }
}

module.exports = { sendSignatureWebhook, PX_TORRE_CORE_WEBHOOK_URL };
