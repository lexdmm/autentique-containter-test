const crypto = require('crypto');
const { DASHBOARD_TOKEN } = require('../lib/config');

function tokensMatch(received, expected) {
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);

    return receivedBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function authenticateDashboard(req, res, next) {
    const authorization = req.get('authorization') || '';
    const prefix = 'Bearer ';
    const receivedToken = authorization.startsWith(prefix)
        ? authorization.slice(prefix.length)
        : '';

    if (!tokensMatch(receivedToken, DASHBOARD_TOKEN)) {
        res.set('www-authenticate', 'Bearer');
        res.status(401).json({ errors: [{ message: 'Unauthorized dashboard access' }] });

        return;
    }

    next();
}

module.exports = { authenticateDashboard };
