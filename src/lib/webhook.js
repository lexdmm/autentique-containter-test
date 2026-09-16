const crypto = require('crypto');
const { WEBHOOK_SECRET, PX_TORRE_CORE_WEBHOOK_URL } = require('./config');

/**
 * The real webhook's `data` for a signature.* event is the full Signature
 * resource (per Autentique's docs): public_id, object, user{name,email,cpf,
 * birthday}, document, action, and Event-typed viewed/signed/rejected/
 * biometric_* fields. One deliberate deviation: `signed` here is a plain ISO
 * string, not an Event object like the docs show - px-torre-core's own
 * AutentiqueSignatureService reads `data.signed` straight into a `signed_at`
 * column (`$signatureEvent['data']['signed'] ?? now()`), so a nested object
 * would misfeed it. Matching the doc's literal shape would mean feeding the
 * one real consumer of this field a value it can't use.
 */
function buildSignatureData({ documentId, signer, cpf, email }) {
    return {
        object: 'signature',
        public_id: signer?.public_id ?? null,
        document: documentId,
        action: { name: signer?.action ?? 'SIGN' },
        signed: new Date().toISOString(),
        viewed: null,
        rejected: null,
        biometric_approved: null,
        biometric_rejected: null,
        user: {
            cpf,
            email: email ?? signer?.email ?? null,
            name: signer?.name ?? null,
            birthday: null,
        },
    };
}

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

module.exports = { sendSignatureWebhook, buildSignatureData, PX_TORRE_CORE_WEBHOOK_URL };
