module.exports = {
    PORT: process.env.PORT || 4000,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || 'http://localhost:4100',
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || 'local-mock-secret',
    PX_TORRE_CORE_WEBHOOK_URL: process.env.PX_TORRE_CORE_WEBHOOK_URL
        || 'http://host.docker.internal:8080/api/webhooks/documents/signature',
    DOWNLOADS_DIR: process.env.DOWNLOADS_DIR || '/app/downloads',
};
