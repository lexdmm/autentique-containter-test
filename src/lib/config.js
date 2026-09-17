function positiveInteger(name, fallback) {
    const value = Number(process.env[name] || fallback);

    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }

    return value;
}

module.exports = {
    API_TOKEN: process.env.AUTENTIQUE_API_TOKEN || 'fake-local-token',
    API_USER_EMAIL: (process.env.AUTENTIQUE_API_USER_EMAIL || 'api-owner@example.test').toLowerCase(),
    MAX_UPLOAD_BYTES: positiveInteger('MAX_UPLOAD_BYTES', 10 * 1024 * 1024),
    PORT: process.env.PORT || 4000,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || 'http://localhost:4100',
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || 'local-mock-secret',
    WEBHOOK_TARGET_URL: process.env.WEBHOOK_TARGET_URL
        || 'http://host.docker.internal:8080/api/webhooks/autentique',
    DOWNLOADS_DIR: process.env.DOWNLOADS_DIR || '/app/downloads',
};
