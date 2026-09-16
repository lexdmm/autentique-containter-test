const { buildSignedPdf } = require('./pdfStamp');
const { saveSignedPdf } = require('./downloads');

async function markDocumentSigned(document) {
    if (document.signed) {
        return document;
    }

    const signedAt = new Date().toISOString();
    document.signatures.forEach((signer) => {
        signer.signed_at = signedAt;
    });

    document.signedFile = await buildSignedPdf(document.originalFile, {
        documentId: document.id,
        signers: document.signatures,
    });
    document.signed = true;

    saveSignedPdf(document.id, document.signedFile);

    return document;
}

module.exports = { markDocumentSigned };
