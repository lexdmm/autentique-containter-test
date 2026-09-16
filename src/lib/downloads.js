const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DOWNLOADS_DIR } = require('./config');

function savePdfAtomically(filename, buffer) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    const targetPath = path.join(DOWNLOADS_DIR, filename);
    const temporaryPath = `${targetPath}.${crypto.randomUUID()}.tmp`;

    try {
        fs.writeFileSync(temporaryPath, buffer, { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporaryPath, targetPath);
    } finally {
        if (fs.existsSync(temporaryPath)) {
            fs.unlinkSync(temporaryPath);
        }
    }
}

function saveOriginalPdf(documentId, buffer) {
    savePdfAtomically(`original-${documentId}.pdf`, buffer);
}

function saveSignedPdf(documentId, buffer) {
    savePdfAtomically(`signed-${documentId}.pdf`, buffer);
}

module.exports = { saveOriginalPdf, saveSignedPdf, DOWNLOADS_DIR };
