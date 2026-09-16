const express = require('express');
const multer = require('multer');
const { graphql } = require('graphql');
const simulateTimeout = require('./middleware/simulateTimeout');
const {
    simulatedError,
    signatureNotFoundError,
    unauthorizedError,
    validationError,
} = require('./lib/errors');
const { getDocument, findBySignerPublicId } = require('./store');
const { markSignerSigned } = require('./lib/signing');
const { sendSignatureWebhook, buildSignatureData } = require('./lib/webhook');
const { renderSignPage } = require('./lib/signPage');
const { API_TOKEN, MAX_UPLOAD_BYTES, PORT } = require('./lib/config');
const { schema, rootValue } = require('./graphql/schema');

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

function createApp({ sendWebhook = sendSignatureWebhook } = {}) {
    const app = express();

    app.use(simulateTimeout);
    app.use(express.json());

    app.get('/health', (req, res) => {
        res.json({ status: 'ok' });
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
        } catch {
            res.status(400).json({ errors: [{ message: 'Malformed GraphQL request payload' }] });

            return;
        }

        if (!operation?.query || typeof operation.query !== 'string') {
            res.status(400).json({ errors: [{ message: 'GraphQL query is required' }] });

            return;
        }

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

        if (!cpf) {
            res.status(400).json({ errors: [{ message: 'cpf is required to simulate a driver signature' }] });

            return;
        }

        const signer = document.signatures.find((candidate) => (
            candidate.public_id === req.params.publicId
        ));

        try {
            const signing = await markSignerSigned(document, signer);
            const webhookResult = signing.changed
                ? await sendWebhook({
                    type: 'signature.accepted',
                    data: buildSignatureData({ documentId: document.id, signer, cpf, email }),
                })
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
