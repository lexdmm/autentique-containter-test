const fs = require('fs');
const path = require('path');
const { DOWNLOADS_DIR } = require('./config');

function saveOriginalPdf(documentId, buffer) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(DOWNLOADS_DIR, `original-${documentId}.pdf`), buffer);
}

function saveSignedPdf(documentId, buffer) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(DOWNLOADS_DIR, `signed-${documentId}.pdf`), buffer);
}

module.exports = { saveOriginalPdf, saveSignedPdf, DOWNLOADS_DIR };
