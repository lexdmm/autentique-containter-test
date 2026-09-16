/**
 * When SIMULATE_TIMEOUT=true, holds every request open and never responds,
 * so the real caller's own HTTP timeout (or lack of one) is what fires -
 * reproducing a real Autentique outage instead of a fast, clearly-fake error.
 */
function simulateTimeout(req, res, next) {
    if (process.env.SIMULATE_TIMEOUT !== 'true') {
        next();

        return;
    }

    req.socket.setTimeout(0);
}

module.exports = simulateTimeout;
