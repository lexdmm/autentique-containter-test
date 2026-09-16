const express = require('express');
const multer = require('multer');
const simulateTimeout = require('./middleware/simulateTimeout');
const { simulatedError } = require('./lib/errors');
const { handleCreateDocument } = require('./graphql/createDocument');
const { handleDocumentQuery } = require('./graphql/documentQuery');
const { getDocument } = require('./store');

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
app.post('/graphql', upload.single('file'), express.json(), (req, res) => {
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

    if (/\bcreateDocument\s*\(/.test(query)) {
        const result = handleCreateDocument(variables, req.file);
        res.status(result.status).json(result.body);

        return;
    }

    if (/\bdocument\s*\(/.test(query)) {
        const result = handleDocumentQuery(variables);
        res.status(result.status).json(result.body);

        return;
    }

    res.status(400).json({ errors: [{ message: 'Unknown or not-yet-implemented operation' }] });
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

app.listen(PORT, () => {
    process.stdout.write(`Autentique mock listening on port ${PORT}\n`);
});
