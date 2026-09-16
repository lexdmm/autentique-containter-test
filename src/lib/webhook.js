const crypto = require('crypto');
const { WEBHOOK_SECRET, WEBHOOK_TARGET_URL } = require('./config');

function formatAction(action) {
    const normalized = String(action || 'SIGN').toLowerCase();

    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildSignatureData({ documentId, signer, cpf, email }) {
    return {
        public_id: signer?.public_id ?? null,
        object: 'signature',
        user: {
            name: signer?.name ?? null,
            company: null,
            email: email ?? signer?.email ?? null,
            phone: signer?.phone ?? null,
            cpf,
            birthday: null,
        },
        mail: {
            sent: null,
            opened: null,
            refused: null,
            delivered: null,
            reason: null,
        },
        document: documentId,
        action: formatAction(signer?.action),
        viewed: signer?.viewed_at ?? null,
        signed: signer?.signed_at ?? new Date().toISOString(),
        rejected: null,
        biometric_unapproved: null,
        biometric_approved: null,
        biometric_rejected: null,
        events: [],
        created_at: signer?.created_at ?? null,
    };
}

async function sendSignatureWebhook({ type, data }) {
    const eventId = crypto.randomUUID();
    const payload = {
        id: Buffer.from(`1|${eventId}`).toString('base64'),
        object: 'webhook',
        name: 'local-mock',
        format: 'json',
        url: WEBHOOK_TARGET_URL,
        event: {
            id: eventId,
            object: 'event',
            organization: 1,
            type,
            data,
            previous_attributes: [],
            created_at: new Date().toISOString(),
        },
    };

    const body = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

    try {
        const response = await fetch(WEBHOOK_TARGET_URL, {
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
        return { delivered: false, error: error.message, target: WEBHOOK_TARGET_URL };
    }
}

module.exports = { sendSignatureWebhook, buildSignatureData, WEBHOOK_TARGET_URL };
