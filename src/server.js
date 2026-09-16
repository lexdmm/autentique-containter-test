const express = require('express');
const multer = require('multer');
const simulateTimeout = require('./middleware/simulateTimeout');
const { simulatedError, documentNotFoundError } = require('./lib/errors');
const { handleCreateDocument } = require('./graphql/createDocument');
const { handleDocumentQuery } = require('./graphql/documentQuery');
const { handleSignDocument } = require('./graphql/signDocument');
const { getDocument, findBySignerPublicId } = require('./store');
const { markDocumentSigned } = require('./lib/signing');
const { sendSignatureWebhook } = require('./lib/webhook');
const { renderSignPage } = require('./lib/signPage');

const PORT = process.env.PORT || 4000;
const upload = multer();

const app = express();

app.use(simulateTimeout);

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// createDocument arrives as multipart (operations+map+file); signDocument and
// the document query arrive as plain JSON. Multer skips non-multipart
// requests without consuming the body, so express.json() still sees them.
app.post('/graphql', upload.single('file'), express.json(), async (req, res) => {
    const simulated = simulatedError(req);

    if (simulated) {
        res.status(simulated.status).json(simulated.body);

        return;
    }

    let query;
    let variables;

    if (req.body.operations) {
        try {
            ({ query, variables } = JSON.parse(req.body.operations));
        } catch {
            res.status(400).json({ errors: [{ message: 'Malformed operations payload' }] });

            return;
        }
    } else {
        ({ query, variables } = req.body);
    }

    try {
        if (/\bcreateDocument\s*\(/.test(query)) {
            const result = handleCreateDocument(variables, req.file);
            res.status(result.status).json(result.body);

            return;
        }

        if (/\bsignDocument\s*\(/.test(query)) {
            const result = await handleSignDocument(variables);
            res.status(result.status).json(result.body);

            return;
        }

        if (/\bdocument\s*\(/.test(query)) {
            const result = handleDocumentQuery(variables);
            res.status(result.status).json(result.body);

            return;
        }

        res.status(400).json({ errors: [{ message: 'Unknown or not-yet-implemented operation' }] });
    } catch (error) {
        res.status(500).json({ errors: [{ message: `Mock crashed handling this request: ${error.message}` }] });
    }
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

// Stands in for the driver actually opening the signature link and signing
// for real on Autentique's side: marks the document signed, generates the
// stamped PDF, and fires the same webhook Autentique would send afterwards.
app.post('/simulate/:documentId/sign', express.json(), async (req, res) => {
    const simulated = simulatedError(req);

    if (simulated) {
        res.status(simulated.status).json(simulated.body);

        return;
    }

    const document = getDocument(req.params.documentId);

    if (!document) {
        res.status(404).json(documentNotFoundError().body);

        return;
    }

    const { cpf, email } = req.body || {};

    if (!cpf) {
        res.status(400).json({ errors: [{ message: 'cpf is required to simulate a driver signature' }] });

        return;
    }

    try {
        await markDocumentSigned(document);

        const signer = document.signatures[0];
        const webhookResult = await sendSignatureWebhook({
            type: 'signature.accepted',
            data: {
                document: document.id,
                public_id: signer?.public_id ?? null,
                signed: new Date().toISOString(),
                user: { cpf, email: email ?? signer?.email ?? null },
            },
        });

        res.json({ signed: true, webhook: webhookResult });
    } catch (error) {
        res.status(500).json({ errors: [{ message: `Failed to simulate signature: ${error.message}` }] });
    }
});

// This is what a signer's `link.short_link` points to in real Autentique - a
// hosted page where they review and sign. Here it's a stand-in with one
// button that calls the same /simulate/:documentId/sign endpoint above.
app.get('/sign/:publicId', (req, res) => {
    const document = findBySignerPublicId(req.params.publicId);

    if (!document) {
        res.status(404).send('Signer not found.');

        return;
    }

    const signer = document.signatures.find((s) => s.public_id === req.params.publicId);
    res.type('html').send(renderSignPage(document, signer));
});

app.listen(PORT, () => {
    process.stdout.write(`Autentique mock listening on port ${PORT}\n`);
});
