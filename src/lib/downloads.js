const fs = require('fs');
const path = require('path');

const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || '/app/downloads';

function saveOriginalPdf(documentId, buffer) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(DOWNLOADS_DIR, `original-${documentId}.pdf`), buffer);
}

module.exports = { saveOriginalPdf, DOWNLOADS_DIR };
