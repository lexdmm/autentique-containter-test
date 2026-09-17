import crypto from 'node:crypto';
import { WEBHOOK_SECRET, WEBHOOK_TARGET_URL } from './config';
import type {
    Signature,
    SignatureWebhookData,
    WebhookDeliveryResult,
    WebhookPayload,
} from '../types';

function formatAction(action: string | null | undefined): string {
    const normalized = String(action || 'SIGN').toLowerCase();

    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

interface BuildSignatureDataInput {
    documentId: string;
    signer?: Signature;
    cpf: string | null;
    email?: string | null;
}

function buildSignatureData({
    documentId,
    signer,
    cpf,
    email,
}: BuildSignatureDataInput): SignatureWebhookData {
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

function buildWebhookPayload({
    type,
    data,
}: { type: string; data: SignatureWebhookData }): WebhookPayload {
    const eventId = crypto.randomUUID();

    return {
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
}

async function readResponseBody(response: Response): Promise<unknown> {
    const body = await response.text();
    const contentType = response.headers?.get?.('content-type') || '';

    if (!contentType.includes('json')) {
        return body;
    }

    try {
        return JSON.parse(body) as unknown;
    } catch {
        return body;
    }
}

async function sendSignatureWebhook(payload: WebhookPayload): Promise<WebhookDeliveryResult> {
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

        return {
            delivered: response.ok,
            status: response.status,
            body: await readResponseBody(response),
        };
    } catch (error) {
        return {
            delivered: false,
            error: error instanceof Error ? error.message : 'Unknown webhook delivery error',
            target: WEBHOOK_TARGET_URL,
        };
    }
}

export {
    buildSignatureData,
    buildWebhookPayload,
    sendSignatureWebhook,
    WEBHOOK_TARGET_URL,
};
