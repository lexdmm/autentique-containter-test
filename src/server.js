const path = require('path');
const express = require('express');
const multer = require('multer');
const { graphql } = require('graphql');
const simulateTimeout = require('./middleware/simulateTimeout');
const { recordActivity } = require('./middleware/recordActivity');
const {
    simulatedError,
    signatureNotFoundError,
    unauthorizedError,
    validationError,
} = require('./lib/errors');
const { getDocument, findBySignerPublicId } = require('./store');
const { markSignerSigned } = require('./lib/signing');
const {
    buildSignatureData,
    buildWebhookPayload,
    sendSignatureWebhook,
    WEBHOOK_TARGET_URL,
} = require('./lib/webhook');
const { renderSignPage } = require('./lib/signPage');
const { createActivityLog } = require('./lib/activityLog');
const { API_TOKEN, MAX_UPLOAD_BYTES, PORT } = require('./lib/config');
const { createRootValue, schema } = require('./graphql/schema');

const DASHBOARD_DIR = path.join(__dirname, 'dashboard');
const DASHBOARD_ASSETS_DIR = path.join(DASHBOARD_DIR, 'assets');

const upload = multer({
    limits: {
        fileSize: MAX_UPLOAD_BYTES,
        fieldSize: 1024 * 1024,
        files: 1,
        fields: 2,
        parts: 3,
    },
});
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function logError(error, context) {
    console.error(JSON.stringify({
        level: 'error',
        context,
        message: error.message,
        stack: error.stack,
    }));
}

function elapsedMilliseconds(startedAt) {
    const duration = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    return Math.round(duration * 100) / 100;
}

function sendSseEvent(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function setDashboardSecurityHeaders(req, res, next) {
    res.set({
        'content-security-policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; img-src 'self' data:; script-src 'self'; style-src 'self'",
        'cross-origin-opener-policy': 'same-origin',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
    });
    next();
}

function authenticateGraphql(req, res, next) {
    if (req.get('authorization') !== `Bearer ${API_TOKEN}`) {
        const unauthorized = unauthorizedError();
        res.status(unauthorized.status).json(unauthorized.body);

        return;
    }

    next();
}

function receiveGraphqlUpload(req, res, next) {
    upload.any()(req, res, (error) => {
        if (!error) {
            next();

            return;
        }

        if (error instanceof multer.MulterError) {
            const rule = error.code === 'LIMIT_FILE_SIZE'
                ? `may_not_be_greater_than:${MAX_UPLOAD_BYTES}`
                : 'must_be_a_file';
            const validation = validationError({ file: [rule] });

            res.status(validation.status).json({
                ...validation.body,
                data: { createDocument: null },
            });

            return;
        }

        next(error);
    });
}

function assignPath(target, path, value) {
    const segments = path.split('.');

    if (segments[0] !== 'variables'
        || segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment))) {
        throw new Error('Invalid multipart map path');
    }

    let cursor = target;

    for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];

        if (cursor[segment] === undefined || cursor[segment] === null) {
            cursor[segment] = /^\d+$/.test(segments[index + 1]) ? [] : {};
        }

        cursor = cursor[segment];
    }

    cursor[segments.at(-1)] = value;
}

function parseGraphqlRequest(req) {
    if (!req.body.operations) {
        return req.body;
    }

    const operation = JSON.parse(req.body.operations);
    const fileMap = JSON.parse(req.body.map || '{}');
    const filesByField = new Map((req.files || []).map((file) => [file.fieldname, file]));

    for (const [fieldName, paths] of Object.entries(fileMap)) {
        const file = filesByField.get(fieldName);

        if (!file || !Array.isArray(paths)) {
            throw new Error('Invalid multipart map');
        }

        paths.forEach((path) => assignPath(operation, path, file));
    }

    return operation;
}

function formatExecutionResult(result) {
    if (!result.errors) {
        return result;
    }

    return {
        ...result,
        errors: result.errors.map((error) => {
            if (error.originalError && Object.keys(error.extensions).length === 0) {
                logError(error.originalError, 'graphql-resolver');

                return {
                    message: 'Internal server error',
                    locations: error.locations,
                    path: error.path,
                    extensions: { code: 'internal_server_error' },
                };
            }

            return error.toJSON();
        }),
    };
}

function createApp({
    activityLog = createActivityLog(),
    sendWebhook = sendSignatureWebhook,
} = {}) {
    const app = express();
    const webhookDeliveries = new WeakMap();

    async function deliverPendingWebhook(signer, requestId) {
        const previous = webhookDeliveries.get(signer) || Promise.resolve();
        const delivery = previous.catch(() => undefined).then(async () => {
            if (!signer.pending_webhook) {
                return { skipped: true, reason: 'already_delivered' };
            }

            const startedAt = process.hrtime.bigint();
            let result;

            try {
                result = await sendWebhook(signer.pending_webhook);
            } catch (error) {
                activityLog.add({
                    type: 'webhook',
                    request_id: requestId,
                    event_id: signer.pending_webhook.event.id,
                    event_type: signer.pending_webhook.event.type,
                    target: WEBHOOK_TARGET_URL,
                    duration_ms: elapsedMilliseconds(startedAt),
                    request: signer.pending_webhook,
                    response: { delivered: false, error: error.message },
                });

                throw error;
            }

            activityLog.add({
                type: 'webhook',
                request_id: requestId,
                event_id: signer.pending_webhook.event.id,
                event_type: signer.pending_webhook.event.type,
                target: WEBHOOK_TARGET_URL,
                duration_ms: elapsedMilliseconds(startedAt),
                request: signer.pending_webhook,
                response: result,
            });

            if (result.delivered) {
                delete signer.pending_webhook;
            }

            return result;
        });
        webhookDeliveries.set(signer, delivery);

        try {
            return await delivery;
        } finally {
            if (webhookDeliveries.get(signer) === delivery) {
                webhookDeliveries.delete(signer);
            }
        }
    }

    app.use(recordActivity(activityLog));
    app.use(simulateTimeout);
    app.use(express.json());

    app.get('/health', (req, res) => {
        res.json({ status: 'ok' });
    });

    app.use('/dashboard', setDashboardSecurityHeaders);
    app.get(['/dashboard', '/dashboard/'], (req, res) => {
        res.sendFile(path.join(DASHBOARD_DIR, 'index.html'));
    });
    app.use('/dashboard/assets', express.static(DASHBOARD_ASSETS_DIR, {
        etag: true,
        fallthrough: true,
        index: false,
        maxAge: 0,
    }));

    app.get('/dashboard/api/activity', (req, res) => {
        res.set('cache-control', 'no-store').json({ data: activityLog.list() });
    });

    app.get('/dashboard/api/stream', (req, res) => {
        res.status(200).set({
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'content-type': 'text/event-stream',
            'x-accel-buffering': 'no',
        });
        res.flushHeaders();
        res.write('retry: 3000\n\n');

        const unsubscribe = activityLog.subscribe((entry) => {
            if (!res.writableEnded) {
                sendSseEvent(res, 'activity', entry);
            }
        });
        sendSseEvent(res, 'snapshot', activityLog.list());

        const heartbeat = setInterval(() => {
            if (!res.writableEnded) {
                res.write(': keep-alive\n\n');
            }
        }, 15_000);
        heartbeat.unref();

        req.once('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
        });
    });

    app.post('/graphql', authenticateGraphql, receiveGraphqlUpload, async (req, res) => {
        const simulated = simulatedError(req);

        if (simulated) {
            res.status(simulated.status).json(simulated.body);

            return;
        }

        let operation;

        try {
            operation = parseGraphqlRequest(req);
            req.activityRequestBody = operation;
        } catch {
            res.status(400).json({ errors: [{ message: 'Malformed GraphQL request payload' }] });

            return;
        }

        if (!operation?.query || typeof operation.query !== 'string') {
            res.status(400).json({ errors: [{ message: 'GraphQL query is required' }] });

            return;
        }

        const rootValue = createRootValue({
            onApiSignerSigned: async ({ document, signer }) => {
                if (!signer.pending_webhook) {
                    signer.pending_webhook = buildWebhookPayload({
                        type: 'signature.accepted',
                        data: buildSignatureData({
                            documentId: document.id,
                            signer,
                            cpf: null,
                        }),
                    });
                }

                await deliverPendingWebhook(signer, req.activityRequestId);
            },
        });
        const result = await graphql({
            schema,
            source: operation.query,
            rootValue,
            variableValues: operation.variables,
            operationName: operation.operationName,
        });

        res.json(formatExecutionResult(result));
    });

    app.get('/files/:documentId/original.pdf', (req, res) => {
        const document = getDocument(req.params.documentId);

        if (!document) {
            res.sendStatus(404);

            return;
        }

        res.type('application/pdf').send(document.originalFile);
    });

    app.get('/files/:documentId/signed.pdf', (req, res) => {
        const document = getDocument(req.params.documentId);

        if (!document || !document.signed) {
            res.sendStatus(404);

            return;
        }

        res.type('application/pdf').send(document.signedFile);
    });

    app.post('/simulate/:publicId/sign', async (req, res) => {
        const simulated = simulatedError(req);

        if (simulated) {
            res.status(simulated.status).json(simulated.body);

            return;
        }

        const document = findBySignerPublicId(req.params.publicId);

        if (!document) {
            res.status(404).json(signatureNotFoundError().body);

            return;
        }

        const { cpf, email } = req.body || {};

        if (typeof cpf !== 'string' || !/^\d{11}$/.test(cpf)) {
            res.status(400).json({ errors: [{ message: 'cpf must contain exactly 11 digits' }] });

            return;
        }

        const signer = document.signatures.find((candidate) => (
            candidate.public_id === req.params.publicId
        ));

        try {
            const signing = await markSignerSigned(document, signer);
            if (signing.changed) {
                signer.pending_webhook = buildWebhookPayload({
                    type: 'signature.accepted',
                    data: buildSignatureData({ documentId: document.id, signer, cpf, email }),
                });
            }

            const webhookResult = signer.pending_webhook
                ? await deliverPendingWebhook(signer, req.activityRequestId)
                : { skipped: true, reason: 'already_signed' };

            res.json({
                signed: true,
                document_finished: signing.completed,
                signer_public_id: signer.public_id,
                webhook: webhookResult,
            });
        } catch (error) {
            logError(error, 'simulate-signature');
            res.status(500).json({ errors: [{ message: 'Failed to simulate signature' }] });
        }
    });

    app.get('/sign/:publicId', (req, res) => {
        const document = findBySignerPublicId(req.params.publicId);

        if (!document) {
            res.status(404).send('Signer not found.');

            return;
        }

        const signer = document.signatures.find((item) => item.public_id === req.params.publicId);
        res.type('html').send(renderSignPage(document, signer));
    });

    app.use((error, req, res, next) => {
        if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
            res.status(400).json({ errors: [{ message: 'Malformed JSON request payload' }] });

            return;
        }

        logError(error, 'http-request');
        res.status(500).json({ errors: [{ message: 'Internal server error' }] });
    });

    return app;
}

if (require.main === module) {
    createApp().listen(PORT, () => {
        process.stdout.write(`Autentique mock listening on port ${PORT}\n`);
    });
}

module.exports = { createApp };
