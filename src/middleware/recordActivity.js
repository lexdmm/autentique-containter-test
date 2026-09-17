const crypto = require('crypto');

function isMonitoredPath(path) {
    return path !== '/health' && path !== '/favicon.ico' && !path.startsWith('/dashboard');
}

function recordActivity(activityLog) {
    return (req, res, next) => {
        if (!isMonitoredPath(req.path)) {
            next();

            return;
        }

        const startedAt = process.hrtime.bigint();
        const requestId = crypto.randomUUID();
        const sendJson = res.json.bind(res);

        req.activityRequestId = requestId;
        res.set('x-request-id', requestId);
        res.json = (body) => {
            res.activityResponseBody = body;

            return sendJson(body);
        };
        res.once('finish', () => {
            const duration = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

            activityLog.add({
                type: 'http',
                request_id: requestId,
                method: req.method,
                path: req.path,
                status: res.statusCode,
                duration_ms: Math.round(duration * 100) / 100,
                request: {
                    headers: req.headers,
                    body: req.activityRequestBody ?? req.body ?? null,
                },
                response: {
                    headers: res.getHeaders(),
                    body: res.activityResponseBody ?? null,
                },
            });
        });

        next();
    };
}

module.exports = { recordActivity };
