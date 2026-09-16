const express = require('express');
const multer = require('multer');
const simulateTimeout = require('./middleware/simulateTimeout');
const { simulatedError } = require('./lib/errors');
const { handleCreateDocument } = require('./graphql/createDocument');

const PORT = process.env.PORT || 4000;
const upload = multer();

const app = express();

app.use(simulateTimeout);

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.post('/graphql', upload.single('file'), (req, res) => {
    const simulated = simulatedError(req);

    if (simulated) {
        res.status(simulated.status).json(simulated.body);

        return;
    }

    let operations;

    try {
        operations = JSON.parse(req.body.operations);
    } catch {
        res.status(400).json({ errors: [{ message: 'Malformed operations payload' }] });

        return;
    }

    const { query, variables } = operations;

    if (/\bcreateDocument\s*\(/.test(query)) {
        const result = handleCreateDocument(variables, req.file);
        res.status(result.status).json(result.body);

        return;
    }

    res.status(400).json({ errors: [{ message: 'Unknown or not-yet-implemented operation' }] });
});

app.listen(PORT, () => {
    process.stdout.write(`Autentique mock listening on port ${PORT}\n`);
});
