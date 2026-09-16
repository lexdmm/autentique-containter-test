module.exports = {
    PORT: process.env.PORT || 4000,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || 'http://localhost:4100',
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || 'local-mock-secret',
    WEBHOOK_TARGET_URL: process.env.WEBHOOK_TARGET_URL
        || 'http://host.docker.internal:8080/api/webhooks/autentique',
    DOWNLOADS_DIR: process.env.DOWNLOADS_DIR || '/app/downloads',
};
