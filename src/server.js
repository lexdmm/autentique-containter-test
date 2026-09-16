const express = require('express');
const simulateTimeout = require('./middleware/simulateTimeout');

const PORT = process.env.PORT || 4000;

const app = express();

app.use(simulateTimeout);

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    process.stdout.write(`Autentique mock listening on port ${PORT}\n`);
});
